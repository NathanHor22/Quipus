/** Invalid or missing expiry never creates a rapid renewal loop. */
export function playbackRenewalDelay(expiresAt: unknown, now = Date.now()): number | null {
  if (typeof expiresAt !== "string") return null;
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now + 30_000) return null;
  return Math.min(2_147_483_647, expiry - now - 30_000);
}
