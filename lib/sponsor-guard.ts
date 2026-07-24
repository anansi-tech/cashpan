/**
 * Sponsor whitelist — what our Shinami gas station is allowed to co-sign.
 *
 * /api/sponsor's generic branch accepts a CLIENT-serialized PTB. Without this,
 * anyone with a session could get an arbitrary transaction sponsored (gas
 * theft + sponsoring malicious txs under our account). We validate the BUILT
 * transaction — every command, not first-match — so a mixed PTB (one legit
 * call + one attacker call) fails.
 *
 * Allowed shape (matches every real client-serialized flow):
 *   - MoveCall to <our package>::vault::<entrypoint below>
 *   - TransferObjects (moves the caller's own call results / owned objects)
 * Anything else — foreign moveCall, Publish, Upgrade, SplitCoins, MakeMoveVec —
 * is rejected. deposit/walletSend PTBs are server-BUILT (never client-supplied),
 * so they don't pass through here.
 */

const ALLOWED_FUNCTIONS = new Set([
  'owner_send',
  'withdraw',
  'owner_rebalance',
  'redeem_position',
  'create_vault',
  'deposit',
  // Autopilot enable/disable — owner-signed, sponsored like the other owner
  // verbs. Both are capability-scoped by the Move layer (OwnerCap required).
  'issue_agent_cap',
  'revoke',
  // Phase B allowlist management — owner-signed (OwnerCap-gated in Move).
  // agent_send itself stays OFF this list: the agent pays its own gas, and
  // sponsoring it would let any session drain the gas station.
  'add_payee',
  'remove_payee',
]);

const ALLOWED_MODULE = 'vault';

/** Normalize a Sui address/package id to lowercase 0x + 64 hex for comparison. */
export function normalizeSuiAddress(addr: string): string {
  const hex = addr.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]+$/.test(hex) || hex.length === 0 || hex.length > 64) return '';
  return '0x' + hex.padStart(64, '0');
}

export interface SponsorCommand {
  $kind: string;
  MoveCall?: { package?: string; module?: string; function?: string };
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Pure validator: every command must be an allowed vault MoveCall or a
 * TransferObjects. `allowedPackages` is the normalized set {PACKAGE_ID,
 * PACKAGE_ID_LATEST}.
 */
export function validateSponsorCommands(commands: SponsorCommand[], allowedPackages: Set<string>): GuardResult {
  if (!Array.isArray(commands) || commands.length === 0) {
    return { ok: false, reason: 'empty transaction' };
  }
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (cmd.$kind === 'TransferObjects') continue;
    if (cmd.$kind !== 'MoveCall' || !cmd.MoveCall) {
      return { ok: false, reason: `command ${i} is ${cmd.$kind} — only MoveCall/TransferObjects allowed` };
    }
    const { package: pkg, module, function: fn } = cmd.MoveCall;
    if (!pkg || !allowedPackages.has(normalizeSuiAddress(pkg))) {
      return { ok: false, reason: `command ${i} calls foreign package ${pkg}` };
    }
    if (module !== ALLOWED_MODULE || !fn || !ALLOWED_FUNCTIONS.has(fn)) {
      return { ok: false, reason: `command ${i} calls disallowed ${module}::${fn}` };
    }
  }
  return { ok: true };
}

/** The set of vault entrypoints requiring an existing, owned vault (i.e. not create_vault). */
export function isProvisioningOnly(commands: SponsorCommand[]): boolean {
  const fns = commands.filter((c) => c.$kind === 'MoveCall').map((c) => c.MoveCall?.function);
  return fns.length > 0 && fns.every((f) => f === 'create_vault');
}
