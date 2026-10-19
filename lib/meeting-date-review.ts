import type { MeetingExtractionResult } from "./meeting-schema";

const warning =
  "Recording time is uncertain. Review all follow-up and commitment dates before approval.";
/** Provider-independent guard: a guessed capture date cannot authorise scheduling. */
export function requireMeetingDateReview(
  result: MeetingExtractionResult,
  uncertain = false,
): MeetingExtractionResult {
  if (!uncertain) return result;
  return {
    ...result,
    insight: {
      ...result.insight,
      commitments: result.insight.commitments.map((item) => ({ ...item, dueAt: null })),
    },
    followUps: result.followUps.map((item) => ({
      ...item,
      dueAt: null,
      ...(item.schedule ? { schedule: { ...item.schedule, startAt: null } } : {}),
    })),
    warning: result.warning?.includes(warning)
      ? result.warning
      : [result.warning, warning].filter(Boolean).join(" ").slice(0, 500),
  };
}
