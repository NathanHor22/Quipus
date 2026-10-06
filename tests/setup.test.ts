import test from "node:test";
import assert from "node:assert/strict";
import {
  hasRecentHeartbeat,
  pairingSecondsRemaining,
  pairingStorageKey,
  readPairingProgress,
  readSetupPreferences,
  setupStorageKey,
  workspaceSetupStep,
} from "../lib/workspace/setup";

test("setup preferences are isolated by account and cannot certify actual connections", () => {
  assert.equal(setupStorageKey(" Nathan@Example.com "), setupStorageKey("nathan@example.com"));
  assert.notEqual(pairingStorageKey("nathan@example.com"), pairingStorageKey("client@example.com"));
  const preferences = readSetupPreferences(JSON.stringify({ version: 1, collapsed: true, calendarSkipped: true, devicePaired: true, hasRecording: true }));
  assert.deepEqual(preferences, { version: 1, collapsed: true, calendarSkipped: true });
  assert.equal(workspaceSetupStep({ devicePaired: false, hasRecording: false, calendarConnected: false, calendarSkipped: preferences.calendarSkipped }), "pair");
});

test("first setup follows real pairing and upload state while Calendar is optional", () => {
  assert.equal(workspaceSetupStep({ devicePaired: undefined, hasRecording: false, calendarConnected: undefined, calendarSkipped: false }), "checking");
  assert.equal(workspaceSetupStep({ devicePaired: false, hasRecording: false, calendarConnected: false, calendarSkipped: false }), "calendar");
  assert.equal(workspaceSetupStep({ devicePaired: false, hasRecording: false, calendarConnected: false, calendarSkipped: true }), "pair");
  assert.equal(workspaceSetupStep({ devicePaired: true, hasRecording: false, calendarConnected: true, calendarSkipped: false }), "record");
  assert.equal(workspaceSetupStep({ devicePaired: true, hasRecording: true, calendarConnected: false, calendarSkipped: false }), "calendar");
  assert.equal(workspaceSetupStep({ devicePaired: true, hasRecording: true, calendarConnected: false, calendarSkipped: true }), "complete");
  assert.equal(workspaceSetupStep({ devicePaired: true, hasRecording: true, calendarConnected: true, calendarSkipped: false }), "complete");
  assert.equal(workspaceSetupStep({ devicePaired: false, hasRecording: true, calendarConnected: true, calendarSkipped: false }), "pair");
});

test("resuming pairing rejects expired, invalid and malformed codes", () => {
  const now = Date.parse("2026-10-06T08:00:00Z");
  const entry = { version: 1, code: "ABCDE-23456", expiresAt: "2026-10-06T08:01:00Z", step: 2 };
  assert.deepEqual(readPairingProgress(JSON.stringify(entry), now), entry);
  assert.equal(readPairingProgress(JSON.stringify(entry), now + 60_000), null);
  assert.equal(readPairingProgress(JSON.stringify({ ...entry, code: "AAAAI-00000" }), now), null);
  assert.equal(readPairingProgress(JSON.stringify({ ...entry, step: 4 }), now), null);
  assert.equal(readPairingProgress("{broken", now), null);
  assert.equal(readPairingProgress(JSON.stringify({ ...entry, expiresAt: "tomorrow" }), now), null);
  assert.equal(pairingSecondsRemaining(entry.expiresAt, now), 60);
  assert.equal(pairingSecondsRemaining(entry.expiresAt, now + 90_000), 0);
});

test("old or missing heartbeats never claim a live connection", () => {
  const now = Date.parse("2026-10-06T08:00:00Z");
  assert.equal(hasRecentHeartbeat("2026-10-06T07:59:45Z", now), true);
  assert.equal(hasRecentHeartbeat("2026-10-06T07:00:00Z", now), false);
  assert.equal(hasRecentHeartbeat("2026-10-06T09:00:00Z", now), false);
  assert.equal(hasRecentHeartbeat(null, now), false);
  assert.equal(hasRecentHeartbeat("invalid", now), false);
});
