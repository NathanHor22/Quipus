import { NextResponse } from "next/server";

import { requireAuthenticatedSession, requireProductionPersistence } from "@/lib/api-security";
import {
  GoogleCalendarProviderError,
  createGoogleAuthorizationUrl,
  createGoogleOAuthState,
  getGoogleOAuthConfig,
  requireApprovalSecret,
  readGoogleOAuthState,
} from "@/lib/providers/google-calendar";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  try {
    const client = getServerSupabase();
    const readinessError = requireProductionPersistence(
      Boolean(client),
      "Supabase credential persistence is required before connecting Google in production.",
    );
    if (readinessError) return readinessError;
    if (!client) {
      return NextResponse.json(
        { error: "Supabase must be configured before connecting Google." },
        { status: 503 },
      );
    }
    const user = await getAuthenticatedLanternUser();
    if (!user) {
      return NextResponse.json(
        { error: "Sign in before connecting Google Calendar." },
        { status: 401 },
      );
    }
    // Ensure users created before the multi-user trigger was installed have the
    // profile row required by provider_connections.
    const { error: profileError } = await client.from("profiles").upsert(
      {
        id: user.id,
        email: user.email || "",
        name: user.displayName,
      },
      // Reconnecting a provider must not overwrite the preferred Quipus name.
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (profileError) {
      return NextResponse.json(
        { error: "The Quipus profile could not be prepared for Google." },
        { status: 503 },
      );
    }

    const requestUrl = new URL(request.url);
    const config = getGoogleOAuthConfig();
    const state = createGoogleOAuthState(
      { userId: user.id, returnTo: requestUrl.searchParams.get("returnTo") },
      requireApprovalSecret(config.approvalSecret),
    );
    const authorizationUrl = createGoogleAuthorizationUrl(state, {
      config,
      loginHint: user.email || undefined,
      includeGmail: requestUrl.searchParams.get("gmail") === "1",
    });

    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set("quipus-google-oauth-nonce", readGoogleOAuthState(state, requireApprovalSecret(config.approvalSecret)).nonce, {
      httpOnly: true, secure: new URL(config.redirectUri).protocol === "https:",
      sameSite: "lax", path: "/api/google", maxAge: 600,
    });
    return response;
  } catch (error) {
    const status =
      error instanceof GoogleCalendarProviderError &&
      error.code === "configuration"
        ? 503
        : 500;
    return NextResponse.json(
      { error: "Google connection could not be started." },
      { status },
    );
  }
}
