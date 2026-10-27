import type { SupabaseClient } from "@supabase/supabase-js";
import { matchesLanternSecret, parseDeviceAuthorization } from "./lantern-device-auth";
import { compareFirmwareVersions, parseFirmwareVersion } from "./firmware-updates";

/** First Quipus build with the authenticated, restart-safe factory-reset protocol. */
export function supportsDeviceFactoryReset(version: unknown): boolean {
  if (typeof version !== "string") return false;
  const parsed = parseFirmwareVersion(version);
  return parsed !== null && compareFirmwareVersions(parsed, [0, 14, 1]) >= 0;
}

export function deviceResetState(state: DeviceResetState, version: unknown): DeviceResetState {
  return state === "pending" && !supportsDeviceFactoryReset(version) ? "recovery_required" : state;
}

export type DeviceResetState = "pending" | "completed" | "recovery_required";
export type DeviceResetRequest = {
  id: string;
  device_id: string;
  user_id: string;
  credential_hash: string | null;
  state: "pending" | "completed";
  requested_at: string;
  completed_at: string | null;
};

/** This verifier authorises reset control only. Never use it for data access. */
export async function authenticateDeviceReset(request: Request, client: SupabaseClient) {
  const authorization = parseDeviceAuthorization(request.headers.get("authorization"));
  if (!authorization) return null;
  const reset = await client.from("device_reset_requests")
    .select("id,device_id,user_id,credential_hash,state,requested_at,completed_at")
    .eq("device_id", authorization.deviceId).maybeSingle();
  if (reset.error) throw new Error("Device reset storage is unavailable.");
  if (reset.data) {
    const row = reset.data as DeviceResetRequest;
    return row.credential_hash && matchesLanternSecret(authorization.secret, row.credential_hash)
      ? { authorization, reset: row } : null;
  }
  const device = await client.from("devices").select("credential_hash,revoked_at")
    .eq("id", authorization.deviceId).maybeSingle();
  if (device.error) throw new Error("Device reset storage is unavailable.");
  return device.data?.credential_hash && !device.data.revoked_at &&
    matchesLanternSecret(authorization.secret, device.data.credential_hash)
    ? { authorization, reset: null } : null;
}

export function publicDeviceReset(reset: DeviceResetRequest, firmwareVersion: unknown) {
  return {
    id: reset.id,
    state: deviceResetState(reset.state === "completed" ? "completed"
      : reset.credential_hash ? "pending" : "recovery_required", firmwareVersion),
    requestedAt: reset.requested_at,
    completedAt: reset.completed_at,
  };
}
