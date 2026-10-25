import { NextResponse } from "next/server";

import { mobileGoogleConfig, mobileResultUrl, readMobileTicket } from "@/lib/google-mobile-connect";
import {
  createGoogleAuthorizationUrl,
  createGoogleOAuthState,
  getGoogleOAuthConfig,
  readGoogleOAuthState,
  requireApprovalSecret,
} from "@/lib/providers/google-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Opened in the app's system browser, which has no Quipus session. The
 * encrypted ticket is the only credential; it names the user, expires in two
 * minutes and carries the app's challenge into the OAuth state.
 */
export async function GET(request: Request) {
  try {
    const config = mobileGoogleConfig(getGoogleOAuthConfig());
    const secret = requireApprovalSecret(config.approvalSecret);
    const ticket = readMobileTicket(new URL(request.url).searchParams.get("ticket") || "", secret);
    const state = createGoogleOAuthState(
      { userId: ticket.userId, returnTo: "/dashboard/settings", mobileChallenge: ticket.challenge },
      secret,
    );
    const response = NextResponse.redirect(createGoogleAuthorizationUrl(state, { config, includeGmail: ticket.includeGmail }));
    response.headers.set("cache-control", "no-store");
    response.headers.set("referrer-policy", "no-referrer");
    response.cookies.set("quipus-google-oauth-nonce", readGoogleOAuthState(state, secret).nonce, {
      httpOnly: true, secure: new URL(config.redirectUri).protocol === "https:",
      sameSite: "lax", path: "/api/google", maxAge: 600,
    });
    return response;
  } catch {
    // Never reflect the ticket or provider details.
    const response = NextResponse.redirect(mobileResultUrl({ status: "error" }));
    response.headers.set("cache-control", "no-store");
    return response;
  }
}
