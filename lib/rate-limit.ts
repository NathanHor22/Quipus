export type RateLimitDecision = { allowed: boolean; remaining: number; retryAfterSeconds: number };
export interface RateLimitStore { increment(key: string, windowSeconds: number): Promise<number> }

/** Store increments and expiry must be atomic; never use per-instance memory in production. */
export async function checkRateLimit(store: RateLimitStore, key: string, limit: number,
  windowSeconds: number): Promise<RateLimitDecision> {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error("Invalid rate limit configuration.");
  }
  const count = await store.increment(key, windowSeconds);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("Invalid rate limit counter.");
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSeconds: count > limit ? windowSeconds : 0 };
}
