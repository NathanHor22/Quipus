import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSession } from "@/lib/api-security";
import { checkGoogleConnection } from "@/lib/google-connection";
import { MobileGoogleConnectError, mobileVerifierSchema, openMobileResult } from "@/lib/google-mobile-connect";
import { getGoogleOAuthConfig, persistGoogleCredentials, requireApprovalSecret } from "@/lib/providers/google-calendar";
import { enforceUserRateLimit } from "@/lib/server-rate-limit";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "cache-control": "no-store, max-age=0" };
const inputSchema = z.object({ result: z.string().min(1).max(16_384), verifier: mobileVerifierSchema }).strict();

/** Saves a sealed mobile Google result for the signed-in user who holds its verifier. */
export async function POST(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const user = await getAuthenticatedLanternUser();
  const client = getServerSupabase();
  if (!user || !client) return NextResponse.json({ error: "Sign in before connecting Google." }, { status: 401, headers });
  const limited = await enforceUserRateLimit(user.id, "google-mobile-complete", 10, 300);
  if (limited) return limited;
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Invalid connection result." }, { status: 400, headers });
  try {
    const secret = requireApprovalSecret(getGoogleOAuthConfig().approvalSecret);
    const credentials = openMobileResult(input.data.result, { userId: user.id, verifier: input.data.verifier }, secret);
    await persistGoogleCredentials(client, user.id, credentials, secret);
    const connection = await checkGoogleConnection(client, user.id);
    return NextResponse.json(connection, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof MobileGoogleConnectError ? error.message : "The Google connection could not be saved." },
      { status: error instanceof MobileGoogleConnectError ? 400 : 503, headers },
    );
  }
}
