import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedLantern } from "./lantern-device-auth";

export const REPORT_CONTEXT_MAX_AGE_MS = 2 * 60 * 60 * 1000;
export const REPORT_CONTEXT_IDLE_MS = 15 * 60 * 1000;

export class ReplacedReportTurnError extends Error {
  constructor() { super("Report interaction was cancelled or replaced."); }
}
/** Reserve a new turn before slow transcription/retrieval; never change another owner. */
export async function claimReportTurn(client: SupabaseClient, device: AuthenticatedLantern, contextId: string, interactionId: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const saved = await client.from("device_report_sessions").select("state")
      .eq("id", contextId).eq("user_id", device.userId).eq("device_id", device.id)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (saved.error) throw saved.error;
    const previous = saved.data?.state as Record<string, unknown> | undefined;
    if (!previous || previous.closed || !previous.conversation) return false;
    if (previous.activeInteractionId === interactionId) return true;
    let update = client.from("device_report_sessions").update({ state: { ...previous, activeInteractionId: interactionId } })
      .eq("id", contextId).eq("user_id", device.userId).eq("device_id", device.id)
      .gt("expires_at", new Date().toISOString());
    update = typeof previous.activeInteractionId === "string"
      ? update.eq("state->>activeInteractionId", previous.activeInteractionId)
      : update.is("state->>activeInteractionId", null);
    const changed = await update.select("id").maybeSingle();
    if (changed.error) throw changed.error;
    if (changed.data) return true;
  }
  throw new ReplacedReportTurnError();
}
