/**
 * Sponsor whitelist. The generic /api/sponsor branch co-signs a client PTB;
 * this gate is what stops an attacker getting an arbitrary transaction
 * sponsored. Every command is checked — a mixed PTB (legit + attacker call)
 * must fail.
 */

import { validateSponsorCommands, isProvisioningOnly, normalizeSuiAddress, type SponsorCommand } from '../lib/sponsor-guard.js';

const PKG = '0x' + '9'.repeat(64);
const FOREIGN = '0x' + 'f'.repeat(64);
const allowed = new Set([normalizeSuiAddress(PKG)]);

const mv = (pkg: string, fn: string): SponsorCommand => ({ $kind: 'MoveCall', MoveCall: { package: pkg, module: 'vault', function: fn } });
const transfer = (): SponsorCommand => ({ $kind: 'TransferObjects' });

describe('validateSponsorCommands', () => {
  test.each(['owner_send', 'withdraw', 'owner_rebalance', 'redeem_position', 'create_vault', 'deposit'])(
    'accepts vault::%s', (fn) => {
      expect(validateSponsorCommands([mv(PKG, fn)], allowed).ok).toBe(true);
    });

  test('accepts MoveCall + TransferObjects (withdraw, create_vault shapes)', () => {
    expect(validateSponsorCommands([mv(PKG, 'withdraw'), transfer()], allowed).ok).toBe(true);
  });

  test('accepts a package id with different 0x-padding (normalized compare)', () => {
    // Same address value, short form in the allowed set vs padded in the call.
    const shortForm = '0xabc';
    const paddedForm = '0x' + 'abc'.padStart(64, '0');
    const set = new Set([normalizeSuiAddress(shortForm)]);
    expect(validateSponsorCommands([mv(paddedForm, 'withdraw')], set).ok).toBe(true);
  });

  test('REJECTS a foreign package', () => {
    const r = validateSponsorCommands([mv(FOREIGN, 'withdraw')], allowed);
    expect(r.ok).toBe(false);
  });

  test('REJECTS a non-whitelisted vault function (e.g. revoke)', () => {
    expect(validateSponsorCommands([mv(PKG, 'revoke')], allowed).ok).toBe(false);
    expect(validateSponsorCommands([mv(PKG, 'issue_agent_cap')], allowed).ok).toBe(false);
  });

  test('REJECTS a call to the wrong module', () => {
    expect(validateSponsorCommands([{ $kind: 'MoveCall', MoveCall: { package: PKG, module: 'evil', function: 'withdraw' } }], allowed).ok).toBe(false);
  });

  test('THE mixed-PTB attack: legit call + attacker call fails at command 1', () => {
    const r = validateSponsorCommands([mv(PKG, 'owner_rebalance'), mv(FOREIGN, 'drain')], allowed);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('command 1');
  });

  test('attacker call FIRST also fails', () => {
    expect(validateSponsorCommands([mv(FOREIGN, 'drain'), mv(PKG, 'owner_rebalance')], allowed).ok).toBe(false);
  });

  test('REJECTS non-MoveCall/Transfer commands (Publish, SplitCoins, MakeMoveVec)', () => {
    for (const kind of ['Publish', 'Upgrade', 'SplitCoins', 'MergeCoins', 'MakeMoveVec']) {
      expect(validateSponsorCommands([{ $kind: kind }], allowed).ok).toBe(false);
    }
  });

  test('REJECTS an empty transaction', () => {
    expect(validateSponsorCommands([], allowed).ok).toBe(false);
  });
});

describe('isProvisioningOnly', () => {
  test('create_vault (+ transfer) is provisioning', () => {
    expect(isProvisioningOnly([mv(PKG, 'create_vault'), transfer()])).toBe(true);
  });
  test('vault ops are NOT provisioning (need an existing vault)', () => {
    expect(isProvisioningOnly([mv(PKG, 'withdraw'), transfer()])).toBe(false);
    expect(isProvisioningOnly([mv(PKG, 'owner_rebalance')])).toBe(false);
  });
  test('create_vault mixed with a vault op is NOT provisioning-only', () => {
    expect(isProvisioningOnly([mv(PKG, 'create_vault'), mv(PKG, 'withdraw')])).toBe(false);
  });
});

describe('normalizeSuiAddress', () => {
  test('pads and lowercases', () => {
    expect(normalizeSuiAddress('0x9')).toBe('0x' + '9'.padStart(64, '0'));
    expect(normalizeSuiAddress('0xAbC')).toBe('0x' + 'abc'.padStart(64, '0'));
  });
  test('rejects garbage → empty (never matches an allowed set)', () => {
    expect(normalizeSuiAddress('0xzz')).toBe('');
    expect(normalizeSuiAddress('')).toBe('');
  });
});
