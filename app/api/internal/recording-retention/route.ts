import { NextResponse } from "next/server";
import { validInternalBearer } from "@/lib/internal-auth";
import { purgeExpiredRecordingAudio } from "@/lib/recording-retention";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status,
  headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
export async function POST(request: Request) {
  if (!validInternalBearer(request, process.env.RECORDING_RETENTION_SECRET)) return reply({ error: "Unauthorized." }, 401);
  const client = getServerSupabase();
  if (!client) return reply({ error: "Service unavailable." }, 503);
  try { return reply(await purgeExpiredRecordingAudio(client)); }
  catch { return reply({ error: "Audio retention is temporarily unavailable." }, 503); }
}
