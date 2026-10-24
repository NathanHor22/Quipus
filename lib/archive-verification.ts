import type { SupabaseClient } from "@supabase/supabase-js";
import { verifiedSilenceDiscard } from "./recording-discard";

/** A queue acknowledgement is not proof that the complete WAV passed SHA-256. */
export async function archiveVerified(client: SupabaseClient, sessionId: string,
  eventId: string | null, recordingId: string | null): Promise<boolean> {
  if (!eventId || !recordingId) return false;
  const [{ data, error }, { data: session, error: sessionError }] = await Promise.all([
    client.from("lantern_audio_uploads").select("event_id,verified_at")
      .eq("session_id", sessionId).maybeSingle(),
    client.from("lantern_sessions").select("recording_id,audio_event_id,expected_audio_sources,processing_stage,user_id,device_id")
      .eq("id", sessionId).eq("recording_id", recordingId).maybeSingle(),
  ]);
  if (error || sessionError) throw new Error("Could not check recording verification.");
  if (session?.processing_stage === "discarded_silence") {
    return verifiedSilenceDiscard(client, { sessionId, recordingId, eventId,
      userId: session.user_id, deviceId: session.device_id });
  }
  if (!data || data.event_id !== eventId || !data.verified_at || !session ||
      session.recording_id !== recordingId || session.audio_event_id !== eventId ||
      !Array.isArray(session.expected_audio_sources) || !session.expected_audio_sources.includes("onboard") ||
      session.expected_audio_sources.some((kind: unknown) => kind !== "onboard" && kind !== "phone")) return false;
  const { data: sources, error: sourcesError } = await client.from("recording_audio_sources")
    .select("source_kind,committed_at,verified_at").eq("session_id", sessionId).eq("recording_id", recordingId);
  if (sourcesError) throw new Error("Could not check every recording source.");
  const tracks = sources || [];
  if (session.expected_audio_sources.includes("phone") &&
      !tracks.some(source => source.source_kind === "phone")) return false;
  return tracks.every(source => Boolean(source.committed_at && source.verified_at));
}
