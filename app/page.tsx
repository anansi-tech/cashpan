import { getBalances, getConfig } from '@/lib/read-layer';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [balances, config] = await Promise.all([getBalances(), getConfig()]);

  const liquidSui = (Number(balances.liquid) / 1e9).toFixed(4);
  const savingsSui = (Number(balances.savingsValue) / 1e9).toFixed(4);
  const accruedMist = BigInt(balances.savingsValue) - BigInt(balances.savingsPrincipal);
  const accruedSui = (Number(accruedMist) / 1e9).toFixed(6);

  return (
    <main style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <h1 style={{ color: '#10b981', marginBottom: '1.5rem' }}>🍳 CashPan</h1>
      <section style={{ marginBottom: '1rem' }}>
        <p><strong>Spend pocket:</strong> {liquidSui} SUI</p>
        <p><strong>Savings pocket:</strong> {savingsSui} SUI (accrued: {accruedSui} SUI)</p>
        <p><strong>Epoch:</strong> {balances.currentEpoch}</p>
        <p><strong>APR:</strong> {Number(balances.rateBps) / 100}% / epoch</p>
      </section>
      <section>
        <p><strong>Buffer:</strong> {(Number(config.buffer) / 1e9).toFixed(3)} SUI</p>
        <p><strong>Vault:</strong> {config.vaultId.slice(0, 10)}…</p>
      </section>
      <p style={{ marginTop: '2rem', color: '#64748b', fontSize: '0.85rem' }}>
        Dashboard UI coming soon. API endpoints: /api/balances /api/activity /api/config
      </p>
    </main>
  );
}
