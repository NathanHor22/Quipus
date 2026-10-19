import { z } from "zod";
import { browserMutationError } from "@/lib/request-security";
import { enforceUserRateLimit } from "@/lib/server-rate-limit";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";
import { getServerSupabase } from "@/lib/supabase/server";
import { peopleJson } from "@/lib/people-api";
import { deriveMeetingPreparation } from "@/lib/meeting-preparation";
import { loadOwnedPreparationSource } from "@/lib/meeting-preparation-store";
import { venuePreferencesSchema, publicVenueUrl, type VenueOption } from "@/lib/venues";
import { researchVenues } from "@/lib/providers/venue-research";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const taskUpdateSchema = z
  .object({ requirementId: z.string().min(1).max(100), completed: z.boolean() })
  .strict();
const locationSchema = z
  .object({
    followUpId: z.string().uuid(),
    venueUrl: z.string().url().max(2000),
    venueName: z.string().trim().min(1).max(160),
  })
  .strict();

async function contextFor(request: Request, id: string) {
  const boundary = browserMutationError(request);
  if (boundary) return { response: peopleJson({ error: boundary.error }, boundary.status) };
  if (!id || id.length > 160) return { response: peopleJson({ error: "Invalid meeting." }, 400) };
  const user = await getAuthenticatedLanternUser();
  if (!user) return { response: peopleJson({ error: "Sign in to continue." }, 401) };
  const client = getServerSupabase();
  if (!client)
    return { response: peopleJson({ error: "Meeting preparation is unavailable." }, 503) };
  const limited = await enforceUserRateLimit(
    user.id,
    `preparation:${request.method}`,
    request.method === "POST" ? 3 : 60,
    300,
  );
  if (limited) return { response: limited };
  try {
    const meeting = await loadOwnedPreparationSource(client, user.id, id);
    if (!meeting) return { response: peopleJson({ error: "Meeting not found." }, 404) };
    const stored = await client
      .from("meeting_preparations")
      .select("requirements,venue_preferences,venue_results,researched_at")
      .eq("user_id", user.id)
      .eq("meeting_id", meeting.id)
      .maybeSingle();
    if (stored.error)
      return {
        response: peopleJson({ error: "Meeting preparation storage is unavailable." }, 503),
      };
    return { client, userId: user.id, meeting, stored: stored.data };
  } catch {
    return { response: peopleJson({ error: "Meeting preparation could not be loaded." }, 503) };
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextFor(request, (await params).id);
  if (context.response) return context.response;
  return peopleJson({
    requirements: deriveMeetingPreparation(context.meeting, context.stored?.requirements),
    preferences: context.stored?.venue_preferences || null,
    venues: context.stored?.venue_results || [],
    researchedAt: context.stored?.researched_at || null,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextFor(request, (await params).id);
  if (context.response) return context.response;
  if (context.meeting.status !== "ready")
    return peopleJson({ error: "Wait until this meeting report is ready." }, 409);
  const input = venuePreferencesSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return peopleJson({ error: "Check the area, party size and budget." }, 400);
  const { client, userId, meeting } = context;
  if (!process.env.EXA_API_KEY || !process.env.OPENAI_API_KEY)
    return peopleJson({ error: "Venue research is not connected yet." }, 503);
  const created = await client
    .from("meeting_preparations")
    .upsert(
      { user_id: userId, meeting_id: meeting.id },
      { onConflict: "user_id,meeting_id", ignoreDuplicates: true },
    );
  if (created.error) return peopleJson({ error: "Venue research could not be started." }, 503);
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const reserved = await client
    .from("meeting_preparations")
    .update({
      researched_at: now,
      venue_preferences: input.data,
      venue_results: [],
      updated_at: now,
    })
    .eq("user_id", userId)
    .eq("meeting_id", meeting.id)
    .or(`researched_at.is.null,researched_at.lt.${cutoff}`)
    .select("id")
    .maybeSingle();
  if (reserved.error) return peopleJson({ error: "Venue research could not be reserved." }, 503);
  if (!reserved.data)
    return peopleJson(
      { error: "Please wait five minutes before searching this meeting again." },
      429,
    );
  try {
    const venues = await researchVenues(input.data);
    const saved = await client
      .from("meeting_preparations")
      .update({ venue_results: venues, updated_at: new Date().toISOString() })
      .eq("id", reserved.data.id)
      .eq("user_id", userId)
      .eq("researched_at", now);
    if (saved.error) throw saved.error;
    return peopleJson({ venues, preferences: input.data, researchedAt: now });
  } catch {
    return peopleJson(
      { error: "Venue research could not finish. Your meeting report is unchanged." },
      503,
    );
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await contextFor(request, (await params).id);
  if (context.response) return context.response;
  const input = await request.json().catch(() => null);
  const task = taskUpdateSchema.safeParse(input);
  const { client, userId, meeting } = context;
  if (task.success) {
    const requirements = deriveMeetingPreparation(meeting, context.stored?.requirements);
    const requirement = requirements.find((item) => item.id === task.data.requirementId);
    if (!requirement)
      return peopleJson({ error: "Preparation item not found in this conversation." }, 404);
    const saved = await client.rpc("toggle_meeting_preparation_requirement", {
      p_user_id: userId,
      p_meeting_id: meeting.id,
      p_requirement_id: task.data.requirementId,
      p_completed: task.data.completed,
      p_derived: requirements,
    });
    return saved.error
      ? peopleJson({ error: "The checklist could not be saved." }, 503)
      : peopleJson({ requirements: saved.data });
  }
  const location = locationSchema.safeParse(input);
  if (!location.success) return peopleJson({ error: "Invalid preparation update." }, 400);
  const venues = Array.isArray(context.stored?.venue_results)
    ? (context.stored.venue_results as VenueOption[])
    : [];
  const chosen = venues.find(
    (venue) =>
      venue.sourceUrl === location.data.venueUrl &&
      venue.name === location.data.venueName &&
      publicVenueUrl(venue.sourceUrl),
  );
  if (!chosen || chosen.budget?.status === "over_budget")
    return peopleJson(
      { error: "Choose a researched venue within your budget, or verify its unknown price first." },
      400,
    );
  const followUp = await client
    .from("follow_ups")
    .select("id,schedule_details")
    .eq("id", location.data.followUpId)
    .eq("user_id", userId)
    .eq("meeting_id", meeting.id)
    .eq("type", "schedule")
    .eq("status", "pending")
    .maybeSingle();
  if (followUp.error || !followUp.data)
    return peopleJson({ error: "Pending meeting invitation not found." }, 404);
  const details = followUp.data.schedule_details;
  if (!details || typeof details !== "object")
    return peopleJson({ error: "Review the meeting details before choosing its location." }, 409);
  const saved = await client
    .from("follow_ups")
    .update({
      schedule_details: {
        ...details,
        location: chosen.address ? `${chosen.name}, ${chosen.address}` : chosen.name,
      },
    })
    .eq("id", followUp.data.id)
    .eq("user_id", userId)
    .eq("meeting_id", meeting.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  return saved.error || !saved.data
    ? peopleJson({ error: "The location could not be saved." }, 503)
    : peopleJson({ saved: true, approvalRequired: true });
}
