import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { deriveMeetingPreparation } from "../lib/meeting-preparation";
import { loadOwnedPreparationSource } from "../lib/meeting-preparation-store";
import { reviewVenueBudget, publicVenueUrl, type VenuePreferences } from "../lib/venues";
import { groundedVenueOptions, researchVenues } from "../lib/providers/venue-research";
import type { MeetingEvidence } from "../lib/types";

const preferences: VenuePreferences = {
  area: "Bangsar",
  kind: "coffee",
  partySize: 3,
  budgetMyr: 50,
  budgetBasis: "total",
  setting: "any",
  quietPreferred: true,
};
const evidence = (quote: string, changes: Partial<MeetingEvidence> = {}): MeetingEvidence => ({
  category: "commitment",
  statement: "A model interpretation",
  speaker: "Speaker 1",
  startSeconds: 1,
  endSeconds: 4,
  quote,
  confidence: 0.9,
  importance: 4,
  ...changes,
});

test("preparation keeps sourced requests and completion but omits unsupported, negative and research-only requirements", () => {
  const meeting = {
    transcript: [
      {
        speaker: "Speaker 1",
        text: "Please bring your supervisor and a demo. Do not bring the old presentation.",
        startSeconds: 1,
      },
    ],
    evidence: [
      evidence("Please bring your supervisor and a demo."),
      evidence("Invented: bring a contract"),
      evidence("Do not bring the old presentation."),
      evidence("Please bring your supervisor and a demo.", { sourceKind: "research" }),
    ],
  };
  const result = deriveMeetingPreparation(meeting);
  assert.equal(result.length, 1);
  assert.equal(result[0].description, "Please bring your supervisor and a demo.");
  assert.equal(result[0].sourceQuote, result[0].description);
  assert.equal(
    deriveMeetingPreparation(meeting, [{ ...result[0], completed: true }])[0].completed,
    true,
  );
  assert.equal(
    deriveMeetingPreparation(meeting, [{ id: "invented", completed: true }])[0].completed,
    false,
  );
});

test("budgets use integer cents, distinguish total from per-person, and never approve unknown prices", () => {
  assert.deepEqual(reviewVenueBudget(preferences, 20), {
    status: "over_budget",
    estimatedTotalMyr: 60,
    maximumTotalMyr: 50,
  });
  assert.equal(
    reviewVenueBudget({ ...preferences, budgetBasis: "per_person" }, 20).status,
    "within_budget",
  );
  assert.equal(
    reviewVenueBudget({ ...preferences, partySize: 3, budgetMyr: 29.97 }, 9.99).status,
    "within_budget",
  );
  assert.equal(reviewVenueBudget(preferences, null).status, "unknown");
  assert.equal(reviewVenueBudget(preferences, Number.NaN).status, "unknown");
});

const source = {
  url: "https://example.com/cafe",
  title: "Acme Cafe",
  text: "Acme Cafe is at 12 Jalan Example. Meeting set RM20 per person. Rated 4.2 by this guide. Located in a shopping mall.",
  publishedAt: "2026-09-01",
};
const venue = {
  name: "Acme Cafe",
  sourceIndex: 0,
  address: "12 Jalan Example",
  setting: "mall",
  settingQuote: "Located in a shopping mall.",
  pricePerPersonMyr: 20,
  priceQuote: "Meeting set RM20 per person.",
  ratingQuote: "Rated 4.2 by this guide.",
};

test("venue facts require source quotes; traffic and crowds stay unknown and unsupported places disappear", () => {
  const result = groundedVenueOptions(
    { venues: [venue, { ...venue, name: "Invented Cafe" }] },
    [source],
    preferences,
    "2026-10-18T00:00:00Z",
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].address, venue.address);
  assert.equal(result[0].traffic, "unknown");
  assert.equal(result[0].crowds, "unknown");
  assert.equal(result[0].budget.status, "over_budget");
  const unsupported = groundedVenueOptions(
    {
      venues: [
        {
          ...venue,
          address: "Invented road",
          priceQuote: "RM1 per person",
          pricePerPersonMyr: 1,
          settingQuote: "made up mall",
          ratingQuote: "Rated 5 stars",
        },
      ],
    },
    [source],
    preferences,
    "now",
  )[0];
  assert.equal(unsupported.address, null);
  assert.equal(unsupported.pricePerPersonMyr, null);
  assert.equal(unsupported.setting, "unknown");
  assert.equal(unsupported.ratingQuote, null);
  assert.equal(unsupported.budget.status, "unknown");
  const coffee = { ...source, text: "Acme Cafe. Coffee RM12 each." };
  assert.equal(
    groundedVenueOptions(
      { venues: [{ ...venue, pricePerPersonMyr: 12, priceQuote: "Coffee RM12 each." }] },
      [coffee],
      preferences,
      "now",
    )[0].pricePerPersonMyr,
    null,
  );
});

test("venue research sends only selected preferences and rejects unsafe source URLs", async () => {
  for (const url of [
    "https://127.0.0.1/private",
    "https://192.168.1.1/",
    "https://user:password@example.com",
    "javascript:alert(1)",
    "https://intranet.local/",
  ])
    assert.equal(publicVenueUrl(url), null);
  let requests = 0;
  const results = await researchVenues(preferences, {
    exaApiKey: "test-exa",
    openaiApiKey: "test-openai",
    fetchImpl: async (request, init) => {
      requests++;
      const body = JSON.parse(String(init?.body));
      if (String(request).includes("exa.ai")) {
        assert.equal(body.numResults, 5);
        assert.equal(body.query.includes("Bangsar"), true);
        return Response.json({
          results: [{ url: source.url, title: source.title, text: source.text }],
        });
      }
      assert.equal(body.store, false);
      assert.equal(JSON.parse(body.input).preferences.area, "Bangsar");
      return Response.json({ output_text: JSON.stringify({ venues: [venue] }) });
    },
  });
  assert.equal(requests, 2);
  assert.equal(results.length, 1);
});

test("preparation lookup refuses another owner's meeting before reading any evidence", async () => {
  let calls = 0;
  const client = createClient("https://test.invalid", "test-service-role", {
    auth: { persistSession: false },
    global: {
      fetch: async (request) => {
        calls++;
        const url = new URL(String(request));
        assert.equal(url.searchParams.get("user_id"), "eq.owner-b");
        return Response.json([]);
      },
    },
  });
  assert.equal(
    await loadOwnedPreparationSource(client, "owner-b", "11111111-1111-4111-8111-111111111111"),
    null,
  );
  assert.equal(calls, 1);
});
