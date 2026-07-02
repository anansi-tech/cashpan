/**
 * Vault registry — maps identityKey → vault + cap IDs + per-user contacts.
 *
 * identityKey is the zkLogin `sub`.
 *
 * Fields reserved for later blocks:
 *   eventCursor  — Block 3: durable deposit-event cursor per vault
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
  eventCursor?: string;
  rebalanceCursor?: string;
  contacts?: Contact[];
  buffer?: string;
  band?: string;
  savingsPrincipal?: string;
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
  eventCursor:      { type: String },
  rebalanceCursor:  { type: String },
  contacts:         { type: [ContactSchema], default: [] },
  buffer:           { type: String },
  band:             { type: String },
  savingsPrincipal: { type: String, default: '0' },
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

// ─── Cursor (watcher durable bookmark) ───────────────────────────────────────

export async function updateCursor(identityKey: string, cursor: string): Promise<void> {
  await connectDB();
  await getModel().updateOne({ identityKey }, { $set: { eventCursor: cursor } });
}

export async function updateRebalanceCursor(identityKey: string, cursor: string): Promise<void> {
  await connectDB();
  await getModel().updateOne({ identityKey }, { $set: { rebalanceCursor: cursor } });
}

// ─── Savings principal (cost-basis tracking) ──────────────────────────────────

export async function updateSavingsPrincipal(identityKey: string, newPrincipal: bigint): Promise<void> {
  await connectDB();
  await getModel().updateOne({ identityKey }, { $set: { savingsPrincipal: newPrincipal.toString() } });
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
