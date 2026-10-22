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

    return NextResponse.json(
      { devices: data || [], source: "supabase" },
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
