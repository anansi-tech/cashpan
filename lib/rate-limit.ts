/**
 * Rate limiting — one interface, swappable backend.
 *
 * SERVERLESS CAVEAT: the default backend is an in-memory sliding window, so on
 * Vercel each serverless instance has its OWN counter — limits are PER-INSTANCE
 * and therefore advisory, not global. Fine pre-users (bounds a single abusive
 * instance and local dev). For a hard global limit, implement CheckRateLimit
 * over Upstash/Vercel KV and swap `rateLimiter` below — config, not refactor.
 */

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterS: number;
}

export interface RateLimiter {
  check(key: string, limit: number, windowMs: number): RateLimitResult;
}

// ── In-memory sliding-window limiter ──────────────────────────────────────────

class MemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();

  check(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const cutoff = now - windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (arr.length >= limit) {
      const retryAfterS = Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000));
      this.hits.set(key, arr);
      this.sweep(cutoff);
      return { ok: false, remaining: 0, retryAfterS };
    }
    arr.push(now);
    this.hits.set(key, arr);
    return { ok: true, remaining: limit - arr.length, retryAfterS: 0 };
  }

  // Bound memory: drop keys whose newest hit is older than the window.
  private sweep(cutoff: number): void {
    if (this.hits.size < 5000) return;
    for (const [k, v] of this.hits) if (v.length === 0 || v[v.length - 1] <= cutoff) this.hits.delete(k);
  }
}

// Persist across hot-reloads / warm invocations on one instance.
const g = globalThis as typeof globalThis & { _rateLimiter?: RateLimiter };
export const rateLimiter: RateLimiter = (g._rateLimiter ??= new MemoryRateLimiter());

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientKey(req: Request, bucket: string): string {
  const xff = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = xff || req.headers.get('x-real-ip')?.trim() || 'unknown';
  return `${bucket}:${ip}`;
}

/**
 * Enforce a per-IP limit for a route. Returns null when allowed, or a 429
 * Response (with Retry-After) when the caller should be blocked.
 */
export function enforceRateLimit(
  req: Request,
  bucket: string,
  limit: number,
  windowMs: number,
): Response | null {
  const r = rateLimiter.check(clientKey(req, bucket), limit, windowMs);
  if (r.ok) return null;
  return new Response(JSON.stringify({ error: 'Too many requests' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(r.retryAfterS) },
  });
}
