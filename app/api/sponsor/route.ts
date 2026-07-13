import { NextResponse } from 'next/server';
import { Transaction } from '@mysten/sui/transactions';
import { SuiJsonRpcClient, JsonRpcHTTPTransport } from '@mysten/sui/jsonRpc';
import { NETWORK, suiNetwork } from '@/lib/sui';
import { buildDepositTx, buildWalletSendTx } from '@/lib/vault-tx';
import { getAuthedSub } from '@/lib/session';
import { getActiveVault } from '@/lib/db/vault-registry';
import { enforceRateLimit } from '@/lib/rate-limit';
import { validateSponsorCommands, isProvisioningOnly, normalizeSuiAddress, type SponsorCommand } from '@/lib/sponsor-guard';
import { upstreamFetch, UpstreamError } from '@/lib/upstream-fetch';

const GRAPHQL_URL = process.env.SUI_GRAPHQL_URL ?? '';
const RPC_URL = GRAPHQL_URL.replace(/\/graphql\/?$/, '');
const GRPC_TOKEN = process.env.SUI_GRPC_TOKEN ?? '';
const AUTH_HEADER = process.env.SUI_GRPC_AUTH_HEADER ?? 'x-token';
const COIN_TYPE = process.env.COIN_TYPE ?? '';
const PACKAGE_ID_LATEST = process.env.PACKAGE_ID_LATEST ?? process.env.PACKAGE_ID ?? '';

const ALLOWED_PACKAGES = new Set(
  [process.env.PACKAGE_ID, process.env.PACKAGE_ID_LATEST].filter(Boolean).map((p) => normalizeSuiAddress(p as string)),
);

function rpcClient() {
  return new SuiJsonRpcClient({
    network: NETWORK,
    transport: new JsonRpcHTTPTransport({ url: RPC_URL, rpc: { url: RPC_URL, headers: { [AUTH_HEADER]: GRPC_TOKEN } } }),
  });
}

type RegularBody = { txSerialized: string; sender: string };
type DepositBody = { action: 'deposit'; amountBase: string; sender: string; vaultId: string; packageId: string; coinType: string };
type WalletSendBody = { action: 'walletSend'; amountBase: string; sender: string; recipient: string; coinType: string };

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const sub = getAuthedSub(req);
  if (!sub) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const limited = await enforceRateLimit(req, 'sponsor', 30, 60_000);
  if (limited) return limited;

  try {
    const body = await req.json() as RegularBody | DepositBody | WalletSendBody;
    const apiKey = process.env.SHINAMI_GAS_STATION_KEY!;
    const vault = await getActiveVault(sub, suiNetwork());
    const payout = vault ? normalizeSuiAddress(vault.payoutAddress) : null;

    // Assert the tx sender is the session's own vault wallet. Bypassed only for
    // create_vault (provisioning), which runs before a vault row exists.
    const assertSender = (sender: string): NextResponse | null => {
      if (!vault) return NextResponse.json({ error: 'Vault not found' }, { status: 404 });
      if (normalizeSuiAddress(sender) !== payout) {
        return NextResponse.json({ error: 'Sender is not your vault wallet' }, { status: 403 });
      }
      return null;
    };

    let tx: Transaction;

    if ('action' in body && body.action === 'deposit') {
      const deny = assertSender(body.sender);
      if (deny) return deny;
      // Pin PTB params to the session vault + env — never trust the body's IDs.
      tx = buildDepositTx(BigInt(body.amountBase), { packageId: PACKAGE_ID_LATEST, coinType: COIN_TYPE, vaultId: vault!.vaultId });
      tx.setSender(body.sender);
    } else if ('action' in body && body.action === 'walletSend') {
      const deny = assertSender(body.sender);
      if (deny) return deny;
      if (!/^0x[0-9a-fA-F]{64}$/.test(body.recipient)) {
        return NextResponse.json({ error: 'Invalid recipient address' }, { status: 400 });
      }
      tx = buildWalletSendTx(BigInt(body.amountBase), body.recipient, COIN_TYPE);
      tx.setSender(body.sender);
    } else {
      // Client-serialized PTB — whitelist EVERY command before we co-sign.
      const { txSerialized, sender } = body as RegularBody;
      tx = Transaction.from(txSerialized);
      const commands = tx.getData().commands as unknown as SponsorCommand[];
      const guard = validateSponsorCommands(commands, ALLOWED_PACKAGES);
      if (!guard.ok) {
        console.error('[/api/sponsor] rejected PTB:', guard.reason);
        return NextResponse.json({ error: 'Transaction not permitted for sponsorship' }, { status: 400 });
      }
      // Vault ops require the caller's own vault; create_vault (provisioning) is exempt.
      if (!isProvisioningOnly(commands)) {
        const deny = assertSender(sender);
        if (deny) return deny;
      }
      tx.setSender(sender);
    }

    const kindBytes = await tx.build({ client: rpcClient(), onlyTransactionKind: true });
    const txBase64 = Buffer.from(kindBytes).toString('base64');

    const { data } = await upstreamFetch<{
      result?: { txBytes: string; signature: string };
      error?: { message: string; data?: { details?: string } };
    }>('sponsor', 'https://api.us1.shinami.com/sui/gas/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'gas_sponsorTransactionBlock', params: [txBase64, body.sender], id: 1 }),
    });

    if (data.error) {
      const details = data.error.data?.details;
      const msg = details ? `${data.error.message}: ${details}` : data.error.message;
      console.error('[/api/sponsor] Shinami error:', msg);
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    if (!data.result?.txBytes || !data.result?.signature) {
      const raw = JSON.stringify(data).slice(0, 500);
      console.error('[/api/sponsor] unexpected Shinami response (no result):', raw);
      return NextResponse.json({ error: `Unexpected sponsorship response: ${raw}` }, { status: 502 });
    }

    return NextResponse.json(data.result);
  } catch (err) {
    if (err instanceof UpstreamError) {
      console.error('[/api/sponsor] upstream:', err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[/api/sponsor] error:', err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
