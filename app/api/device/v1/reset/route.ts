import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateDeviceReset } from "@/lib/device-reset";
import { hashLanternSecret } from "@/lib/lantern-device-auth";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }).strict(),
  z.object({ action: z.literal("acknowledge"), resetId: z.string().uuid() }).strict(),
]);
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

export async function POST(request: Request) {
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return reply({ error: "Invalid device reset request." }, 400);
  const client = getServerSupabase();
  if (!client) return reply({ error: "Device reset is temporarily unavailable." }, 503);
  try {
    const authenticated = await authenticateDeviceReset(request, client);
    if (!authenticated) return reply({ error: "Device reset authentication required." }, 403);
    const { reset, authorization } = authenticated;
    if (input.data.action === "status") {
      if (!reset) return new Response(null, { status: 204, headers });
      return reply({ reset: {
        id: reset.id, deviceId: reset.device_id, mode: "factory", completed: reset.state === "completed",
      } });
    }
    if (!reset || input.data.resetId !== reset.id)
      return reply({ error: "Device reset request does not match." }, 409);
    const acknowledged = await client.rpc("acknowledge_quipus_device_reset", {
      p_reset_id: reset.id,
      p_device_id: authorization.deviceId,
      p_credential_hash: hashLanternSecret(authorization.secret),
    });
    if (acknowledged.error)
      return reply({ error: "Device reset could not be confirmed. Keep the reset journal and retry." }, 409);
    return reply({ resetComplete: true });
  } catch {
    return reply({ error: "Device reset is temporarily unavailable." }, 503);
  }
}
