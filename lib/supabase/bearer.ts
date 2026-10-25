/**
 * Native apps send their Supabase access token as `Authorization: Bearer`.
 * Only a compact JWS shape is accepted; Supabase still verifies the token.
 * A present but malformed header is "invalid" so callers fail closed instead
 * of falling back to an ambient browser cookie.
 */
export type BearerCredential =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "token"; token: string };

const MAX_TOKEN_LENGTH = 8192;
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

export function readBearerCredential(authorization: string | null | undefined): BearerCredential {
  if (authorization === null || authorization === undefined) return { kind: "none" };
  const match = /^Bearer ([^\s]+)$/u.exec(authorization);
  const token = match?.[1] || "";
  if (!token || token.length > MAX_TOKEN_LENGTH || !COMPACT_JWS.test(token)) return { kind: "invalid" };
  return { kind: "token", token };
}
