/**
 * Vault registry — maps identityKey → vault + cap IDs.
 *
 * identityKey is a dev-placeholder string in Block 1 (e.g. "alice", "bob").
 * Block 2 swaps it for a zkLogin `sub` — only this file changes.
 *
 * Fields reserved for later blocks:
 *   eventCursor  — Block 3: durable deposit-event cursor per vault
 *   payees       — later: per-user label → address map
 */

import mongoose, { Schema, Model, Document } from 'mongoose';
import { connectDB } from './connection';

export interface VaultRecord {
  identityKey: string;
  vaultId: string;
  ownerCapId: string;
  agentCapId?: string;       // Block 2: not issued; Block 4+ Autopilot
  payoutAddress: string;
  coinType: string;
  salt?: string;             // zkLogin salt (base64); stored for audit / address re-derivation
  createdAt: Date;
  // Reserved for Block 3:
  eventCursor?: string;
  // Reserved for payee management:
  payees?: Record<string, string>;
}

type VaultDoc = VaultRecord & Document;

const VaultSchema = new Schema<VaultDoc>({
  identityKey:   { type: String, required: true, unique: true, index: true },
  vaultId:       { type: String, required: true },
  ownerCapId:    { type: String, required: true },
  agentCapId:    { type: String },
  payoutAddress: { type: String, required: true },
  coinType:      { type: String, required: true },
  salt:          { type: String },
  createdAt:     { type: Date, default: () => new Date() },
  eventCursor:   { type: String },
  payees:        { type: Map, of: String },
});

function getModel(): Model<VaultDoc> {
  return (mongoose.models.Vault as Model<VaultDoc>) ??
    mongoose.model<VaultDoc>('Vault', VaultSchema);
}

export async function registerVault(record: Omit<VaultRecord, 'createdAt' | 'agentCapId'> & { agentCapId?: string }): Promise<VaultRecord> {
  await connectDB();
  const VaultModel = getModel();
  const doc = await VaultModel.findOneAndUpdate(
    { identityKey: record.identityKey },
    { $set: record },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return doc!.toObject();
}

export async function getByIdentity(identityKey: string): Promise<VaultRecord | null> {
  await connectDB();
  const doc = await getModel().findOne({ identityKey }).lean();
  return doc as VaultRecord | null;
}

export async function listVaults(): Promise<VaultRecord[]> {
  await connectDB();
  return getModel().find({}).lean() as Promise<VaultRecord[]>;
}

export async function getActiveVault(identityKey: string): Promise<VaultRecord | null> {
  return getByIdentity(identityKey);
}
