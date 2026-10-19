import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSession, requireProductionPersistence } from "@/lib/api-security";
import {
  GoogleCalendarProviderError,
  createAuthorizedGoogleOAuthClient,
  getGoogleCalendarAvailability,
  getGoogleOAuthConfig,
} from "@/lib/providers/google-calendar";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const readinessError = requireProductionPersistence(
    Boolean(getServerSupabase()),
    "Supabase persistence is required for production Calendar access.",
  );
  if (readinessError) return readinessError;
  try {
    const requestUrl = new URL(request.url);
    const input = {
      date: requestUrl.searchParams.get("date"),
      period: requestUrl.searchParams.get("period") || "afternoon",
    };
    const config = getGoogleOAuthConfig();
    const client = getServerSupabase();
    if (!client) {
      throw new GoogleCalendarProviderError(
        "Google Calendar is not connected.",
        "not_connected",
      );
    }
    const userId = await resolveWorkspaceUserId(client);
    if (!userId) {
      throw new GoogleCalendarProviderError(
        "Google Calendar is not connected.",
        "not_connected",
      );
    }
    const oauthClient = await createAuthorizedGoogleOAuthClient({
      config,
      client,
      userId,
    });
    const { data: profile, error: profileError } = await client.from("profiles").select("timezone").eq("id", userId).maybeSingle();
    if (profileError) throw new Error("Calendar timezone is unavailable.");
    const availability = await getGoogleCalendarAvailability({ ...input, timeZone: profile?.timezone ?? "Asia/Kuala_Lumpur" }, {
      oauthClient,
      calendarId: config.calendarId,
    });
    return NextResponse.json(
      { availability },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Choose a valid availability date and period." },
        { status: 400 },
      );
    }
    if (error instanceof GoogleCalendarProviderError) {
      const status =
        error.code === "configuration" || error.code === "not_connected"
          ? 503
          : 502;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json(
      { error: "Calendar availability could not be checked." },
      { status: 500 },
    );
  }
}
