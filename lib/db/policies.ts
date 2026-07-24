/**
 * Scheduled-send policies (owner intent — storing is correct) and the
 * policy_runs idempotency ledger (the load-bearing piece of Phase B).
 *
 * EXACTLY-ONCE PROTOCOL — every executor MUST go through claimRun():
 *   1. claimRun(policyId, period) inserts {status:'executing'} — a duplicate
 *      key means another run owns this period: SKIP.
 *   2. build + sign + submit agent_send.
 *   3. markSent(digest) on success; markFailed(error) on failure.
 * Crash between 1 and 3 leaves an 'executing' row; recovery verifies AGAINST
 * CHAIN before anything else (see worker/policies.ts). The standing rule:
 * when uncertain whether money moved, STOP and surface — never resend.
 *
 * Retries stay within the SAME period (no catchup): reclaimFailedRun() flips
 * 'failed' → 'executing' atomically, so two workers can never both retry.
 */

import mongoose, { Schema, Model, Document, Types } from 'mongoose';
import { connectDB } from './connection';
import type { PolicySchedule } from '../policy-schedule';

export type PolicyStatus = 'active' | 'paused' | 'ended' | 'failed';

export interface PolicyRecord {
  _id: string;
  vaultId: string;
  network: string;
  type: 'scheduled_send';
  recipient: { address: string; label: string };
  /** Fixed amount, base units (v1 — no percentages, no "rest"). */
  amountBase: string;
  schedule: PolicySchedule;
  status: PolicyStatus;
  createdAt: Date;
  /** Last period this policy successfully sent in, e.g. '2026-W31'. */
  lastRunPeriod?: string;
  endAt?: Date;
  note?: string;
}

export type RunStatus = 'executing' | 'sent' | 'failed';

export interface PolicyRunRecord {
  _id: string;
  policyId: string;
  period: string;
  status: RunStatus;
  amountBase: string;
  vaultId: string;
  attempts: number;
  startedAt: Date;
  lastAttemptAt: Date;
  digest?: string;
  error?: string;
  /** Owner tapped the failure card — stops surfacing it. */
  acknowledged?: boolean;
}

type PolicyDoc = Omit<PolicyRecord, '_id'> & Document;
type RunDoc = Omit<PolicyRunRecord, '_id'> & Document;

const PolicySchema = new Schema<PolicyDoc>({
  vaultId:   { type: String, required: true, index: true },
  network:   { type: String, required: true },
  type:      { type: String, required: true, default: 'scheduled_send' },
  recipient: {
    type: new Schema({ address: { type: String, required: true }, label: { type: String, required: true } }, { _id: false }),
    required: true,
  },
  amountBase: { type: String, required: true },
  schedule:   { type: Schema.Types.Mixed, required: true },
  status:     { type: String, required: true, default: 'active' },
  createdAt:  { type: Date, default: () => new Date() },
  lastRunPeriod: { type: String },
  endAt:      { type: Date },
  note:       { type: String },
});
PolicySchema.index({ vaultId: 1, status: 1 });

const RunSchema = new Schema<RunDoc>({
  policyId:      { type: String, required: true },
  period:        { type: String, required: true },
  status:        { type: String, required: true },
  amountBase:    { type: String, required: true },
  vaultId:       { type: String, required: true },
  attempts:      { type: Number, required: true, default: 1 },
  startedAt:     { type: Date, default: () => new Date() },
  lastAttemptAt: { type: Date, default: () => new Date() },
  digest:        { type: String },
  error:         { type: String },
  acknowledged:  { type: Boolean },
});
// THE exactly-once guarantee. Never drop or loosen this index.
RunSchema.index({ policyId: 1, period: 1 }, { unique: true });

function policyModel(): Model<PolicyDoc> {
  return (mongoose.models.Policy as Model<PolicyDoc>) ?? mongoose.model<PolicyDoc>('Policy', PolicySchema);
}
function runModel(): Model<RunDoc> {
  return (mongoose.models.PolicyRun as Model<RunDoc>) ?? mongoose.model<RunDoc>('PolicyRun', RunSchema, 'policy_runs');
}

const toRecord = <T>(doc: unknown): T => {
  const o = doc as { _id: Types.ObjectId } & Record<string, unknown>;
  return { ...o, _id: String(o._id) } as T;
};

// ─── Policy CRUD (API routes; all callers scope by the session's own vaultId) ─

export async function createPolicy(
  p: Omit<PolicyRecord, '_id' | 'createdAt' | 'status' | 'type'> & { status?: PolicyStatus },
): Promise<PolicyRecord> {
  await connectDB();
  const doc = await policyModel().create({ ...p, type: 'scheduled_send', status: p.status ?? 'active' });
  return toRecord<PolicyRecord>(doc.toObject());
}

export async function listPolicies(vaultId: string, network: string): Promise<PolicyRecord[]> {
  await connectDB();
  const docs = await policyModel()
    .find({ vaultId, network, status: { $ne: 'ended' } })
    .sort({ createdAt: -1 })
    .lean();
  return docs.map((d) => toRecord<PolicyRecord>(d));
}

export async function getPolicy(id: string, vaultId: string): Promise<PolicyRecord | null> {
  await connectDB();
  if (!Types.ObjectId.isValid(id)) return null;
  const doc = await policyModel().findOne({ _id: id, vaultId }).lean();
  return doc ? toRecord<PolicyRecord>(doc) : null;
}

/** Pause / resume / end. Scoped to the vault so a session can only touch its own. */
export async function setPolicyStatus(id: string, vaultId: string, status: PolicyStatus): Promise<boolean> {
  await connectDB();
  if (!Types.ObjectId.isValid(id)) return false;
  const r = await policyModel().updateOne({ _id: id, vaultId }, { $set: { status } });
  return r.matchedCount > 0;
}

export async function deletePolicy(id: string, vaultId: string): Promise<boolean> {
  await connectDB();
  if (!Types.ObjectId.isValid(id)) return false;
  const r = await policyModel().deleteOne({ _id: id, vaultId });
  return r.deletedCount > 0;
}

// ─── Worker queries ───────────────────────────────────────────────────────────

/** All active policies across the given vaults (one query per tick). */
export async function listActivePolicies(vaultIds: string[], network: string): Promise<PolicyRecord[]> {
  if (vaultIds.length === 0) return [];
  await connectDB();
  const docs = await policyModel().find({ network, status: 'active', vaultId: { $in: vaultIds } }).lean();
  return docs.map((d) => toRecord<PolicyRecord>(d));
}

/** Worker-only unscoped lookup (crash recovery joins run → policy). */
export async function getPolicyById(id: string): Promise<PolicyRecord | null> {
  await connectDB();
  if (!Types.ObjectId.isValid(id)) return null;
  const doc = await policyModel().findById(id).lean();
  return doc ? toRecord<PolicyRecord>(doc) : null;
}

export async function markPolicyRan(id: string, period: string, ended: boolean): Promise<void> {
  await connectDB();
  await policyModel().updateOne(
    { _id: id },
    { $set: { lastRunPeriod: period, ...(ended ? { status: 'ended' as PolicyStatus } : {}) } },
  );
}

/** Repeated hard failures → park the policy; the owner must resume it. */
export async function markPolicyFailed(id: string): Promise<void> {
  await connectDB();
  await policyModel().updateOne({ _id: id }, { $set: { status: 'failed' } });
}

// ─── Idempotency ledger ───────────────────────────────────────────────────────

export async function getRun(policyId: string, period: string): Promise<PolicyRunRecord | null> {
  await connectDB();
  const doc = await runModel().findOne({ policyId, period }).lean();
  return doc ? toRecord<PolicyRunRecord>(doc) : null;
}

/**
 * Step 1 of the protocol: claim (policyId, period) by inserting 'executing'.
 * Returns the run id, or null if the period is already claimed (E11000) —
 * null ALWAYS means skip, never retry-around.
 */
export async function claimRun(
  policyId: string,
  period: string,
  vaultId: string,
  amountBase: string,
): Promise<string | null> {
  await connectDB();
  try {
    const doc = await runModel().create({
      policyId, period, vaultId, amountBase,
      status: 'executing', attempts: 1,
      startedAt: new Date(), lastAttemptAt: new Date(),
    });
    return String(doc._id);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return null;
    throw err;
  }
}

/**
 * Atomically flip an existing 'failed' row back to 'executing' for a retry
 * WITHIN the same period. The status filter makes the claim race-safe.
 */
export async function reclaimFailedRun(runId: string): Promise<boolean> {
  await connectDB();
  const r = await runModel().updateOne(
    { _id: runId, status: 'failed' },
    {
      $set: { status: 'executing', lastAttemptAt: new Date() },
      $inc: { attempts: 1 },
      // A retry is a NEW outcome — an ack of the previous failure must not
      // hide whatever this attempt produces.
      $unset: { acknowledged: 1 },
    },
  );
  return r.modifiedCount > 0;
}

export async function markRunSent(runId: string, digest: string): Promise<void> {
  await connectDB();
  await runModel().updateOne({ _id: runId }, { $set: { status: 'sent', digest } });
}

export async function markRunFailed(runId: string, error: string): Promise<void> {
  await connectDB();
  await runModel().updateOne({ _id: runId }, { $set: { status: 'failed', error: error.slice(0, 300) } });
}

/** Crash recovery: 'executing' rows older than the threshold, worker-wide. */
export async function listStaleExecutingRuns(olderThanMs: number): Promise<PolicyRunRecord[]> {
  await connectDB();
  const cutoff = new Date(Date.now() - olderThanMs);
  const docs = await runModel().find({ status: 'executing', lastAttemptAt: { $lt: cutoff } }).lean();
  return docs.map((d) => toRecord<PolicyRunRecord>(d));
}

/** Unacknowledged failures for the owner's notify card (joined by the caller). */
export async function listUnacknowledgedFailures(vaultId: string): Promise<PolicyRunRecord[]> {
  await connectDB();
  const docs = await runModel()
    .find({ vaultId, status: 'failed', acknowledged: { $ne: true } })
    .sort({ lastAttemptAt: -1 })
    .lean();
  return docs.map((d) => toRecord<PolicyRunRecord>(d));
}

export async function acknowledgeRun(runId: string, vaultId: string): Promise<boolean> {
  await connectDB();
  if (!Types.ObjectId.isValid(runId)) return false;
  const r = await runModel().updateOne({ _id: runId, vaultId }, { $set: { acknowledged: true } });
  return r.matchedCount > 0;
}
