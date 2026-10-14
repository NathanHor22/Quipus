import assert from "node:assert/strict";
import test from "node:test";
import {
  deviceDemoReducer,
  initialDeviceDemoState,
  formatDeviceDemoTime,
  type DeviceDemoState,
} from "../lib/landing/device-demo";

test("a sample cannot record, stop, or approve before consent", () => {
  for (const type of ["consent", "stop", "approve", "report", "tick"] as const) {
    assert.equal(deviceDemoReducer(initialDeviceDemoState, { type }), initialDeviceDemoState);
  }
  const consent = deviceDemoReducer(initialDeviceDemoState, { type: "start" });
  assert.equal(consent.stage, "consent");
  assert.equal(deviceDemoReducer(consent, { type: "stop" }), consent);
  assert.equal(deviceDemoReducer(consent, { type: "approve" }), consent);
  assert.deepEqual(deviceDemoReducer(consent, { type: "decline" }), { stage: "ready" });
});

test("a consented sample preserves its duration and requires a manual stop", () => {
  let state = deviceDemoReducer(initialDeviceDemoState, { type: "start" });
  state = deviceDemoReducer(state, { type: "consent" });
  for (let i = 0; i < 63; i++) state = deviceDemoReducer(state, { type: "tick" });
  assert.deepEqual(state, { stage: "recording", seconds: 63 });
  assert.equal(deviceDemoReducer(state, { type: "report" }), state);
  state = deviceDemoReducer(state, { type: "stop" });
  assert.deepEqual(state, { stage: "saved", seconds: 63 });
  assert.equal(deviceDemoReducer(state, { type: "tick" }), state);
  assert.equal(formatDeviceDemoTime(63), "01:03");
});

test("report approval is idempotent and reset clears the sample", () => {
  let state: DeviceDemoState = { stage: "saved", seconds: 14 };
  state = deviceDemoReducer(state, { type: "report" });
  assert.deepEqual(state, { stage: "report", approved: false });
  state = deviceDemoReducer(state, { type: "approve" });
  assert.deepEqual(state, { stage: "report", approved: true });
  assert.equal(deviceDemoReducer(state, { type: "approve" }), state);
  assert.equal(deviceDemoReducer(state, { type: "reset" }), initialDeviceDemoState);
});

test("the sample clock stays bounded without stopping a session", () => {
  const state = deviceDemoReducer({ stage: "recording", seconds: 3_599 }, { type: "tick" });
  assert.deepEqual(state, { stage: "recording", seconds: 3_599 });
  assert.equal(formatDeviceDemoTime(3_599), "59:59");
});
