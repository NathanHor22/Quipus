import assert from "node:assert/strict";
import test from "node:test";
import { wrapArchiveKey, unwrapArchiveKey } from "../lib/device-archive-key";
import { offlineImportDiagnostic, offlineSessionSchema, prepareOfflineSession } from "../lib/offline-session";
const owner = "11111111-1111-4111-8111-111111111111";
const device = "22222222-2222-4222-8222-222222222222";
const secret = "archive-wrapping-test-secret-32-characters";
test("archive keys are authenticated, owner-bound and recoverable", () => {
  const key = "ab".repeat(32);
  const encrypted = wrapArchiveKey(key, owner, device, secret);
  assert.equal(unwrapArchiveKey(encrypted, owner, device, secret), key);
  assert.ok(!encrypted.includes(key));
  assert.throws(() => unwrapArchiveKey(encrypted, device, owner, secret));
  assert.throws(() => unwrapArchiveKey(encrypted, owner, device, secret + "changed"));
  const parts = encrypted.split(".");
  parts[2] = ("A" === parts[2][0] ? "B" : "A") + parts[2].slice(1);
  assert.throws(() => unwrapArchiveKey(parts.join("."), owner, device, secret));
});
test("offline import is consented, bounded and explicitly time-uncertain", () => {
  const input = {
    sessionId: device,
    eventId: owner,
    ownerId: owner,
    ownerDeviceId: device,
    capturedAt: null,
    timeUncertain: true,
    durationSeconds: 300,
    consentAccepted: true,
  };
  const parsed = offlineSessionSchema.parse(input);
  const first = prepareOfflineSession(parsed, Date.parse("2026-10-18T10:00:00Z"));
  const retry = prepareOfflineSession(parsed, Date.parse("2026-10-18T11:00:00Z"));
  assert.equal(first.fingerprint, retry.fingerprint);
  assert.equal(first.machine.state, "finalising");
  assert.throws(() => offlineSessionSchema.parse({ ...input, consentAccepted: false }));
  assert.throws(() => offlineSessionSchema.parse({ ...input, timeUncertain: false }));
  assert.throws(() => offlineSessionSchema.parse({ ...input, durationSeconds: 999999 }));
});
test("future and expired recordings cannot spoof current meeting dates", () => {
  const input = offlineSessionSchema.parse({
    sessionId: device,
    eventId: owner,
    ownerId: owner,
    ownerDeviceId: device,
    capturedAt: "2027-10-18T10:00:00Z",
    timeUncertain: false,
    durationSeconds: 30,
    consentAccepted: true,
  });
  assert.throws(() => prepareOfflineSession(input, Date.parse("2026-10-18T10:00:00Z")));
});

test("offline import diagnostics identify known conflicts without exposing database row details", () => {
  for (const message of ["Conflicting offline import", "Conflicting offline owner", "Session identity is already in use", "Event already used"]) {
    assert.deepEqual(offlineImportDiagnostic({ code: "P0001", message }), { code: "P0001", message });
  }
  assert.deepEqual(offlineImportDiagnostic({
    code: "23505", message: 'duplicate key value violates unique constraint "lantern_one_open_session_per_device"',
  }), { code: "23505", message: "Unique constraint conflict: lantern_one_open_session_per_device" });
  const diagnostic = offlineImportDiagnostic({ code: "P0001", message: `Private row ${owner} contains a private token` });
  assert.doesNotMatch(JSON.stringify(diagnostic), /11111111|private token/u);
  assert.equal(diagnostic.code, "P0001");
  assert.equal(offlineImportDiagnostic({ code: "Invalid private token" }).code, "UNKNOWN");
  assert.match(offlineImportDiagnostic({ code: "PGRST202", message: "Private schema detail" }).message, /function is unavailable/u);
});
