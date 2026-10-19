import type { SupabaseClient } from "@supabase/supabase-js";
import { researchCompaniesForMeeting } from "./company-research";
import { researchMeetingPeople } from "./people-research";

/** Optional research is leased separately and cannot delay or fail the core report. */
export async function processNextMeetingEnrichment(client: SupabaseClient): Promise<boolean> {
  const claimed = await client.rpc("claim_quipus_meeting_enrichment");
  if (claimed.error) throw new Error("Could not claim optional meeting research.");
  const job = claimed.data?.[0];
  if (!job) return false;
  const update = async (values: Record<string, unknown>) => {
    const saved = await client
      .from("quipus_meeting_enrichment_jobs")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("meeting_id", job.meeting_id)
      .eq("user_id", job.user_id)
      .eq("state", "running")
      .eq("lease_token", job.lease_token)
      .gt("lease_until", new Date().toISOString())
      .select("meeting_id")
      .maybeSingle();
    if (saved.error || !saved.data) throw new Error("Optional research lease was lost.");
  };
  const heartbeat = setInterval(() => {
    void update({ lease_until: new Date(Date.now() + 6 * 60_000).toISOString() }).catch(() => {
      /* The next fenced write or lease recovery handles the outage. */
    });
  }, 60_000);
  heartbeat.unref?.();
  try {
    if (job.attempts > 3) throw new Error("Optional research exceeded its retry limit.");
    const meeting = await client
      .from("meetings")
      .select("id")
      .eq("id", job.meeting_id)
      .eq("user_id", job.user_id)
      .eq("status", "ready")
      .maybeSingle();
    if (meeting.error || !meeting.data) throw new Error("Completed meeting was not found.");
    const links = await client
      .from("meeting_contacts")
      .select("contacts(company,user_id)")
      .eq("meeting_id", job.meeting_id)
      .limit(5);
    if (links.error) throw new Error("Could not load meeting companies.");
    const companies: string[] = [];
    for (const link of links.data || []) {
      const contact = (Array.isArray(link.contacts) ? link.contacts[0] : link.contacts) as {
        company?: string;
        user_id?: string;
      } | null;
      if (contact && contact.user_id === job.user_id && contact.company)
        companies.push(contact.company);
    }
    const sources = await researchCompaniesForMeeting(companies);
    await update({});
    if (sources.length) {
      const saved = await client.from("meeting_research_sources").upsert(
        sources.map((source) => ({
          user_id: job.user_id,
          meeting_id: job.meeting_id,
          company: source.company,
          title: source.title,
          url: source.url,
          snippet: source.snippet,
          published_date: source.publishedDate,
        })),
        { onConflict: "meeting_id,url" },
      );
      if (saved.error) throw new Error("Could not save public company sources.");
    }
    await researchMeetingPeople(client, job.user_id, job.meeting_id);
    await update({ state: "ready", lease_until: null, last_error: null });
  } catch {
    // Never store provider responses or conversation contents in queue error fields.
    await update({
      state: job.attempts >= 3 ? "failed" : "queued",
      lease_until: null,
      available_at: new Date(Date.now() + Math.min(job.attempts, 3) * 60_000).toISOString(),
      last_error: "Optional research was not completed. The meeting report is still available.",
    });
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
