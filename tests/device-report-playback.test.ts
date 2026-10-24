import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { build } from "esbuild";
import { database, device, type Row } from "./helpers/report-fixtures";

const root = realpathSync(process.cwd());
const folder = mkdtempSync(path.join(root, ".tmp-report-playback-"));
const stateKey = Symbol.for("quipus.report.playback.test");
const state = { calls: 0, cancelled: 0, complete: false, onSpeech: undefined as (() => void) | undefined };
Reflect.set(globalThis, stateKey, state);
after(() => {
  Reflect.deleteProperty(globalThis, stateKey);
  const resolved = realpathSync(folder);
  assert.ok(resolved.startsWith(root + path.sep) && path.basename(resolved).startsWith(".tmp-report-playback-"));
  rmSync(resolved, { recursive: true, force: true });
});
type SpeechInput = { reportId?: string; page?: number; speech?: string; intent?: string; reportContextId?: string; interactionId?: string; conversational?: boolean; playbackMode?: "repeat" };
let deviceSpeechPage: (client: SupabaseClient, board: typeof device, input: SpeechInput) => Promise<Response>;
before(async () => {
  const result = await build({
    entryPoints: [path.join(root, "lib/device-speech-response.ts")], bundle: true,
    platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "report-playback-speech-edge", setup(builder) {
      builder.onResolve({ filter: /providers\/openai-speech$/ }, () => ({ path: "speech", namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ loader: "js", contents:
        'const state=globalThis[Symbol.for("quipus.report.playback.test")];export const createOpenAISpeech=async()=>{state.calls++;state.onSpeech?.();return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,0]));if(state.complete)c.close();},cancel(){state.cancelled++;}}));};' }));
    } }],
  });
  const output = path.join(folder, "playback.cjs"); writeFileSync(output, result.outputFiles[0].contents);
  const load = createRequire(path.join(root, "package.json"));
  deviceSpeechPage = (load(output) as { deviceSpeechPage: typeof deviceSpeechPage }).deviceSpeechPage;
});
function fixture() {
  const reportId = randomUUID(), contextId = randomUUID(), generation = randomUUID();
  const tables: Record<string, Row[]> = {
    device_reports: [{ id: reportId, user_id: device.userId, device_id: device.id, pages: ["First section.", "Final section."], expires_at: new Date(Date.now() + 60000).toISOString() }],
    device_report_sessions: [{ id: contextId, user_id: device.userId, device_id: device.id, state: { interactionId: generation, startedAt: Date.now() }, expires_at: new Date(Date.now() + 60000).toISOString() }],
  };
  return { tables, client: database(tables), input: { reportId, reportContextId: contextId, interactionId: generation, conversational: true, intent: "report_answer" } };
}

test("actual PCM response retains old page headers and echoes the current conversation generation", async () => {
  const { client, input } = fixture();
  const response = await deviceSpeechPage(client, device, { ...input, page: 0 });
  assert.equal(response.headers.get("x-quipus-playback-page"), "0");
  assert.equal(response.headers.get("x-lantern-report-page"), "1");
  assert.equal(response.headers.get("x-quipus-interaction-id"), input.interactionId);
  assert.equal(response.headers.get("x-quipus-context-id"), input.reportContextId);
  assert.equal(response.headers.get("x-quipus-report-mode"), "conversation");
  assert.match(response.headers.get("cache-control") || "", /private.*no-store/u);
  await response.body?.cancel();
  const final = await deviceSpeechPage(client, device, { ...input, page: 1 });
  assert.equal(final.headers.get("x-lantern-report-id"), null);
  assert.equal(final.headers.get("x-quipus-playback-page"), "1");
  await final.body?.cancel();
});

test("stale, foreign and closed report contexts cannot start TTS", async () => {
  for (const replacement of [ { interactionId: randomUUID() }, { closed: true }, { user_id: "foreign" } ]) {
    const { tables, client, input } = fixture();
    if ("user_id" in replacement) tables.device_report_sessions[0].user_id = replacement.user_id;
    else Object.assign(tables.device_report_sessions[0].state as object, replacement);
    const before = state.calls;
    await assert.rejects(deviceSpeechPage(client, device, input), /cancelled or replaced/);
    assert.equal(state.calls, before);
  }
});

test("a report cancelled while TTS starts cancels its PCM body instead of returning abandoned speech", async () => {
  const { tables, client, input } = fixture();
  const before = state.cancelled;
  state.onSpeech = () => { (tables.device_report_sessions[0].state as Record<string, unknown>).interactionId = randomUUID(); };
  try { await assert.rejects(deviceSpeechPage(client, device, input), /cancelled or replaced/); }
  finally { state.onSpeech = undefined; }
  assert.equal(state.cancelled, before + 1);
});

test("stop acknowledgement remains playable after the context is deliberately closed", async () => {
  const { tables, client, input } = fixture();
  tables.device_report_sessions[0].expires_at = new Date(0).toISOString();
  const response = await deviceSpeechPage(client, device, { ...input, reportId: undefined, intent: "report_stop", speech: "Report stopped. Nothing has been sent." });
  assert.equal(response.headers.get("x-lantern-command"), "report_stop");
  assert.equal(response.headers.get("x-quipus-interaction-id"), input.interactionId);
  await response.body?.cancel();
});

test("repeat plays only one page and never exposes continuation or an action approval token", async () => {
  const { tables, client, input } = fixture();
  tables.device_reports[0].review_token = randomUUID();
  const response = await deviceSpeechPage(client, device, { ...input, page: 0, playbackMode: "repeat" });
  assert.equal(response.headers.get("x-quipus-playback-mode"), "repeat");
  assert.equal(response.headers.get("x-lantern-report-id"), null);
  assert.equal(response.headers.get("x-lantern-report-page"), null);
  assert.equal(response.headers.get("x-lantern-review-token"), null);
  assert.equal(response.headers.get("x-quipus-playback-page"), "0");
  await response.body?.cancel();
});

test("active paged playback renews inactivity expiry but never extends the absolute context lifetime", async () => {
  const { tables, client, input } = fixture();
  const startedAt = Date.now() - 110 * 60000;
  (tables.device_report_sessions[0].state as Record<string, unknown>).startedAt = startedAt;
  const response = await deviceSpeechPage(client, device, input);
  assert.equal(tables.device_report_sessions[0].expires_at, new Date(startedAt + 120 * 60000).toISOString());
  await response.body?.cancel();
  (tables.device_report_sessions[0].state as Record<string, unknown>).startedAt = Date.now() - 121 * 60000;
  const before = state.calls;
  await assert.rejects(deviceSpeechPage(client, device, input), /context has expired/);
  assert.equal(state.calls, before);
});


test("a completed report page is reused without TTS while ownership and expiry are checked before cache access", async () => {
  const { tables, client, input } = fixture();
  tables.device_reports[0].pages = [`Private cache test ${randomUUID()}`];
  state.complete = true;
  try {
    const first = await deviceSpeechPage(client, device, input);
    assert.deepEqual([...new Uint8Array(await first.arrayBuffer())], [1, 0]);
    const calls = state.calls;
    const replay = await deviceSpeechPage(client, device, { ...input, playbackMode: "repeat" });
    assert.deepEqual([...new Uint8Array(await replay.arrayBuffer())], [1, 0]);
    assert.equal(state.calls, calls);
    assert.equal(replay.headers.get("x-quipus-voice-profile"), "quipus-marin-v1");
    assert.match(replay.headers.get("x-quipus-audio-key")!, /^[a-f0-9]{64}$/);
    assert.equal(replay.headers.get("x-quipus-audio-key"), first.headers.get("x-quipus-audio-key"));
    for (const change of ["closed", "foreign-report", "expired-report"]) {
      if (change === "closed") (tables.device_report_sessions[0].state as Record<string, unknown>).closed = true;
      else if (change === "foreign-report") tables.device_reports[0].user_id = "foreign";
      else tables.device_reports[0].expires_at = new Date(0).toISOString();
      await assert.rejects(deviceSpeechPage(client, device, input), /cancelled or replaced|Report has expired/);
      assert.equal(state.calls, calls);
      delete (tables.device_report_sessions[0].state as Record<string, unknown>).closed;
      tables.device_reports[0].user_id = device.userId;
    }
  } finally { state.complete = false; }
});

test("changing the text or authenticated owner/device cannot reuse another cached page", async () => {
  const { tables, client, input } = fixture();
  tables.device_reports[0].pages = [`Owner-scoped test ${randomUUID()}`];
  state.complete = true;
  try {
    const first = await deviceSpeechPage(client, device, input); await first.arrayBuffer();
    const calls = state.calls;
    tables.device_reports[0].pages = [String((tables.device_reports[0].pages as string[])[0]) + " changed"];
    const changed = await deviceSpeechPage(client, device, input); await changed.arrayBuffer();
    assert.equal(state.calls, calls + 1);
    assert.notEqual(changed.headers.get("x-quipus-audio-key"), first.headers.get("x-quipus-audio-key"));
    const other = { ...device, id: "another-board", userId: "another-owner" };
    for (const table of ["device_reports", "device_report_sessions"])
      Object.assign(tables[table][0], { user_id: other.userId, device_id: other.id });
    const foreign = await deviceSpeechPage(client, other, input); await foreign.arrayBuffer();
    assert.equal(state.calls, calls + 2);
    assert.notEqual(foreign.headers.get("x-quipus-audio-key"), changed.headers.get("x-quipus-audio-key"));
  } finally { state.complete = false; }
});

test("generation replacement during a cache hit still discards the returned PCM", async () => {
  const { tables, client, input } = fixture();
  tables.device_reports[0].pages = [`Generation-scoped test ${randomUUID()}`];
  state.complete = true;
  try {
    await (await deviceSpeechPage(client, device, input)).arrayBuffer();
    const calls = state.calls;
    let checks = 0;
    const racing = { from: (table: string) => {
      const query = client.from(table);
      if (table === "device_report_sessions") {
        const fixtureQuery = query as unknown as { maybeSingle: () => Promise<unknown> };
        const original = fixtureQuery.maybeSingle.bind(fixtureQuery);
        fixtureQuery.maybeSingle = async () => {
          if (++checks === 2) (tables.device_report_sessions[0].state as Record<string, unknown>).interactionId = randomUUID();
          return original();
        };
      }
      return query;
    } } as unknown as SupabaseClient;
    await assert.rejects(deviceSpeechPage(racing, device, input), /cancelled or replaced/);
    assert.equal(state.calls, calls);
    assert.equal(checks, 2);
  } finally { state.complete = false; }
});


test("only a selected meeting report is eligible for private offline caching", async () => {
  for (const [reportMatches, indexes, eligible] of [
    [true, [0, 0], true], [true, [-1], false], [false, [0], false],
  ] as const) {
    const { tables, client, input } = fixture();
    Object.assign(tables.device_report_sessions[0].state as object, {
      currentReportId: reportMatches ? input.reportId : randomUUID(),
      currentMeetingPages: [...indexes],
    });
    const response = await deviceSpeechPage(client, device, input);
    assert.equal(response.headers.get("x-quipus-offline-cache"), eligible ? "report" : null);
    await response.body?.cancel();
  }
});
