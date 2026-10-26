import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { browserMutationError } from "./request-security";
import { transcriptSegmentSchema, type ExtractionContext } from "./meeting-schema";
import { MEETING_TITLE_MAX_LENGTH, normalizeMeetingTitle } from "./meeting-title";
import type { TranscriptSegment } from "./types";

const referenceSchema = z.string().min(1).max(160).refine(value => !/[\u0000-\u001f\u007f]/u.test(value) && !value.startsWith("sample:"));
const titleSchema = z.string().trim().min(1).max(MEETING_TITLE_MAX_LENGTH)
  .refine(value => !/[\u0000-\u001f\u007f]/u.test(value))
  .transform(value => normalizeMeetingTitle(value)).refine(value => value !== null);
const expectedTitleSchema = z.string().max(1_000);
const renameSchema = z.object({ title: titleSchema, expectedTitle: expectedTitleSchema }).strict();
const generateSchema = z.object({ expectedTitle: expectedTitleSchema }).strict();
const uuidSchema = z.string().uuid();
const transcriptSchema = z.array(transcriptSegmentSchema).min(1).max(10_000);
const MAX_TRANSCRIPT_CHARACTERS = 250_000;

type Dependencies = {
  user: () => Promise<{ id: string } | null>;
  client: () => SupabaseClient | null;
  limit: (userId: string, method: "PATCH" | "POST") => Promise<Response | null>;
  extract: (segments: TranscriptSegment[], context: ExtractionContext) => Promise<{ title?: string | null }>;
};
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
});

/** Explicit, owner-scoped rename/backfill; merely opening a meeting never invokes AI. */
export function meetingTitleHandlers(dependencies: Dependencies) {
  const handler = (method: "PATCH" | "POST") => async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const boundary = browserMutationError(request);
    if (boundary) return json({ error: boundary.error }, boundary.status);
    const user = await dependencies.user();
    if (!user) return json({ error: "Sign in to continue." }, 401);
    const reference = referenceSchema.safeParse((await context.params).id);
    const raw = await request.json().catch(() => null);
    const input = method === "PATCH" ? renameSchema.safeParse(raw) : generateSchema.safeParse(raw);
    if (!reference.success || !input.success) return json({ error: "Enter a short meeting title and refresh the meeting if it has changed." }, 400);
    const limited = await dependencies.limit(user.id, method);
    if (limited) return limited;
    const client = dependencies.client();
    if (!client) return json({ error: "Meeting titles are unavailable." }, 503);
    try {
      const query = client.from("meetings").select("id,title,status,source,recording_id,start_at")
        .eq("user_id", user.id);
      const found = await (uuidSchema.safeParse(reference.data).success
        ? query.eq("id", reference.data) : query.eq("client_reference", reference.data)).maybeSingle();
      if (found.error) throw new Error("Meeting lookup failed");
      const meeting = found.data;
      if (!meeting) return json({ error: "Meeting not found." }, 404);
      if (meeting.source === "calendar" || meeting.status === "upcoming") return json({ error: "Only recorded conversation titles can be changed here." }, 400);
      if (meeting.title !== input.data.expectedTitle) return json({ error: "This meeting title changed. Refresh it before saving again." }, 409);
      let title: string | null;
      if (method === "PATCH") title = renameSchema.parse(raw).title;
      else {
        if (meeting.status !== "ready" || !meeting.recording_id) return json({ error: "Wait until this meeting transcript is ready." }, 409);
        const transcript = await client.from("transcripts").select("segments")
          .eq("user_id", user.id).eq("recording_id", meeting.recording_id).maybeSingle();
        if (transcript.error) throw new Error("Transcript lookup failed");
        const source = transcriptSchema.safeParse(transcript.data?.segments);
        if (!source.success) return json({ error: "A saved transcript is needed to generate this title." }, 422);
        const length = source.data.reduce((total, segment) => total + segment.text.length, 0);
        if (length > MAX_TRANSCRIPT_CHARACTERS) return json({ error: "This transcript is too long for a title refresh. You can rename it instead." }, 422);
        const extracted = await dependencies.extract(source.data, {
          title: "Recorded conversation", outputLanguage: "English", referenceDate: meeting.start_at,
          referenceTimeUncertain: true,
        });
        title = normalizeMeetingTitle(extracted.title);
        if (!title) return json({ error: "The transcript does not establish a clear meeting title. You can rename it instead." }, 422);
      }
      const saved = await client.from("meetings").update({ title })
        .eq("id", meeting.id).eq("user_id", user.id).eq("title", input.data.expectedTitle)
        .select("title").maybeSingle();
      if (saved.error) throw new Error("Title update failed");
      if (!saved.data) return json({ error: "This meeting title changed. Refresh it before saving again." }, 409);
      return json({ title: saved.data.title, persisted: true });
    } catch {
      return json({ error: method === "POST" ? "The title could not be generated. Your meeting is unchanged; try again or rename it." : "The meeting title could not be saved. Please try again." }, 503);
    }
  };
  return { PATCH: handler("PATCH"), POST: handler("POST") };
}
