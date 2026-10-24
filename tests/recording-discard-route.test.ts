import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { createLanternMachine } from "../lib/lantern-state";

const root = realpathSync(process.cwd());
const folder = mkdtempSync(path.join(root, ".tmp-discard-route-"));
const key = Symbol.for("quipus.discard.route.test");
const id = "11111111-1111-4111-8111-111111111111";
const event = "22222222-2222-4222-8222-222222222222";
const state = { stage: "discarded_silence", proof: true, proofReads: 0 };
const client = { from: (table: string) => {
  const filters: Record<string,unknown> = {};
  const stored = { id, user_id: "owner", device_id: "device", recording_id: "recording", audio_event_id: "audio",
    completion_event_id: event, processing_stage: state.stage, ended_at: "2026-10-24T00:00:01Z", meeting_id: null,
    machine: createLanternMachine("ready"), expected_audio_sources: ["onboard"] };
  const proof = { session_id: id, recording_id: "recording", user_id: "owner", device_id: "device", audio_event_id: "audio",
    reason: "short_digital_silence", policy_version: "digital-constant-v1" };
  const query = { select: () => query, eq: (key: string,value: unknown) => { filters[key] = value; return query; },
    maybeSingle: async () => {
      if (table === "recording_discard_decisions") {
        state.proofReads++;
        return { data: state.proof && Object.entries(filters).every(([key,value]) => proof[key as keyof typeof proof] === value) ? proof : null, error: null };
      }
      return { data: table === "lantern_sessions" ? stored : { event_id: "audio", verified_at: state.stage === "discarded_silence" ? null : "2026-10-24T00:00:00Z" }, error: null };
    },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  }; return query;
} };
Reflect.set(globalThis, key, { state, client });
after(() => {
  Reflect.deleteProperty(globalThis, key);
  assert.ok(realpathSync(folder).startsWith(root + path.sep));
  rmSync(folder, { recursive: true, force: true });
});
let POST: (request: Request, context: { params: Promise<{id:string}> }) => Promise<Response>;
before(async () => {
  const mocks: Record<string,string> = {
    "next/server": 'export class NextResponse extends Response{static json(body,options){return Response.json(body,options);}}export const after=()=>{};',
    "@/lib/supabase/server": 'export const getServerSupabase=()=>shared.client;',
    "@/lib/lantern-device-auth": 'export const authenticateLantern=async()=>({id:"device",userId:"owner"});',
    "@/lib/processing-mode": 'export const usesDedicatedRecordingWorker=()=>true;',
    "@/lib/processing-queue": 'export const processNextRecording=()=>{throw Error("Unexpected inline processing");};',
    "@/lib/redis": 'export const publishProcessingWakeup=async()=>true;',
  };
  const output = path.join(folder, "complete.cjs");
  const bundled = await build({ entryPoints: [path.join(root, "app/api/device/v1/sessions/[id]/complete/route.ts")],
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "complete-route-edges", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (Object.hasOwn(mocks,args.path)) return { path: args.path, namespace: "mock" };
        if (args.path.startsWith("@/")) return { path: path.join(root,args.path.slice(2)+".ts") };
      });
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: 'const shared=globalThis[Symbol.for("quipus.discard.route.test")];'+mocks[args.path], loader: "js" }));
    } }] });
  writeFileSync(output,bundled.outputFiles[0].contents);
  POST = createRequire(path.join(root,"package.json"))(output).POST;
});
async function complete() {
  return POST(new Request(`https://quipus.example/api/device/v1/sessions/${id}/complete`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({eventId:event}),
  }), { params: Promise.resolve({id}) });
}
test("actual completion route distinguishes an authoritative discard from an uploaded report", async () => {
  const response = await complete();
  assert.equal(response.status,200);
  const body = await response.json();
  assert.equal(body.sessionId,id); assert.equal(body.session.sessionId,null);
  assert.equal(body.discarded,true); assert.equal(body.discardReason,"short_digital_silence");
  assert.equal(body.archiveVerified,true); assert.equal(body.processingQueued,false);
  assert.equal(body.meeting,null); assert.equal(response.headers.get("cache-control"),"no-store");
});
test("discard stage without private proof never grants a deletion receipt", async () => {
  state.proof=false;
  const body = await (await complete()).json();
  assert.equal(body.discarded,false); assert.equal(body.archiveVerified,false);
  assert.equal(body.discardReason,undefined);
});
test("ordinary completion stays compatible before migration021 and never queries its proof table", async () => {
  state.stage="queued"; state.proofReads=0;
  const response = await complete();
  assert.equal(response.status,200);
  const body = await response.json();
  assert.equal(body.sessionId,id); assert.equal(body.session.sessionId,null);
  assert.equal(body.discarded,false); assert.equal(body.archiveVerified,true);
  assert.equal(body.processingQueued,true); assert.equal(state.proofReads,0);
});
