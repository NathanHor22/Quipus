import { z } from "zod";
import { browserMutationError } from "@/lib/request-security";
import { enforceUserRateLimit } from "@/lib/server-rate-limit";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";
import { getServerSupabase } from "@/lib/supabase/server";
import { peopleJson } from "@/lib/people-api";

const schema = z
  .object({
    speakerLabel: z.string().trim().min(1).max(80),
    contactId: z.string().uuid().nullable(),
  })
  .strict();
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const boundary = browserMutationError(request);
  if (boundary) return peopleJson({ error: boundary.error }, boundary.status);
  const user = await getAuthenticatedLanternUser();
  if (!user) return peopleJson({ error: "Sign in to continue." }, 401);
  const client = getServerSupabase();
  if (!client) return peopleJson({ error: "Speaker corrections are unavailable." }, 503);
  const limited = await enforceUserRateLimit(user.id, "speaker-identities", 30, 300);
  if (limited) return limited;
  const input = schema.safeParse(await request.json().catch(() => null));
  const id = (await params).id;
  if (!input.success || id.length > 160)
    return peopleJson({ error: "Invalid speaker correction." }, 400);
  const query = client.from("meetings").select("id,recording_id").eq("user_id", user.id);
  const meeting = await (
    z.string().uuid().safeParse(id).success ? query.eq("id", id) : query.eq("client_reference", id)
  ).maybeSingle();
  if (meeting.error) return peopleJson({ error: "The meeting could not be loaded." }, 503);
  if (!meeting.data?.recording_id) return peopleJson({ error: "Meeting not found." }, 404);
  if (input.data.contactId) {
    const link = await client
      .from("meeting_contacts")
      .select("contact_id,contacts!inner(user_id)")
      .eq("meeting_id", meeting.data.id)
      .eq("contact_id", input.data.contactId)
      .eq("contacts.user_id", user.id)
      .maybeSingle();
    if (link.error || !link.data)
      return peopleJson({ error: "Choose a participant from this meeting." }, 400);
  }
  const transcript = await client
    .from("transcripts")
    .select("segments")
    .eq("user_id", user.id)
    .eq("recording_id", meeting.data.recording_id)
    .maybeSingle();
  const segments = transcript.data?.segments;
  if (
    transcript.error ||
    !Array.isArray(segments) ||
    !segments.some(
      (segment) =>
        segment && typeof segment === "object" && segment.speaker === input.data.speakerLabel,
    )
  )
    return peopleJson({ error: "Speaker label not found in the original transcript." }, 400);
  const saved = await client
    .from("meeting_speaker_identifications")
    .upsert(
      {
        meeting_id: meeting.data.id,
        user_id: user.id,
        speaker_label: input.data.speakerLabel,
        contact_id: input.data.contactId,
        confirmed_at: new Date().toISOString(),
      },
      { onConflict: "meeting_id,speaker_label" },
    );
  return saved.error
    ? peopleJson({ error: "The correction could not be saved." }, 503)
    : peopleJson({ saved: true });
}
