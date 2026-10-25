import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSession, requireProductionPersistence } from "@/lib/api-security";
import { env } from "@/lib/env";
import { createMobileTicket, mobileChallengeSchema } from "@/lib/google-mobile-connect";
import { getGoogleOAuthConfig, requireApprovalSecret } from "@/lib/providers/google-calendar";
import { enforceUserRateLimit } from "@/lib/server-rate-limit";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "cache-control": "no-store, max-age=0" };
const inputSchema = z.object({ challenge: mobileChallengeSchema, gmail: z.boolean().default(false) }).strict();

function applicationOrigin(request: Request): string {
  const configured = env().NEXT_PUBLIC_APP_URL?.trim();
  return configured ? new URL(configured).origin : new URL(request.url).origin;
}

/** Starts the mobile Google connection: returns a two-minute browser ticket URL. */
export async function POST(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const client = getServerSupabase();
  const readinessError = requireProductionPersistence(Boolean(client), "Supabase credential persistence is required before connecting Google.");
  if (readinessError) return readinessError;
  const user = await getAuthenticatedLanternUser();
  if (!user || !client) return NextResponse.json({ error: "Sign in before connecting Google." }, { status: 401, headers });
  const limited = await enforceUserRateLimit(user.id, "google-mobile-connect", 10, 300);
  if (limited) return limited;
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Invalid connection request." }, { status: 400, headers });
  try {
    // Same profile preparation as the website flow; never overwrite the chosen name.
    const { error: profileError } = await client.from("profiles").upsert(
      { id: user.id, email: user.email || "", name: user.displayName },
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (profileError) return NextResponse.json({ error: "The Quipus profile could not be prepared for Google." }, { status: 503, headers });
    const secret = requireApprovalSecret(getGoogleOAuthConfig().approvalSecret);
    const ticket = createMobileTicket({ userId: user.id, includeGmail: input.data.gmail, challenge: input.data.challenge }, secret);
    const url = new URL("/api/google/mobile/authorize", applicationOrigin(request));
    url.searchParams.set("ticket", ticket);
    return NextResponse.json({ url: url.toString() }, { headers });
  } catch {
    return NextResponse.json({ error: "Google connection could not be started." }, { status: 503, headers });
  }
}
