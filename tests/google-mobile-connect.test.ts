import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { isPublicAuthPath } from "../lib/auth-policy";
import {
  MOBILE_GOOGLE_CALLBACK, challengeFor, mobileGoogleConfig, challengeMatches, createMobileTicket, mobileResultUrl,
  openMobileResult, readMobileTicket, sealMobileResult,
} from "../lib/google-mobile-connect";
import { createGoogleOAuthState, readGoogleOAuthState } from "../lib/providers/google-calendar";
import { proxy } from "../proxy";
import { loadRoute } from "./helpers/route-harness";

const SECRET = "a".repeat(40);
const userId = "0c3b1f0e-7f7c-4a43-9a37-3c5c2a0f1d11";
const otherUser = "b6f4a2cd-9025-4426-b11f-c87080289994";
const verifier = randomBytes(32).toString("base64url");
const challenge = challengeFor(verifier);
const credentials = { access_token: "ya29.access", refresh_token: "1//refresh", scope: "openid email", token_type: "Bearer", expiry_date: 1_900_000_000_000 };

test("tickets carry only user, scope choice and challenge, and expire after two minutes", () => {
  const now = Date.parse("2026-10-25T10:00:00Z");
  const ticket = createMobileTicket({ userId, includeGmail: true, challenge }, SECRET, now);
  assert.doesNotMatch(ticket, new RegExp(userId), "the ticket is encrypted, not a readable identifier");
  assert.deepEqual(readMobileTicket(ticket, SECRET, now + 60_000), { userId, includeGmail: true, challenge, issuedAt: now });
  assert.throws(() => readMobileTicket(ticket, SECRET, now + 121_000), /expired/u);
  assert.throws(() => readMobileTicket(ticket, "b".repeat(40), now), /invalid/u);
  assert.throws(() => readMobileTicket(ticket.slice(0, -2) + "xx", SECRET, now), /invalid/u);
  // A sealed result can never be replayed as a ticket (separate encryption purpose).
  const result = sealMobileResult({ userId, challenge, credentials }, SECRET, now);
  assert.throws(() => readMobileTicket(result, SECRET, now), /invalid/u);
});

test("sealed results open only for the same user with the original verifier, within five minutes", () => {
  const now = Date.parse("2026-10-25T10:00:00Z");
  const sealed = sealMobileResult({ userId, challenge, credentials: { ...credentials, extra: "dropped" } as never }, SECRET, now);
  assert.doesNotMatch(sealed, /refresh|ya29/u);
  assert.deepEqual(openMobileResult(sealed, { userId, verifier }, SECRET, now + 60_000), credentials);
  assert.throws(() => openMobileResult(sealed, { userId: otherUser, verifier }, SECRET, now), /different request/u);
  assert.throws(() => openMobileResult(sealed, { userId, verifier: randomBytes(32).toString("base64url") }, SECRET, now), /different request/u);
  assert.throws(() => openMobileResult(sealed, { userId, verifier }, SECRET, now + 301_000), /expired/u);
  const ticket = createMobileTicket({ userId, includeGmail: false, challenge }, SECRET, now);
  assert.throws(() => openMobileResult(ticket, { userId, verifier }, SECRET, now), /could not be completed/u);
});

test("verifier checks are exact and reject malformed input", () => {
  assert.equal(challengeMatches(verifier, challenge), true);
  assert.equal(challengeMatches(verifier + "x", challenge), false);
  assert.equal(challengeMatches("short", challengeFor("short")), false);
  assert.equal(challengeMatches(verifier, "not a challenge"), false);
});

test("mobile results only ever redirect to the app's fixed callback", () => {
  assert.equal(mobileResultUrl({ status: "denied" }), `${MOBILE_GOOGLE_CALLBACK}?google=denied`);
  assert.ok(mobileResultUrl({ result: "v1.a.b.c" }).startsWith(`${MOBILE_GOOGLE_CALLBACK}?result=`));
});

test("the mobile redirect URI is a fixed path on the configured website origin", () => {
  const config = { clientId: "c", clientSecret: "s", calendarId: "primary", redirectUri: "https://quipus.example/api/google/callback" };
  assert.equal(mobileGoogleConfig(config).redirectUri, "https://quipus.example/api/google/mobile/callback");
  assert.equal(config.redirectUri, "https://quipus.example/api/google/callback", "the website config is not mutated");
});

test("website OAuth state is unchanged; mobile state carries its challenge", () => {
  const now = Date.now();
  const web = readGoogleOAuthState(createGoogleOAuthState({ userId, returnTo: "/dashboard" }, SECRET, now), SECRET, now);
  assert.equal(web.mobileChallenge, undefined);
  const mobile = readGoogleOAuthState(createGoogleOAuthState({ userId, mobileChallenge: challenge }, SECRET, now), SECRET, now);
  assert.equal(mobile.mobileChallenge, challenge);
  assert.throws(() => createGoogleOAuthState({ userId, mobileChallenge: "bad" }, SECRET, now));
});

test("only the mobile authorize and callback paths skip proxy authentication; the website callback stays protected", async () => {
  assert.equal(isPublicAuthPath("/api/google/mobile/authorize"), true);
  assert.equal(isPublicAuthPath("/api/google/mobile/callback"), true);
  for (const path of ["/api/google/callback", "/api/google/mobile", "/api/google/mobile/complete", "/api/google/connect", "/api/google/status"])
    assert.equal(isPublicAuthPath(path), false, path);
  const keys = ["NODE_ENV", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://auth-test.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" });
  globalThis.fetch = async () => Response.json({ msg: "no session" }, { status: 401 });
  try {
    assert.equal((await proxy(new NextRequest("https://quipus.example/api/google/mobile/authorize?ticket=x"))).status, 200);
    assert.equal((await proxy(new NextRequest("https://quipus.example/api/google/mobile/complete", { method: "POST" }))).status, 401);
    assert.equal((await proxy(new NextRequest("https://quipus.example/api/google/callback?state=x&code=y"))).status, 401);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else Object.assign(process.env, { [key]: previous[key] });
    }
  }
});

type CompleteRoute = { POST(request: Request): Promise<Response> };
type CompleteState = { user: { id: string } | null; persisted: unknown[] };
const stateKey = Symbol.for("quipus.google.mobile.complete.test");
const prelude = 'const state=globalThis[Symbol.for("quipus.google.mobile.complete.test")];';
const mocks = {
  "@/lib/api-security": "export async function requireAuthenticatedSession(){return state.user?null:new Response('{}',{status:401});}",
  "@/lib/supabase/session": "export async function getAuthenticatedLanternUser(){return state.user;}",
  "@/lib/supabase/server": "export function getServerSupabase(){return {};}",
  "@/lib/server-rate-limit": "export async function enforceUserRateLimit(){return null;}",
  "@/lib/google-connection": "export async function checkGoogleConnection(){return {state:'connected',email:'me@example.test',checkedAt:null,scopes:[]};}",
  "@/lib/providers/google-calendar": `export function getGoogleOAuthConfig(){return {approvalSecret:${JSON.stringify(SECRET)}};}
    export function requireApprovalSecret(value){return value;}
    export async function persistGoogleCredentials(_client,user,credentials){state.persisted.push({user,credentials});return credentials;}`,
};

test("completion saves credentials only for the bound user and verifier", async () => {
  const state: CompleteState = { user: { id: userId }, persisted: [] };
  Reflect.set(globalThis, stateKey, state);
  const loaded = await loadRoute<CompleteRoute>("app/api/google/mobile/complete/route.ts", mocks, prelude);
  const post = (body: unknown) => loaded.module.POST(new Request("https://quipus.example/api/google/mobile/complete", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  try {
    const sealed = sealMobileResult({ userId, challenge, credentials }, SECRET);
    const wrongVerifier = await post({ result: sealed, verifier: randomBytes(32).toString("base64url") });
    assert.equal(wrongVerifier.status, 400);
    state.user = { id: otherUser };
    assert.equal((await post({ result: sealed, verifier })).status, 400, "another account cannot claim it");
    assert.equal(state.persisted.length, 0);
    state.user = { id: userId };
    const ok = await post({ result: sealed, verifier });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store, max-age=0");
    assert.deepEqual(state.persisted, [{ user: userId, credentials }]);
    assert.equal((await post({ result: sealed, verifier, extra: 1 })).status, 400);
    state.user = null;
    assert.equal((await post({ result: sealed, verifier })).status, 401);
  } finally {
    loaded.cleanup();
    Reflect.deleteProperty(globalThis, stateKey);
  }
});
