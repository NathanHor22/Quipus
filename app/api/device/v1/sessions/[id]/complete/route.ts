import { archiveVerified } from "@/lib/archive-verification";
import { usesDedicatedRecordingWorker } from "@/lib/processing-mode";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateLantern } from "@/lib/lantern-device-auth";
import { advanceLantern, lanternMachineSchema } from "@/lib/lantern-state";
import { processNextRecording } from "@/lib/processing-queue";
import { publishProcessingWakeup } from "@/lib/redis";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const client = getServerSupabase();
  if (!client) return reply({ error: "Quipus service is unavailable." }, 503);
  const device = await authenticateLantern(request, client);
  if (!device) return reply({ error: "Device credential is invalid or revoked." }, 403);
  try {
    const id = z.string().uuid().parse((await context.params).id);
    const { eventId } = z.object({ eventId: z.string().uuid() }).strict().parse(await request.json());
    const { data: stored, error } = await client.from("lantern_sessions").select("*")
      .eq("id", id).eq("user_id", device.userId).eq("device_id", device.id).maybeSingle();
    if (error) throw error;
    if (!stored) return reply({ error: "Session not found." }, 404);
    if (!stored.recording_id) return reply({ error: "Upload the complete WAV first." }, 409);
    let machine = lanternMachineSchema.parse(stored.machine);
    if (stored.ended_at) {
      if (stored.completion_event_id !== eventId) return reply({ error: "Session already completed." }, 409);
    } else {
      const next = advanceLantern(machine, { type: "PROCESSING_QUEUED", at: new Date().toISOString() });
      const { data, error: queueError } = await client.rpc("enqueue_lantern_processing", {
        p_session_id: id, p_user_id: device.userId, p_device_id: device.id,
        p_event_id: eventId, p_expected_version: machine.version, p_machine: next,
      });
      if (queueError) throw queueError;
      machine = lanternMachineSchema.parse(data);
    }
    after(async () => {
      const results = await Promise.allSettled([
        publishProcessingWakeup({ sessionId: id, userId: device.userId }),
        ...(!usesDedicatedRecordingWorker() ? [processNextRecording(client, device.userId, id)] : []),
      ]);
      for (const result of results) {
        if (result.status === "rejected") console.error("Recording processing is delayed; the durable job will retry.");
      }
    });
    const verified = await archiveVerified(client, id, stored.audio_event_id, stored.recording_id);
    return reply({ accepted: true, archiveAccepted: true, archiveVerified: verified, processingQueued: stored.processing_stage !== "ready",
      duplicate: Boolean(stored.ended_at), conversationId: `hardware:${id}`, meetingId: stored.meeting_id,
      meeting: stored.processing_stage === "ready" ? { status: "ready" } : null, session: machine });
  } catch (cause) {
    console.error("Recording queue request failed; the SD original must be retained.");
    return reply({ error: "Could not queue this recording. Retry with the same session." }, cause instanceof z.ZodError ? 400 : 502);
  }
}
