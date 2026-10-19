import assert from "node:assert/strict";
import test from "node:test";
import { wrapArchiveKey, unwrapArchiveKey } from "../lib/device-archive-key";
import { offlineSessionSchema, prepareOfflineSession } from "../lib/offline-session";
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
