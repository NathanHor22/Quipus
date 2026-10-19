import { NextResponse } from "next/server";
import { z } from "zod";
import { archiveVerified } from "@/lib/archive-verification";
import { authenticateLantern } from "@/lib/lantern-device-auth";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
});
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const client = getServerSupabase();
  if (!client) return reply({ error: "Service unavailable." }, 503);
  const device = await authenticateLantern(request, client);
  if (!device) return reply({ error: "Device credential is invalid or revoked." }, 403);
  const id = z.string().uuid().safeParse((await context.params).id);
  if (!id.success) return reply({ error: "Invalid session." }, 400);
  try {
    const { data: session, error } = await client.from("lantern_sessions")
      .select("id,recording_id,audio_event_id,processing_stage")
      .eq("id", id.data).eq("user_id", device.userId).eq("device_id", device.id).maybeSingle();
    if (error) throw error;
    if (!session) return reply({ error: "Session not found." }, 404);
    const verified = await archiveVerified(client, session.id, session.audio_event_id, session.recording_id);
    return reply({ sessionId: session.id, audioEventId: session.audio_event_id,
      archiveAccepted: Boolean(session.recording_id), archiveVerified: verified,
      deleteLocalCopy: verified, processingStage: session.processing_stage });
  } catch { return reply({ error: "Verification is unavailable. Keep the local recording." }, 503); }
}
