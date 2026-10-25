import { createHash, timingSafeEqual } from "node:crypto";
import type { Credentials } from "google-auth-library";
import { z } from "zod";

import { compactGoogleCredentials, openGooglePayload, sealGooglePayload, type GoogleOAuthConfig } from "./providers/google-calendar";

/**
 * Google Calendar/Gmail connection for the mobile app.
 *
 * The website flow binds the OAuth callback to the browser's Quipus session
 * cookie. The app's system browser has no such session, so the binding is a
 * PKCE-style verifier instead:
 *
 * 1. The signed-in app sends SHA-256(verifier) and receives a short-lived,
 *    encrypted ticket URL (no tokens, no user-visible identifiers).
 * 2. The browser exchanges the ticket for the normal OAuth state + nonce cookie.
 * 3. A dedicated callback (`/api/google/mobile/callback`, registered as a second
 *    redirect URI on the same Google OAuth client) seals the credentials and
 *    returns them only to the app's fixed `quipus://` URL. Nothing is saved yet.
 *    The website callback and its session check are untouched.
 * 4. The app posts the sealed result with its verifier and bearer token; only
 *    the same user holding the verifier can save the connection.
 *
 * A start link sent to someone else therefore cannot attach their Google
 * account to the sender's workspace, and an intercepted deep link is useless
 * without the verifier and that user's session.
 */
export const MOBILE_GOOGLE_CALLBACK = "quipus://google/callback";
export const MOBILE_GOOGLE_REDIRECT_PATH = "/api/google/mobile/callback";

/** Same OAuth client, with the mobile redirect URI on the configured website origin. */
export function mobileGoogleConfig(config: GoogleOAuthConfig): GoogleOAuthConfig {
  return { ...config, redirectUri: new URL(MOBILE_GOOGLE_REDIRECT_PATH, config.redirectUri).toString() };
}
export const MOBILE_TICKET_MAX_AGE_MS = 2 * 60_000;
export const MOBILE_RESULT_MAX_AGE_MS = 5 * 60_000;
const FUTURE_SKEW_MS = 60_000;
const TICKET_PURPOSE = "quipus:google-mobile-ticket";
const RESULT_PURPOSE = "quipus:google-mobile-result";

export const mobileChallengeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export const mobileVerifierSchema = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u);

const ticketSchema = z.object({
  userId: z.string().uuid(),
  includeGmail: z.boolean(),
  challenge: mobileChallengeSchema,
  issuedAt: z.number().int().nonnegative(),
}).strict();

const resultSchema = z.object({
  userId: z.string().uuid(),
  challenge: mobileChallengeSchema,
  issuedAt: z.number().int().nonnegative(),
  credentials: z.record(z.string(), z.unknown()),
}).strict();

export type MobileTicket = z.infer<typeof ticketSchema>;

export class MobileGoogleConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MobileGoogleConnectError";
  }
}

function fresh(issuedAt: number, maxAge: number, now: number) {
  return issuedAt <= now + FUTURE_SKEW_MS && now - issuedAt <= maxAge;
}

export function createMobileTicket(input: Omit<MobileTicket, "issuedAt">, secret: string, now = Date.now()): string {
  return sealGooglePayload(ticketSchema.parse({ ...input, issuedAt: now }), secret, TICKET_PURPOSE);
}

export function readMobileTicket(ticket: string, secret: string, now = Date.now()): MobileTicket {
  if (ticket.length > 2048) throw new MobileGoogleConnectError("The connection link is invalid.");
  const parsed = ticketSchema.safeParse((() => {
    try { return openGooglePayload(ticket, secret, TICKET_PURPOSE); } catch { return null; }
  })());
  if (!parsed.success) throw new MobileGoogleConnectError("The connection link is invalid.");
  if (!fresh(parsed.data.issuedAt, MOBILE_TICKET_MAX_AGE_MS, now))
    throw new MobileGoogleConnectError("The connection link expired. Start again from the app.");
  return parsed.data;
}

export function sealMobileResult(
  input: { userId: string; challenge: string; credentials: Credentials },
  secret: string,
  now = Date.now(),
): string {
  return sealGooglePayload(resultSchema.parse({
    userId: input.userId,
    challenge: input.challenge,
    issuedAt: now,
    credentials: compactGoogleCredentials(input.credentials),
  }), secret, RESULT_PURPOSE);
}

/** Opens a sealed result for the authenticated user holding the original verifier. */
export function openMobileResult(
  sealed: string,
  input: { userId: string; verifier: string },
  secret: string,
  now = Date.now(),
): Credentials {
  if (sealed.length > 16_384) throw new MobileGoogleConnectError("The Google connection could not be completed.");
  const parsed = resultSchema.safeParse((() => {
    try { return openGooglePayload(sealed, secret, RESULT_PURPOSE); } catch { return null; }
  })());
  if (!parsed.success) throw new MobileGoogleConnectError("The Google connection could not be completed.");
  if (!fresh(parsed.data.issuedAt, MOBILE_RESULT_MAX_AGE_MS, now))
    throw new MobileGoogleConnectError("The Google connection expired. Connect again.");
  if (parsed.data.userId !== input.userId || !challengeMatches(input.verifier, parsed.data.challenge))
    throw new MobileGoogleConnectError("This Google connection belongs to a different request.");
  return parsed.data.credentials as Credentials;
}

export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export function challengeMatches(verifier: string, challenge: string): boolean {
  if (!mobileVerifierSchema.safeParse(verifier).success || !mobileChallengeSchema.safeParse(challenge).success) return false;
  const expected = Buffer.from(challengeFor(verifier));
  const actual = Buffer.from(challenge);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** The only redirect target for mobile results: a fixed app URL, never user input. */
export function mobileResultUrl(outcome: { result: string } | { status: "denied" | "error" }): string {
  const url = new URL(MOBILE_GOOGLE_CALLBACK);
  if ("result" in outcome) url.searchParams.set("result", outcome.result);
  else url.searchParams.set("google", outcome.status);
  return url.toString();
}
