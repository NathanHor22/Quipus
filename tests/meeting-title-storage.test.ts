import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { meetingTitleHandlers } from "../lib/meeting-title-api";
import { saveMeetingWithProtectedTitle } from "../lib/meeting-title-store";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MEETING = "33333333-3333-4333-8333-333333333333";
const RECORDING = "44444444-4444-4444-8444-444444444444";
const REFERENCE = `hardware:${RECORDING}`;
type Row = Record<string, unknown>;
type Operation = { table: string; mode: "read" | "insert" | "update"; filters: [string, unknown][]; value: Row | null };
const source = [{ speaker: "Speaker 1", text: "We will test the pilot in the Bangsar branch.", startSeconds: 0, endSeconds: 4 }];
function database(seed: Record<string, Row[]> = {}, before?: (operation: Operation, tables: Record<string, Row[]>) => void) {
  const tables: Record<string, Row[]> = { meetings: [], transcripts: [], ...seed };
  const operations: Operation[] = [];
  let failure = false;
  const client = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let mode: Operation["mode"] = "read";
      let value: Row | null = null;
      const execute = () => {
        const operation = { table, mode, filters: [...filters], value };
        operations.push(operation);
        before?.(operation, tables);
        if (failure) return { data: [], error: { code: "XX001", message: "injected failure" } };
        const rows = tables[table] ||= [];
        if (mode === "insert" && value) {
          if (rows.some(row => row.user_id === value?.user_id && row.client_reference === value?.client_reference)) return { data: [], error: { code: "23505", message: "duplicate" } };
          const inserted = { id: MEETING, ...value };
          rows.push(inserted);
          return { data: [{ ...inserted }], error: null };
        }
        const matching = rows.filter(row => filters.every(([key, expected]) => row[key] === expected));
        if (mode === "update" && value) for (const row of matching) Object.assign(row, value);
        return { data: matching.map(row => ({ ...row })), error: null };
      };
      const query = {
        select() { return query; },
        eq(key: string, expected: unknown) { filters.push([key, expected]); return query; },
        update(input: Row) { mode = "update"; value = input; return query; },
        insert(input: Row) { mode = "insert"; value = input; return query; },
        async maybeSingle() { const result = execute(); return { data: result.data[0] || null, error: result.error }; },
        async single() { const result = execute(); return { data: result.data[0] || null, error: result.error || (result.data.length !== 1 ? { code: "PGRST116", message: "one row required" } : null) }; },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, tables, operations, fail: () => { failure = true; } };
}
const meeting = (extra: Row = {}) => ({ id: MEETING, user_id: OWNER, client_reference: REFERENCE, title: "Old meeting title", status: "ready", source: "hardware", recording_id: RECORDING, start_at: "2026-10-26T02:00:00Z", ...extra });
const write = (extra: Row = {}) => ({ user_id: OWNER, client_reference: REFERENCE, title: "Bangsar pilot rollout", status: "processing", source: "hardware", recording_id: RECORDING, start_at: "2026-10-26T02:00:00Z", end_at: "2026-10-26T03:00:00Z", ...extra });
const request = (method: "PATCH" | "POST", body: unknown, origin = "https://quipus.example") => new Request(`https://quipus.example/api/meetings/${REFERENCE}/title`, { method, headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
const context = (id = REFERENCE) => ({ params: Promise.resolve({ id }) });
function handlers(db: ReturnType<typeof database>, overrides: Partial<Parameters<typeof meetingTitleHandlers>[0]> = {}) {
  return meetingTitleHandlers({ user: async () => ({ id: OWNER }), client: () => db.client, limit: async () => null, extract: async () => ({ title: "Bangsar pilot rollout" }), ...overrides });
}

test("manual rename is owner scoped, normalized, persisted and rejects stale edits", async () => {
  const db = database({ meetings: [meeting(), meeting({ id: OTHER, user_id: OTHER })] });
  const api = handlers(db);
  const response = await api.PATCH(request("PATCH", { title: "  Bangsar   pilot rollout  ", expectedTitle: "Old meeting title" }), context());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { title: "Bangsar pilot rollout", persisted: true });
  assert.equal(db.tables.meetings[1].title, "Old meeting title");
  assert.equal((await api.PATCH(request("PATCH", { title: "A different title", expectedTitle: "Old meeting title" }), context())).status, 409);
  for (const op of db.operations) assert(op.filters.some(([key, value]) => key === "user_id" && value === OWNER));
});

test("cross-site mutations are rejected before authentication or storage access", async () => {
  let authCalls = 0;
  const db = database();
  const api = handlers(db, { user: async () => { authCalls++; return { id: OWNER }; } });
  for (const method of ["PATCH", "POST"] as const) {
    const response = await api[method](request(method, {}, "https://attacker.example"), context());
    assert.equal(response.status, 403);
  }
  assert.equal(authCalls, 0);
  assert.equal(db.operations.length, 0);
});

test("authentication, rate limits and unavailable storage fail closed", async () => {
  const db = database();
  const body = { title: "Pilot review", expectedTitle: "Old meeting title" };
  assert.equal((await handlers(db, { user: async () => null }).PATCH(request("PATCH", body), context())).status, 401);
  assert.equal((await handlers(db, { limit: async () => Response.json({ error: "limited" }, { status: 429 }) }).PATCH(request("PATCH", body), context())).status, 429);
  assert.equal((await handlers(db, { client: () => null }).PATCH(request("PATCH", body), context())).status, 503);
  assert.equal(db.operations.length, 0);
});

test("invalid references, forged fields, empty, control, oversized and placeholder titles do not touch storage", async () => {
  const db = database();
  const api = handlers(db);
  for (const title of ["", "Speaker 1", "Conversation 1", "A".repeat(81), "Pilot\nreview"]) {
    assert.equal((await api.PATCH(request("PATCH", { title, expectedTitle: "Old meeting title" }), context())).status, 400);
  }
  assert.equal((await api.PATCH(request("PATCH", { title: "Pilot review", expectedTitle: "Old meeting title", userId: OTHER }), context())).status, 400);
  assert.equal((await api.PATCH(request("PATCH", { title: "Pilot review", expectedTitle: "Old meeting title" }), context("sample:1"))).status, 400);
  assert.equal((await api.PATCH(request("PATCH", { title: "Pilot review" }), context())).status, 400);
  assert.equal(db.operations.length, 0);
});

test("foreign/unknown meetings are indistinguishable and never run title analysis", async () => {
  const db = database({ meetings: [meeting({ user_id: OTHER })] });
  let calls = 0;
  const api = handlers(db, { extract: async () => { calls++; return { title: "Pilot review" }; } });
  assert.equal((await api.POST(request("POST", { expectedTitle: "Old meeting title" }), context())).status, 404);
  assert.equal((await api.POST(request("POST", { expectedTitle: "Old meeting title" }), context(OTHER))).status, 404);
  assert.equal(calls, 0);
  assert(!db.operations.some(operation => operation.mode !== "read"));
});

test("backfill analyses only the saved owned transcript and stores only its generated title", async () => {
  const db = database({ meetings: [meeting()], transcripts: [{ user_id: OWNER, recording_id: RECORDING, segments: source }] });
  let calls = 0;
  const api = handlers(db, { extract: async (segments, extractionContext) => { calls++; assert.deepEqual(segments, source); assert.equal(extractionContext.referenceTimeUncertain, true); return { title: "Bangsar pilot rollout" }; } });
  assert.equal((await api.POST(request("POST", { expectedTitle: "Old meeting title" }), context())).status, 200);
  assert.equal(calls, 1);
  const update = db.operations.find(operation => operation.mode === "update");
  assert.deepEqual(update?.value, { title: "Bangsar pilot rollout" });
  assert(db.operations.filter(operation => operation.table === "transcripts").every(operation => operation.filters.some(([key, value]) => key === "user_id" && value === OWNER)));
});

test("backfill cannot overwrite a title renamed while analysis was in flight", async () => {
  const db = database({ meetings: [meeting()], transcripts: [{ user_id: OWNER, recording_id: RECORDING, segments: source }] });
  const api = handlers(db, { extract: async () => { db.tables.meetings[0].title = "Owner's new title"; return { title: "Bangsar pilot rollout" }; } });
  assert.equal((await api.POST(request("POST", { expectedTitle: "Old meeting title" }), context())).status, 409);
  assert.equal(db.tables.meetings[0].title, "Owner's new title");
});

test("missing, enormous or ungrounded transcripts never replace an existing title", async () => {
  for (const segments of [[], [{ ...source[0], text: "x".repeat(50_000) }, ...Array.from({ length: 5 }, () => ({ ...source[0], text: "x".repeat(50_000) }))]]) {
    const db = database({ meetings: [meeting()], transcripts: [{ user_id: OWNER, recording_id: RECORDING, segments }] });
    let calls = 0;
    assert.equal((await handlers(db, { extract: async () => { calls++; return { title: "Pilot review" }; } }).POST(request("POST", { expectedTitle: "Old meeting title" }), context())).status, 422);
    assert.equal(calls, 0);
  }
  const db = database({ meetings: [meeting()], transcripts: [{ user_id: OWNER, recording_id: RECORDING, segments: source }] });
  assert.equal((await handlers(db, { extract: async () => ({ title: null }) }).POST(request("POST", { expectedTitle: "Old meeting title" }), context())).status, 422);
  assert.equal(db.tables.meetings[0].title, "Old meeting title");
});

test("calendar events and unfinished reports cannot invoke title backfill", async () => {
  for (const extra of [{ source: "calendar" }, { status: "processing" }, { recording_id: null }]) {
    const db = database({ meetings: [meeting(extra)] });
    const response = await handlers(db).POST(request("POST", { expectedTitle: "Old meeting title" }), context());
    assert([400, 409].includes(response.status));
    assert(!db.operations.some(operation => operation.mode !== "read"));
  }
});

test("persistence inserts a generated title only once and retries preserve manual renames", async () => {
  const db = database();
  assert.deepEqual(await saveMeetingWithProtectedTitle(db.client, write(), true), { id: MEETING, ...write() });
  db.tables.meetings[0].title = "Owner's revised title";
  const result = await saveMeetingWithProtectedTitle(db.client, write(), true);
  assert.equal(result.title, "Owner's revised title");
  assert(db.operations.filter(operation => operation.mode === "update").every(operation => !Object.hasOwn(operation.value || {}, "title")));
});

test("a successful retry promotes a neutral failed-archive title using a compare-and-set", async () => {
  const db = database({ meetings: [meeting({ title: "Conversation 1" })] });
  const saved = await saveMeetingWithProtectedTitle(db.client, write(), true);
  assert.equal(saved.title, "Bangsar pilot rollout");
  const promoted = db.operations.find(operation => operation.mode === "update" && operation.value?.title);
  assert(promoted?.filters.some(([key, value]) => key === "title" && value === "Conversation 1"));
});

test("processing title promotion respects a simultaneous rename", async () => {
  const db = database({ meetings: [meeting({ title: "Conversation 1" })] }, (operation, tables) => {
    if (operation.mode === "update" && operation.value?.title) tables.meetings[0].title = "Manual title wins";
  });
  const result = await saveMeetingWithProtectedTitle(db.client, write(), true);
  assert.equal(result.title, "Manual title wins");
});

test("a concurrent initial insert is resolved without clobbering the winning title", async () => {
  let raced = false;
  const db = database({}, (operation, tables) => {
    if (!raced && operation.mode === "insert") { raced = true; tables.meetings.push(meeting({ title: "Manual title wins" })); }
  });
  const result = await saveMeetingWithProtectedTitle(db.client, write(), true);
  assert.equal(result.title, "Manual title wins");
  assert.equal(db.tables.meetings.length, 1);
});

test("database failures are not reported as successful title saves", async () => {
  const db = database({ meetings: [meeting()] });
  db.fail();
  assert.equal((await handlers(db).PATCH(request("PATCH", { title: "Pilot review", expectedTitle: "Old meeting title" }), context())).status, 503);
  await assert.rejects(saveMeetingWithProtectedTitle(db.client, write(), true));
});
