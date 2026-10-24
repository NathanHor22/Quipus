import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateLantern } from "@/lib/lantern-device-auth";
import { conversationClock } from "@/lib/conversation-clock";
import { env } from "@/lib/env";
import {
  advanceLantern,
  createLanternMachine,
  lanternMachineSchema,
  RECORDING_CONSENT_WINDOW_MS,
} from "@/lib/lantern-state";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    eventId: z.string().uuid(),
    mode: z.enum(["quick", "status"]),
  })
  .strict();

function noStore(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const client = getServerSupabase();
  if (!client) return noStore("Quipus service is unavailable.", 503);
  const device = await authenticateLantern(request, client);
  if (!device) return noStore("Device credential is invalid or revoked.", 403);

  try {
    const input = requestSchema.parse(await request.json());
    const { data: replay } = await client
      .from("lantern_device_events")
      .select("event_type,machine")
      .eq("device_id", device.id)
      .eq("event_id", input.eventId)
      .maybeSingle();
    if (replay?.machine) {
      const expectedType = input.mode === "quick" ? "BEGIN_QUICK" : "BEGIN_STATUS";
      if (replay.event_type !== expectedType) {
        return noStore("That event ID already belongs to another action.", 409);
      }
      return NextResponse.json(
        { session: lanternMachineSchema.parse(replay.machine), duplicate: true },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const { data: activeData, error: activeError } = await client
      .from("lantern_sessions")
      .select("id,state,state_version,machine,recording_id,processing_error")
      .eq("device_id", device.id)
      .eq("user_id", device.userId)
      .is("ended_at", null)
      .is("offline_import_fingerprint", null)
      .maybeSingle();
    if (activeError) throw new Error(activeError.message);
    let active = activeData;

    // Releases sessions created by older deployments that archived audio but
    // became stuck after the AI processing step failed.
    let effectiveDeviceState = device.state;
    if (
      active?.recording_id &&
      active.processing_error &&
      (active.state === "finalising" || active.state === "processing")
    ) {
      const current = lanternMachineSchema.parse(active.machine);
      const recoveredAt = new Date().toISOString();
      const ready = advanceLantern(current, { type: "RESET", at: recoveredAt });
      const { data: rows, error: recoveryError } = await client.rpc(
        "apply_lantern_transition",
        {
          p_session_id: active.id,
          p_user_id: device.userId,
          p_device_id: device.id,
          p_expected_version: Number(active.state_version),
          p_state: ready.state,
          p_state_version: ready.version,
          p_machine: ready,
          p_event_id: randomUUID(),
          p_event_type: "RESET",
          p_ended_at: recoveredAt,
        },
      );
      if (recoveryError) throw new Error(recoveryError.message);
      const recovery = Array.isArray(rows) ? rows[0] : rows;
      if (!recovery?.applied) {
        return noStore("Quipus recovery changed. Please retry.", 409);
      }
      active = null;
      effectiveDeviceState = "ready";
    }

    if (effectiveDeviceState !== "ready" && effectiveDeviceState !== "report_ready") {
      return noStore(`Quipus cannot start while it is ${effectiveDeviceState}.`, 409);
    }
    if (active) {
      return noStore(
        `Quipus already has an active ${active.state} session.`,
        409,
      );
    }

    const now = new Date();
    const sessionId = randomUUID();
    const machine =
      input.mode === "quick"
        ? advanceLantern(createLanternMachine("ready"), {
            type: "BEGIN_QUICK",
            at: now.toISOString(),
            sessionId,
            promptId: randomUUID(),
            promptExpiresAt: new Date(now.getTime() + RECORDING_CONSENT_WINDOW_MS).toISOString(),
          })
        : advanceLantern(createLanternMachine("ready"), {
            type: "BEGIN_STATUS",
            at: now.toISOString(),
            sessionId,
          });

    const { error: sessionError } = await client.rpc("start_lantern_session", {
      p_session_id: sessionId,
      p_user_id: device.userId,
      p_device_id: device.id,
      p_mode: input.mode,
      p_state: machine.state,
      p_state_version: machine.version,
      p_machine: machine,
      p_event_id: input.eventId,
      p_event_type: input.mode === "quick" ? "BEGIN_QUICK" : "BEGIN_STATUS",
      p_started_at: now.toISOString(),
    });
    if (sessionError) {
      if (sessionError.code === "23505") {
        return noStore("Quipus already has an active session.", 409);
      }
      throw new Error(sessionError.message);
    }

    const timezone = env().APP_TIMEZONE;
    const { error: contextError } = await client
      .from("lantern_sessions")
      .update({ conversation_timezone: timezone })
      .eq("id", sessionId)
      .eq("device_id", device.id);
    if (contextError) throw new Error(contextError.message);

    return NextResponse.json(
      {
        session: machine,
        clock: conversationClock(now, timezone),
        duplicate: false,
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[lantern-session-start]", error);
    return noStore(
      error instanceof z.ZodError
        ? "Quipus session request is invalid."
        : "Quipus session could not start.",
      error instanceof z.ZodError ? 400 : 500,
    );
  }
}
