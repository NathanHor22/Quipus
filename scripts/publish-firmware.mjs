#!/usr/bin/env node
/**
 * Publishes a signed recorder image for wireless updates.
 *
 *   node --env-file=.env.local scripts/publish-firmware.mjs publish \
 *     --file hardware/lantern-firmware/build-waveshare/lantern.signed.bin \
 *     --version 0.13.1-quipus --hardware-id esp32s3:80456b35b7dc [--all] [--activate] [--notes "..."]
 *   node --env-file=.env.local scripts/publish-firmware.mjs activate|pause --version 0.13.1-quipus
 *   node --env-file=.env.local scripts/publish-firmware.mjs status
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
 * environment. Neither the key nor any signed link is ever printed.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const MODEL = "Waveshare-ESP32-S3-LCD-1.54";
const SLOT_BYTES = 4_128_768;
const VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}(-[a-z0-9-]+)?$/u;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    file: { type: "string" },
    version: { type: "string" },
    model: { type: "string", default: MODEL },
    "hardware-id": { type: "string", multiple: true, default: [] },
    all: { type: "boolean", default: false },
    activate: { type: "boolean", default: false },
    notes: { type: "string" },
  },
});

function fail(message) {
  console.error(`publish-firmware: ${message}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail("set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (for example with --env-file=.env.local).");
const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const model = values.model;

/** Signed ESP-IDF v2 images end with a 4 KiB signature sector starting 0xE7 0x02. */
function checkImage(image, version) {
  if (image.length > SLOT_BYTES) fail(`image is ${image.length} bytes; the update slot holds ${SLOT_BYTES}.`);
  if (image[0] !== 0xe9) fail("file is not an ESP32 application image.");
  const signature = image.length - 4096;
  if (image.length % 4096 !== 0 || signature <= 0 || image[signature] !== 0xe7 || image[signature + 1] !== 0x02) {
    fail("image is not signed. Run hardware/lantern-firmware/sign-firmware.ps1 first.");
  }
  if (!image.includes(Buffer.from(`${version}\0`, "ascii"))) {
    fail(`image does not contain version "${version}". Build it with that version first.`);
  }
}

async function devicesFor(hardwareIds) {
  if (!hardwareIds.length) return [];
  const { data, error } = await client.from("devices").select("id,hardware_id,name").in("hardware_id", hardwareIds).is("revoked_at", null);
  if (error) fail(error.message);
  const missing = hardwareIds.filter(id => !data.some(device => device.hardware_id === id));
  if (missing.length) fail(`no paired device has hardware id ${missing.join(", ")}.`);
  return data;
}

async function publish() {
  const version = values.version;
  if (!values.file || !version || !VERSION.test(version)) fail("publish needs --file and a --version like 0.13.1-quipus.");
  if (!values.all && !values["hardware-id"].length) fail("choose --hardware-id (repeatable) or --all.");
  const image = await readFile(values.file);
  checkImage(image, version);
  const devices = await devicesFor(values["hardware-id"]);
  const sha256 = createHash("sha256").update(image).digest("hex");
  const path = `${model}/${version}/lantern.signed.bin`;
  const upload = await client.storage.from("firmware").upload(path, image, { contentType: "application/octet-stream", upsert: false });
  if (upload.error) fail(`upload failed: ${upload.error.message}`);
  const { data: release, error } = await client.from("firmware_releases").insert({
    model, version, storage_path: path, sha256, size_bytes: image.length,
    status: values.activate ? "active" : "draft", rollout: values.all ? "all" : "selected",
    notes: values.notes ?? null, activated_at: values.activate ? new Date().toISOString() : null,
  }).select("id").single();
  if (error) {
    await client.storage.from("firmware").remove([path]);
    fail(`release could not be saved: ${error.message}`);
  }
  if (devices.length) {
    const { error: targetError } = await client.from("firmware_release_devices")
      .insert(devices.map(device => ({ release_id: release.id, device_id: device.id })));
    if (targetError) fail(`targets could not be saved: ${targetError.message}`);
  }
  console.log(`Published ${model} ${version} (${image.length} bytes, sha256 ${sha256}).`);
  console.log(values.all ? "Rollout: every recorder of this model." : `Rollout: ${devices.map(device => device.name || device.hardware_id).join(", ")}.`);
  console.log(values.activate ? "Active: recorders will install it when idle." : "Draft: run `activate` to start the rollout.");
}

async function setStatus(status) {
  const version = values.version;
  if (!version) fail(`${status === "active" ? "activate" : "pause"} needs --version.`);
  const { data, error } = await client.from("firmware_releases")
    .update({ status, ...(status === "active" ? { activated_at: new Date().toISOString() } : {}) })
    .eq("model", model).eq("version", version).select("id");
  if (error) fail(error.message);
  if (!data.length) fail(`no ${model} release ${version}.`);
  console.log(`${model} ${version} is now ${status}.`);
}

async function status() {
  const { data: releases, error } = await client.from("firmware_releases")
    .select("id,version,status,rollout,created_at").eq("model", model).order("created_at", { ascending: false }).limit(10);
  if (error) fail(error.message);
  const { data: devices, error: deviceError } = await client.from("devices")
    .select("id,name,hardware_id,firmware_version,last_seen_at").eq("model", model).is("revoked_at", null);
  if (deviceError) fail(deviceError.message);
  const { data: history, error: historyError } = await client.from("device_firmware_updates")
    .select("device_id,release_id,state,attempts,last_error,updated_at");
  if (historyError) fail(historyError.message);
  console.log("Releases:");
  for (const release of releases) console.log(`  ${release.version.padEnd(24)} ${release.status.padEnd(7)} ${release.rollout}`);
  console.log("Recorders:");
  for (const device of devices) {
    const latest = history.filter(row => row.device_id === device.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    const target = latest && releases.find(release => release.id === latest.release_id)?.version;
    const update = latest ? ` last update: ${target ?? "?"} ${latest.state}${latest.last_error ? ` (${latest.last_error})` : ""}` : "";
    console.log(`  ${(device.name || device.hardware_id || device.id).padEnd(24)} running ${device.firmware_version ?? "unknown"}${update}`);
  }
}

const command = positionals[0];
if (command === "publish") await publish();
else if (command === "activate") await setStatus("active");
else if (command === "pause") await setStatus("paused");
else if (command === "status") await status();
else fail("use publish, activate, pause or status.");
