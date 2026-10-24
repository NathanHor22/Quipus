import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { loadRoute } from "./helpers/route-harness";

const secret = "s".repeat(32);
let POST: (request: Request) => Promise<Response>;
let cleanup = () => {};
before(async () => {
  const loaded = await loadRoute<{ POST: typeof POST }>("app/api/internal/process-recordings/route.ts", {
    // Returning no client stops the handler right after authorization succeeds.
    "@/lib/supabase/server": "export const getServerSupabase=()=>null;",
    "@/lib/processing-queue": "export const processNextRecording=async()=>false;",
    "@/lib/processing-mode": "export const usesDedicatedRecordingWorker=()=>true;",
    "@/lib/meeting-enrichment": "export const processNextMeetingEnrichment=async()=>false;",
    "@/lib/meeting-delivery": "export const deliverNextMeeting=async()=>false;",
  });
  POST = loaded.module.POST;
  cleanup = loaded.cleanup;
});
after(() => {
  cleanup();
  delete process.env.PROCESSING_WORKER_SECRET;
});

const call = (authorization?: string) => POST(new Request("https://quipus.example/api/internal/process-recordings", {
  method: "POST", headers: authorization ? { authorization } : {},
}));

test("worker wake-up requires the exact strong bearer secret", async () => {
  delete process.env.PROCESSING_WORKER_SECRET;
  assert.equal((await call("Bearer " + secret)).status, 401);

  process.env.PROCESSING_WORKER_SECRET = "short";
  assert.equal((await call("Bearer short")).status, 401);

  process.env.PROCESSING_WORKER_SECRET = secret;
  assert.equal((await call()).status, 401);
  assert.equal((await call(secret)).status, 401);
  assert.equal((await call("Bearer " + secret + "x")).status, 401);
  assert.equal((await call("Bearer " + secret)).status, 503);
});
