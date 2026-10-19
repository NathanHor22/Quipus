import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getRedis } from "./redis";
import { checkRateLimit } from "./rate-limit";

const incrementScript = `local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

/** Supplemental account throttling. Provider firewall/quotas remain the outer boundary. */
export async function enforceUserRateLimit(userId: string, scope: string, limit = 30, windowSeconds = 300) {
  const redis = getRedis();
  if (!redis) return null;
  const key = `rate:${createHash("sha256").update(`${scope}:${userId}`).digest("hex")}`;
  try {
    const decision = await checkRateLimit({ increment: async (counter, seconds) =>
      Number(await redis.eval(incrementScript, [counter], [String(seconds)])) }, key, limit, windowSeconds);
    if (decision.allowed) return null;
    return NextResponse.json({ error: "Too many requests. Please try again shortly." }, {
      status: 429, headers: { "retry-after": String(decision.retryAfterSeconds), "cache-control": "no-store" },
    });
  } catch {
    // An optional cache outage must not interrupt an already authorised replay.
    console.warn("Account request throttling is temporarily unavailable.");
    return null;
  }
}
