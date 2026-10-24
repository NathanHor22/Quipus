import { NextResponse } from "next/server";
import { z } from "zod";
import { loadDeviceBriefing } from "@/lib/device-briefing-service";
import { createVoicePrompt } from "@/lib/device-dialogue";
import { deviceSpeechPage } from "@/lib/device-speech-response";
import { authenticateLantern } from "@/lib/lantern-device-auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { prepareReportQuery } from "@/lib/device-report-session";
import { reportProtocol } from "@/lib/report-protocol";
export const runtime = "nodejs";
export const maxDuration = 120;
const schema = z.object({ kind: z.enum(["boot", "status"]), batteryLevel: z.number().int().min(0).max(100).nullable().default(null), reportId: z.string().uuid().optional(), page: z.number().int().nonnegative().max(10000).default(0) }).strict();
export async function POST(request: Request) {
  const client = getServerSupabase();
  if (!client) return NextResponse.json({ error: "Service unavailable." }, { status: 503 });
  const device = await authenticateLantern(request, client);
  if (!device) return NextResponse.json({ error: "Device credential is invalid or revoked." }, { status: 403 });
  try {
    const input = schema.parse(await request.json());
    const metadata = reportProtocol(request);
    if (input.reportId) return await deviceSpeechPage(client, device, { ...input, reportContextId: metadata.contextId, interactionId: metadata.interactionId, conversational: metadata.conversational });
    if (input.page !== 0) return NextResponse.json({ error: "A report ID is required." }, { status: 400 });
    if (input.kind === "status" && request.headers.get("x-lantern-protocol") === "3") {
      return await deviceSpeechPage(client, device, await prepareReportQuery(client, device, { text: metadata.conversational ? "status report" : "Today's status report", ...metadata }));
    }
    const briefing = await loadDeviceBriefing(client, device.userId, input.kind, input.batteryLevel);
    const prompt = briefing.followUpIds.length
      ? await createVoicePrompt(client, device, "review", {}, briefing.followUpIds, briefing.speech)
      : { speech: briefing.speech };
    return await deviceSpeechPage(client, device, prompt);
  } catch (error) {
    console.error("[device-briefing]", error);
    return NextResponse.json({ error: "Report could not be played. Please retry." }, { status: error instanceof z.ZodError ? 400 : 502 });
  }
}
