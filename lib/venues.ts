import { z } from "zod";

export const venuePreferencesSchema = z
  .object({
    area: z.string().trim().min(2).max(120),
    kind: z.enum(["coffee", "lunch", "dinner", "meeting_room"]),
    partySize: z.number().int().min(1).max(20),
    budgetMyr: z.number().finite().positive().max(10_000),
    budgetBasis: z.enum(["total", "per_person"]),
    setting: z.enum(["any", "mall", "shoplot"]),
    quietPreferred: z.boolean(),
  })
  .strict();
export type VenuePreferences = z.infer<typeof venuePreferencesSchema>;
export type VenueBudgetReview = {
  status: "within_budget" | "over_budget" | "unknown";
  estimatedTotalMyr: number | null;
  maximumTotalMyr: number;
};
export type VenueOption = {
  name: string;
  address: string | null;
  setting: "mall" | "shoplot" | "unknown";
  pricePerPersonMyr: number | null;
  priceQuote: string | null;
  ratingQuote: string | null;
  sourceUrl: string;
  sourceTitle: string;
  observedAt: string;
  publishedAt: string | null;
  traffic: "unknown";
  crowds: "unknown";
  budget: VenueBudgetReview;
};

/** Integer cents avoid currency rounding errors; unknown prices never pass a budget. */
export function reviewVenueBudget(
  preferences: VenuePreferences,
  pricePerPersonMyr: number | null,
): VenueBudgetReview {
  const maximumCents =
    Math.round(preferences.budgetMyr * 100) *
    (preferences.budgetBasis === "per_person" ? preferences.partySize : 1);
  if (pricePerPersonMyr === null || !Number.isFinite(pricePerPersonMyr) || pricePerPersonMyr < 0)
    return { status: "unknown", estimatedTotalMyr: null, maximumTotalMyr: maximumCents / 100 };
  const estimatedCents = Math.round(pricePerPersonMyr * 100) * preferences.partySize;
  return {
    status: estimatedCents <= maximumCents ? "within_budget" : "over_budget",
    estimatedTotalMyr: estimatedCents / 100,
    maximumTotalMyr: maximumCents / 100,
  };
}

export function publicVenueUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname.includes(".") ||
      /^(?:[0-9.]+|\[)/u.test(url.hostname) ||
      /\.(local|internal|localhost)$/iu.test(url.hostname)
    )
      return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
