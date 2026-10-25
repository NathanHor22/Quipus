import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  requireAuthenticatedSession,
  requireProductionPersistence,
} from "@/lib/api-security";
import {
  getServerSupabase,
  resolveWorkspaceUserId,
} from "@/lib/supabase/server";
import {
  isLanternSchemaOutdated,
  LANTERN_SCHEMA_OUTDATED,
  lanternSchemaUpgradeMessage,
} from "@/lib/supabase/lantern-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;

  const client = getServerSupabase();
  const readinessError = requireProductionPersistence(
    Boolean(client),
    "Supabase is required to load Quipus devices.",
  );
  if (readinessError) return readinessError;
  if (!client) {
    return NextResponse.json(
      { devices: [], source: "unconfigured" },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const userId = await resolveWorkspaceUserId(client);
    if (!userId) {
      return NextResponse.json(
        { devices: [], source: "supabase" },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const { data, error } = await client
      .from("devices")
      .select("id,hardware_id,name,model,firmware_version,last_seen_at,status,device_state,state_version,battery_level,network_type,free_heap_bytes,last_error,revoked_at")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const devices = await withFirmwareUpdates(client, data || []);

    return NextResponse.json(
      { devices, source: "supabase" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[devices]", error);
    const schemaOutdated = isLanternSchemaOutdated(error);
    return NextResponse.json(
      {
        ...(schemaOutdated ? { code: LANTERN_SCHEMA_OUTDATED } : {}),
        error:
          schemaOutdated
            ? lanternSchemaUpgradeMessage
            : error instanceof Error
            ? error.message
            : "Quipus devices could not be loaded.",
      },
      {
        status: schemaOutdated ? 503 : 500,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}

type DeviceRow = { id: string } & Record<string, unknown>;

/** Adds each recorder's most recent wireless update; omitted if unavailable. */
async function withFirmwareUpdates(client: SupabaseClient, devices: DeviceRow[]) {
  if (!devices.length) return devices;
  const { data, error } = await client.from("device_firmware_updates")
    .select("device_id,state,last_error,updated_at,firmware_releases(version)")
    .in("device_id", devices.map(device => device.id))
    .order("updated_at", { ascending: false });
  if (error) {
    console.warn("[devices] firmware update status unavailable");
    return devices;
  }
  return devices.map(device => {
    const latest = (data || []).find(row => row.device_id === device.id);
    const release = latest?.firmware_releases as { version?: string } | { version?: string }[] | null | undefined;
    const version = Array.isArray(release) ? release[0]?.version : release?.version;
    return {
      ...device,
      firmware_update: latest && version
        ? { version, state: latest.state, error: latest.last_error, updated_at: latest.updated_at }
        : null,
    };
  });
}
