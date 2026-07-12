/**
 * Shinami zkWallet — server-side derivation of a user's stable zkLogin wallet
 * from their Google JWT. Idempotent per sub: the same {salt, address} every
 * time. Used by /api/salt (client's own use during login) and by the session
 * mint (to capture the authenticated address into the sealed cookie).
 */

export interface ZkWallet {
  salt: string;
  address: string;
}

export async function getOrCreateZkLoginWallet(jwt: string): Promise<ZkWallet> {
  const apiKey = process.env.SHINAMI_ZKLOGIN_KEY;
  if (!apiKey) throw new Error('SHINAMI_ZKLOGIN_KEY not configured');

  const res = await fetch('https://api.us1.shinami.com/sui/zkwallet/v1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'shinami_zkw_getOrCreateZkLoginWallet',
      params: [jwt],
      id: 1,
    }),
  });

  const data = await res.json() as { result?: { salt: string; address: string }; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  if (!data.result?.address || !data.result?.salt) throw new Error('Shinami returned no wallet');
  return { salt: data.result.salt, address: data.result.address };
}
