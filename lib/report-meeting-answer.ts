import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportMeeting } from "./device-report-data";
import type { ReportRequest } from "./report-request";

type Question = NonNullable<ReportRequest["question"]>;
/** Read saved conversation facts verbatim; do not infer identities or perform actions. */
export async function answerMeetingQuestion(client: SupabaseClient, userId: string, meeting: ReportMeeting, question: Question) {
  if (meeting.status !== "ready") return "That meeting is still processing. Would you like another meeting?";
  if (question.topic === "people") return meeting.person
    ? `The saved participants are ${meeting.person}.`
    : "Participant names were not captured for that meeting.";
  const { data, error } = await client.from("meeting_evidence")
    .select("statement,quote,category,confidence")
    .eq("user_id", userId).eq("meeting_id", meeting.id).eq("source_kind", "conversation")
    .gte("confidence", 0.75).order("importance", { ascending: false }).limit(40);
  if (error) throw error;
  const evidence = (data || []).map(row => row.statement as string).filter(Boolean);
  const all = [meeting.intent, ...meeting.keyPoints, meeting.wants, meeting.concern,
    meeting.promised, meeting.nextAction, ...(meeting.commitments || []),
    ...meeting.actions.map(action => action.description), ...evidence].filter((fact): fact is string => Boolean(fact));
  let facts: string[];
  switch (question.topic) {
    case "bring": facts = all.filter(fact => /\b(?:bring|brought|take along|pack|prepare|carry|need to take)\b/iu.test(fact)); break;
    case "needs": facts = [meeting.wants || "", ...all.filter(fact => /\b(?:ask|asked|want|wanted|need|needs|request|require)\w*/iu.test(fact))]; break;
    case "decisions": facts = all.filter(fact => /\b(?:decid|decision|agree|agreed|approve|chose|chosen|confirmed)\w*/iu.test(fact)); break;
    case "concerns": facts = [meeting.concern || "", ...all.filter(fact => /\b(?:concern|risk|worr|objection|problem|issue)\w*/iu.test(fact))]; break;
    case "next": facts = [meeting.nextAction || "", ...(meeting.commitments || []), ...meeting.actions.map(action => action.description)]; break;
    default: {
      const ignored = new Set(["what", "when", "how", "does", "did", "they", "them", "their", "about", "that", "this", "meeting", "said", "with", "have", "were", "your", "from"]);
      const words = question.text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.filter(word => !ignored.has(word)) || [];
      facts = all.filter(fact => words.some(word => fact.toLowerCase().includes(word)));
    }
  }
  const unique = [...new Map(facts.filter(Boolean).map(fact => [fact.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(), fact])).values()].slice(0, 6);
  return unique.length ? `From this meeting's saved notes: ${unique.join(" ")}`
    : "I couldn't find that detail in this meeting's saved notes. I won't guess. You can ask about its next steps or another meeting.";
}
