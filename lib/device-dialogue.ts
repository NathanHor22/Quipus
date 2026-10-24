import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AuthenticatedLantern } from "./lantern-device-auth";
import { voiceApprovalDecision } from "./voice-approval";
import { googleCalendarEventSchema } from "./providers/google-calendar";
import { sendApprovedEmail } from "./email-action";

import { createVoicePrompt, type VoiceReply } from "./device-voice-prompt";
export { createVoicePrompt, type VoiceReply } from "./device-voice-prompt";

async function nextAction(client: SupabaseClient, device: AuthenticatedLantern, ids: string[], prefix = ""): Promise<VoiceReply> {
  for (let index = 0; index < ids.length; index++) {
    const { data: task, error } = await client.from("follow_ups").select("*").eq("id", ids[index])
      .eq("user_id", device.userId).in("status", ["pending", "approved"]).maybeSingle();
    if (error) throw error;
    if (!task) continue;
    const remaining = ids.slice(index + 1);
    if (task.type === "schedule") {
      const schedule = task.schedule_details;
      const candidate = googleCalendarEventSchema.safeParse({ approved: true, summary: task.description,
        startAt: schedule?.startAt, durationMinutes: schedule?.durationMinutes, attendees: schedule?.attendees,
        meetingId: task.meeting_id, followUpId: task.id,
        ...(schedule?.location ? { location: schedule.location } : {}),
      });
      if (candidate.success && schedule?.durationMinutes && Date.parse(candidate.data.startAt) > Date.now()) {
        const input = candidate.data;
        const when = new Intl.DateTimeFormat("en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "full", timeStyle: "short" }).format(new Date(input.startAt));
        return createVoicePrompt(client, device, "calendar", { input, original: task }, remaining,
          `${prefix}Send a Google Calendar invitation for ${input.summary}, to ${input.attendees.join(" and ")}, on ${when}, Malaysia time, for ${input.durationMinutes} minutes${input.location ? `, at ${input.location}` : ""}, with a Google Meet link. This emails the invitation to those attendees. Do you approve? Say yes or no.`);
      }
    }
    if (task.type === "email" && task.draft) {
      return createVoicePrompt(client, device, "email_draft", { original: task }, remaining,
        `${prefix}Email follow-up: ${task.description}. Draft: ${task.draft}. Shall I save this reviewed draft? This will not send an email. Say yes or no.`);
    }
    return createVoicePrompt(client, device, "skip", { original: task }, remaining,
      `${prefix}${task.description}. This needs ${task.type === "schedule" ? "a confirmed future date, duration, and recipient email" : "manual details"} before I can carry it out. Please complete it in the dashboard. Review the next item? Say yes or no.`);
  }
  return { speech: `${prefix}Action review complete. There are no more pending items in this report.` };
}

export async function answerVoicePrompt(client: SupabaseClient, device: AuthenticatedLantern, token: string, text: string): Promise<VoiceReply> {
  z.string().uuid().parse(token);
  if (device.state !== "ready") return { speech: "Finish the current recording before reviewing actions." };
  const { data: prompt, error } = await client.from("device_voice_prompts").select("*")
    .eq("id", token).eq("device_id", device.id).eq("user_id", device.userId).maybeSingle();
  if (error) throw error;
  if (!prompt || Date.parse(prompt.expires_at) <= Date.now()) return { speech: "That approval has expired. Ask for a new status report." };
  if (prompt.status === "completed" && prompt.result) return prompt.result as VoiceReply;
  if (prompt.status !== "pending") return { speech: "That action has already been submitted. Check its result before trying again." };
  const decision = voiceApprovalDecision(text);
  if (decision === "unknown") return { speech: "I need a clear yes or no for the action I just read. Nothing has been sent.", token };
  const { data: claimed, error: claimError } = await client.from("device_voice_prompts").update({ status: "executing" })
    .eq("id", token).eq("status", "pending").select("id").maybeSingle();
  if (claimError || !claimed) return { speech: "That response is already being handled. Nothing else will be submitted." };
  let result: VoiceReply;
  try {
    if (prompt.kind === "review" || prompt.kind === "skip") {
      result = decision === "yes" ? await nextAction(client, device, prompt.remaining_ids) : { speech: "Review cancelled. Your pending actions are unchanged." };
    } else if (decision === "no") {
      result = await nextAction(client, device, prompt.remaining_ids, "Skipped. Nothing was sent. ");
    } else {
      const original = prompt.payload.original;
      const { data: current } = await client.from("follow_ups").select("*").eq("id", original.id).eq("user_id", device.userId).maybeSingle();
      if (!current || current.status !== original.status || !["pending", "approved"].includes(current.status) || current.description !== original.description ||
          current.draft !== original.draft || JSON.stringify(current.schedule_details) !== JSON.stringify(original.schedule_details)) {
        throw new Error("The action changed after it was read. Request a new report to review the updated details.");
      }
      if (prompt.kind === "calendar") {
        const { executeCalendarRequest } = await import("./calendar-action-service");
        const response = await executeCalendarRequest(new Request("https://lantern.internal/calendar", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(prompt.payload.input),
        }), device.userId);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Calendar could not confirm this invitation. Check the dashboard before retrying.");
        result = await nextAction(client, device, prompt.remaining_ids, "Google Calendar confirmed the event and the invitation request. ");
      } else if (prompt.kind === "email_send") {
        await sendApprovedEmail(client, device.userId, prompt.payload.input);
        result = await nextAction(client, device, prompt.remaining_ids, "Gmail confirmed your email was sent. ");
      } else {
        const { error: saveError } = await client.from("follow_ups").update({ status: "approved" })
          .eq("id", original.id).eq("user_id", device.userId).eq("status", original.status);
        if (saveError) throw saveError;
        const { data: contact } = current.contact_id ? await client.from("contacts").select("email").eq("id", current.contact_id).eq("user_id", device.userId).maybeSingle() : { data: null };
        if (contact?.email && z.string().email().safeParse(contact.email).success) {
          result = await createVoicePrompt(client, device, "email_send", {
            original: { ...current, status: "approved" }, input: { approved: true, followUpId: current.id, recipient: contact.email, subject: current.description, body: current.draft },
          }, prompt.remaining_ids, `Draft saved. Send it by Gmail to ${contact.email}? Subject: ${current.description}. Message: ${current.draft}. Say yes to send this email, or no to leave it as a draft.`);
        } else result = await nextAction(client, device, prompt.remaining_ids, "Draft saved. Add the recipient's email in the dashboard before sending. ");
      }
    }
  } catch (cause) {
    result = { speech: cause instanceof Error ? cause.message : "I could not confirm that action. Check the dashboard before retrying." };
  }
  const { error: resultError } = await client.from("device_voice_prompts").update({ status: "completed", result }).eq("id", token);
  if (resultError) throw new Error("Could not save the action result. Check the dashboard before retrying.");
  return result;
}
