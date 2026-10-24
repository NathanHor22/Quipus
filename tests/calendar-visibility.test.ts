import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CalendarRecordingAction } from "../components/workspace/CalendarRecordingAction";
import {
  calendarVisibilityHandler,
  setRecordingCalendarVisibility,
  withCalendarVisibility,
} from "../lib/recording-calendar-visibility";
import {
  calendarMeetings,
  canHideRecording,
  updateCalendarVisibility,
} from "../lib/workspace/calendar-visibility";
import { createSampleWorkspace, readSampleWorkspace } from "../lib/workspace/sample";
import { getApprovals, isConversation } from "../lib/workspace/model";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MEETING = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const REFERENCE = `hardware:${SESSION}`;
type Row = Record<string, unknown>;
type Failure = { code: string; message: string };

/** Emulates only the persistence edges: all production authorization/filtering runs unchanged. */
function database(seed: Record<string, Row[]> = {}, failures: Record<string, Failure> = {}) {
  const tables: Record<string, Row[]> = {
    meetings: [],
    lantern_sessions: [],
    calendar_recording_preferences: [],
    ...seed,
  };
  const reads: { table: string; filters: [string, unknown][] }[] = [];
  const writes: { table: string; value: Row; options: unknown }[] = [];
  const client = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let included: [string, unknown[]] | null = null;
      const result = () => {
        reads.push({ table, filters: [...filters] });
        return {
          data: (tables[table] || []).filter(
            (row) =>
              filters.every(([key, value]) => row[key] === value) &&
              (!included || included[1].includes(row[included[0]])),
          ),
          error: failures[table] || null,
        };
      };
      const query = {
        select() {
          return query;
        },
        eq(key: string, value: unknown) {
          filters.push([key, value]);
          return query;
        },
        in(key: string, values: unknown[]) {
          included = [key, values];
          return query;
        },
        async maybeSingle() {
          const found = result();
          return { data: found.data[0] || null, error: found.error };
        },
        then(resolve: (value: ReturnType<typeof result>) => unknown) {
          return Promise.resolve(result()).then(resolve);
        },
        async upsert(value: Row, options: unknown) {
          writes.push({ table, value, options });
          if (!failures[table]) {
            const rows = (tables[table] ||= []);
            const index = rows.findIndex(
              (row) =>
                row.user_id === value.user_id &&
                row.conversation_reference === value.conversation_reference,
            );
            if (index < 0) rows.push(value);
            else rows[index] = value;
          }
          return { error: failures[table] || null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, reads, writes, tables };
}
const ownedMeeting = (extra: Row = {}) => ({
  id: MEETING,
  user_id: OWNER,
  client_reference: REFERENCE,
  source: "hardware",
  status: "ready",
  ...extra,
});
const request = (body: unknown = { hidden: true }, origin = "https://quipus.example") =>
  new Request(`https://quipus.example/api/meetings/${REFERENCE}/calendar-visibility`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
const context = (id = REFERENCE) => ({ params: Promise.resolve({ id }) });

function handler(
  db: ReturnType<typeof database>,
  overrides: Partial<Parameters<typeof calendarVisibilityHandler>[0]> = {},
) {
  return calendarVisibilityHandler({
    user: async () => ({ id: OWNER }),
    client: () => db.client,
    limit: async () => null,
    ...overrides,
  });
}

test("calendar hiding preserves conversation history, audio, approvals and sample reload", () => {
  const sample = createSampleWorkspace(new Date("2026-10-24T01:00:00Z"));
  const recording = sample.meetings.find(isConversation)!;
  const changed = updateCalendarVisibility(sample.meetings, recording.id, true);
  assert.equal(
    calendarMeetings(changed).some((item) => item.id === recording.id),
    false,
  );
  assert.deepEqual(
    calendarMeetings(changed, true).map((item) => item.id),
    [recording.id],
  );
  assert.equal(
    changed.filter(isConversation).length,
    sample.meetings.filter(isConversation).length,
  );
  assert.deepEqual(getApprovals(changed), getApprovals(sample.meetings));
  assert.equal(sample.meetings.find((item) => item.id === recording.id)?.calendarHidden, undefined);
  assert.deepEqual(
    changed.find((item) => item.id === recording.id),
    { ...recording, calendarHidden: true },
  );
  const reloaded = readSampleWorkspace(JSON.stringify({ version: 1, meetings: changed }))!;
  assert.equal(reloaded.meetings.find((item) => item.id === recording.id)?.calendarHidden, true);
  const restored = updateCalendarVisibility(reloaded.meetings, recording.id, false);
  assert.equal(
    calendarMeetings(restored).some((item) => item.id === recording.id),
    true,
  );
  assert.equal(calendarMeetings(restored, true).length, 0);
});

test("calendar invitations and upcoming events cannot be hidden even with a stale hidden flag", () => {
  const source = createSampleWorkspace().meetings[0];
  for (const meeting of [
    { ...source, source: "calendar" as const, calendarHidden: true },
    { ...source, status: "upcoming" as const, calendarHidden: true },
  ]) {
    assert.equal(canHideRecording(meeting), false);
    assert.deepEqual(calendarMeetings([meeting]), [meeting]);
    assert.deepEqual(calendarMeetings([meeting], true), []);
    assert.equal(updateCalendarVisibility([meeting], meeting.id, false)[0], meeting);
  }
});

test("owned recordings hide and restore idempotently using their stable public reference", async () => {
  const db = database({ meetings: [ownedMeeting()] });
  for (const hidden of [true, true, false]) {
    assert.deepEqual(await setRecordingCalendarVisibility(db.client, OWNER, MEETING, hidden), {
      id: REFERENCE,
      hidden,
      persisted: true,
    });
  }
  assert.equal(db.tables.calendar_recording_preferences.length, 1);
  assert.equal(db.tables.calendar_recording_preferences[0].hidden, false);
  assert.ok(
    db.reads.every((query) =>
      query.filters.some(([key, value]) => key === "user_id" && value === OWNER),
    ),
  );
  assert.ok(
    db.writes.every(
      (write) => write.table === "calendar_recording_preferences" && write.value.user_id === OWNER,
    ),
  );
  assert.deepEqual(db.tables.meetings, [ownedMeeting()]);
});

test("an owned hardware placeholder remains hidden when its completed meeting appears", async () => {
  const db = database({ lantern_sessions: [{ id: SESSION, user_id: OWNER }] });
  await setRecordingCalendarVisibility(db.client, OWNER, REFERENCE, true);
  const complete = { ...createSampleWorkspace().meetings[0], id: REFERENCE };
  const loaded = await withCalendarVisibility(db.client, OWNER, [complete]);
  assert.equal(loaded[0].calendarHidden, true);
  assert.equal(calendarMeetings(loaded).length, 0);
  assert.deepEqual(loaded[0].transcript, complete.transcript);
});

test("foreign and unknown references never create a preference or expose the owner", async () => {
  for (const id of [MEETING, REFERENCE, "unknown"]) {
    const db = database({
      meetings: [ownedMeeting({ user_id: OTHER })],
      lantern_sessions: [{ id: SESSION, user_id: OTHER }],
    });
    const response = await handler(db)(request(), context(id));
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Recording not found." });
    assert.equal(db.writes.length, 0);
    assert.ok(
      db.reads.every((query) =>
        query.filters.some(([key, value]) => key === "user_id" && value === OWNER),
      ),
    );
  }
});

test("the browser route requires authentication, same origin, strict input and a live reference", async () => {
  const db = database({ meetings: [ownedMeeting()] });
  assert.equal((await handler(db, { user: async () => null })(request(), context())).status, 401);
  assert.equal(
    (await handler(db)(request(undefined, "https://attacker.example"), context())).status,
    403,
  );
  for (const body of [{ hidden: "true" }, { hidden: true, userId: OTHER }, {}, null])
    assert.equal((await handler(db)(request(body), context())).status, 400);
  assert.equal((await handler(db)(request(), context("sample:conversation:0"))).status, 400);
  assert.equal(db.reads.length, 0);
  assert.equal(db.writes.length, 0);
});

test("rate limits and missing configuration return without touching stored recordings", async () => {
  const db = database({ meetings: [ownedMeeting()] });
  assert.equal(
    (
      await handler(db, { limit: async () => new Response(null, { status: 429 }) })(
        request(),
        context(),
      )
    ).status,
    429,
  );
  assert.equal((await handler(db, { client: () => null })(request(), context())).status, 503);
  assert.equal(db.reads.length, 0);
  assert.equal(db.writes.length, 0);
});

test("calendar/upcoming records reject hiding; persistence failure is never reported as success", async () => {
  for (const patch of [{ source: "calendar" }, { status: "upcoming" }]) {
    const db = database({ meetings: [ownedMeeting(patch)] });
    assert.equal((await handler(db)(request(), context())).status, 400);
    assert.equal(db.writes.length, 0);
  }
  const db = database(
    { meetings: [ownedMeeting()] },
    { calendar_recording_preferences: { code: "42P01", message: "sensitive internal detail" } },
  );
  const response = await handler(db)(request(), context());
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(await response.json()), /sensitive internal detail/);
});

test("visibility loading is owner scoped and only missing migration is a safe compatibility fallback", async () => {
  const meetings = createSampleWorkspace().meetings;
  const ref = meetings[0].id;
  const db = database({
    calendar_recording_preferences: [{ user_id: OTHER, conversation_reference: ref, hidden: true }],
  });
  assert.equal((await withCalendarVisibility(db.client, OWNER, meetings))[0].calendarHidden, false);
  for (const code of ["42P01", "PGRST205"]) {
    const missing = database({}, { calendar_recording_preferences: { code, message: "missing" } });
    assert.equal(await withCalendarVisibility(missing.client, OWNER, meetings), meetings);
  }
  const unavailable = database(
    {},
    { calendar_recording_preferences: { code: "XX000", message: "internal error" } },
  );
  await assert.rejects(
    withCalendarVisibility(unavailable.client, OWNER, meetings),
    /could not be loaded/,
  );
});

test(
  "real SQL grants no browser access and keeps preferences separate from source data",
  { timeout: 30_000 },
  async () => {
    const db = new PGlite();
    try {
      await db.exec(
        "create role anon; create role authenticated; create role service_role bypassrls; create table public.profiles(id uuid primary key); grant usage on schema public to service_role,anon,authenticated;",
      );
      await db.query("insert into profiles values($1)", [OWNER]);
      const sql = await readFile(
        "supabase/migrations/022_recording_calendar_visibility.sql",
        "utf8",
      );
      await db.exec(sql);
      await db.exec(sql); // Safe for the combined migration handoff to be re-run.
      await db.exec("set role service_role");
      await db.query(
        "insert into calendar_recording_preferences(user_id,conversation_reference,hidden) values($1,$2,true)",
        [OWNER, REFERENCE],
      );
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`reset role; set role ${role}`);
        await assert.rejects(
          db.query("select * from calendar_recording_preferences"),
          /permission denied/,
        );
        await assert.rejects(
          db.query("update calendar_recording_preferences set hidden=false"),
          /permission denied/,
        );
      }
      await db.exec("reset role");
      assert.deepEqual((await db.query("select hidden from calendar_recording_preferences")).rows, [
        { hidden: true },
      ]);
      assert.deepEqual((await db.query("select id from profiles")).rows, [{ id: OWNER }]);
    } finally {
      await db.close();
    }
  },
);

test("the rendered recording control is a contained native button with explicit hide/restore labels", async () => {
  const result = await build({
    entryPoints: ["components/workspace/CalendarRecordingAction.tsx"],
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    write: false,
    plugins: [
      {
        name: "css-module-fixture",
        setup(builder) {
          builder.onResolve({ filter: /\.css$/ }, (args) => ({
            path: args.path,
            namespace: "css-fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "css-fixture" }, () => ({
            contents: 'export default {calendarRecordingAction:"calendar-action"}',
            loader: "js",
          }));
        },
      },
    ],
  });
  const evaluated = { exports: {} };
  const load = createRequire(`${process.cwd()}/package.json`);
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    load,
    evaluated,
    evaluated.exports,
  );
  const Control = (evaluated.exports as { CalendarRecordingAction: typeof CalendarRecordingAction })
    .CalendarRecordingAction;
  const meeting = createSampleWorkspace().meetings[0];
  const changes: [string, boolean][] = [];
  const onChange = async (id: string, hidden: boolean) => {
    changes.push([id, hidden]);
    return true;
  };
  for (const hidden of [false, true]) {
    const props = { meeting: { ...meeting, calendarHidden: hidden }, disabled: false, onChange };
    const markup = renderToStaticMarkup(createElement(Control, props));
    assert.match(markup, /^<button type="button" class="calendar-action" aria-label=/);
    assert.ok(markup.includes(hidden ? "Restore to calendar:" : "Hide from calendar:"));
    const element = Control(props);
    element.props.onClick();
  }
  assert.deepEqual(changes, [
    [meeting.id, true],
    [meeting.id, false],
  ]);
  assert.match(
    renderToStaticMarkup(createElement(Control, { meeting, disabled: true, onChange })),
    /disabled=""/,
  );
});
