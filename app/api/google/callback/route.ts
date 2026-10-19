import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requireAuthenticatedSession, requireProductionPersistence } from "@/lib/api-security";
import { env } from "@/lib/env";
import { checkGoogleConnection } from "@/lib/google-connection";
import {
  exchangeGoogleAuthorizationCode,
  getGoogleOAuthConfig,
  persistGoogleCredentials,
  readGoogleOAuthState,
  requireApprovalSecret,
  sanitizeGoogleReturnTo,
} from "@/lib/providers/google-calendar";
import {
  getServerSupabase,
  resolveWorkspaceUserId,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function applicationOrigin(request: Request): string {
  const configured = env().NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return new URL(configured).origin;
  return new URL(request.url).origin;
}

function resultRedirect(
  request: Request,
  returnTo: string,
  result: "connected" | "denied" | "error",
) {
  const destination = new URL(
    sanitizeGoogleReturnTo(returnTo),
    applicationOrigin(request),
  );
  destination.searchParams.set("google", result);
  const response = NextResponse.redirect(destination);
  response.cookies.set("quipus-google-oauth-nonce", "", { httpOnly: true, sameSite: "lax",
    secure: destination.protocol === "https:", path: "/api/google", maxAge: 0 });
  return response;
}

export async function GET(request: Request) {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const readinessError = requireProductionPersistence(
    Boolean(getServerSupabase()),
    "Supabase credential persistence is required to complete Google connection in production.",
  );
  if (readinessError) return readinessError;
  const requestUrl = new URL(request.url);
  const encryptedState = requestUrl.searchParams.get("state");
  let returnTo = "/";

  try {
    const config = getGoogleOAuthConfig();
    const approvalSecret = requireApprovalSecret(config.approvalSecret);
    if (!encryptedState) return resultRedirect(request, returnTo, "error");

    const state = readGoogleOAuthState(encryptedState, approvalSecret);
    returnTo = state.returnTo;
    const nonce = (await cookies()).get("quipus-google-oauth-nonce")?.value ?? "";
    if (nonce.length !== state.nonce.length || !timingSafeEqual(Buffer.from(nonce), Buffer.from(state.nonce))) {
      return resultRedirect(request, returnTo, "error");
    }
    if (requestUrl.searchParams.has("error")) {
      return resultRedirect(request, returnTo, "denied");
    }

    const code = requestUrl.searchParams.get("code");
    if (!code) return resultRedirect(request, returnTo, "error");

    const client = getServerSupabase();
    if (!client) return resultRedirect(request, returnTo, "error");
    const resolvedUserId = await resolveWorkspaceUserId(client);
    if (!resolvedUserId || resolvedUserId !== state.userId) {
      return resultRedirect(request, returnTo, "error");
    }

    const credentials = await exchangeGoogleAuthorizationCode(code, { config });
    await persistGoogleCredentials(
      client,
      state.userId,
      credentials,
      approvalSecret,
    );
    const connection = await checkGoogleConnection(client, state.userId);
    return resultRedirect(request, returnTo, connection.state === "connected" ? "connected" : "error");
  } catch {
    // Never reflect Google's authorization code, state, tokens, or provider error
    // details into a browser-visible response.
    return resultRedirect(request, returnTo, "error");
  }
}
