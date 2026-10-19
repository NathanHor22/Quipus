import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Meeting, MeetingEvidence, TranscriptSegment } from "./types";

export async function loadOwnedPreparationSource(
  client: SupabaseClient,
  userId: string,
  reference: string,
): Promise<Meeting | null> {
  const query = client
    .from("meetings")
    .select("id,title,start_at,end_at,status,source,recording_id")
    .eq("user_id", userId);
  const meeting = await (
    z.string().uuid().safeParse(reference).success
      ? query.eq("id", reference)
      : query.eq("client_reference", reference)
  ).maybeSingle();
  if (meeting.error) throw new Error("The meeting could not be loaded.");
  if (!meeting.data) return null;
  const row = meeting.data;
  const [evidence, transcript] = await Promise.all([
    client
      .from("meeting_evidence")
      .select(
        "id,category,statement,speaker,start_seconds,end_seconds,quote,confidence,importance,source_kind",
      )
      .eq("user_id", userId)
      .eq("meeting_id", row.id)
      .order("importance", { ascending: false })
      .limit(80),
    row.recording_id
      ? client
          .from("transcripts")
          .select("segments")
          .eq("user_id", userId)
          .eq("recording_id", row.recording_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (evidence.error || transcript.error) throw new Error("Meeting evidence could not be loaded.");
  return {
    id: row.id,
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    source: row.source,
    contacts: [],
    transcript: (transcript.data?.segments || []) as TranscriptSegment[],
    evidence: (evidence.data || []).map((item) => ({
      id: item.id,
      category: item.category,
      statement: item.statement,
      speaker: item.speaker,
      startSeconds: item.start_seconds === null ? null : Number(item.start_seconds),
      endSeconds: item.end_seconds === null ? null : Number(item.end_seconds),
      quote: item.quote,
      confidence: Number(item.confidence),
      importance: Number(item.importance),
      sourceKind: item.source_kind,
    })) as MeetingEvidence[],
  };
}
