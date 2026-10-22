import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  createDeviceSecret,
  hashLanternSecret,
  normalizePairingCode,
} from "@/lib/lantern-device-auth";
import { devicePairingFailure } from "@/lib/device-pairing-errors";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    pairingCode: z.string().trim().min(1).max(20),
    hardwareId: z.string().trim().min(8).max(120),
    model: z.string().trim().min(1).max(100),
    firmwareVersion: z.string().trim().min(1).max(80),
    credentialSecret: z
      .string()
      .regex(/^[A-Za-z0-9_-]{40,80}$/u)
      .optional(),
  })
  .strict();

type ClaimedLantern = {
  device_id: string;
  owner_id: string;
  device_name: string;
};

async function findRepeatedClaim(
  client: SupabaseClient,
  input: z.infer<typeof requestSchema>,
  codeHash: string,
  credentialHash: string,
): Promise<ClaimedLantern | null> {
  if (!input.credentialSecret) return null;

  const now = new Date().toISOString();
  const { data: pairing, error: pairingError } = await client
    .from("device_pairings")
    .select("user_id,device_name,claimed_device_id")
    .eq("code_hash", codeHash)
    .not("claimed_at", "is", null)
    .gt("expires_at", now)
    .maybeSingle();
  if (pairingError) throw new Error(pairingError.message);
  if (!pairing?.claimed_device_id) return null;

  const { data: device, error: deviceError } = await client
    .from("devices")
    .select("id,user_id,name")
    .eq("id", pairing.claimed_device_id)
    .eq("hardware_id", input.hardwareId)
    .eq("credential_hash", credentialHash)
    .is("revoked_at", null)
    .maybeSingle();
  if (deviceError) throw new Error(deviceError.message);
  if (!device || device.user_id !== pairing.user_id) return null;

  return {
    device_id: device.id,
    owner_id: device.user_id,
    device_name: device.name || pairing.device_name,
  };
}

async function claimWithQualifiedQueries(
  client: SupabaseClient,
  input: z.infer<typeof requestSchema>,
  codeHash: string,
  deviceId: string,
  credentialHash: string,
): Promise<ClaimedLantern | null> {
  const claimedAt = new Date().toISOString();
  const { data: pairing, error: pairingError } = await client
    .from("device_pairings")
    .update({ claimed_at: claimedAt })
    .eq("code_hash", codeHash)
    .is("claimed_at", null)
    .gt("expires_at", claimedAt)
    .select("id,user_id,device_name")
    .maybeSingle();
  if (pairingError) throw new Error(pairingError.message);
  if (!pairing) return null;

  let completed = false;
  try {
    const { data: existing, error: existingError } = await client
      .from("devices")
      .select("id,user_id,revoked_at,credential_hash")
      .eq("hardware_id", input.hardwareId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing && existing.user_id !== pairing.user_id) {
      throw new Error("Quipus hardware is already paired to another owner.");
    }
    if (existing && existing.revoked_at === null && existing.credential_hash) {
      throw new Error("Quipus hardware is already paired; revoke it before pairing again.");
    }

    let claimedDevice: { id: string; name: string } | null = null;
    if (existing) {
      const now = new Date().toISOString();
      const { error: sessionError } = await client
        .from("lantern_sessions")
        .update({ ended_at: now, updated_at: now })
        .eq("device_id", existing.id)
        .is("ended_at", null);
      if (sessionError) throw new Error(sessionError.message);

      const { data, error } = await client
        .from("devices")
        .update({
          name: pairing.device_name,
          model: input.model,
          firmware_version: input.firmwareVersion,
          credential_hash: credentialHash,
          paired_at: now,
          revoked_at: null,
          status: "online",
          device_state: "ready",
          state_version: 0,
          last_error: null,
          last_seen_at: now,
          updated_at: now,
        })
        .eq("id", existing.id)
        .select("id,name")
        .single();
      if (error || !data) throw new Error(error?.message || "Device reclaim failed.");
      claimedDevice = data;
    } else {
      const now = new Date().toISOString();
      const { data, error } = await client
        .from("devices")
        .insert({
          id: deviceId,
          user_id: pairing.user_id,
          name: pairing.device_name,
          hardware_id: input.hardwareId,
          model: input.model,
          firmware_version: input.firmwareVersion,
          credential_hash: credentialHash,
          paired_at: now,
          status: "online",
          device_state: "ready",
          last_seen_at: now,
        })
        .select("id,name")
        .single();
      if (error || !data) throw new Error(error?.message || "Device registration failed.");
      claimedDevice = data;
    }

    const { data: finished, error: finishError } = await client
      .from("device_pairings")
      .update({ claimed_device_id: claimedDevice.id })
      .eq("id", pairing.id)
      .eq("claimed_at", claimedAt)
      .select("id")
      .single();
    if (finishError || !finished) {
      throw new Error(finishError?.message || "Pairing completion failed.");
    }
    completed = true;
    return {
      device_id: claimedDevice.id,
      owner_id: pairing.user_id,
      device_name: claimedDevice.name,
    };
  } finally {
    if (!completed) {
      await client
        .from("device_pairings")
        .update({ claimed_at: null, claimed_device_id: null })
        .eq("id", pairing.id)
        .eq("claimed_at", claimedAt);
    }
  }
}

export async function POST(request: Request) {
  const client = getServerSupabase();
  if (!client) {
    return NextResponse.json(
      { error: "Quipus pairing is unavailable." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const input = requestSchema.parse(await request.json());
    const code = normalizePairingCode(input.pairingCode);
    const deviceId = randomUUID();
    // New firmware persists this secret before making the request. That makes
    // pairing safe to retry if Wi-Fi drops after the server claims the code but
    // before the ESP32 receives the response. Older firmware remains supported.
    const deviceSecret = input.credentialSecret || createDeviceSecret();
    const codeHash = hashLanternSecret(code);
    const credentialHash = hashLanternSecret(deviceSecret);
    const { data, error } = await client.rpc("claim_lantern_pairing", {
      p_code_hash: codeHash,
      p_device_id: deviceId,
      p_hardware_id: input.hardwareId,
      p_model: input.model,
      p_firmware_version: input.firmwareVersion,
      p_credential_hash: credentialHash,
    });
    const firstClaim = error
      ? /column reference ["']device_id["'] is ambiguous/i.test(error.message)
        ? await claimWithQualifiedQueries(
            client,
            input,
            codeHash,
            deviceId,
            credentialHash,
          )
        : (() => {
            throw error;
          })()
      : Array.isArray(data)
        ? data[0]
        : data;
    const claimed =
      firstClaim ||
      (await findRepeatedClaim(client, input, codeHash, credentialHash));
    if (!claimed?.device_id) {
      return NextResponse.json(
        { code: "PAIRING_CODE_EXPIRED", error: "The pairing code is invalid or has expired." },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        device: {
          id: claimed.device_id,
          ownerId: claimed.owner_id,
          name: claimed.device_name,
        },
        credential: {
          scheme: "Device",
          secret: deviceSecret,
        },
      },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const failure = devicePairingFailure(error);
    if (failure.status >= 500) {
      console.error("[device-claim]", error);
    } else {
      console.warn("[device-claim]", failure.code);
    }
    return NextResponse.json(
      { code: failure.code, error: failure.error },
      {
        status: failure.status,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
