import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { splitSpeechPages } from "./device-briefing";
import { createOpenAISpeech } from "./providers/openai-speech";
import { env } from "./env";
import { quipusVoiceProfile } from "./quipus-voice-profile";
import { reportAudioCache, reportAudioCacheKey } from "./report-audio-cache";
import type { AuthenticatedLantern } from "./lantern-device-auth";
import { REPORT_CONTEXT_MAX_AGE_MS, REPORT_CONTEXT_IDLE_MS } from "./report-turn";

export async function deviceSpeechPage(client: SupabaseClient, device: AuthenticatedLantern,
  input: { speech?: string; token?: string; reportId?: string; page?: number; intent?: string; reportContextId?: string; interactionId?: string; conversational?: boolean; playbackMode?: "repeat" }) {
  let id = input.reportId;
  let pages: string[];
  let token = input.token;
  const page = input.page || 0;
  if (id) {
    const { data, error } = await client.from("device_reports").select("pages,review_token")
      .eq("id", id).eq("user_id", device.userId).eq("device_id", device.id)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error || !data) throw new Error("Report has expired. Request a new report.");
    pages = data.pages;
    token = data.review_token || undefined;
  } else {
    pages = splitSpeechPages(input.speech || "Nothing to report.");
    if (pages.length > 1) {
      const { data, error } = await client.from("device_reports").insert({
        user_id: device.userId, device_id: device.id, pages, review_token: token || null,
      }).select("id").single();
      if (error || !data) throw new Error("Could not prepare report playback.");
      id = data.id;
    }
  }
  if (!pages[page]) throw new Error("Report page is invalid.");
  let offlineCacheable = false;
  const assertCurrent = async (refresh = false) => {
    if (!input.conversational || !input.reportContextId || input.intent === "report_stop") return;
    const current = await client.from("device_report_sessions").select("state")
      .eq("id", input.reportContextId).eq("user_id", device.userId).eq("device_id", device.id)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (current.error) throw current.error;
    const state = current.data?.state as { closed?: boolean; interactionId?: string; activeInteractionId?: string; startedAt?: number; currentReportId?: string; currentMeetingPages?: number[] } | undefined;
    if (!state || state.closed || (input.interactionId && (state.activeInteractionId || state.interactionId) !== input.interactionId)) {
      throw new Error("Report interaction was cancelled or replaced.");
    }
    offlineCacheable = Boolean(id && state.currentReportId === id &&
      state.currentMeetingPages?.some(index => Number.isInteger(index) && index >= 0));
    if (typeof state.startedAt === "number") {
      const now = Date.now();
      const maximum = state.startedAt + REPORT_CONTEXT_MAX_AGE_MS;
      if (now >= maximum) throw new Error("Report context has expired.");
      if (refresh) {
        let renewal = client.from("device_report_sessions").update({ expires_at: new Date(Math.min(maximum, now + REPORT_CONTEXT_IDLE_MS)).toISOString() })
          .eq("id", input.reportContextId).eq("user_id", device.userId).eq("device_id", device.id)
          .gt("expires_at", new Date(now).toISOString());
        const active = state.activeInteractionId || state.interactionId;
        if (active) renewal = renewal.eq(state.activeInteractionId ? "state->>activeInteractionId" : "state->>interactionId", active);
        const changed = await renewal.select("id").maybeSingle();
        if (changed.error) throw changed.error;
        if (!changed.data) throw new Error("Report interaction was cancelled or replaced.");
      }
    }
  };
  await assertCurrent();
  const runtime = env();
  const profile = quipusVoiceProfile({ model: runtime.OPENAI_SPEECH_MODEL, voice: runtime.OPENAI_SPEECH_VOICE });
  const audioKey = reportAudioCacheKey({ userId: device.userId, deviceId: device.id }, pages[page], profile);
  const cached = reportAudioCache.get(audioKey);
  const audio = cached || reportAudioCache.capture(audioKey, await createOpenAISpeech(pages[page]));
  try { await assertCurrent(true); }
  catch (error) { await audio.body?.cancel(); throw error; }
  const repeat = input.playbackMode === "repeat";
  const more = !repeat && page + 1 < pages.length;
  return new NextResponse(audio.body, { headers: {
    "cache-control": "private, no-store", "content-type": "audio/pcm", "x-lantern-audio-rate": String(profile.sampleRate),
    "x-quipus-voice-profile": profile.version, "x-quipus-audio-key": audioKey,
    ...(offlineCacheable ? { "x-quipus-offline-cache": "report" } : {}),
    ...(input.intent ? { "x-lantern-command": input.intent } : {}),
    ...(input.reportContextId ? { "x-quipus-context-id": input.reportContextId } : {}),
    ...(input.interactionId ? { "x-quipus-interaction-id": input.interactionId } : {}),
    ...(input.conversational ? { "x-quipus-report-mode": "conversation" } : {}),
    ...(repeat ? { "x-quipus-playback-mode": "repeat" } : {}),
    ...(id ? { "x-quipus-playback-id": id, "x-quipus-playback-page": String(page) } : {}),
    ...(more ? { "x-lantern-report-id": id!, "x-lantern-report-page": String(page + 1) } : {}),
    ...(!repeat && !more && token ? { "x-lantern-review-token": token } : {}),
  } });
}
