/**
 * Vault registry — maps identityKey → vault + cap IDs + per-user contacts.
 *
 * identityKey is the zkLogin `sub`.
 */

import mongoose, { Schema, Model, Document } from 'mongoose';
import { connectDB } from './connection';

export interface Contact {
  label: string;
  address: string;
  createdAt: Date;
}

export interface VaultRecord {
  identityKey: string;
  network: string;
  vaultId: string;
  ownerCapId: string;
  agentCapId?: string;
  payoutAddress: string;
  coinType: string;
  salt?: string;
  createdAt: Date;
  contacts?: Contact[];
  buffer?: string;
  band?: string;
  /** Coinbase offramp deposit addresses seen for this user — pure label cache
      so cash-out sends read "Coinbase (cash out)" in activity. Optional, unqueried. */
  offrampAddresses?: string[];
  /** Autopilot = OWNER INTENT (not derived), so storing it is correct.
      Absent = disabled; no backfill needed (absence is a handled state). */
  autopilot?: Autopilot;
}

export interface Autopilot {
  enabled: boolean;
  /** AgentCap minted to the service agent address at enable time. */
  agentCapId?: string;
  /** User-chosen soft daily limit, base units — enforced by the WORKER.
      The chain's own per_tx/daily caps are the immutable hard bound. */
  dailyCapBase?: string;
  enabledAt?: Date;
  /** Set by the worker after repeated on-chain aborts; owner must re-enable. */
  suspended?: boolean;
  suspendReason?: string;
}

type VaultDoc = VaultRecord & Document;

const ContactSchema = new Schema<Contact>(
  {
    label:     { type: String, required: true },
    address:   { type: String, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const VaultSchema = new Schema<VaultDoc>({
  identityKey:      { type: String, required: true, index: true },
  network:          { type: String, required: true, default: 'mainnet' },
  vaultId:          { type: String, required: true },
  ownerCapId:       { type: String, required: true },
  agentCapId:       { type: String },
  payoutAddress:    { type: String, required: true },
  coinType:         { type: String, required: true },
  salt:             { type: String },
  createdAt:        { type: Date, default: () => new Date() },
  contacts:         { type: [ContactSchema], default: [] },
  buffer:           { type: String },
  band:             { type: String },
  offrampAddresses: { type: [String], default: [] },
  autopilot: {
    type: new Schema<Autopilot>({
      enabled:       { type: Boolean, required: true },
      agentCapId:    { type: String },
      dailyCapBase:  { type: String },
      enabledAt:     { type: Date },
      suspended:     { type: Boolean },
      suspendReason: { type: String },
    }, { _id: false }),
    required: false,
  },
});
VaultSchema.index({ identityKey: 1, network: 1 }, { unique: true });

function getModel(): Model<VaultDoc> {
  return (mongoose.models.Vault as Model<VaultDoc>) ??
    mongoose.model<VaultDoc>('Vault', VaultSchema);
}

export async function registerVault(record: Omit<VaultRecord, 'createdAt' | 'agentCapId'> & { agentCapId?: string }): Promise<VaultRecord> {
  await connectDB();
  const VaultModel = getModel();
  const doc = await VaultModel.findOneAndUpdate(
    { identityKey: record.identityKey, network: record.network },
    { $set: record },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  return doc!.toObject();
}

export async function getByIdentity(identityKey: string, network = 'mainnet'): Promise<VaultRecord | null> {
  await connectDB();
  const doc = await getModel().findOne({ identityKey, network }).lean();
  return doc as VaultRecord | null;
}

export async function listVaults(network?: string): Promise<VaultRecord[]> {
  await connectDB();
  const filter = network ? { network } : {};
  return getModel().find(filter).lean() as Promise<VaultRecord[]>;
}

export async function getActiveVault(identityKey: string, network = 'mainnet'): Promise<VaultRecord | null> {
  return getByIdentity(identityKey, network);
}

// ─── Settings (per-user buffer/band) ─────────────────────────────────────────

export async function updateSettings(identityKey: string, settings: { buffer?: string; band?: string }): Promise<void> {
  await connectDB();
  await getModel().updateOne({ identityKey }, { $set: settings });
}

// ─── Autopilot (owner intent) ─────────────────────────────────────────────────

export async function setAutopilot(identityKey: string, autopilot: Autopilot): Promise<void> {
  await connectDB();
  await getModel().updateOne({ identityKey }, { $set: { autopilot } });
}

/** Worker: every vault with autopilot on and not suspended, for this network. */
export async function listAutopilotVaults(network: string): Promise<VaultRecord[]> {
  await connectDB();
  return getModel().find({
    network,
    'autopilot.enabled': true,
    'autopilot.suspended': { $ne: true },
  }).lean() as Promise<VaultRecord[]>;
}

/** Worker: park a vault after repeated on-chain aborts — owner must re-enable. */
export async function suspendAutopilot(identityKey: string, reason: string): Promise<void> {
  await connectDB();
  await getModel().updateOne(
    { identityKey },
    { $set: { 'autopilot.suspended': true, 'autopilot.suspendReason': reason } },
  );
}

// ─── Offramp deposit addresses (activity label cache) ─────────────────────────

export async function addOfframpAddress(identityKey: string, address: string): Promise<void> {
  await connectDB();
  await getModel().updateOne({ identityKey }, { $addToSet: { offrampAddresses: address } });
}

// ─── Contacts (per-user address book) ────────────────────────────────────────

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

export async function listContacts(identityKey: string): Promise<Contact[]> {
  await connectDB();
  const doc = await getModel().findOne({ identityKey }).select('contacts').lean();
  return (doc as VaultRecord | null)?.contacts ?? [];
}

export async function addContact(identityKey: string, label: string, address: string): Promise<Contact> {
  if (!label.trim()) throw new Error('Label is required');
  if (!SUI_ADDRESS_RE.test(address.trim())) throw new Error('Invalid Sui address (must be 0x + 64 hex chars)');
  await connectDB();
  const contact: Contact = { label: label.trim(), address: address.trim(), createdAt: new Date() };
  await getModel().updateOne(
    { identityKey },
    { $push: { contacts: contact } },
  );
  return contact;
}

export async function removeContact(identityKey: string, label: string): Promise<void> {
  await connectDB();
  await getModel().updateOne(
    { identityKey },
    { $pull: { contacts: { label } } },
  );
}

export async function patchContact(
  identityKey: string,
  oldLabel: string,
  newLabel: string,
  newAddress: string,
): Promise<void> {
  if (!newLabel.trim()) throw new Error('Label is required');
  if (!SUI_ADDRESS_RE.test(newAddress.trim())) throw new Error('Invalid Sui address (must be 0x + 64 hex chars)');
  await connectDB();
  await getModel().updateOne(
    { identityKey, 'contacts.label': oldLabel },
    { $set: { 'contacts.$.label': newLabel.trim(), 'contacts.$.address': newAddress.trim() } },
  );
}
