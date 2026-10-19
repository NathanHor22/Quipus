import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";
import { getServerSupabase } from "@/lib/supabase/server";
import { browserMutationError } from "@/lib/request-security";
import { enforceUserRateLimit } from "@/lib/server-rate-limit";

const json = (value: unknown, status = 200) =>
  NextResponse.json(value, { status, headers: { "cache-control": "no-store" } });
export const runtime = "nodejs";
async function handle(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const boundary = browserMutationError(request);
  if (boundary) return json({ error: boundary.error }, boundary.status);
  const user = await getAuthenticatedLanternUser(),
    client = getServerSupabase();
  if (!user) return json({ error: "Authentication required." }, 401);
  if (!client) return json({ error: "Device management is unavailable." }, 503);
  const id = z
    .string()
    .uuid()
    .safeParse((await params).id);
  if (!id.success) return json({ error: "Invalid device." }, 400);
  const limited = await enforceUserRateLimit(user.id, "device-transfer", 10, 300);
  if (limited) return limited;
  const { data: device, error } = await client
    .from("devices")
    .select("id")
    .eq("id", id.data)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return json({ error: "Device management is unavailable." }, 503);
  if (!device) return json({ error: "Device not found." }, 404);
  if (request.method === "POST") {
    const result = await client.rpc("request_quipus_transfer", {
      p_device_id: id.data,
      p_user_id: user.id,
    });
    return result.error
      ? json({ error: "Finish the current session before requesting transfer." }, 409)
      : json({ transfer: result.data });
  }
  if (request.method === "DELETE") {
    const result = await client
      .from("device_transfers")
      .update({ status: "cancelled" })
      .eq("device_id", id.data)
      .eq("user_id", user.id)
      .eq("status", "pending");
    return result.error
      ? json({ error: "Transfer could not be cancelled." }, 503)
      : json({ cancelled: true });
  }
  const result = await client
    .from("device_transfers")
    .select("id,status,expires_at,completed_at")
    .eq("device_id", id.data)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return result.error
    ? json({ error: "Transfer status is unavailable." }, 503)
    : json({ transfer: result.data });
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
