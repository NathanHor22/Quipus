import { NextResponse } from "next/server";
import { requireAuthenticatedSession } from "@/lib/api-security";
import { readGoogleConnection } from "@/lib/google-connection";
import { integrationStatus } from "@/lib/env";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const integrations = integrationStatus();

  const client = getServerSupabase();
  if (client) {
    const userId = await resolveWorkspaceUserId(client).catch(() => null);
    if (userId) {
      try { integrations.google = (await readGoogleConnection(client, userId)).state === "connected"; }
      catch { return NextResponse.json({ error: "Connection status is temporarily unavailable." }, { status: 503, headers: { "cache-control": "no-store" } }); }
    }
  }

  return NextResponse.json({
    integrations,
    checkedAt: new Date().toISOString(),
  }, { headers: { "cache-control": "no-store" } });
}
