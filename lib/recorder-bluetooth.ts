import { isActiveDevice, type DeviceAvailability } from "./device-status";

// Browser-only transport. Credentials stay in memory and go directly to the
// recorder over authenticated, encrypted GATT, never through a website API.
export const RECORDER_BLE_SERVICE = "71817060-8ac5-45ec-9c18-21429ab00001";
export const RECORDER_BLE_INFO = "71817060-8ac5-45ec-9c18-21429ab00002";
export const RECORDER_BLE_CONTROL = "71817060-8ac5-45ec-9c18-21429ab00003";
export const RECORDER_BLE_STATUS = "71817060-8ac5-45ec-9c18-21429ab00004";

export interface RecorderCharacteristic {
  readValue(): Promise<DataView>;
  writeValueWithResponse(value: Uint8Array<ArrayBuffer>): Promise<void>;
}
interface RecorderService {
  getCharacteristic(uuid: string): Promise<RecorderCharacteristic>;
}
export interface RecorderGatt {
  connected: boolean;
  connect(): Promise<RecorderGatt>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<RecorderService>;
}
export interface RecorderBluetoothDevice {
  name?: string;
  gatt?: RecorderGatt;
}
export interface RecorderBluetoothAdapter {
  requestDevice(options: { filters: { services: string[] }[] }): Promise<RecorderBluetoothDevice>;
}
export type RecorderInfo = {
  v: 1; firmware: string; backend: string; hardwareId: string; available: boolean;
};
export type RecorderBluetoothStatus = {
  v: 1; state: "ready" | "scanning" | "saving" | "saved" | "error";
  error: string; savedSsid: string; networks: { ssid: string; secured: boolean }[];
};

export function bluetoothAdapter(): RecorderBluetoothAdapter | null {
  if (typeof navigator === "undefined" || !globalThis.isSecureContext) return null;
  return (navigator as unknown as { bluetooth?: RecorderBluetoothAdapter }).bluetooth || null;
}

/** Call directly from a click; never fetch or await before opening the chooser. */
export function chooseRecorder(adapter = bluetoothAdapter()) {
  if (!adapter) throw new Error("Use Chrome on Windows or Android with Bluetooth turned on, or choose Wi-Fi setup below.");
  return adapter.requestDevice({ filters: [{ services: [RECORDER_BLE_SERVICE] }] });
}

function deadline<T>(promise: Promise<T>, ms = 12000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Bluetooth took too long. Keep the recorder nearby and try again.")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function jsonValue(value: DataView): Record<string, unknown> {
  if (value.byteLength > 512) throw new Error("The recorder returned an unsupported response.");
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* Report a bounded, credential-free error. */ }
  throw new Error("The recorder returned an unsupported response. Update its firmware.");
}

export function parseRecorderInfo(value: DataView, websiteOrigin: string): RecorderInfo {
  const info = jsonValue(value);
  if (info.v !== 1 || typeof info.firmware !== "string" ||
      typeof info.backend !== "string" || typeof info.available !== "boolean" ||
      typeof info.hardwareId !== "string" || !/^esp32s3:[0-9a-f]{12}$/.test(info.hardwareId))
    throw new Error("Update the recorder to the Bluetooth setup firmware.");
  if (info.backend !== websiteOrigin)
    throw new Error("This recorder is configured for another website. Install the firmware for this Quipus website before pairing.");
  if (!info.available)
    throw new Error("This recorder is already paired or finishing setup. Check your Devices page.");
  return info as RecorderInfo;
}

export function parseRecorderStatus(value: DataView): RecorderBluetoothStatus {
  const status = jsonValue(value);
  if (status.v !== 1 || !["ready", "scanning", "saving", "saved", "error"].includes(String(status.state)) ||
      typeof status.error !== "string" || status.error.length > 96 ||
      typeof status.savedSsid !== "string" || new TextEncoder().encode(status.savedSsid).length > 32 ||
      status.savedSsid.includes("\0") || !Array.isArray(status.networks) || status.networks.length > 4 ||
      status.networks.some(network => !network || typeof network.ssid !== "string" ||
        new TextEncoder().encode(network.ssid).length > 32 || typeof network.secured !== "boolean"))
    throw new Error("Update the recorder to the Bluetooth setup firmware.");
  return status as RecorderBluetoothStatus;
}

export function setupFrames(ssid: string, password: string, code: string, reuseSaved = false): Uint8Array<ArrayBuffer>[] {
  const encoder = new TextEncoder();
  if (!reuseSaved && (!ssid || encoder.encode(ssid).length > 32 || ssid.includes("\0")))
    throw new Error("Enter a Wi-Fi name of 1–32 bytes.");
  const passwordBytes = encoder.encode(password).length;
  if (!reuseSaved && (password.includes("\0") ||
      (passwordBytes > 0 && (passwordBytes < 8 || passwordBytes > 64 ||
        (passwordBytes === 64 && !/^[0-9a-f]{64}$/i.test(password))))))
    throw new Error("Use an open network, an 8–63 byte Wi-Fi password, or a 64-digit hexadecimal key.");
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/.test(code))
    throw new Error("Create a fresh pairing code and try again.");
  const body = encoder.encode(new URLSearchParams({ ssid: reuseSaved ? "" : ssid,
    password: reuseSaved ? "" : password, code }).toString());
  if (body.length > 1024) throw new Error("The Wi-Fi details are too long.");
  const frames = [new Uint8Array([1, body.length & 255, body.length >> 8])];
  for (let offset = 0, sequence = 0; offset < body.length; offset += 17, ++sequence) {
    const payload = body.slice(offset, offset + 17);
    const frame = new Uint8Array(3 + payload.length);
    frame.set([2, sequence & 255, sequence >> 8]);
    frame.set(payload, 3);
    frames.push(frame);
  }
  frames.push(new Uint8Array([3]));
  body.fill(0);
  return frames;
}

export function bluetoothMessage(cause: unknown) {
  const name = cause && typeof cause === "object" && "name" in cause ? cause.name : "";
  if (name === "NotFoundError") return "No recorder selected. Turn Bluetooth on, keep Quipus nearby, and choose Connect with Bluetooth to try again.";
  if (name === "SecurityError" || name === "NotAllowedError") return "Bluetooth permission was not granted. Allow access in Chrome, or use Wi-Fi setup below.";
  if (name === "NetworkError") return "Bluetooth disconnected. Keep Quipus nearby, check the pairing PIN on its screen, and reconnect.";
  if (cause instanceof Error && cause.message) return cause.message;
  return "Bluetooth could not connect. Try again or use Wi-Fi setup below.";
}

export class RecorderBluetoothConnection {
  private closed = false;

  private ensureOpen() {
    if (this.closed) throw new DOMException("Bluetooth setup cancelled.", "AbortError");
  }

  private constructor(readonly device: RecorderBluetoothDevice, readonly info: RecorderInfo,
    private control: RecorderCharacteristic, private status: RecorderCharacteristic) {}

  static async connect(device: RecorderBluetoothDevice, websiteOrigin: string) {
    if (!device.gatt) throw new Error("Bluetooth is unavailable on this device.");
    try {
      const server = await deadline(device.gatt.connect(), 60000);
      const service = await deadline(server.getPrimaryService(RECORDER_BLE_SERVICE));
      const infoCharacteristic = await deadline(service.getCharacteristic(RECORDER_BLE_INFO));
      const info = parseRecorderInfo(await deadline(infoCharacteristic.readValue()), websiteOrigin);
      const control = await deadline(service.getCharacteristic(RECORDER_BLE_CONTROL));
      const status = await deadline(service.getCharacteristic(RECORDER_BLE_STATUS));
      const connection = new RecorderBluetoothConnection(device, info, control, status);
      // This protected read triggers OS pairing before any credentials are sent.
      await deadline(status.readValue(), 90000).then(parseRecorderStatus);
      return connection;
    } catch (error) { device.gatt.disconnect(); throw error; }
  }

  async readStatus() {
    this.ensureOpen();
    const value = await deadline(this.status.readValue());
    this.ensureOpen();
    return parseRecorderStatus(value);
  }

  async scan() {
    this.ensureOpen();
    await deadline(this.control.writeValueWithResponse(new Uint8Array([5])));
    for (let attempt = 0; attempt < 30; ++attempt) {
      const status = await this.readStatus();
      if (status.state !== "scanning") return status;
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    throw new Error("Wi-Fi scanning took too long. Enter the network name manually.");
  }

  async save(ssid: string, password: string, code: string, reuseSaved = false) {
    const frames = setupFrames(ssid, password, code, reuseSaved);
    let commitStarted = false;
    try {
      for (const [index, frame] of frames.entries()) {
        this.ensureOpen();
        commitStarted = index === frames.length - 1;
        await deadline(this.control.writeValueWithResponse(frame));
      }
      for (let attempt = 0; attempt < 10; ++attempt) {
        const status = await this.readStatus();
        if (status.state === "saved") return;
        if (status.state === "error") throw new Error(status.error || "The recorder could not save setup.");
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      // The commit was acknowledged. Cloud verification is the source of truth.
    } catch (error) {
      if (this.closed) throw error;
      if (commitStarted && !this.device.gatt?.connected) return;
      try { await deadline(this.control.writeValueWithResponse(new Uint8Array([4])), 1500); } catch {}
      throw error;
    } finally {
      frames.forEach(frame => frame.fill(0));
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.device.gatt?.disconnect();
  }
}

export function isRecorderOnline(device: DeviceAvailability & { hardware_id?: string; status?: string; last_seen_at?: string | null }, hardwareId: string, startedAt: number) {
  const seen = Date.parse(device.last_seen_at || "");
  return isActiveDevice(device) && device.hardware_id === hardwareId && device.status === "online" &&
    Number.isFinite(seen) && seen >= startedAt - 5000 && seen <= Date.now() + 30000;
}
