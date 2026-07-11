/**
 * Retrying GraphQL POST — the root fix for transient "returned no data".
 *
 * Provider blips (null data, network hiccups, 5xx) almost always vanish
 * within one retry; callers throw only after 3 attempts (0ms/300ms/800ms).
 * Kept dependency-free so tests can exercise it with a mocked fetch.
 */

const GRAPHQL_URL = process.env.SUI_GRAPHQL_URL ?? '';
const GRPC_TOKEN = process.env.SUI_GRPC_TOKEN ?? '';
const AUTH_HEADER = process.env.SUI_GRPC_AUTH_HEADER ?? '';

export const GQL_RETRY_DELAYS_MS = [300, 800];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function gqlPost<T>(
  query: string,
  label: string,
  // injectable for tests
  delays: number[] = GQL_RETRY_DELAYS_MS,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    try {
      const res = await fetch(GRAPHQL_URL, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', [AUTH_HEADER]: GRPC_TOKEN },
        body: JSON.stringify({ query }),
      });
      const json = await res.json() as { data?: T; errors?: { message: string }[] };
      if (json.errors?.length) throw new Error(`GraphQL ${label}: ${json.errors[0].message}`);
      if (!json.data) throw new Error(`GraphQL ${label}: returned no data`);
      return json.data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
