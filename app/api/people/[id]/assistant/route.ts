import { z } from "zod";
import { ownedPersonContext, peopleJson } from "@/lib/people-api";
import { answerPersonQuestion, type PersonMeetingSource } from "@/lib/people-assistant";

export const dynamic = "force-dynamic";
const questionSchema = z.object({ question: z.string().trim().min(2).max(500) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await ownedPersonContext(request, (await params).id);
  if (context.response) return context.response;
  const input = questionSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return peopleJson({ error: "Ask a question using 2-500 characters." }, 400);
  const { client, userId, contact } = context;
  try {
    const meetings = await client
      .from("meetings")
      .select("id,client_reference,title,start_at,meeting_contacts!inner(contact_id)")
      .eq("user_id", userId)
      .eq("meeting_contacts.contact_id", contact.id)
      .eq("status", "ready")
      .order("start_at", { ascending: false })
      .limit(20);
    if (meetings.error) throw meetings.error;
    const meetingIds = (meetings.data || []).map((meeting) => meeting.id);
    if (!meetingIds.length)
      return peopleJson({
        answer: "There are no completed conversations for this person yet.",
        sources: [],
      });
    const [insights, evidence, timing] = await Promise.all([
      client
        .from("meeting_insights")
        .select("meeting_id,executive_summary,key_points,next_action,open_questions")
        .eq("user_id", userId)
        .in("meeting_id", meetingIds),
      client
        .from("meeting_evidence")
        .select("meeting_id,statement,quote,speaker,start_seconds")
        .eq("user_id", userId)
        .in("meeting_id", meetingIds)
        .order("importance", { ascending: false })
        .limit(240),
      client
        .from("lantern_sessions")
        .select("meeting_id,capture_time_uncertain")
        .eq("user_id", userId)
        .in("meeting_id", meetingIds),
    ]);
    if (insights.error || evidence.error || timing.error)
      throw new Error("Meeting evidence is unavailable.");
    const sources: PersonMeetingSource[] = (meetings.data || []).map((meeting) => {
      const insight = insights.data?.find((item) => item.meeting_id === meeting.id);
      return {
        id: meeting.client_reference || meeting.id,
        title: meeting.title,
        occurredAt: meeting.start_at,
        timeUncertain:
          timing.data?.some(
            (item) => item.meeting_id === meeting.id && item.capture_time_uncertain,
          ) || false,
        summary: JSON.stringify(insight || {}).slice(0, 3_500),
        evidence: (evidence.data || [])
          .filter((item) => item.meeting_id === meeting.id)
          .slice(0, 12)
          .map((item) => ({
            statement: item.statement,
            quote: item.quote,
            speaker: item.speaker,
            startSeconds: item.start_seconds === null ? null : Number(item.start_seconds),
          })),
      };
    });
    return peopleJson(await answerPersonQuestion(input.data.question, sources));
  } catch {
    return peopleJson(
      { error: "This question could not be answered. Your saved conversations are unchanged." },
      503,
    );
  }
}
