import { createHash } from "node:crypto";

import { type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireProductionPersistence } from "@/lib/api-security";
import { env } from "@/lib/env";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";
import { requireWhatsAppOwner } from "@/lib/whatsapp-owner-auth";

export const runtime = "nodejs";

const requestSchema = z.object({
  followUpId: z.string().trim().min(1).max(120),
  meetingId: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
  recipient: z.string().trim().min(8).max(24),
  approved: z.literal(true),
}).strict();

const uuidSchema = z.string().uuid();

class WhatsAppActionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WhatsAppActionError";
  }
}

function normalizeMalaysianPhone(value: string) {
  const digits = value.replace(/\D/gu, "");
  if (digits.startsWith("0")) return `6${digits}`;
  return digits;
}

function isUuid(value: string) {
  return uuidSchema.safeParse(value).success;
}

async function resolveOwnedMeeting(
  client: SupabaseClient,
  userId: string,
  reference: string,
): Promise<string | null> {
  let query = client.from("meetings").select("id").eq("user_id", userId);
  query = isUuid(reference)
    ? query.eq("id", reference)
    : query.eq("client_reference", reference);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("Could not resolve the meeting for this action.");
  return (data?.id as string | undefined) ?? null;
}

async function resolveOwnedFollowUp(
  client: SupabaseClient,
  userId: string,
  followUpId: string,
): Promise<{ id: string; meetingId: string } | null> {
  if (!isUuid(followUpId)) return null;
  const { data, error } = await client
    .from("follow_ups")
    .select("id,meeting_id")
    .eq("user_id", userId)
    .eq("id", followUpId)
    .maybeSingle();
  if (error) throw new Error("Could not resolve the follow-up for this action.");
  if (!data) return null;
  return { id: data.id as string, meetingId: data.meeting_id as string };
}

async function markFollowUpCompleted(
  client: SupabaseClient,
  userId: string,
  followUpId: string,
  completedAt: string,
) {
  const { data, error } = await client
    .from("follow_ups")
    .update({ status: "completed", completed_at: completedAt })
    .eq("id", followUpId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error("The message was delivered, but its follow-up could not be marked completed.");
  }
}

export async function POST(request: Request) {
  // The relay is the owner's linked WhatsApp account; other workspace users must not send through it.
  const authError = await requireWhatsAppOwner();
  if (authError) return authError;
  const client = getServerSupabase();
  const readinessError = requireProductionPersistence(
    Boolean(client),
    "Supabase action persistence is required before sending WhatsApp messages in production.",
  );
  if (readinessError) return readinessError;
  let userId: string | null = null;
  let actionId: string | null = null;
  let delivered = false;

  try {
    const input = requestSchema.parse(await request.json());
    const runtime = env();
    const recipient = normalizeMalaysianPhone(input.recipient);
    if (recipient !== runtime.WHATSAPP_ALLOWED_RECIPIENT) {
      throw new WhatsAppActionError(
        "This build can send only to the owner-approved WhatsApp number.",
        403,
      );
    }
    if (!runtime.WHATSAPP_RELAY_URL || !runtime.WHATSAPP_RELAY_TOKEN) {
      throw new WhatsAppActionError(
        "The persistent WhatsApp relay is not connected yet.",
        503,
      );
    }

    let databaseMeetingId: string | null = null;
    let databaseFollowUpId: string | null = null;
    if (client) {
      userId = await resolveWorkspaceUserId(client);
      if (userId) {
        databaseMeetingId = await resolveOwnedMeeting(client, userId, input.meetingId);
        const ownedFollowUp = await resolveOwnedFollowUp(client, userId, input.followUpId);

        // UUIDs represent persisted records. Never silently downgrade an
        // unowned UUID to a local action, as the service-role client bypasses RLS.
        if (isUuid(input.meetingId) && !databaseMeetingId) {
          throw new WhatsAppActionError("The meeting could not be found.", 404);
        }
        if (isUuid(input.followUpId) && !ownedFollowUp) {
          throw new WhatsAppActionError("The follow-up could not be found.", 404);
        }
        if (ownedFollowUp) {
          if (!databaseMeetingId) {
            throw new WhatsAppActionError("The follow-up's meeting could not be found.", 404);
          }
          if (ownedFollowUp.meetingId !== databaseMeetingId) {
            throw new WhatsAppActionError("The follow-up does not belong to this meeting.", 409);
          }
          databaseFollowUpId = ownedFollowUp.id;
        }
      } else if (isUuid(input.followUpId) || isUuid(input.meetingId)) {
        throw new WhatsAppActionError("The follow-up could not be found.", 404);
      }
    }

    // Including the owner in the digest prevents the globally unique database
    // key from ever colliding across users, while the worker still gets a stable
    // retry key for at-most-once delivery.
    const idempotencyKey = createHash("sha256")
      .update(`${userId ?? "local"}\0${input.followUpId}\0${recipient}\0${input.body}`)
      .digest("hex");

    if (client && userId) {
      const { data: existing, error: existingError } = await client
        .from("actions")
        .select("id,status,external_id")
        .eq("user_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existingError) throw new Error("Could not check the WhatsApp action audit log.");

      if (existing?.status === "completed") {
        actionId = existing.id as string;
        delivered = true;
        if (databaseFollowUpId) {
          await markFollowUpCompleted(
            client,
            userId,
            databaseFollowUpId,
            new Date().toISOString(),
          );
        }
        return NextResponse.json({
          ok: true,
          actionId,
          messageId: existing.external_id,
          duplicate: true,
        });
      }

      const actionPayload = { recipient, body: input.body };
      if (existing?.id) {
        actionId = existing.id as string;
        const { error } = await client
          .from("actions")
          .update({
            meeting_id: databaseMeetingId,
            follow_up_id: databaseFollowUpId,
            payload: actionPayload,
            status: "executing",
            approved_at: new Date().toISOString(),
            error_message: null,
          })
          .eq("id", actionId)
          .eq("user_id", userId);
        if (error) throw new Error("Could not update the WhatsApp action audit log.");
      } else {
        const { data: created, error } = await client
          .from("actions")
          .insert({
            user_id: userId,
            meeting_id: databaseMeetingId,
            follow_up_id: databaseFollowUpId,
            type: "send_message",
            provider: "baileys",
            payload: actionPayload,
            status: "executing",
            approved_at: new Date().toISOString(),
            idempotency_key: idempotencyKey,
          })
          .select("id")
          .single();
        if (error || !created) throw new Error("Could not write the WhatsApp action audit log.");
        actionId = created.id as string;
      }
    }

    const response = await fetch(new URL("/send", runtime.WHATSAPP_RELAY_URL), {
      method: "POST",
      headers: {
        authorization: `Bearer ${runtime.WHATSAPP_RELAY_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ to: recipient, text: input.body, idempotencyKey }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as {
      id?: string;
      error?: string;
      duplicate?: boolean;
    };
    if (!response.ok) {
      throw new WhatsAppActionError(
        payload.error || `WhatsApp relay failed with HTTP ${response.status}.`,
        502,
      );
    }
    delivered = true;

    const completedAt = new Date().toISOString();
    const messageId = payload.id || idempotencyKey;
    if (client && userId && actionId) {
      const { error } = await client
        .from("actions")
        .update({
          status: "completed",
          executed_at: completedAt,
          external_id: messageId,
          error_message: null,
        })
        .eq("id", actionId)
        .eq("user_id", userId);
      if (error) throw new Error("The message was delivered, but its action log could not be completed.");
      if (databaseFollowUpId) {
        await markFollowUpCompleted(client, userId, databaseFollowUpId, completedAt);
      }
    }

    return NextResponse.json({
      ok: true,
      actionId,
      messageId,
      duplicate: payload.duplicate || false,
    });
  } catch (error) {
    // A provider failure may be retried with the same key. Never downgrade a
    // completed action when delivery succeeded but a later persistence write did
    // not; the duplicate path repairs the follow-up on the next request.
    if (client && userId && actionId && !delivered) {
      await client
        .from("actions")
        .update({ status: "failed", error_message: "WhatsApp delivery failed." })
        .eq("id", actionId)
        .eq("user_id", userId);
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid WhatsApp action.", issues: error.flatten() },
        { status: 400 },
      );
    }
    if (error instanceof WhatsAppActionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "WhatsApp send failed." },
      { status: 502 },
    );
  }
}
