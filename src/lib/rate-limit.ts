/**
 * Minimal in-memory fixed-window rate limiter (M4 portal endpoints).
 *
 * Per-process only — fine for the single-instance deployment this app
 * targets through M10; a multi-instance future moves this to Postgres or
 * Redis (noted in PROGRESS.md limitations). Durable caps that MUST survive
 * restarts (the 5-wrong-OTP lockout) live in the portal_token row, not here.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Occasional sweep so abandoned keys don't accumulate forever. */
function pruneExpired(now: number) {
  if (buckets.size < 10_000) return;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Consume one hit for `key`. Returns true while the caller is under `max`
 * hits per `windowMs` window.
 */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  pruneExpired(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count += 1;
  return true;
}

/** Test helper — never called by app code. */
export function resetRateLimits() {
  buckets.clear();
}
