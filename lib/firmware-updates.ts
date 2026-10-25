import { z } from "zod";

/** Wireless firmware updates offered in the device heartbeat. */

export const FIRMWARE_BUCKET = "firmware";
export const FIRMWARE_URL_SECONDS = 900;
export const MAX_FAILED_ATTEMPTS = 3;

export const firmwareReportSchema = z
  .object({
    state: z.enum(["installed", "failed", "rolled_back"]),
    targetVersion: z.string().trim().min(5).max(39),
    error: z.string().trim().max(200).nullable(),
  })
  .strict();

export type FirmwareReport = z.infer<typeof firmwareReportSchema>;

export type FirmwareVersion = [number, number, number];

const VERSION = /^(\d{1,5})\.(\d{1,5})\.(\d{1,5})(?:-[a-z0-9-]+)?$/u;

export function parseFirmwareVersion(value: string): FirmwareVersion | null {
  const match = VERSION.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compareFirmwareVersions(a: FirmwareVersion, b: FirmwareVersion): number {
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
  }
  return 0;
}

export type FirmwareRelease = {
  id: string;
  version: string;
  status: "draft" | "active" | "paused";
  rollout: "selected" | "all";
  storage_path: string;
  sha256: string;
  size_bytes: number;
};

export type FirmwareHistory = { release_id: string; state: "offered" | "installed" | "failed" | "rolled_back"; attempts: number };

/**
 * The newest active release this device may install: strictly newer than what
 * it runs, targeted to it (or rolled out to all), never one it rolled back,
 * and not one that already failed too often.
 */
export function selectFirmwareOffer(input: {
  runningVersion: string;
  releases: FirmwareRelease[];
  targetedReleaseIds: Set<string>;
  history: FirmwareHistory[];
}): FirmwareRelease | null {
  const running = parseFirmwareVersion(input.runningVersion);
  if (!running) return null;
  const history = new Map(input.history.map(item => [item.release_id, item]));
  let best: { release: FirmwareRelease; version: FirmwareVersion } | null = null;
  for (const release of input.releases) {
    if (release.status !== "active") continue;
    if (release.rollout !== "all" && !input.targetedReleaseIds.has(release.id)) continue;
    const version = parseFirmwareVersion(release.version);
    if (!version || compareFirmwareVersions(version, running) <= 0) continue;
    const past = history.get(release.id);
    if (past?.state === "rolled_back" || past?.state === "installed") continue;
    if (past?.state === "failed" && past.attempts >= MAX_FAILED_ATTEMPTS) continue;
    if (!best || compareFirmwareVersions(version, best.version) > 0) best = { release, version };
  }
  return best?.release ?? null;
}

/** How a device's report changes its history row for that release. */
export function applyFirmwareReport(previous: FirmwareHistory | null, report: FirmwareReport) {
  return {
    state: report.state,
    attempts: (previous?.attempts ?? 0) + (report.state === "failed" ? 1 : 0),
    last_error: report.state === "installed" ? null : report.error,
  };
}

/** Device states in which an offer is useful; others skip the signed URL. */
export function offerableDeviceState(state: string) {
  return state === "ready" || state === "error";
}

export type FirmwareUpdateStatus = {
  version: string;
  state: FirmwareHistory["state"];
  error: string | null;
  updated_at: string;
};

/** Owner-facing summary of a recorder's latest wireless update. */
export function firmwareUpdateLabel(update: FirmwareUpdateStatus | null | undefined, running: string | null) {
  if (!update) return null;
  switch (update.state) {
    case "installed":
      return `Updated to ${update.version}`;
    case "offered":
      return running === update.version ? `Updated to ${update.version}` : `Update ${update.version} is ready. It installs when the recorder is idle and powered.`;
    case "failed":
      return `Update ${update.version} paused${update.error ? `: ${update.error}` : ""}. It will try again.`;
    case "rolled_back":
      return `Update ${update.version} didn’t pass its first-boot check, so the recorder kept ${running || "its previous firmware"}.`;
  }
}
