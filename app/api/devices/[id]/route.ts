import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthenticatedSession } from "@/lib/api-security";
import { browserMutationError } from "@/lib/request-security";
import { enforceUserRateLimit } from "@/lib/server-rate-limit";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";
import { deviceResetState, supportsDeviceFactoryReset, type DeviceResetState } from "@/lib/device-reset";

export const runtime = "nodejs";
const paramsSchema = z.object({ id: z.string().uuid() }).strict();
const requestSchema = z.object({ action: z.literal("revoke") }).strict();
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const boundary = browserMutationError(request);
  if (boundary) return reply({ error: boundary.error }, boundary.status);
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const client = getServerSupabase();
  if (!client) return reply({ error: "Device reset is temporarily unavailable." }, 503);
  const params = paramsSchema.safeParse(await context.params);
  const input = requestSchema.safeParse(await request.json().catch(() => null));
  if (!params.success || !input.success) return reply({ error: "Quipus management request is invalid." }, 400);
  try {
    const userId = await resolveWorkspaceUserId(client);
    if (!userId) return reply({ error: "Authentication required." }, 401);
    const limited = await enforceUserRateLimit(userId, "device-reset", 10, 300);
    if (limited) return limited;
    const device = await client.from("devices").select("firmware_version")
      .eq("id", params.data.id).eq("user_id", userId).maybeSingle();
    if (device.error) return reply({ error: "Device status is temporarily unavailable." }, 503);
    if (!device.data) return reply({ error: "Quipus device was not found." }, 404);
    const { data, error } = await client.rpc("request_quipus_device_reset", {
      p_device_id: params.data.id, p_user_id: userId,
    });
    if (error) return error.code === "P0002"
      ? reply({ error: "Quipus device was not found." }, 404)
      : reply({ error: "Device reset is temporarily unavailable. Check the reset database migration." }, 503);
    const reset = (Array.isArray(data) ? data[0] : data) as {
      reset_id: string | null; reset_state: DeviceResetState;
    } | null;
    if (!reset || !["pending", "completed", "recovery_required"].includes(reset.reset_state))
      return reply({ error: "Device reset could not be confirmed." }, 503);
    const resetState = deviceResetState(reset.reset_state, device.data.firmware_version);
    return reply({ revoked: true, deviceId: params.data.id, resetId: reset.reset_id,
      resetPending: resetState !== "completed", resetState,
      resetSupported: supportsDeviceFactoryReset(device.data.firmware_version) });
  } catch {
    return reply({ error: "Device reset is temporarily unavailable." }, 503);
  }
}
