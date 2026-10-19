import { timingSafeEqual } from "node:crypto";

/** No cookies, query-string tokens or fallbacks for privileged maintenance. */
export function validInternalBearer(request: Request, secret: string | undefined): boolean {
  if (!secret || Buffer.byteLength(secret) < 32) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get("authorization") || "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
