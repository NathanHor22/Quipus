import type { SupabaseClient } from "@supabase/supabase-js";

import {
  applyFirmwareReport,
  FIRMWARE_BUCKET,
  FIRMWARE_URL_SECONDS,
  offerableDeviceState,
  selectFirmwareOffer,
  type FirmwareHistory,
  type FirmwareRelease,
  type FirmwareReport,
} from "@/lib/firmware-updates";

export type FirmwareOffer = { version: string; url: string; sha256: string; size: number };

/**
 * Records a device's update report and returns the update it should install,
 * if any. Firmware problems never fail the heartbeat itself.
 */
export async function processFirmwareHeartbeat(client: SupabaseClient, input: {
  deviceId: string;
  model: string | null;
  runningVersion: string;
  state: string;
  report: FirmwareReport | null;
  transferPending: boolean;
}): Promise<FirmwareOffer | null> {
  if (!input.model) return null;
  try {
    if (input.report) await recordReport(client, input.deviceId, input.model, input.report);
    if (input.transferPending || !offerableDeviceState(input.state)) return null;

    const { data: releases, error } = await client.from("firmware_releases")
      .select("id,version,status,rollout,storage_path,sha256,size_bytes")
      .eq("model", input.model).eq("status", "active");
    if (error) throw new Error(error.message);
    if (!releases?.length) return null;
    const ids = releases.map(release => release.id as string);
    const [targets, history] = await Promise.all([
      client.from("firmware_release_devices").select("release_id").eq("device_id", input.deviceId).in("release_id", ids),
      client.from("device_firmware_updates").select("release_id,state,attempts").eq("device_id", input.deviceId).in("release_id", ids),
    ]);
    if (targets.error) throw new Error(targets.error.message);
    if (history.error) throw new Error(history.error.message);

    const offer = selectFirmwareOffer({
      runningVersion: input.runningVersion,
      releases: releases as FirmwareRelease[],
      targetedReleaseIds: new Set((targets.data || []).map(row => row.release_id as string)),
      history: (history.data || []) as FirmwareHistory[],
    });
    if (!offer) return null;

    const { data: signed, error: signError } = await client.storage.from(FIRMWARE_BUCKET)
      .createSignedUrl(offer.storage_path, FIRMWARE_URL_SECONDS);
    if (signError || !signed?.signedUrl) throw new Error(signError?.message || "Firmware link could not be signed.");
    const { error: offeredError } = await client.from("device_firmware_updates")
      .upsert({ device_id: input.deviceId, release_id: offer.id }, { onConflict: "device_id,release_id", ignoreDuplicates: true });
    if (offeredError) throw new Error(offeredError.message);
    return { version: offer.version, url: signed.signedUrl, sha256: offer.sha256, size: offer.size_bytes };
  } catch (error) {
    // The signed link is never logged; only the failure reason is.
    console.error("[firmware-update]", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

async function recordReport(client: SupabaseClient, deviceId: string, model: string, report: FirmwareReport) {
  const { data: release, error } = await client.from("firmware_releases").select("id")
    .eq("model", model).eq("version", report.targetVersion).maybeSingle();
  if (error) throw new Error(error.message);
  if (!release) return;
  const { data: previous, error: previousError } = await client.from("device_firmware_updates")
    .select("release_id,state,attempts").eq("device_id", deviceId).eq("release_id", release.id).maybeSingle();
  if (previousError) throw new Error(previousError.message);
  const { error: saveError } = await client.from("device_firmware_updates").upsert({
    device_id: deviceId,
    release_id: release.id,
    ...applyFirmwareReport((previous as FirmwareHistory | null) ?? null, report),
    updated_at: new Date().toISOString(),
  }, { onConflict: "device_id,release_id" });
  if (saveError) throw new Error(saveError.message);
}
