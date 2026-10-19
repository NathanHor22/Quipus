import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { processNextRecording } from "@/lib/processing-queue";
import { usesDedicatedRecordingWorker } from "@/lib/processing-mode";
import { processNextMeetingEnrichment } from "@/lib/meeting-enrichment";
import { deliverNextMeeting } from "@/lib/meeting-delivery";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  const secret = process.env.PROCESSING_WORKER_SECRET;
  const provided = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || secret.length < 32 || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const client = getServerSupabase();
  if (!client) return NextResponse.json({ error: "Service unavailable." }, { status: 503 });
  after(async () => {
    const results = await Promise.allSettled([
      ...(!usesDedicatedRecordingWorker() ? [processNextRecording(client), processNextMeetingEnrichment(client)] : []),
      deliverNextMeeting(client),
    ]);
    results.forEach((result, index) => {
      if (result.status === "rejected") console.error(`Background operation ${index + 1} failed; its lease will be retried.`);
    });
    await client.from("device_reports").delete().lt("expires_at", new Date().toISOString());
    await client.from("device_voice_prompts").delete().lt("expires_at", new Date(Date.now() - 86400000).toISOString());
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
