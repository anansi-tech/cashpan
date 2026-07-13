/**
 * Resilient upstream proxy fetch — for routes that relay to a third party
 * (Shinami sponsor, GraphQL submit, CDP). Guards the three failure modes that
 * turned a slow upstream into a 57s hang → empty body → JSON.parse → 500:
 *   1. AbortController timeout (default 15s) so a hung upstream fails fast.
 *   2. Defensive parse: read text, JSON.parse in try/catch — empty/invalid
 *      body becomes a typed error, never a SyntaxError.
 *   3. One retry with short backoff on timeout / network error / 5xx.
 *
 * Returns { status, data } on a parseable response, or throws UpstreamError
 * (carrying a clean message + status) which callers map to a 502.
 */

export class UpstreamError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = 'UpstreamError';
  }
}

interface UpstreamResult<T> {
  httpStatus: number;
  data: T;
}

export async function upstreamFetch<T = unknown>(
  label: string,
  url: string,
  init: RequestInit,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<UpstreamResult<T>> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const retries = opts.retries ?? 1;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      const text = await res.text();

      // 5xx → retry (upstream transient). Non-5xx: parse and return (caller
      // decides on the payload; a clean 4xx body is not our failure).
      if (res.status >= 500) {
        lastErr = new UpstreamError(`${label}: upstream ${res.status}`);
        continue;
      }

      let data: T;
      try {
        data = (text ? JSON.parse(text) : {}) as T;
      } catch {
        throw new UpstreamError(`${label}: invalid response body (${res.status}, ${text.slice(0, 120) || 'empty'})`);
      }
      return { httpStatus: res.status, data };
    } catch (err) {
      const e = err as Error;
      if (e instanceof UpstreamError) throw e;
      // AbortError (timeout) or network error → retry.
      lastErr = e.name === 'AbortError' ? new UpstreamError(`${label}: timed out after ${timeoutMs}ms`) : new UpstreamError(`${label}: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new UpstreamError(`${label}: failed`);
}
