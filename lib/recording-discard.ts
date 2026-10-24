import type { SupabaseClient } from "@supabase/supabase-js";

/** This private proof survives removal of upload manifests and raw WAV objects. */
export async function verifiedSilenceDiscard(client: SupabaseClient, identity: {
  sessionId: string; recordingId: string; eventId: string; userId: string; deviceId: string;
}) {
  const { data, error } = await client.from("recording_discard_decisions")
    .select("reason,policy_version")
    .eq("session_id", identity.sessionId).eq("recording_id", identity.recordingId)
    .eq("audio_event_id", identity.eventId).eq("user_id", identity.userId).eq("device_id", identity.deviceId)
    .maybeSingle();
  if (error) throw new Error("Could not verify this recording's discard decision.");
  return data?.reason === "short_digital_silence" && data.policy_version === "digital-constant-v1";
}
