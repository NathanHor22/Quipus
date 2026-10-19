import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateLantern } from "@/lib/lantern-device-auth";
import { getServerSupabase } from "@/lib/supabase/server";
const schema = z
  .object({
    transferId: z.string().uuid(),
    pendingRecordings: z.literal(0),
    readyForKeyErase: z.literal(true),
  })
  .strict();
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "cache-control": "no-store" };
  const client = getServerSupabase();
  if (!client)
    return NextResponse.json({ error: "Transfer is unavailable." }, { status: 503, headers });
  const device = await authenticateLantern(request, client);
  if (!device)
    return NextResponse.json({ error: "Invalid or revoked device." }, { status: 403, headers });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Local recordings must be safely resolved before transfer." },
      { status: 400, headers },
    );
  const { error } = await client.rpc("acknowledge_quipus_transfer", {
    p_transfer_id: parsed.data.transferId,
    p_device_id: device.id,
    p_user_id: device.userId,
  });
  return error
    ? NextResponse.json(
        { error: "Transfer is not ready. Preserve local recordings and retry." },
        { status: 409, headers },
      )
    : NextResponse.json({ transferred: true }, { headers });
}
