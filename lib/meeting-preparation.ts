import { createHash } from "node:crypto";
import type { Meeting } from "./types";

export type PreparationRequirement = {
  id: string;
  description: string;
  sourceQuote: string;
  speaker: string | null;
  startSeconds: number | null;
  completed: boolean;
};
const normalise = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/gu, " ").trim();
const preparationLanguage =
  /\b(bring|prepare|send|check with|confirm with|make sure|need to|bawa|sediakan|semak|pastikan)\b/iu;

/** Requirements retain original wording; unsupported model statements are omitted. */
export function deriveMeetingPreparation(
  meeting: Pick<Meeting, "evidence" | "transcript">,
  saved: unknown = [],
): PreparationRequirement[] {
  const completed = new Set(
    Array.isArray(saved)
      ? saved.flatMap((item) =>
          item &&
          typeof item === "object" &&
          "id" in item &&
          "completed" in item &&
          item.completed === true &&
          typeof item.id === "string"
            ? [item.id]
            : [],
        )
      : [],
  );
  const seen = new Set<string>();
  return (meeting.evidence || [])
    .flatMap((evidence) => {
      if (
        evidence.sourceKind === "research" ||
        (evidence.category !== "commitment" && !preparationLanguage.test(evidence.quote)) ||
        /\b(do not|don.t|no need|not necessary|tak perlu|jangan)\b/iu.test(evidence.quote)
      )
        return [];
      const quote = normalise(evidence.quote);
      if (!quote || seen.has(quote)) return [];
      const segment = (meeting.transcript || []).find((segment) =>
        normalise(segment.text).includes(quote),
      );
      if (!segment) return [];
      seen.add(quote);
      const id = createHash("sha256")
        .update(`${quote}:${segment.sourceSpeaker || segment.speaker}`)
        .digest("hex")
        .slice(0, 24);
      return [
        {
          id,
          description: evidence.quote,
          sourceQuote: evidence.quote,
          speaker: segment.speaker,
          startSeconds: segment.startSeconds ?? null,
          completed: completed.has(id),
        },
      ];
    })
    .slice(0, 12);
}
