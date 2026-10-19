import { NextResponse } from "next/server";
import { z } from "zod";

import {
  matchesLanternSecret,
  parseDeviceAuthorization,
} from "@/lib/lantern-device-auth";
import { lanternStateSchema } from "@/lib/lantern-state";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const heartbeatSchema = z
  .object({
    eventId: z.string().uuid(),
    firmwareVersion: z.string().trim().min(1).max(80),
    state: lanternStateSchema,
    stateVersion: z.number().int().nonnegative(),
    batteryLevel: z.number().int().min(0).max(100).nullable(),
    networkType: z.enum(["wifi", "cellular", "offline"]),
    freeHeapBytes: z.number().int().nonnegative().max(32 * 1024 * 1024),
    lastError: z.string().trim().max(500).nullable(),
  })
  .strict();

function response(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const authorization = parseDeviceAuthorization(
    request.headers.get("authorization"),
  );
  if (!authorization) return response("Device authentication required.", 401);
  const client = getServerSupabase();
  if (!client) return response("Quipus service is unavailable.", 503);

  try {
    const input = heartbeatSchema.parse(await request.json());
    const { data: device, error: lookupError } = await client
      .from("devices")
      .select("id,credential_hash,revoked_at,device_state,state_version")
      .eq("id", authorization.deviceId)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (
      !device?.credential_hash ||
      device.revoked_at ||
      !matchesLanternSecret(authorization.secret, device.credential_hash)
    ) {
      return response("Device credential is invalid or revoked.", 403);
    }
    const serverTime = new Date().toISOString();
    const { data: updated, error: updateError } = await client
      .from("devices")
      .update({
        firmware_version: input.firmwareVersion,
        battery_level: input.batteryLevel,
        network_type: input.networkType,
        free_heap_bytes: input.freeHeapBytes,
        last_error: input.lastError,
        last_seen_at: serverTime,
        status: "online",
        updated_at: serverTime,
      })
      .eq("id", device.id)
      .is("revoked_at", null)
      .select("id,device_state,state_version")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!updated) return response("Device credential is invalid or revoked.", 403);

    const { data: transfer, error: transferError } = await client.from("device_transfers")
      .select("id").eq("device_id", device.id).eq("status", "pending")
      .gt("expires_at", serverTime).maybeSingle();
    if (transferError) throw new Error("Transfer status could not be checked.");
    const authoritativeState = lanternStateSchema.parse(updated.device_state);
    const authoritativeVersion = Number(updated.state_version || 0);

    return NextResponse.json(
      {
        acknowledgedEventId: input.eventId,
        transfer: transfer ? { id: transfer.id } : null,
        state: authoritativeState,
        stateVersion: authoritativeVersion,
        synchronized:
          input.state === authoritativeState &&
          input.stateVersion === authoritativeVersion,
        serverTime,
        limits: { retryBufferSeconds: 30, heartbeatSeconds: 15 },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[device-heartbeat]", error);
    return response(
      error instanceof z.ZodError
        ? "Quipus heartbeat is invalid."
        : "Quipus heartbeat could not be saved.",
      error instanceof z.ZodError ? 400 : 500,
    );
  }
}
