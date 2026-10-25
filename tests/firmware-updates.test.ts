import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { processFirmwareHeartbeat } from "../lib/firmware-update-service";
import {
  applyFirmwareReport,
  compareFirmwareVersions,
  firmwareReportSchema,
  parseFirmwareVersion,
  selectFirmwareOffer,
  type FirmwareRelease,
} from "../lib/firmware-updates";

const release = (id: string, version: string, extra: Partial<FirmwareRelease> = {}): FirmwareRelease => ({
  id, version, status: "active", rollout: "selected", storage_path: `Waveshare/${version}/lantern.bin`,
  sha256: "a".repeat(64), size_bytes: 3_346_432, ...extra,
});

test("firmware versions compare numerically and ignore suffixes", () => {
  assert.deepEqual(parseFirmwareVersion("0.13.0-quipus"), [0, 13, 0]);
  assert.equal(parseFirmwareVersion("0.13"), null);
  assert.equal(parseFirmwareVersion("dcf18c5-dirty"), null);
  assert.equal(parseFirmwareVersion("0.13.0-Quipus"), null);
  assert.equal(compareFirmwareVersions([0, 13, 10], [0, 13, 9]), 1);
  assert.equal(compareFirmwareVersions([0, 13, 0], [0, 13, 0]), 0);
});

test("only a strictly newer, active, targeted release is offered", () => {
  const releases = [release("a", "0.13.1-quipus"), release("b", "0.13.2-quipus"), release("c", "0.14.0-quipus", { status: "paused" })];
  const offer = (running: string, targeted = new Set(["a", "b", "c"]), history: Parameters<typeof selectFirmwareOffer>[0]["history"] = []) =>
    selectFirmwareOffer({ runningVersion: running, releases, targetedReleaseIds: targeted, history })?.id ?? null;
  assert.equal(offer("0.13.0-quipus"), "b");
  assert.equal(offer("0.13.2-quipus"), null);
  assert.equal(offer("0.14.5-quipus"), null);
  assert.equal(offer("not-a-version"), null);
  assert.equal(offer("0.13.0-quipus", new Set(["a"])), "a");
  assert.equal(offer("0.13.0-quipus", new Set()), null);
  // A rolled-back release is never offered again; failures stop after three attempts.
  assert.equal(offer("0.13.0-quipus", undefined, [{ release_id: "b", state: "rolled_back", attempts: 0 }]), "a");
  assert.equal(offer("0.13.0-quipus", undefined, [{ release_id: "b", state: "failed", attempts: 2 }]), "b");
  assert.equal(offer("0.13.0-quipus", undefined, [{ release_id: "b", state: "failed", attempts: 3 }]), "a");
  const all = selectFirmwareOffer({ runningVersion: "0.13.0-quipus", releases: [release("x", "0.13.1-quipus", { rollout: "all" })], targetedReleaseIds: new Set(), history: [] });
  assert.equal(all?.id, "x");
});

test("device reports are strict and count failures", () => {
  assert.equal(firmwareReportSchema.safeParse({ state: "downloading", targetVersion: "0.13.1-quipus", error: null }).success, false);
  assert.equal(firmwareReportSchema.safeParse({ state: "failed", targetVersion: "0.13.1-quipus", error: null, url: "x" }).success, false);
  const failed = firmwareReportSchema.parse({ state: "failed", targetVersion: "0.13.1-quipus", error: "Checksum did not match" });
  assert.deepEqual(applyFirmwareReport({ release_id: "a", state: "failed", attempts: 1 }, failed), { state: "failed", attempts: 2, last_error: "Checksum did not match" });
  const installed = firmwareReportSchema.parse({ state: "installed", targetVersion: "0.13.1-quipus", error: null });
  assert.deepEqual(applyFirmwareReport(null, installed), { state: "installed", attempts: 0, last_error: null });
});

type Row = Record<string, unknown>;

function fakeClient(tables: Record<string, Row[]>) {
  const signed: string[] = [];
  const query = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    const rows = () => (tables[table] ||= []).filter(row => filters.every(filter => filter(row)));
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => { filters.push(row => row[column] === value); return builder; },
      in: (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return builder; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      upsert: async (value: Row, options: { onConflict: string; ignoreDuplicates?: boolean }) => {
        const keys = options.onConflict.split(",");
        const list = (tables[table] ||= []);
        const existing = list.find(row => keys.every(key => row[key] === value[key]));
        if (existing && !options.ignoreDuplicates) Object.assign(existing, value);
        if (!existing) list.push({ state: "offered", attempts: 0, ...value });
        return { error: null };
      },
      then: (resolve: (value: { data: Row[]; error: null }) => void) => resolve({ data: rows(), error: null }),
    };
    return builder;
  };
  const client = {
    from: query,
    storage: { from: () => ({ createSignedUrl: async (path: string, seconds: number) => {
      signed.push(path);
      return { data: { signedUrl: `https://example.supabase.co/storage/v1/object/sign/firmware/${path}?token=t&s=${seconds}` }, error: null };
    } }) },
  };
  return { client: client as unknown as SupabaseClient, signed, tables };
}

const input = { deviceId: "d1", model: "Waveshare-ESP32-S3-LCD-1.54", runningVersion: "0.13.0-quipus", state: "ready", report: null, transferPending: false };

test("heartbeat offers a signed link and records the offer once", async () => {
  const { client, signed, tables } = fakeClient({
    firmware_releases: [{ ...release("r1", "0.13.1-quipus"), model: input.model }],
    firmware_release_devices: [{ release_id: "r1", device_id: "d1" }],
  });
  const offer = await processFirmwareHeartbeat(client, input);
  assert.deepEqual(offer && { ...offer, url: offer.url.split("?")[0] }, {
    version: "0.13.1-quipus", sha256: "a".repeat(64), size: 3_346_432,
    url: "https://example.supabase.co/storage/v1/object/sign/firmware/Waveshare/0.13.1-quipus/lantern.bin",
  });
  await processFirmwareHeartbeat(client, input);
  assert.equal(signed.length, 2);
  assert.equal(tables.device_firmware_updates!.length, 1);

  // Not targeted, another model, busy, or mid-transfer devices get nothing.
  assert.equal(await processFirmwareHeartbeat(client, { ...input, deviceId: "d2" }), null);
  assert.equal(await processFirmwareHeartbeat(client, { ...input, model: "LCDWIKI-ES3C28P" }), null);
  assert.equal(await processFirmwareHeartbeat(client, { ...input, state: "recording" }), null);
  assert.equal(await processFirmwareHeartbeat(client, { ...input, transferPending: true }), null);
  assert.equal(await processFirmwareHeartbeat(client, { ...input, model: null }), null);
});

test("a rolled-back report stops further offers of that release", async () => {
  const { client, tables } = fakeClient({
    firmware_releases: [{ ...release("r1", "0.13.1-quipus"), model: input.model }],
    firmware_release_devices: [{ release_id: "r1", device_id: "d1" }],
  });
  const offer = await processFirmwareHeartbeat(client, {
    ...input, report: { state: "rolled_back", targetVersion: "0.13.1-quipus", error: "New firmware failed its first-boot check" },
  });
  assert.equal(offer, null);
  assert.equal(tables.device_firmware_updates![0]!.state, "rolled_back");
  assert.equal(tables.device_firmware_updates![0]!.last_error, "New firmware failed its first-boot check");
});

test("storage failures never break the heartbeat", async () => {
  const { client } = fakeClient({
    firmware_releases: [{ ...release("r1", "0.13.1-quipus", { rollout: "all" }), model: input.model }],
  });
  (client as unknown as { storage: unknown }).storage = { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "down" } }) }) };
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await processFirmwareHeartbeat(client, input), null);
  } finally {
    console.error = original;
  }
});
