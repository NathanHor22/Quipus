import assert from "node:assert/strict";
import test from "node:test";
import { browserMutationError, isMachineAuthenticatedPath } from "../lib/request-security";
import { checkRateLimit } from "../lib/rate-limit";
import { validInternalBearer } from "../lib/internal-auth";
import { playbackRenewalDelay } from "../lib/workspace/playback-expiry";
import { isPublicContentPath } from "../lib/auth-policy";
import { archiveVerified } from "../lib/archive-verification";
import type { SupabaseClient } from "@supabase/supabase-js";

test("browser mutations reject cross-origin, opaque and credentialled origin-less requests", () => {
  const request = (headers: Record<string,string>, method = "POST") => new Request("https://quipus.example/api/actions", { method, headers });
  assert.equal(browserMutationError(request({ origin: "https://quipus.example" })), null);
  assert.equal(browserMutationError(request({ origin: "https://evil.example" }))?.status, 403);
  assert.equal(browserMutationError(request({ origin: "null" }))?.status, 403);
  assert.equal(browserMutationError(request({ origin: "invalid" }))?.status, 403);
  assert.equal(browserMutationError(request({ cookie: "session=private" }))?.status, 403);
  assert.equal(browserMutationError(request({ "sec-fetch-site": "cross-site" }))?.status, 403);
  assert.equal(browserMutationError(request({}, "GET")), null);
  assert.equal(browserMutationError(request({ authorization: "Bearer device-token" })), null);
  assert.equal(isMachineAuthenticatedPath("/api/internal/recording-retention"), true);
  assert.equal(isMachineAuthenticatedPath("/api/actions/approve"), false);
});

test("distributed counter respects account-specific keys and denies requests beyond the window quota", async () => {
  const counts = new Map<string,number>();
  const store = { increment: async (key: string) => { const value = (counts.get(key) || 0) + 1; counts.set(key,value); return value; } };
  assert.equal((await checkRateLimit(store,"owner-a",2,60)).allowed,true);
  assert.equal((await checkRateLimit(store,"owner-a",2,60)).remaining,0);
  assert.deepEqual(await checkRateLimit(store,"owner-a",2,60),{ allowed:false,remaining:0,retryAfterSeconds:60 });
  assert.equal((await checkRateLimit(store,"owner-b",2,60)).allowed,true);
  await assert.rejects(checkRateLimit(store,"owner-a",0,60), /configuration/);
});

test("maintenance requires a strong exact bearer and never accepts query-string credentials", () => {
  const secret = "a".repeat(32);
  assert.equal(validInternalBearer(new Request("https://example.test?token="+secret),secret),false);
  assert.equal(validInternalBearer(new Request("https://example.test", { headers:{ authorization:"Bearer "+secret } }),secret),true);
  assert.equal(validInternalBearer(new Request("https://example.test", { headers:{ authorization:"Bearer "+secret+"x" } }),secret),false);
  assert.equal(validInternalBearer(new Request("https://example.test"),undefined),false);
});

test("short-lived playback renews before expiry without invalid-expiry retry loops", () => {
  const now=Date.parse("2026-10-18T00:00:00Z");
  assert.equal(playbackRenewalDelay("2026-10-18T00:05:00Z",now),270000);
  for (const value of [null, "bad", "2026-10-17T00:00:00Z", "2026-10-18T00:00:10Z"]) assert.equal(playbackRenewalDelay(value,now),null);
});

test("archive queue acceptance never authorises local deletion without matching durable checksum verification", async () => {
  let row: Record<string,unknown> | null = { event_id:"event-a",verified_at:null };
  const query = { select:()=>query,eq:()=>query,maybeSingle:async()=>({ data:row,error:null }) };
  let sources: Record<string, unknown>[] = [];
  const sourceQuery = { select:()=>sourceQuery,eq:()=>sourceQuery,then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:sources,error:null}).then(resolve) };
  const session = { recording_id:"recording",audio_event_id:"event-a",expected_audio_sources:["onboard"] };
  const sessionQuery = { select:()=>sessionQuery,eq:()=>sessionQuery,maybeSingle:async()=>({data:session,error:null}) };
  const client = { from:(table:string)=>table === "recording_audio_sources" ? sourceQuery : table === "lantern_sessions" ? sessionQuery : query } as unknown as SupabaseClient;
  assert.equal(await archiveVerified(client,"session","event-a","recording"),false);
  row={ event_id:"event-a",verified_at:"2026-10-18T00:00:00Z" };
  assert.equal(await archiveVerified(client,"session","event-a","recording"),true);
  session.expected_audio_sources=["onboard","phone"];
  assert.equal(await archiveVerified(client,"session","event-a","recording"),false);
  sources=[{ source_kind:"phone",committed_at:"2026-10-18T00:00:00Z",verified_at:null }];
  assert.equal(await archiveVerified(client,"session","event-a","recording"),false);
  sources[0].verified_at="2026-10-18T00:00:01Z";
  assert.equal(await archiveVerified(client,"session","event-a","recording"),true);
  assert.equal(await archiveVerified(client,"session","event-b","recording"),false);
  assert.equal(await archiveVerified(client,"session","event-a",null),false);
});


test("public install metadata and icons never unlock private APIs", () => {
  for (const path of ["/manifest.webmanifest","/icon","/apple-icon","/icons/192.png"]) assert.equal(isPublicContentPath(path),true);
  for (const path of ["/api/recordings/private","/api/manifest.webmanifest","/dashboard"]) assert.equal(isPublicContentPath(path),false);
});
