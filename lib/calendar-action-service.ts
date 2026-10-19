import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  GoogleCalendarProviderError,
  buildGoogleCalendarInsert,
  createAuthorizedGoogleOAuthClient,
  createGoogleCalendarEvent,
  getGoogleOAuthConfig,
  googleCalendarEventSchema,
} from "@/lib/providers/google-calendar";
import {
  getServerSupabase,
} from "@/lib/supabase/server";
import {
  loadRelayMatchById,
  updateRelayMatchStatus,
} from "@/lib/relay-store";
import { relayCalendarApprovalMatches } from "@/lib/relay";




function internalIdempotencyKey(
  userId: string | null,
  input: z.output<typeof googleCalendarEventSchema>,
): string {
  const canonicalPayload = JSON.stringify({
    summary: input.summary,
    startAt: input.startAt,
    timeZone: input.timeZone ?? "Asia/Kuala_Lumpur",
    ...(input.durationMinutes !== 30 ? { durationMinutes: input.durationMinutes } : {}),
    attendees: [...input.attendees].sort(),
    description: input.description ?? null,
    location: input.location ?? null,
    conferenceUrl: input.conferenceUrl ?? null,
    meetingReference: input.clientReference ?? input.meetingId ?? null,
  });
  const callerKey = input.idempotencyKey ?? "canonical";
  return `calendar:${createHash("sha256")
    .update(`${userId ?? "environment"}\0${callerKey}\0${canonicalPayload}`)
    .digest("hex")}`;
}

function providerStatus(error: GoogleCalendarProviderError): number {
  if (error.code === "configuration" || error.code === "not_connected") {
    return 503;
  }
  if (error.code === "calendar_failure") return 502;
  return 500;
}

type ServerSupabase = NonNullable<ReturnType<typeof getServerSupabase>>;

async function persistCalendarMeeting(
  client: ServerSupabase,
  userId: string,
  input: z.output<typeof googleCalendarEventSchema>,
  event: {
    id: string;
    startAt: string;
    endAt: string;
  },
) {
  const clientReference = `calendar:${event.id}`;
  const { data: meeting, error } = await client
    .from("meetings")
    .upsert(
      {
        user_id: userId,
        calendar_event_id: event.id,
        client_reference: clientReference,
        title: input.summary,
        start_at: event.startAt,
        end_at: event.endAt,
        status: "upcoming",
        source: "calendar",
      },
      { onConflict: "user_id,client_reference" },
    )
    .select("id")
    .single();
  if (error || !meeting) {
    throw new Error("The Calendar event was created but Quipus could not save it.");
  }

  const { data: contacts, error: contactsError } = await client
    .from("contacts")
    .select("id")
    .eq("user_id", userId)
    .in("email", input.attendees);
  if (contactsError) throw new Error("Could not match Calendar attendees.");
  if (contacts?.length) {
    const { error: linkError } = await client.from("meeting_contacts").upsert(
      contacts.map((contact, index) => ({
        meeting_id: meeting.id,
        contact_id: contact.id,
        is_primary: index === 0,
      })),
      { onConflict: "meeting_id,contact_id" },
    );
    if (linkError) throw new Error("Could not link Calendar attendees.");
  }
  return clientReference;
}

export async function executeCalendarRequest(request: Request, authenticatedUserId: string) {
  let actionId: string | null = null;
  let ownerUserId: string | null = null;
  const client = getServerSupabase();

  try {
    const raw = (await request.json()) as unknown;
    if (
      !raw ||
      typeof raw !== "object" ||
      (raw as { approved?: unknown }).approved !== true
    ) {
      return NextResponse.json(
        { error: "Explicit approval is required before inviting attendees." },
        { status: 403 },
      );
    }
    let input = googleCalendarEventSchema.parse(raw);
    if ([input.meetingId, input.clientReference, input.followUpId].some((id) => id?.startsWith("sample:"))) {
      return NextResponse.json({ error: "Sample approvals cannot create real invitations." }, { status: 400 });
    }
    const config = getGoogleOAuthConfig();

    if (!client) {
      throw new GoogleCalendarProviderError(
        "Supabase action persistence is required.",
        "configuration",
      );
    }
    const userId = authenticatedUserId;
    if (!userId) {
      throw new GoogleCalendarProviderError(
        "Sign in before using Google Calendar.",
        "not_connected",
      );
    }
    ownerUserId = userId;
    if (!input.timeZone) {
      const { data: profile, error: profileError } = await client.from("profiles").select("timezone").eq("id", userId).maybeSingle();
      if (profileError) throw new Error("Your Calendar timezone could not be loaded.");
      input = googleCalendarEventSchema.parse({ ...input, timeZone: profile?.timezone ?? "Asia/Kuala_Lumpur" });
    }

    let relayMatch = null;
    if (input.relayMatchId) {
      if (!client || !userId) {
        return NextResponse.json(
          { error: "Relay scheduling requires Supabase persistence." },
          { status: 503 },
        );
      }
      relayMatch = await loadRelayMatchById(client, userId, input.relayMatchId);
      if (!relayMatch) {
        return NextResponse.json(
          { error: "The pending Relay proposal could not be found." },
          { status: 404 },
        );
      }
      if (!relayCalendarApprovalMatches(relayMatch, input)) {
        return NextResponse.json(
          { error: "The invitation does not match the reviewed Relay proposal." },
          { status: 409 },
        );
      }
    }

    const idempotencyKey = internalIdempotencyKey(userId, input);
    const googleEventId = idempotencyKey.slice("calendar:".length);
    let databaseMeetingId: string | null = null;
    let databaseFollowUpId: string | null = null;
    let followUpCompleted = false;
    let oauthClient: Awaited<ReturnType<typeof createAuthorizedGoogleOAuthClient>> | undefined;
    if (client && userId) {
      const meetingReference = input.clientReference ?? input.meetingId;
      if (meetingReference) {
        const { data: byReference, error: referenceError } = await client
          .from("meetings")
          .select("id")
          .eq("user_id", userId)
          .eq("client_reference", meetingReference)
          .maybeSingle();
        if (referenceError) throw new Error("Could not resolve the meeting reference.");
        databaseMeetingId = (byReference?.id as string | undefined) ?? null;
        if (!databaseMeetingId && z.string().uuid().safeParse(meetingReference).success) {
          const { data: byId, error: idError } = await client
            .from("meetings")
            .select("id")
            .eq("user_id", userId)
            .eq("id", meetingReference)
            .maybeSingle();
          if (idError) throw new Error("Could not resolve the meeting ID.");
          databaseMeetingId = (byId?.id as string | undefined) ?? null;
        }
      }
      if ((input.clientReference || input.meetingId) && !databaseMeetingId) {
        return NextResponse.json({ error: "The source conversation could not be found." }, { status: 404 });
      }
      if (input.followUpId && z.string().uuid().safeParse(input.followUpId).success) {
        const { data: followUp, error: followUpError } = await client
          .from("follow_ups")
          .select("id,meeting_id,status")
          .eq("user_id", userId)
          .eq("id", input.followUpId)
          .maybeSingle();
        if (followUpError) throw new Error("Could not resolve the follow-up ID.");
        databaseFollowUpId = (followUp?.id as string | undefined) ?? null;
        followUpCompleted = followUp?.status === "completed";
        if (!followUp || !databaseMeetingId || followUp.meeting_id !== databaseMeetingId || followUp.status === "dismissed") {
          return NextResponse.json({ error: "The pending approval could not be found for this conversation." }, { status: 404 });
        }
      }
      if (input.followUpId && !databaseFollowUpId) {
        return NextResponse.json({ error: "The approval could not be found." }, { status: 404 });
      }
      if (databaseFollowUpId) {
        const { data: claimed, error: claimError } = await client.from("actions").select("id,idempotency_key").eq("user_id", userId).eq("follow_up_id", databaseFollowUpId).eq("type", "calendar_event").maybeSingle();
        if (claimError) throw new Error("Could not check the approval's calendar action.");
        if (claimed && claimed.idempotency_key !== idempotencyKey) {
          return NextResponse.json({ error: "This approval has already been submitted with different details. Refresh your calendar before making changes." }, { status: 409 });
        }
      }
      const { data: existing, error: existingError } = await client
        .from("actions")
        .select("id,status,external_id")
        .eq("user_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existingError) throw new Error("Could not check the calendar action.");
      if (existing?.external_id) {
        actionId = existing.id as string;
        const existingEvent = buildGoogleCalendarInsert(input, config.calendarId);
        const meetingId = await persistCalendarMeeting(
          client,
          userId,
          input,
          {
            id: existing.external_id,
            startAt: existingEvent.startAt,
            endAt: existingEvent.endAt,
          },
        );
        const completedAt = new Date().toISOString();
        const { error: recoveryCompletionError } = await client
          .from("actions")
          .update({
            status: "completed",
            executed_at: completedAt,
            error_message: null,
          })
          .eq("id", existing.id)
          .eq("user_id", userId);
        if (recoveryCompletionError) throw new Error("Could not finish the recovered Calendar action log.");
        if (databaseFollowUpId) {
          const { error: followUpCompletionError } = await client
            .from("follow_ups")
            .update({ status: "completed", completed_at: completedAt })
            .eq("id", databaseFollowUpId)
            .eq("user_id", userId);
          if (followUpCompletionError) throw new Error("Could not complete the calendar follow-up.");
        }
        const scheduledRelayMatch =
          relayMatch && client && userId
            ? await updateRelayMatchStatus(client, userId, relayMatch.id, "scheduled")
            : null;
        return NextResponse.json({
          event: {
            id: existing.external_id,
            htmlLink: null,
            meetLink: null,
            summary: input.summary,
            startAt: existingEvent.startAt,
            endAt: existingEvent.endAt,
            timeZone: "Asia/Kuala_Lumpur",
            attendees: input.attendees,
          },
          meetingId,
          duplicate: true,
          ...(scheduledRelayMatch ? { relayMatch: scheduledRelayMatch } : {}),
        });
      }
      if (followUpCompleted) return NextResponse.json({ error: "This meeting approval has already been completed. Refresh your calendar." }, { status: 409 });
      if (!existing?.external_id && Date.parse(buildGoogleCalendarInsert(input).startAt) <= Date.now()) {
        return NextResponse.json({ error: "This meeting time has passed. Update the date before approving." }, { status: 400 });
      }
      // Missing or unreadable credentials must not reserve this approval. Once
      // the action is claimed, its original payload remains the retry boundary.
      oauthClient = await createAuthorizedGoogleOAuthClient({ config, client, userId });
      const actionPayload = {
        summary: input.summary,
        startAt: input.startAt,
        durationMinutes: input.durationMinutes,
        timeZone: "Asia/Kuala_Lumpur",
        attendees: input.attendees,
        location: input.location ?? null,
      };
      if (existing?.id) {
        actionId = existing.id as string;
        const { error } = await client
          .from("actions")
          .update({
            payload: actionPayload,
            status: "executing",
            approved_at: new Date().toISOString(),
            error_message: null,
          })
          .eq("id", actionId)
          .eq("user_id", userId);
        if (error) throw new Error("Could not update the calendar action.");
      } else {
        const { data: created, error } = await client
          .from("actions")
          .insert({
            user_id: userId,
            meeting_id: databaseMeetingId,
            follow_up_id: databaseFollowUpId,
            type: "calendar_event",
            provider: "google_calendar",
            payload: actionPayload,
            status: "executing",
            idempotency_key: idempotencyKey,
            approved_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (error || !created) {
          throw new Error("Could not record the calendar action.");
        }
        actionId = created.id as string;
      }
    }

    oauthClient ??= await createAuthorizedGoogleOAuthClient({
      config,
      client,
      userId,
    });
    const event = await createGoogleCalendarEvent(input, {
      oauthClient,
      calendarId: config.calendarId,
      eventId: googleEventId,
    });

    let meetingId: string | null = null;
    if (client && userId && actionId) {
      const completedAt = new Date().toISOString();
      const { error: executionRecordError } = await client
        .from("actions")
        .update({
          status: "executing",
          external_id: event.id,
          error_message: null,
        })
        .eq("id", actionId)
        .eq("user_id", userId);
      if (executionRecordError) {
        throw new Error("The Calendar event was created but its result could not be recorded.");
      }
      meetingId = await persistCalendarMeeting(client, userId, input, event);
      const { error: completionError } = await client
        .from("actions")
        .update({
          status: "completed",
          executed_at: completedAt,
          error_message: null,
        })
        .eq("id", actionId)
        .eq("user_id", userId);
      if (completionError) throw new Error("Could not finish the Calendar action log.");
      if (databaseFollowUpId) {
        const { error: followUpCompletionError } = await client
          .from("follow_ups")
          .update({ status: "completed", completed_at: completedAt })
          .eq("id", databaseFollowUpId)
          .eq("user_id", userId);
        if (followUpCompletionError) throw new Error("Could not complete the calendar follow-up.");
      }
    }

    const scheduledRelayMatch =
      relayMatch && client && userId
        ? await updateRelayMatchStatus(client, userId, relayMatch.id, "scheduled")
        : null;

    return NextResponse.json(
      {
        event,
        meetingId,
        duplicate: false,
        ...(scheduledRelayMatch ? { relayMatch: scheduledRelayMatch } : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    if (client && actionId && ownerUserId) {
      await client
        .from("actions")
        .update({
          status: "failed",
          error_message: "Google Calendar action failed.",
        })
        .eq("id", actionId)
        .eq("user_id", ownerUserId);
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid calendar invitation.", issues: error.flatten() },
        { status: 400 },
      );
    }
    if (error instanceof GoogleCalendarProviderError) {
      return NextResponse.json(
        { error: error.message },
        { status: providerStatus(error) },
      );
    }
    return NextResponse.json(
      { error: "The calendar invitation could not be created." },
      { status: 500 },
    );
  }
}

