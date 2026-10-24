import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedLantern } from "../lib/lantern-device-auth";
import { assertReportCaptureStopped } from "../lib/device-report-session";
import { advanceLantern, createLanternMachine, type LanternMachine } from "../lib/lantern-state";

const device: AuthenticatedLantern = {
  id: "board-a",
  userId: "owner-a",
  name: "Quipus",
  state: "error",
  stateVersion: 1,
};
type Row = {
  id?: string;
  machine?: unknown;
  recording_started_at?: string | null;
  recording_id?: string | null;
  audio_received_at?: string | null;
  audio_event_id?: string | null;
  transcript_received_at?: string | null;
  transcript_segments?: unknown;
  final_transcription?: unknown;
  meeting_id?: string | null;
  user_id: string;
  device_id: string;
  state: string;
  capture_ended_at: string | null;
  ended_at: string | null;
  offline_import_fingerprint: string | null;
};
function clientFor(row: Row | null, error: unknown = null) {
  const filters: Array<[string, unknown]> = [];
  let calls = 0;
  let selected: string[] = [];
  const query = {
    select: (columns: string) => {
      selected = columns.split(",");
      assert.ok(selected.includes("state") && selected.includes("capture_ended_at"));
      return query;
    },
    eq: (key: string, value: unknown) => {
      filters.push([key, value]);
      return query;
    },
    is: (key: string, value: unknown) => {
      filters.push([key, value]);
      return query;
    },
    maybeSingle: async () => ({
      // Return only requested columns: omitting a durable evidence column in
      // production must not accidentally pass against an overly rich mock row.
      data: row && filters.every(([key, value]) => row[key as keyof Row] === value)
        ? Object.fromEntries(selected.map(key => [key, row[key as keyof Row]])) : null,
      error,
    }),
  };
  const client = {
    from: (table: string) => {
      calls++;
      assert.equal(table, "lantern_sessions");
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, filters, calls: () => calls };
}
const stopped: Row = {
  user_id: device.userId,
  device_id: device.id,
  state: "finalising",
  capture_ended_at: "2026-01-01T00:00:00Z",
  ended_at: null,
  offline_import_fingerprint: null,
};

test("reports during upload require an owned stopped active session, without changing it", async () => {
  for (const reportedState of ["error", "finalising", "processing", "report_ready", "recording", "connecting", "status_report"] as const) {
    for (const captureState of ["finalising", "processing"]) {
      const row = { ...stopped, state: captureState };
      const before = structuredClone(row);
      const mock = clientFor(row);
      await assertReportCaptureStopped(mock.client, { ...device, state: reportedState });
      assert.deepEqual(mock.filters, [
        ["device_id", device.id],
        ["user_id", device.userId],
        ["ended_at", null],
        ["offline_import_fingerprint", null],
      ]);
      assert.deepEqual(row, before);
    }
  }
});

test("actual active capture cannot bypass the guard through any reported device state", async () => {
  for (const reportedState of ["recording", "paused", "offline_buffering", "awaiting_recording_consent",
    "connecting", "status_report", "oath_listening", "awaiting_action_confirmation", "pending_dashboard_approval", "error"] as const) {
    for (const captureState of ["recording", "paused", "offline_buffering", "awaiting_recording_consent", "error"]) {
      const mock = clientFor({ ...stopped, state: captureState });
      await assert.rejects(assertReportCaptureStopped(mock.client, { ...device, state: reportedState }),
        /Finish the current recording/u);
    }
  }
});

test("invalid and unverified capture receipts remain blocked", async () => {
  for (const row of [
    { ...stopped, capture_ended_at: null },
    { ...stopped, capture_ended_at: "invalid" },
    { ...stopped, capture_ended_at: new Date(Date.now() + 600_000).toISOString() },
  ]) {
    await assert.rejects(
      assertReportCaptureStopped(clientFor(row).client, device),
      /Finish the current recording/u,
    );
  }
  await assert.rejects(
    assertReportCaptureStopped(
      clientFor(stopped, { message: "database unavailable" }).client,
      device,
    ),
    /Could not verify/u,
  );
});

test("a ready device preserves the original report path without extra session queries", async () => {
  const mock = clientFor(null);
  await assertReportCaptureStopped(mock.client, { ...device, state: "ready" });
  assert.equal(mock.calls(), 0);
});

test("stale device state without an owned live slot cannot trap historical reports", async () => {
  for (const state of ["error", "finalising", "processing", "report_ready", "connecting", "status_report",
    "oath_listening", "awaiting_action_confirmation", "pending_dashboard_approval", "recording", "paused",
    "offline_buffering", "awaiting_recording_consent"] as const) {
    for (const row of [null, { ...stopped, user_id: "other-owner" },
      { ...stopped, device_id: "other-board" },
      { ...stopped, ended_at: "2026-01-01T00:00:01Z" },
      { ...stopped, offline_import_fingerprint: "already-finalized-offline-import" }]) {
      const mock = clientFor(row);
      await assertReportCaptureStopped(mock.client, { ...device, state });
      assert.deepEqual(mock.filters, [["device_id", device.id], ["user_id", device.userId],
        ["ended_at", null], ["offline_import_fingerprint", null]]);
    }
  }
});


function abandonedConsent(now = Date.now()): Row {
  const machine = advanceLantern(createLanternMachine("ready"), {
    type: "BEGIN_QUICK", at: new Date(now - 60_000).toISOString(),
    sessionId: "abandoned-consent-session", promptId: "expired-question",
    promptExpiresAt: new Date(now - 30_000).toISOString(),
  });
  return { ...stopped, id: machine.sessionId!, state: "awaiting_recording_consent", machine,
    capture_ended_at: null, recording_started_at: null, recording_id: null,
    audio_received_at: null, audio_event_id: null, transcript_received_at: null,
    transcript_segments: null, final_transcription: null, meeting_id: null };
}
const consentDevice = { ...device, state: "awaiting_recording_consent" as const };

test("an expired untouched consent question allows read-only historical reports without approving or clearing it", async () => {
  for (const transcript_segments of [null, []]) {
    const row = { ...abandonedConsent(), transcript_segments };
    const before = structuredClone(row);
    const mock = clientFor(row);
    await assertReportCaptureStopped(mock.client, consentDevice);
    assert.deepEqual(row, before);
    assert.equal(mock.calls(), 1);
    // The actual state machine still refuses a late yes. A report exception
    // cannot retroactively grant permission to record.
    assert.throws(() => advanceLantern(row.machine as LanternMachine, {
      type: "RECORDING_CONSENT", at: new Date().toISOString(),
      promptId: "expired-question", accepted: true,
    }), /expired/i);
  }
});

test("every durable capture field, including legacy transcript evidence, defeats the expired-consent exception", async () => {
  const base = abandonedConsent();
  for (const field of ["capture_ended_at", "recording_started_at", "recording_id", "audio_received_at",
    "audio_event_id", "transcript_received_at", "final_transcription", "meeting_id"] as const) {
    for (const value of ["present", ""]) {
      await assert.rejects(assertReportCaptureStopped(clientFor({ ...base, [field]: value }).client, consentDevice),
        /Finish the current recording/);
    }
    const incomplete = { ...base };
    delete incomplete[field];
    await assert.rejects(assertReportCaptureStopped(clientFor(incomplete).client, consentDevice),
      /Finish the current recording/);
  }
  for (const transcript_segments of [[{ speaker: "Speaker 1", text: "Yes" }], "[]", {}, undefined]) {
    await assert.rejects(assertReportCaptureStopped(clientFor({ ...base, transcript_segments }).client, consentDevice),
      /Finish the current recording/);
  }
});

test("missing, malformed, not-yet-expired and wrong-session consent machines remain blocked", async t => {
  const now = Date.parse("2026-10-24T10:00:00Z");
  t.mock.method(Date, "now", () => now);
  const base = abandonedConsent(now);
  const machine = base.machine as LanternMachine;
  for (const candidate of [null, {}, { ...machine, sessionId: "another-session" },
    { ...machine, recordingStartedAt: "2026-10-24T09:59:00Z" },
    { ...machine, consentConfirmedAt: "2026-10-24T09:59:00Z" },
    { ...machine, prompt: null },
    ...["invalid", "2000", "2026-01-01", new Date(now).toISOString(), new Date(now + 1).toISOString()]
      .map(expiresAt => ({ ...machine, prompt: { ...machine.prompt!, expiresAt } })),
    { ...machine, prompt: { ...machine.prompt!, kind: "action_confirmation" } },
    { ...machine, state: "recording", prompt: null },
  ]) {
    await assert.rejects(assertReportCaptureStopped(clientFor({ ...base, machine: candidate }).client, consentDevice),
      /Finish the current recording/);
  }
  for (const state of ["recording", "paused", "offline_buffering", "error"] as const) {
    await assert.rejects(assertReportCaptureStopped(clientFor(base).client, { ...device, state }),
      /Finish the current recording/);
    await assert.rejects(assertReportCaptureStopped(clientFor({ ...base, state }).client, consentDevice),
      /Finish the current recording/);
  }
  await assert.rejects(assertReportCaptureStopped(clientFor(base, { message: "lookup failed" }).client, consentDevice),
    /Could not verify/);
});
