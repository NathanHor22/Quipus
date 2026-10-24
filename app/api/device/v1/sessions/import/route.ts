import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateLantern } from "@/lib/lantern-device-auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { offlineImportDiagnostic, offlineSessionSchema, prepareOfflineSession } from "@/lib/offline-session";
import { conversationClock } from "@/lib/conversation-clock";
import { enforceUserRateLimit } from "@/lib/server-rate-limit";

export const runtime = "nodejs";
const headers = { "cache-control": "no-store" };
export async function POST(request: Request) {
  const client = getServerSupabase();
  if (!client)
    return NextResponse.json({ error: "Offline import is unavailable." }, { status: 503, headers });
  const device = await authenticateLantern(request, client);
  if (!device)
    return NextResponse.json({ error: "Invalid or revoked device." }, { status: 403, headers });
  const limited = await enforceUserRateLimit(device.id, "offline-import", 60, 300);
  if (limited) return limited;
  try {
    const input = offlineSessionSchema.parse(await request.json());
    if (input.ownerDeviceId !== device.id || input.ownerId !== device.userId) {
      return NextResponse.json(
        { error: "This recording belongs to a different pairing. Keep the local copy." },
        { status: 403, headers },
      );
    }
    const prepared = prepareOfflineSession(input);
    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("timezone")
      .eq("id", device.userId)
      .maybeSingle();
    if (profileError) throw new Error();
    const timezone = profile?.timezone ?? "Asia/Kuala_Lumpur";
    const { data, error } = await client.rpc("import_quipus_offline_session", {
      p_session_id: input.sessionId,
      p_event_id: input.eventId,
      p_user_id: device.userId,
      p_device_id: device.id,
      p_started_at: prepared.startedAt,
      p_capture_ended_at: prepared.captureEndedAt,
      p_machine: prepared.machine,
      p_time_uncertain: input.timeUncertain,
      p_timezone: timezone,
      p_fingerprint: prepared.fingerprint,
      p_audio_sources: input.audioSources,
    });
    if (error) {
      console.error("[quipus-offline-import]", offlineImportDiagnostic(error));
      return NextResponse.json(
        {
          error:
            "Offline import could not be accepted. Keep the recording and retry after the current session finishes.",
        },
        { status: error.code === "23505" || error.code === "P0001" ? 409 : 503, headers },
      );
    }
    return NextResponse.json(
      {
        session: data,
        clock: conversationClock(data?.recordingStartedAt ?? prepared.startedAt, timezone),
        timeUncertain: input.timeUncertain,
      },
      { headers },
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid offline recording metadata. Keep the local recording." },
      {
        status: error instanceof z.ZodError || error instanceof RangeError ? 400 : 503,
        headers,
      },
    );
  }
}
