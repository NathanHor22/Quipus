import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";
import { getServerSupabase } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { WHATSAPP_COMING_SOON, whatsappEnabled } from "@/lib/features";
import { deliveryPhone, deliverNextMeeting, queueMeetingDelivery } from "@/lib/meeting-delivery";

export const runtime = "nodejs";
export const maxDuration = 300;
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("configure"), enabled: z.boolean(), approved: z.literal(true) }).strict(),
  z.object({ action: z.literal("share"), meetingId: z.string().min(1).max(120), phone: deliveryPhone, approved: z.literal(true) }).strict(),
  z.object({ action: z.literal("retry"), id: z.string().uuid(), approved: z.literal(true) }).strict(),
]);
export async function GET() {
  if (!whatsappEnabled()) return NextResponse.json({ available: false, enabled: false, deliveries: [] });
  const user = await getAuthenticatedLanternUser();
  const client = getServerSupabase();
  if (!user || !client) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const available = user.id === process.env.WHATSAPP_OWNER_USER_ID;
  if (!available) return NextResponse.json({ available: false, enabled: false, deliveries: [] });
  const [preference, deliveries] = await Promise.all([
    client.from("meeting_delivery_preferences").select("enabled,phone").eq("user_id", user.id).maybeSingle(),
    client.from("meeting_deliveries").select("id,meeting_id,phone,state,last_error,sent_at").eq("user_id", user.id).order("available_at", { ascending: false }).limit(10),
  ]);
  if (preference.error || deliveries.error) return NextResponse.json({ error: "Apply the report delivery migration first." }, { status: 503 });
  return NextResponse.json({ available, enabled: preference.data?.enabled || false, phone: env().WHATSAPP_ALLOWED_RECIPIENT, deliveries: deliveries.data });
}
export async function POST(request: Request) {
  if (!whatsappEnabled()) return NextResponse.json({ error: WHATSAPP_COMING_SOON }, { status: 403 });
  const user = await getAuthenticatedLanternUser();
  const client = getServerSupabase();
  if (!user || !client) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (user.id !== process.env.WHATSAPP_OWNER_USER_ID) return NextResponse.json({ error: "WhatsApp delivery is not configured for this account." }, { status: 403 });
  try {
    const input = schema.parse(await request.json());
    if (input.action === "configure") {
      const { error } = await client.from("meeting_delivery_preferences").upsert({ user_id: user.id, phone: env().WHATSAPP_ALLOWED_RECIPIENT, enabled: input.enabled, approved_at: new Date().toISOString() });
      // Database error text can expose schema details; keep it server-side.
      if (error) throw new Error("Could not save the delivery preference.");
    } else if (input.action === "share") {
      await queueMeetingDelivery(client, user.id, input.meetingId, input.phone);
    } else {
      const { error } = await client.from("meeting_deliveries").update({ state: "queued", attempts: 0, available_at: new Date().toISOString() })
        .eq("id", input.id).eq("user_id", user.id).eq("state", "failed");
      if (error) throw new Error("Could not retry the delivery.");
    }
    after(() => deliverNextMeeting(client));
    return NextResponse.json({ accepted: true });
  } catch (error) {
    const message = error instanceof z.ZodError ? "Invalid delivery request."
      : error instanceof Error ? error.message : "Could not queue delivery.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
