import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { mobileGoogleConfig, mobileResultUrl, sealMobileResult } from "@/lib/google-mobile-connect";
import {
  exchangeGoogleAuthorizationCode,
  getGoogleOAuthConfig,
  readGoogleOAuthState,
  requireApprovalSecret,
} from "@/lib/providers/google-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function redirect(request: Request, outcome: Parameters<typeof mobileResultUrl>[0]) {
  const response = NextResponse.redirect(mobileResultUrl(outcome));
  response.cookies.set("quipus-google-oauth-nonce", "", { httpOnly: true, sameSite: "lax",
    secure: new URL(request.url).protocol === "https:", path: "/api/google", maxAge: 0 });
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

/**
 * Google's redirect for the mobile flow. It never saves credentials: it seals
 * them for the app, which must present its verifier and session to save them.
 * Only states minted by /api/google/mobile/authorize (with a challenge) pass.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const config = mobileGoogleConfig(getGoogleOAuthConfig());
    const secret = requireApprovalSecret(config.approvalSecret);
    const state = readGoogleOAuthState(url.searchParams.get("state") || "", secret);
    if (!state.mobileChallenge) return redirect(request, { status: "error" });
    const nonce = (await cookies()).get("quipus-google-oauth-nonce")?.value ?? "";
    if (nonce.length !== state.nonce.length || !timingSafeEqual(Buffer.from(nonce), Buffer.from(state.nonce)))
      return redirect(request, { status: "error" });
    if (url.searchParams.has("error")) return redirect(request, { status: "denied" });
    const code = url.searchParams.get("code");
    if (!code) return redirect(request, { status: "error" });
    const credentials = await exchangeGoogleAuthorizationCode(code, { config });
    return redirect(request, { result: sealMobileResult({ userId: state.userId, challenge: state.mobileChallenge, credentials }, secret) });
  } catch {
    // Never reflect Google's code, state, tokens or provider errors.
    return redirect(request, { status: "error" });
  }
}
