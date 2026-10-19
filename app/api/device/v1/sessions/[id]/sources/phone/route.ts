import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateLantern } from "@/lib/lantern-device-auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { deviceUploadRequest, verifyStoredArchiveMetadata } from "@/lib/device-upload";
import { audioTimingSchema } from "@/lib/multi-source-audio";
import { preparePrivateTusUpload } from "@/lib/tus-upload";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60;
const schema = deviceUploadRequest.extend({ timingManifest: audioTimingSchema });
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const client = getServerSupabase();
  if (!client) return reply({ error: "Recording storage is unavailable." }, 503);
  const device = await authenticateLantern(request, client);
  if (!device) return reply({ error: "Invalid or revoked device." }, 403);
  try {
    if (Number(request.headers.get("content-length") || 0) > 1_000_000)
      return reply({ error: "Audio timing metadata is too large." }, 413);
    const sessionId = z
      .string()
      .uuid()
      .parse((await params).id);
    const input = schema.parse(await request.json());
    const { data: source, error } = await client.rpc("prepare_quipus_phone_audio", {
      p_session_id: sessionId,
      p_user_id: device.userId,
      p_device_id: device.id,
      p_event_id: input.eventId,
      p_bytes: input.bytes,
      p_sha256: input.sha256,
      p_timing: input.timingManifest,
    });
    if (error || !source)
      return reply({ error: "The phone track does not match this stopped session." }, 409);
    if (source.committed_at)
      return reply({
        archived: true,
        verified: Boolean(source.verified_at),
        uploadedBytes: input.bytes,
      });
    if (input.action === "commit") {
      const { data: object, error: objectError } = await client.storage
        .from("recordings")
        .info(source.storage_path);
      if (objectError || !object)
        return reply({ error: "The phone track upload is incomplete." }, 409);
      verifyStoredArchiveMetadata(object, input.bytes);
      const { error: commitError } = await client.rpc("commit_quipus_phone_audio", {
        p_session_id: sessionId,
        p_user_id: device.userId,
        p_device_id: device.id,
        p_event_id: input.eventId,
      });
      if (commitError) throw new Error();
      return reply({ archived: true, verified: false, uploadedBytes: input.bytes });
    }
    if (input.action === "progress") {
      if (input.uploadedBytes === undefined || input.uploadedBytes > input.bytes)
        return reply({ error: "Invalid progress." }, 400);
      return reply({ accepted: true });
    }
    const upload = await preparePrivateTusUpload({
      client,
      supabaseUrl: env().NEXT_PUBLIC_SUPABASE_URL!,
      path: source.storage_path,
      bytes: input.bytes,
      previousUrl: source.upload_url,
    });
    const { error: saveError } = await client
      .from("recording_audio_sources")
      .update({ upload_url: upload.uploadUrl })
      .eq("id", input.eventId)
      .eq("user_id", device.userId)
      .is("committed_at", null);
    if (saveError) throw new Error();
    return reply({ archived: false, ...upload });
  } catch (error) {
    return reply(
      {
        error:
          error instanceof z.ZodError
            ? "Invalid phone audio manifest."
            : "Phone audio could not be uploaded. Keep both local tracks.",
      },
      error instanceof z.ZodError ? 400 : 503,
    );
  }
}
