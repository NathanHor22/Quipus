import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";
import { getServerSupabase } from "@/lib/supabase/server";
import { validTimezone } from "@/lib/quipus-profile";

export const dynamic = "force-dynamic";
const schema = z.object({
  preferredName: z.string().trim().min(1).max(80).refine(v => !/[\u0000-\u001f]/u.test(v), "Enter a name without control characters."),
  timezone: z.string().max(80).refine(v => validTimezone(v) === v, "Choose a recognised timezone.").optional(),
}).strict();

/** The same profile name and timezone the web greeting and paired-device voice use. */
export async function GET() {
  const headers = { "cache-control": "no-store" };
  const user = await getAuthenticatedLanternUser();
  if (!user) return NextResponse.json({ error: "Sign in to view your profile." }, { status: 401, headers });
  const client = getServerSupabase();
  if (!client) return NextResponse.json({ error: "Profile storage is unavailable." }, { status: 503, headers });
  const { data, error } = await client.from("profiles").select("name,timezone").eq("id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Your profile could not be loaded." }, { status: 500, headers });
  return NextResponse.json({
    name: data?.name || user.displayName,
    email: user.email,
    timezone: data?.timezone || null,
  }, { headers });
}

export async function PATCH(request: Request) {
  const headers = { "cache-control": "no-store" };
  const user = await getAuthenticatedLanternUser();
  if (!user) return NextResponse.json({ error: "Sign in to update your profile." }, { status: 401, headers });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers });
  try {
    const input = schema.parse(await request.json());
    const client = getServerSupabase();
    if (!client) return NextResponse.json({ error: "Profile storage is unavailable." }, { status: 503, headers });
    // Profile name is authoritative for both the web greeting and paired-device voice.
    const { data, error } = await client.from("profiles").update({ name: input.preferredName, ...(input.timezone ? { timezone: input.timezone } : {}) })
      .eq("id", user.id).select("name,timezone").maybeSingle();
    if (error || !data) throw new Error("Your profile could not be updated. Reopen your workspace and try again.");
    return NextResponse.json({ name: data.name, timezone: data.timezone }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? error.issues[0]?.message : "Your profile could not be saved." }, { status: error instanceof z.ZodError ? 400 : 500, headers });
  }
}
