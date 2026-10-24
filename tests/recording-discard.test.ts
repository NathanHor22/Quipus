import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { archiveVerified } from "../lib/archive-verification";
import { verifiedSilenceDiscard } from "../lib/recording-discard";
import { purgeDiscardedRecordingAudio } from "../lib/recording-retention";

const identity = { sessionId: "session", recordingId: "recording", eventId: "event", userId: "owner", deviceId: "device" };
test("discard verification requires the private exact owner/device/session/recording/event proof after manifest removal", async () => {
  const proof = { session_id: "session", recording_id: "recording", audio_event_id: "event", user_id: "owner", device_id: "device",
    reason: "short_digital_silence", policy_version: "digital-constant-v1" };
  let missing = false;
  const client = { from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      maybeSingle: async () => ({ error: missing ? { code: "42P01" } : null,
        data: table === "recording_discard_decisions"
          ? Object.entries(filters).every(([key,value]) => proof[key as keyof typeof proof] === value) ? proof : null
          : table === "lantern_sessions" ? { ...proof, processing_stage: "discarded_silence" } : null }),
    }; return query;
  } } as unknown as SupabaseClient;
  assert.equal(await verifiedSilenceDiscard(client, identity), true);
  for (const field of Object.keys(identity))
    assert.equal(await verifiedSilenceDiscard(client, { ...identity, [field]: "foreign" }), false);
  assert.equal(await archiveVerified(client, "session", "event", "recording"), true);
  assert.equal(await archiveVerified(client, "session", "foreign-event", "recording"), false);
  missing = true;
  await assert.rejects(verifiedSilenceDiscard(client, identity));
});

test("immediate discard cleanup claims only its owner-bound recording and never sweeps historic recordings", async () => {
  const calls: string[] = [];
  const owner = "11111111-1111-4111-8111-111111111111";
  const object = `${owner}/device/session/audio.wav`;
  let removalFails = false;
  const deferred: unknown[] = [];
  const query = { update: (value: unknown) => { deferred.push(value); return query; }, eq: () => query,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
  const client = { rpc: async (name: string, args: Record<string,unknown>) => {
    calls.push(name);
    if (name === "claim_quipus_silence_cleanup") {
      assert.deepEqual(args, { p_recording_id: "recording", p_user_id: owner });
      return { data: [{ recording_id: "recording", user_id: owner, object_paths: [object], lease_token: "lease" }], error: null };
    }
    assert.equal(name, "finish_recording_audio_deletion");
    return { data: true, error: null };
  }, from: () => query, storage: { from: () => ({ remove: async (paths: string[]) => {
    assert.deepEqual(paths, [object]); return { error: removalFails ? {} : null };
  } }) } } as unknown as SupabaseClient;
  assert.deepEqual(await purgeDiscardedRecordingAudio(client, "recording", owner), { deleted: 1, deferred: 0 });
  assert.deepEqual(calls, ["claim_quipus_silence_cleanup", "finish_recording_audio_deletion"]);
  calls.length = 0; removalFails = true;
  assert.deepEqual(await purgeDiscardedRecordingAudio(client, "recording", owner), { deleted: 0, deferred: 1 });
  assert.deepEqual(calls, ["claim_quipus_silence_cleanup"]);
  assert.equal(deferred.length, 1);
});
