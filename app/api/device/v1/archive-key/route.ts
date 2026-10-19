import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticateLantern } from "@/lib/lantern-device-auth";
import { getServerSupabase } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { wrapArchiveKey, unwrapArchiveKey } from "@/lib/device-archive-key";
import { enforceUserRateLimit } from "@/lib/server-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store, max-age=0", pragma: "no-cache" };
export async function GET(request: Request) {
  const client = getServerSupabase();
  if (!client)
    return NextResponse.json(
      { error: "Archive key storage is unavailable." },
      { status: 503, headers },
    );
  const device = await authenticateLantern(request, client);
  if (!device)
    return NextResponse.json({ error: "Invalid or revoked device." }, { status: 403, headers });
  const limited = await enforceUserRateLimit(device.id, "device-archive-key", 30, 300);
  if (limited) return limited;
  try {
    const secret = env().ACTION_APPROVAL_SECRET || "";
    const { data: existing, error } = await client
      .from("devices")
      .select("encrypted_archive_key")
      .eq("id", device.id)
      .eq("user_id", device.userId)
      .is("revoked_at", null)
      .maybeSingle();
    if (error || !existing) throw new Error();
    if (!existing.encrypted_archive_key) {
      const protectedKey = wrapArchiveKey(
        randomBytes(32).toString("hex"),
        device.userId,
        device.id,
        secret,
      );
      const { error: writeError } = await client
        .from("devices")
        .update({ encrypted_archive_key: protectedKey })
        .eq("id", device.id)
        .eq("user_id", device.userId)
        .is("revoked_at", null)
        .is("encrypted_archive_key", null);
      if (writeError) throw new Error();
    }
    // Re-read the winner of a concurrent first-request race; never return an unpersisted key.
    const { data: saved, error: readError } = await client
      .from("devices")
      .select("encrypted_archive_key")
      .eq("id", device.id)
      .eq("user_id", device.userId)
      .is("revoked_at", null)
      .maybeSingle();
    if (readError || !saved?.encrypted_archive_key) throw new Error();
    return NextResponse.json(
      {
        key: unwrapArchiveKey(saved.encrypted_archive_key, device.userId, device.id, secret),
        keyVersion: 1,
        ownerId: device.userId,
        deviceId: device.id,
      },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: "Archive key backup is unavailable. Existing recordings must be retained." },
      { status: 503, headers },
    );
  }
}
