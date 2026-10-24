import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateLantern } from "@/lib/lantern-device-auth";
import {
  advanceLantern,
  createLanternMachine,
  lanternMachineSchema,
} from "@/lib/lantern-state";
import { stopAgoraLanternTranscription } from "@/lib/providers/agora-stt";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const requestSchema = z.object({ eventId: z.string().uuid() }).strict();

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
    const { data: replay, error: replayError } = await client
      .from("lantern_device_events")
      .select("event_type,machine")
      .eq("device_id", device.id)
      .eq("event_id", input.eventId)
      .maybeSingle();
    if (replayError) throw new Error(replayError.message);
    if (replay?.machine) {
      if (replay.event_type !== "RESET") {
        return noStore("That event ID already belongs to another action.", 409);
      }
      return NextResponse.json(
        { session: lanternMachineSchema.parse(replay.machine), duplicate: true },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const { data: active, error: activeError } = await client
      .from("lantern_sessions")
      .select("id,state_version,machine,agora_stt_agent_id")
      .eq("device_id", device.id)
      .eq("user_id", device.userId)
      .is("ended_at", null)
      .is("offline_import_fingerprint", null)
      .maybeSingle();
    if (activeError) throw new Error(activeError.message);

    const resetAt = new Date().toISOString();
    if (!active) {
      if (device.state === "ready") {
        return NextResponse.json(
          {
            session: { ...createLanternMachine("ready"), version: device.stateVersion },
            duplicate: false,
          },
          { headers: { "cache-control": "no-store" } },
        );
      }

      const ready = {
        ...createLanternMachine("ready"),
        version: device.stateVersion + 1,
      };
      const { data: updated, error: updateError } = await client
        .from("devices")
        .update({
          device_state: ready.state,
          state_version: ready.version,
          last_error: null,
          last_seen_at: resetAt,
          status: "online",
          updated_at: resetAt,
        })
        .eq("id", device.id)
        .eq("user_id", device.userId)
        .eq("state_version", device.stateVersion)
        .is("revoked_at", null)
        .select("id")
        .maybeSingle();
      if (updateError) throw new Error(updateError.message);
      if (!updated) return noStore("Quipus state changed. Hold to retry.", 409);
      return NextResponse.json(
        { session: ready, duplicate: false },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const current = lanternMachineSchema.parse(active.machine);
    if (Number(active.state_version) !== current.version) {
      return noStore("Quipus session state is stale. Hold to retry.", 409);
    }
    const ready = advanceLantern(current, { type: "RESET", at: resetAt });
    const { data: transitionRows, error: transitionError } = await client.rpc(
      "apply_lantern_transition",
      {
        p_session_id: active.id,
        p_user_id: device.userId,
        p_device_id: device.id,
        p_expected_version: current.version,
        p_state: ready.state,
        p_state_version: ready.version,
        p_machine: ready,
        p_event_id: input.eventId,
        p_event_type: "RESET",
        p_ended_at: resetAt,
      },
    );
    if (transitionError) throw new Error(transitionError.message);
    const transition = Array.isArray(transitionRows)
      ? transitionRows[0]
      : transitionRows;
    if (!transition?.applied) {
      return noStore("Quipus session changed. Hold to retry.", 409);
    }

    if (active.agora_stt_agent_id) {
      await stopAgoraLanternTranscription(active.agora_stt_agent_id).catch(
        (cause) =>
          console.warn(
            "[lantern-explicit-restart-stop-agora]",
            cause instanceof Error ? cause.message : cause,
          ),
      );
    }

    return NextResponse.json(
      {
        session: lanternMachineSchema.parse(transition.stored_machine || ready),
        duplicate: Boolean(transition.duplicate),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[lantern-explicit-restart]", error);
    return noStore(
      error instanceof z.ZodError
        ? "Quipus restart request is invalid."
        : "Quipus session could not restart.",
      error instanceof z.ZodError ? 400 : 500,
    );
  }
}
