import type { MeetingInsight } from "@/lib/types";

type MeetingKeyPointsProps = {
  insight: Pick<MeetingInsight, "keyPoints" | "wants">;
  className?: string;
  omitEmpty?: boolean;
};

/** Use the captured need when a meeting has no separate key points. */
export function MeetingKeyPoints({
  insight,
  className,
  omitEmpty = false,
}: MeetingKeyPointsProps) {
  const points = insight.keyPoints.length ? insight.keyPoints : [insight.wants];

  return (
    <ul className={className}>
      {(omitEmpty ? points.filter(Boolean) : points).map((point, index) => (
        <li key={index}>{point}</li>
      ))}
    </ul>
  );
}
