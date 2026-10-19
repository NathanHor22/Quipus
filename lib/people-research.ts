import type { SupabaseClient } from "@supabase/supabase-js";
import type { Contact } from "./types";

export type PersonResearchCandidate = {
  id: string;
  url: string;
  title: string;
  snippet: string;
  status: "candidate" | "confirmed" | "rejected";
  observed_at: string;
};

/** Allow only public LinkedIn profile URLs; reject lookalike hosts and other pages. */
export function linkedinProfileUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (
      url.hostname !== "linkedin.com" &&
      !/^[a-z]{2,3}\.linkedin\.com$/u.test(url.hostname) &&
      url.hostname !== "www.linkedin.com"
    )
      return null;
    if (!/^\/in\/[a-zA-Z0-9%_-]+\/?$/u.test(url.pathname)) return null;
    return `https://www.linkedin.com${url.pathname.replace(/\/$/u, "")}/`;
  } catch {
    return null;
  }
}

export async function findLinkedinCandidates(
  contact: Pick<Contact, "name" | "company" | "role">,
  options: { apiKey?: string; fetchImpl?: typeof fetch } = {},
) {
  const apiKey = options.apiKey ?? process.env.EXA_API_KEY;
  if (!apiKey) return [];
  const response = await (options.fetchImpl || fetch)("https://api.exa.ai/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    signal: AbortSignal.timeout(12_000),
    body: JSON.stringify({
      query: `${contact.name} ${contact.company || ""} ${contact.role || ""} LinkedIn professional profile`,
      type: "auto",
      numResults: 5,
      includeDomains: ["linkedin.com"],
      moderation: true,
      contents: { highlights: true },
    }),
  });
  if (!response.ok) throw new Error(`LinkedIn research unavailable (${response.status}).`);
  const payload = (await response.json()) as {
    results?: Array<{ url?: unknown; title?: unknown; highlights?: unknown }>;
  };
  const unique = new Map<string, { url: string; title: string; snippet: string }>();
  for (const result of (payload.results || []).slice(0, 10)) {
    const url = linkedinProfileUrl(result.url);
    if (!url || typeof result.title !== "string" || !result.title.trim()) continue;
    const snippet = Array.isArray(result.highlights)
      ? result.highlights
          .filter((item): item is string => typeof item === "string")
          .join(" ")
          .slice(0, 2_000)
      : "";
    unique.set(url, { url, title: result.title.trim().slice(0, 300), snippet });
  }
  return [...unique.values()].slice(0, 5);
}

export async function refreshPersonResearch(
  client: SupabaseClient,
  userId: string,
  contact: Contact,
  force = false,
) {
  const { data: existing, error } = await client
    .from("contact_research_candidates")
    .select("id,url,status,observed_at")
    .eq("user_id", userId)
    .eq("contact_id", contact.id);
  if (error) throw new Error("Person research storage is unavailable.");
  const interval = force ? 60 * 60_000 : 7 * 24 * 60 * 60_000;
  const checkedAt = new Date().toISOString();
  const cutoff = new Date(Date.now() - interval).toISOString();
  const claim = await client
    .from("contacts")
    .update({ research_checked_at: checkedAt })
    .eq("id", contact.id)
    .eq("user_id", userId)
    .or(`research_checked_at.is.null,research_checked_at.lt.${cutoff}`)
    .select("id")
    .maybeSingle();
  if (claim.error) throw new Error("Person research could not be reserved.");
  if (!claim.data) return;
  const candidates = await findLinkedinCandidates(contact);
  // Insert-only means a refresh cannot undo an owner's confirmation or rejection.
  const known = new Set((existing || []).map((row) => row.url));
  const fresh = candidates
    .filter((candidate) => !known.has(candidate.url))
    .map((candidate) => ({ ...candidate, user_id: userId, contact_id: contact.id }));
  if (!fresh.length) return;
  const saved = await client
    .from("contact_research_candidates")
    .upsert(fresh, { onConflict: "contact_id,url", ignoreDuplicates: true });
  if (saved.error) throw new Error("Person research could not be saved.");
}

/** Optional enrichment only: the core report must be ready before calling. */
export async function researchMeetingPeople(
  client: SupabaseClient,
  userId: string,
  meetingId: string,
): Promise<void> {
  if (!process.env.EXA_API_KEY) return;
  const meeting = await client
    .from("meetings")
    .select("id")
    .eq("id", meetingId)
    .eq("user_id", userId)
    .eq("status", "ready")
    .maybeSingle();
  if (meeting.error || !meeting.data) return;
  const links = await client
    .from("meeting_contacts")
    .select("contacts(*)")
    .eq("meeting_id", meetingId)
    .limit(5);
  if (links.error) throw new Error("Meeting participants could not be loaded.");
  // Deliberately bounded and sequential; optional searches never fan out without limit.
  for (const link of links.data || []) {
    const contact = (Array.isArray(link.contacts)
      ? link.contacts[0]
      : link.contacts) as unknown as Contact & { user_id: string };
    if (contact?.user_id === userId) await refreshPersonResearch(client, userId, contact);
  }
}
