import { requireMeetingDateReview } from "../meeting-date-review";
import { env } from "../env";
import type { ExtractionContext } from "../meeting-schema";
import type { TranscriptSegment } from "../types";
import { extractWithOpenAI } from "./openai-extraction";
import { extractMeetingInsights } from "./qwen";

/** Capture providers share one extraction boundary. OpenAI is the prototype's
 * primary multilingual extractor; Qwen remains a configured legacy fallback. */
export async function extractConversationInsights(
  transcript: TranscriptSegment[],
  context: ExtractionContext,
) {
  const result = await (env().OPENAI_API_KEY
    ? extractWithOpenAI(transcript, context)
    : extractMeetingInsights(transcript, context));
  return requireMeetingDateReview(result, Boolean(context.referenceTimeUncertain));
}
