/**
 * replay_checkpoints — Mongo cache of the principal fold's own output.
 *
 * Written ONLY by getReplayedPrincipal after a successful fold. No other
 * writer exists, ever. This is a cache, not truth: the value is derived
 * deterministically from chain events, so a missing/corrupt/stale row just
 * triggers a full genesis replay that rewrites it (self-healing — absence is
 * a handled state; no backfill needed).
 *
 * This does NOT reintroduce the savingsPrincipal drift bug: that was two
 * writers mutating authoritative state. This is one pure function caching
 * itself, rebuild-identical on loss.
 */

import mongoose, { Schema, Model, Document } from 'mongoose';
import { connectDB } from './connection';
import { suiNetwork } from '../sui';

export interface ReplayCheckpoint {
  vaultId: string;
  network: string;
  cursor: string | null;
  principal: string; // bigint as string
  eventCount: number;
  updatedAt: Date;
}

type CheckpointDoc = ReplayCheckpoint & Document;

function getModel(): Model<CheckpointDoc> {
  return (mongoose.models.ReplayCheckpoint as Model<CheckpointDoc>) ??
    mongoose.model<CheckpointDoc>('ReplayCheckpoint', new Schema<CheckpointDoc>({
      vaultId:    { type: String, required: true },
      network:    { type: String, required: true },
      cursor:     { type: String, default: null },
      principal:  { type: String, required: true },
      eventCount: { type: Number, default: 0 },
      updatedAt:  { type: Date, required: true },
    }, { collection: 'replay_checkpoints' }).index({ vaultId: 1, network: 1 }, { unique: true }));
}

export async function getReplayCheckpoint(vaultId: string): Promise<ReplayCheckpoint | null> {
  await connectDB();
  const doc = await getModel().findOne({ vaultId, network: suiNetwork() }).lean();
  return doc as ReplayCheckpoint | null;
}

export async function saveReplayCheckpoint(cp: Omit<ReplayCheckpoint, 'network' | 'updatedAt'>): Promise<void> {
  await connectDB();
  await getModel().updateOne(
    { vaultId: cp.vaultId, network: suiNetwork() },
    { $set: { cursor: cp.cursor, principal: cp.principal, eventCount: cp.eventCount, updatedAt: new Date() } },
    { upsert: true },
  );
}
