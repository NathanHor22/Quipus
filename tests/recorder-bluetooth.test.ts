import test from "node:test";
import assert from "node:assert/strict";
import {
  RECORDER_BLE_SERVICE, RECORDER_BLE_INFO, RECORDER_BLE_CONTROL,
  RECORDER_BLE_STATUS, RecorderBluetoothConnection, setupFrames,
  chooseRecorder, parseRecorderInfo, parseRecorderStatus, isRecorderOnline,
  bluetoothMessage, type RecorderBluetoothDevice, type RecorderCharacteristic,
} from "../lib/recorder-bluetooth";

const origin = "https://quipus-sales-rep-assistant.vercel.app";
const info = { v: 1, firmware: "0.10.0-quipus", backend: origin,
  hardwareId: "esp32s3:aabbccddeeff", available: true };
const status = { v: 1, state: "ready", error: "", savedSsid: "", networks: [] };
function view(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  // Exercise DataView byteOffset handling too.
  const storage = new Uint8Array(bytes.length + 8);
  storage.set(bytes, 4);
  return new DataView(storage.buffer, 4, bytes.length);
}
function peripheral(options: { backend?: string; available?: boolean; failAt?: number } = {}) {
  let protectedReads = 0;
  const writes: Uint8Array[] = [];
  const device: RecorderBluetoothDevice = { name: "Quipus-BT-EEFF" };
  const characteristics: Record<string, RecorderCharacteristic> = {
    [RECORDER_BLE_INFO]: { readValue: async () => view({ ...info, ...options }), writeValueWithResponse: async () => {} },
    [RECORDER_BLE_STATUS]: { readValue: async () => { ++protectedReads; return view(writes.some(frame => frame[0] === 3) ? { ...status, state: "saved" } : status); }, writeValueWithResponse: async () => {} },
    [RECORDER_BLE_CONTROL]: { readValue: async () => view({}), writeValueWithResponse: async frame => {
      if (writes.length === options.failAt) throw new Error("Link failed");
      writes.push(frame.slice());
    } },
  };
  device.gatt = {
    connected: false,
    async connect() { this.connected = true; return this; },
    disconnect() { this.connected = false; },
    async getPrimaryService(uuid) { assert.equal(uuid, RECORDER_BLE_SERVICE); return {
      async getCharacteristic(uuid) { assert(uuid in characteristics); return characteristics[uuid]; },
    }; },
  };
  return { device, writes, protectedReads: () => protectedReads };
}

test("chooser is opened immediately from the click with only the Quipus service filter", async () => {
  let called = false;
  const pending = chooseRecorder({ requestDevice: async options => {
    called = true;
    assert.deepEqual(options, { filters: [{ services: [RECORDER_BLE_SERVICE] }] });
    return {};
  } });
  assert.equal(called, true);
  await pending;
});

test("Bluetooth rejects another backend, unknown versions and an already paired recorder before credential access", async () => {
  for (const options of [{ backend: "https://other.example" }, { available: false }]) {
    const fake = peripheral(options);
    await assert.rejects(RecorderBluetoothConnection.connect(fake.device, origin));
    assert.equal(fake.protectedReads(), 0);
    assert.equal(fake.device.gatt?.connected, false);
    assert.equal(fake.writes.length, 0);
  }
  assert.throws(() => parseRecorderInfo(view({ ...info, v: 2 }), origin));
  assert.throws(() => parseRecorderInfo(view({ ...info, hardwareId: "wrong" }), origin));
});

test("encrypted setup preserves Unicode and reserved characters across default-MTU frames", async () => {
  const fake = peripheral();
  const recorder = await RecorderBluetoothConnection.connect(fake.device, origin);
  assert.equal(fake.protectedReads(), 1);
  await recorder.save("网络 & Lab", "a+b&c=d123", "ABCDE-23456");
  const frames = fake.writes;
  assert(frames.every(frame => frame.length <= 20));
  assert.equal(frames[0][0], 1);
  assert.deepEqual([...frames.at(-1)!], [3]);
  const content: number[] = [];
  for (const [index, frame] of frames.slice(1, -1).entries()) {
    assert.equal(frame[0], 2);
    assert.equal(frame[1] | frame[2] << 8, index);
    content.push(...frame.slice(3));
  }
  assert.equal(content.length, frames[0][1] | frames[0][2] << 8);
  const form = new URLSearchParams(new TextDecoder().decode(new Uint8Array(content)));
  assert.equal(form.get("ssid"), "网络 & Lab");
  assert.equal(form.get("password"), "a+b&c=d123");
  assert.equal(form.get("code"), "ABCDE-23456");
  recorder.close();
  assert.equal(fake.device.gatt?.connected, false);
});

test("incomplete Bluetooth transfers never send a commit", async () => {
  const fake = peripheral({ failAt: 2 });
  const recorder = await RecorderBluetoothConnection.connect(fake.device, origin);
  await assert.rejects(recorder.save("Office", "password123", "ABCDE-23456"), /Link failed/);
  assert(!fake.writes.some(frame => frame[0] === 3));
  recorder.close();
});

test("invalid credentials and expired-code shapes fail before transport; saved Wi-Fi is reused without password", () => {
  assert.throws(() => setupFrames("网".repeat(11), "password123", "ABCDE-23456"));
  assert.throws(() => setupFrames("Office\0evil", "password123", "ABCDE-23456"));
  assert.throws(() => setupFrames("Office", "short", "ABCDE-23456"));
  assert.throws(() => setupFrames("Office", "password123", "expired"));
  const frames = setupFrames("ignored", "ignored", "ABCDE-23456", true);
  const body = new TextDecoder().decode(new Uint8Array(frames.slice(1, -1).flatMap(frame => [...frame.slice(3)])));
  assert.equal(new URLSearchParams(body).get("ssid"), "");
  assert.equal(new URLSearchParams(body).get("password"), "");
  assert.throws(() => parseRecorderStatus(view({ ...status, networks: [{ ssid: "evil", secured: "yes" }] })));
});

test("cloud verification needs this recorder and a fresh online update", () => {
  const now = Date.now();
  const device = { hardware_id: info.hardwareId, status: "online", last_seen_at: new Date(now).toISOString() };
  assert.equal(isRecorderOnline(device, info.hardwareId, now), true);
  assert.equal(isRecorderOnline({ ...device, hardware_id: "another" }, info.hardwareId, now), false);
  assert.equal(isRecorderOnline({ ...device, status: "offline" }, info.hardwareId, now), false);
  assert.equal(isRecorderOnline({ ...device, last_seen_at: new Date(now - 60000).toISOString() }, info.hardwareId, now), false);
  assert.match(bluetoothMessage({ name: "NotFoundError" }), /No recorder selected/);
  assert.match(bluetoothMessage({ name: "SecurityError" }), /permission/);
});

test("closing a recorder cancels future scanning and credential writes", async () => {
  const fake = peripheral();
  const recorder = await RecorderBluetoothConnection.connect(fake.device, origin);
  recorder.close();
  await assert.rejects(recorder.scan(), { name: "AbortError" });
  await assert.rejects(recorder.readStatus(), { name: "AbortError" });
  await assert.rejects(recorder.save("Office", "password123", "ABCDE-23456"), { name: "AbortError" });
  assert.equal(fake.writes.length, 0);
});

test("closing during a delayed write prevents the rest of the transfer and commit", async () => {
  const fake = peripheral();
  const recorder = await RecorderBluetoothConnection.connect(fake.device, origin);
  const pending = recorder.save("Office", "password123", "ABCDE-23456");
  // The first asynchronous write is in flight when the user cancels setup.
  recorder.close();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(fake.writes.length, 1);
  assert.equal(fake.writes.some(frame => frame[0] === 3), false);
});

test("status rejects malformed saved Wi-Fi names before filling the form", () => {
  assert.throws(() => parseRecorderStatus(view({ ...status, savedSsid: "x".repeat(33) })));
  assert.throws(() => parseRecorderStatus(view({ ...status, savedSsid: "Office\0hidden" })));
});
