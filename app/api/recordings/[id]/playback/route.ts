import { requireAuthenticatedSession } from "@/lib/api-security";
import {
  playbackJson,
  playbackSourceSchema,
  recordingIdSchema,
  recordingPlaybackResponse,
} from "./playback-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const id = recordingIdSchema.safeParse((await context.params).id);
  if (!id.success)
    return playbackJson({ error: "A valid recording ID is required." }, 400);

  const source = playbackSourceSchema.safeParse(new URL(request.url).searchParams.get("source") || "combined");
  if (!source.success) return playbackJson({ error: "Invalid recording source." }, 400);
  try {
    // The cookie-backed anon client enforces storage/database RLS in addition
    // to the explicit ownership checks in recordingPlaybackResponse.
    const { createSessionSupabase } = await import("@/lib/supabase/session");
    const client = await createSessionSupabase();
    if (!client) return playbackJson({ error: "Private recording storage is not configured." }, 503);
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return playbackJson({ error: "Authentication required." }, 401);
    const ownerId = user.id;
    const { enforceUserRateLimit } = await import("@/lib/server-rate-limit");
    const limited = await enforceUserRateLimit(ownerId, "recording-playback");
    if (limited) return limited;
    const response = await recordingPlaybackResponse(client, id.data.toLowerCase(), ownerId, Date.now(), source.data);
    if (response.ok) {
      const { error: auditError } = await client.rpc("audit_recording_playback", { p_recording_id: id.data });
      if (auditError) return playbackJson({ error: "Private playback is temporarily unavailable." }, 503);
    }
    return response;
  } catch {
    return playbackJson(
      { error: "Private recording storage is unavailable." },
      503,
    );
  }
}
