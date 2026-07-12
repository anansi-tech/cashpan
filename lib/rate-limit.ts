/**
 * Rate limiting — one interface, swappable backend.
 *
 * Backend is chosen at load: if KV_REST_API_URL + KV_REST_API_TOKEN are set
 * (Vercel KV / Upstash), a GLOBAL sliding-window limiter runs on Upstash Redis
 * — shared across all serverless instances. Otherwise an in-memory sliding
 * window is used (local dev, or KV unconfigured), which is PER-INSTANCE and
 * therefore advisory on serverless. `check` is async so the same call site
 * works for both.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterS: number;
}

export interface RateLimiter {
  check(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

// ── In-memory sliding-window limiter (fallback / local dev) ───────────────────

class MemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
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

  private sweep(cutoff: number): void {
    if (this.hits.size < 5000) return;
    for (const [k, v] of this.hits) if (v.length === 0 || v[v.length - 1] <= cutoff) this.hits.delete(k);
  }
}

// ── Upstash-backed global limiter ─────────────────────────────────────────────

class UpstashRateLimiter implements RateLimiter {
  private redis: Redis;
  // @upstash/ratelimit fixes limit+window at construction, so cache one
  // instance per (limit, windowMs) pair we actually use.
  private limiters = new Map<string, Ratelimit>();

  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }

  private limiter(limit: number, windowMs: number): Ratelimit {
    const key = `${limit}:${windowMs}`;
    let rl = this.limiters.get(key);
    if (!rl) {
      rl = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
        prefix: 'cashpan-rl',
        analytics: false,
      });
      this.limiters.set(key, rl);
    }
    return rl;
  }

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    try {
      const { success, remaining, reset } = await this.limiter(limit, windowMs).limit(key);
      return { ok: success, remaining, retryAfterS: success ? 0 : Math.max(1, Math.ceil((reset - Date.now()) / 1000)) };
    } catch (err) {
      // Fail OPEN on backend error — a rate limiter must never take the API
      // down. (A brief outage means limits lapse, not that requests 500.)
      console.error('[rate-limit] Upstash error, allowing:', err instanceof Error ? err.message : err);
      return { ok: true, remaining: limit, retryAfterS: 0 };
    }
  }
}

// ── Backend selection ─────────────────────────────────────────────────────────

const g = globalThis as typeof globalThis & { _rateLimiter?: RateLimiter };

function makeLimiter(): RateLimiter {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) return new UpstashRateLimiter(url, token);
  return new MemoryRateLimiter();
}

export const rateLimiter: RateLimiter = (g._rateLimiter ??= makeLimiter());

/** True when the global (Upstash) backend is active — for diagnostics/tests. */
export function isGlobalRateLimit(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientKey(req: Request, bucket: string): string {
  const xff = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = xff || req.headers.get('x-real-ip')?.trim() || 'unknown';
  return `${bucket}:${ip}`;
}

/**
 * Enforce a per-IP limit for a route. Resolves to null when allowed, or a 429
 * Response (with Retry-After) when the caller should be blocked.
 */
export async function enforceRateLimit(
  req: Request,
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<Response | null> {
  const r = await rateLimiter.check(clientKey(req, bucket), limit, windowMs);
  if (r.ok) return null;
  return new Response(JSON.stringify({ error: 'Too many requests' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(r.retryAfterS) },
  });
}
