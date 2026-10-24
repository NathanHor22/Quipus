import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedLantern } from "./lantern-device-auth";

export interface VoiceReply { speech: string; token?: string; }
export async function createVoicePrompt(client: SupabaseClient, device: AuthenticatedLantern,
  kind: string, payload: Record<string, unknown>, remaining: string[], speech: string): Promise<VoiceReply> {
  const { data, error } = await client.from("device_voice_prompts").insert({
    user_id: device.userId, device_id: device.id, kind, payload, remaining_ids: remaining,
    expires_at: new Date(Date.now() + (kind === "review" ? 7200000 : 300000)).toISOString(),
  }).select("id").single();
  if (error || !data) throw new Error("Could not prepare voice approval.");
  return { speech, token: data.id };
}
