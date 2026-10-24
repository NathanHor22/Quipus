import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { createCanonicalWav } from "../lib/wav";

// Real shared worker/fallback function, WAV reader, quality preparation and
// discard predicate; only network/database/provider boundaries are replaced.
const root = realpathSync(process.cwd());
const folder = mkdtempSync(path.join(root, ".tmp-silence-pipeline-"));
const key = Symbol.for("quipus.silence.pipeline.test");
const state = {
  wav: new Uint8Array(), phoneWav: null as Uint8Array | null, phoneOffsetSeconds: 0,
  missingMigration: false, text: "", transportFailure: false,
  downloadedSources: [] as string[], derivatives: 0, recognitionHasSignal: false, savedTranscript: "",
  rpc: [] as string[], jobUpdates: [] as Record<string, unknown>[],
  stage: "queued", completedMeetings: 0, failedMeetings: 0, attempts: 1,
};
Reflect.set(globalThis, key, state);
after(() => {
  Reflect.deleteProperty(globalThis, key);
  assert.ok(realpathSync(folder).startsWith(root + path.sep));
  rmSync(folder, { recursive: true, force: true });
});
const prelude = 'const state=globalThis[Symbol.for("quipus.silence.pipeline.test")];';
const mocks: Record<string, string> = {
  "./env": 'export const env=()=>({APP_TIMEZONE:"Asia/Kuala_Lumpur"});',
  "./redis": 'export const setProcessingState=async()=>true;',
  "./persistence": 'export const persistProcessedMeeting=async(input)=>{state.completedMeetings++;state.savedTranscript=input.transcription.text;return{meetingId:"meeting"};};export const persistFailedHardwareMeeting=async()=>{state.failedMeetings++;return{meetingId:"failed-meeting"};};',
  "./providers/meeting-extraction": 'export const extractConversationInsights=async()=>({participants:[],insight:{},evidence:[]});',
  "./providers/openai-transcription": `export class OpenAITranscriptionProviderError extends Error {providerCode="no_speech";noSpeechResponses=5;}
    export const transcribeWithOpenAI=async(audio)=>{const bytes=Buffer.from(await audio.arrayBuffer());
    state.recognitionHasSignal=false;for(let i=44;i<bytes.length;i+=2){if(bytes.readInt16LE(i)!==0){state.recognitionHasSignal=true;break;}}
    if(state.transportFailure)throw Error("provider offline");
    if(state.text)return{text:state.text,segments:[{speaker:"Speaker 1",text:state.text}],language:"en",provider:"openai"};
    throw new OpenAITranscriptionProviderError("No speech");};`,
  "./recording-files": `import {mkdtemp,writeFile,rm} from "node:fs/promises";
    export {consolidateRecordingFiles} from "quipus-test-real-files";import os from "node:os";import path from "node:path";
    export const recordingTempDirectory=async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),"quipus-pipeline-"));return{path:name=>path.join(dir,name),cleanup:()=>rm(dir,{recursive:true,force:true})};};
    export const downloadVerifiedRecording=async({outputPath})=>{const phone=path.basename(outputPath)==="phone.wav";
    state.downloadedSources.push(phone?"phone":"onboard");await writeFile(outputPath,phone?state.phoneWav:state.wav);};
    export const publishConsolidatedRecording=async()=>{state.derivatives++;return "owner/combined.wav";};`,
};
let processNext: (client: unknown) => Promise<boolean>;
before(async () => {
  const output = path.join(folder, "pipeline.cjs");
  const bundled = await build({ entryPoints: [path.join(root, "lib/processing-queue.ts")], bundle: true,
    platform: "node", format: "cjs", packages: "external", write: false, plugins: [{ name: "pipeline-edges", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path === "quipus-test-real-files"
        ? { path: path.join(root, "lib/recording-files.ts") }
        : Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: prelude + mocks[args.path], loader: "js" }));
    } }] });
  writeFileSync(output, bundled.outputFiles[0].contents);
  processNext = createRequire(path.join(root, "package.json"))(output).processNextRecording;
});
function client() {
  const session = { id: "session", user_id: "owner", device_id: "device", recording_id: "recording", audio_event_id: "audio",
    recording_started_at: "2026-10-24T00:00:00Z", capture_ended_at: "2026-10-24T00:00:01Z", expected_audio_sources: state.phoneWav ? ["onboard", "phone"] : ["onboard"] };
  const phone = { id: "phone", source_kind: "phone", storage_path: "owner/phone.wav", byte_length: state.phoneWav?.length,
    sha256: "b".repeat(64), committed_at: "2026-10-24T00:00:01Z", verified_at: null,
    timing_manifest: { version: 1, sampleRate: 16000, channels: 1, deviceStartedUs: 1_000_000,
      firstPacketDeviceUs: 1_032_000 + state.phoneOffsetSeconds * 1_000_000,
      lastPacketDeviceUs: 2_000_000 + state.phoneOffsetSeconds * 1_000_000,
      firstPacketPhoneUs: 1_000_000, lastPacketPhoneUs: 1_968_000, receivedSamples: 16_000,
      missingSamples: 0, droppedPackets: 0, disconnects: 0 } };
  const manifest = { event_id: "audio", total_bytes: state.wav.length, sha256: "a".repeat(64), storage_path: "owner/audio.wav" };
  return { rpc: async (name: string, args: Record<string, unknown>) => {
    state.rpc.push(name);
    if (name === "claim_lantern_processing") return { data: [{ session_id: "session", user_id: "owner", lease_token: "lease", attempts: state.attempts }], error: null };
    if (name === "discard_quipus_short_silence") {
      assert.equal(args.p_user_id, "owner"); assert.equal(args.p_device_id, "device"); assert.equal(args.p_lease_token, "lease");
      if (state.missingMigration) return { data: null, error: { code: "PGRST202" } };
      state.stage = "discarded_silence";
      return { data: true, error: null };
    }
    assert.equal(name, "claim_quipus_silence_cleanup");
    return { data: [], error: null };
  }, from: (table: string) => {
    let update: Record<string, unknown> | undefined;
    const query = { select: () => query, eq: () => query, gt: () => query, is: () => query,
      update: (value: Record<string, unknown>) => { update = value;
        if (table === "lantern_processing_jobs") state.jobUpdates.push(value);
        if (table === "lantern_sessions" && value.processing_stage) state.stage = String(value.processing_stage);
        return query; },
      single: async () => ({ data: table === "lantern_sessions" ? session : { id: "recording", storage_path: "owner/audio.wav" }, error: null }),
      maybeSingle: async () => ({ data: table === "recording_audio_sources" ? update ? { id: "phone" } : phone : table === "meetings" ? null : table === "lantern_audio_uploads" ? update ? { session_id: "session" } : manifest : { session_id: "session" }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
    }; return query;
  } };
}
function reset(value: (i: number) => number = () => 0) {
  const pcm = Buffer.alloc(32_000);
  for (let i = 0; i < 16_000; i++) pcm.writeInt16LE(value(i), i * 2);
  Object.assign(state, { wav: createCanonicalWav(pcm), phoneWav: null, phoneOffsetSeconds: 0,
    downloadedSources: [], derivatives: 0, recognitionHasSignal: false, savedTranscript: "", missingMigration: false, text: "", transportFailure: false,
    rpc: [], jobUpdates: [], stage: "queued", completedMeetings: 0, failedMeetings: 0, attempts: 1 });
}

test("shared recording pipeline discards only positively silent audio and never creates a report for it", async () => {
  reset();
  assert.equal(await processNext(client()), true);
  assert.equal(state.stage, "discarded_silence");
  assert.deepEqual(state.rpc, ["claim_lantern_processing", "discard_quipus_short_silence", "claim_quipus_silence_cleanup"]);
  assert.equal(state.completedMeetings + state.failedMeetings, 0);
});
test("empty transcription with quiet voice, or a provider outage with digital silence, preserves audio", async () => {
  reset(i => Math.round(2 * Math.sin(i / 12)));
  await processNext(client());
  assert.equal(state.rpc.includes("discard_quipus_short_silence"), false);
  reset(); state.transportFailure = true;
  await processNext(client());
  assert.equal(state.rpc.includes("discard_quipus_short_silence"), false);
});
test("a recognized one-word YES is kept as a complete ordinary meeting even on an otherwise suspicious signal", async () => {
  reset(); state.text = "Yes";
  await processNext(client());
  assert.equal(state.rpc.includes("discard_quipus_short_silence"), false);
  assert.equal(state.completedMeetings, 1);
  assert.equal(state.stage, "ready");
});
test("missing migration on the last attempt keeps a candidate retryable without creating or deleting a meeting", async () => {
  reset(); state.missingMigration = true; state.attempts = 3;
  await processNext(client());
  assert.equal(state.rpc.includes("claim_quipus_silence_cleanup"), false);
  assert.equal(state.completedMeetings + state.failedMeetings, 0);
  assert.equal(state.stage, "queued");
  const final = state.jobUpdates.at(-1)!;
  assert.equal(final.state, "queued"); assert.equal(final.attempts, 0);
  assert.ok(Date.parse(String(final.available_at)) > Date.now() + 4 * 60_000);
});


test("silent onboard plus quiet phone speech uses the real mixer and preserves the complete meeting transcript", async () => {
  reset();
  const phone = Buffer.alloc(32_000);
  for (let i = 0; i < 16_000; i++) phone.writeInt16LE(Math.round(12 * Math.sin(i / 12)), i * 2);
  state.phoneWav = createCanonicalWav(phone);
  state.text = "Please bring the signed agreement to our next meeting.";
  const originalOnboard = state.wav.slice(), originalPhone = state.phoneWav.slice();
  assert.equal(await processNext(client()), true);
  assert.deepEqual(state.downloadedSources, ["onboard", "phone"]);
  assert.equal(state.derivatives, 1);
  assert.equal(state.recognitionHasSignal, true, "the real mixer must retain the quiet phone waveform");
  assert.equal(state.rpc.includes("discard_quipus_short_silence"), false);
  assert.equal(state.rpc.includes("claim_quipus_silence_cleanup"), false);
  assert.equal(state.completedMeetings, 1);
  assert.equal(state.failedMeetings, 0);
  assert.equal(state.savedTranscript, state.text);
  assert.equal(state.stage, "ready");
  assert.deepEqual(state.wav, originalOnboard);
  assert.deepEqual(state.phoneWav, originalPhone);
});

test("phone speech outside the mixed playback window prevents discard even when combined STT reports no speech", async () => {
  reset();
  const phone = Buffer.alloc(32_000);
  for (let i = 0; i < 16_000; i++) phone.writeInt16LE(Math.round(3 * Math.sin(i / 12)), i * 2);
  state.phoneWav = createCanonicalWav(phone);
  state.phoneOffsetSeconds = 5;
  assert.equal(await processNext(client()), true);
  assert.deepEqual(state.downloadedSources, ["onboard", "phone"]);
  assert.equal(state.derivatives, 1);
  assert.equal(state.recognitionHasSignal, false, "current production mixing retains the onboard one-second duration");
  assert.equal(state.rpc.includes("discard_quipus_short_silence"), false,
    "speech evidence in any original source must override a silent consolidated derivative");
  assert.equal(state.rpc.includes("claim_quipus_silence_cleanup"), false);
  assert.equal(state.stage, "queued");
  assert.equal(state.completedMeetings + state.failedMeetings, 0);
});
