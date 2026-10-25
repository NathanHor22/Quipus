import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { browserMutationError, isMachineAuthenticatedPath } from "@/lib/request-security";
import { readBearerCredential } from "@/lib/supabase/bearer";
import { NextResponse, type NextRequest } from "next/server";

import {
  authEnforcementMode,
  isLanternDevicePath,
  isPublicAuthPath,
  isPublicContentPath,
} from "@/lib/auth-policy";

/** A personalised home response must never enter a shared browser/CDN cache. */
function continueRequest(request: NextRequest): NextResponse {
  const response = NextResponse.next({ request });
  if (request.nextUrl.pathname === "/") {
    response.headers.set("cache-control", "private, no-store, max-age=0");
    response.headers.set("cdn-cache-control", "no-store");
    response.headers.set("vercel-cdn-cache-control", "no-store");
  }
  return response;
}

function hasSupabaseSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some(({ name }) =>
    /^sb-.+-auth-token(?:\.\d+)?$/u.test(name),
  );
}

function copyCookies(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => to.cookies.set(cookie));
  return to;
}

function unauthenticatedResponse(
  request: NextRequest,
  refreshedResponse: NextResponse,
): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return copyCookies(
      refreshedResponse,
      NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      ),
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  const requestedPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (requestedPath !== "/") loginUrl.searchParams.set("next", requestedPath);
  return copyCookies(refreshedResponse, NextResponse.redirect(loginUrl));
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/") && !isMachineAuthenticatedPath(request.nextUrl.pathname)) {
    const rejected = browserMutationError(request);
    if (rejected) return NextResponse.json({ error: rejected.error }, {
      status: rejected.status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }
  // Anonymous public content never waits for Google/Supabase. A signed-in
  // visitor's home request refreshes cookies before its account slot renders.
  if (isPublicContentPath(request.nextUrl.pathname)) {
    if (request.nextUrl.pathname === "/" && request.nextUrl.searchParams.get("mode") === "sample") {
      const destination = request.nextUrl.clone();
      destination.pathname = "/demo";
      return NextResponse.redirect(destination);
    }
    if (request.nextUrl.pathname !== "/" || !hasSupabaseSessionCookie(request)) {
      return continueRequest(request);
    }
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const mode = authEnforcementMode({
    nodeEnv: process.env.NODE_ENV,
    supabaseUrl,
    supabaseAnonKey,
  });

  if (mode === "disabled") return continueRequest(request);

  if (mode === "misconfigured") {
    // Render the existing sign-in-unavailable card and public sample link.
    // Private pages and APIs continue to fail closed below.
    if (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/") {
      return continueRequest(request);
    }
    const message =
      "Quipus authentication is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.";
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: message }, { status: 503 });
    }
    return new NextResponse(message, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  let response = continueRequest(request);
  if (isLanternDevicePath(request.nextUrl.pathname) || isMachineAuthenticatedPath(request.nextUrl.pathname)) return response;
  if (request.nextUrl.pathname.startsWith("/api/") && request.headers.has("authorization")) {
    // Native app: verify its Supabase access token. Cookies are never a fallback.
    const bearer = readBearerCredential(request.headers.get("authorization"));
    const verified = bearer.kind === "token"
      ? await createClient(supabaseUrl!, supabaseAnonKey!, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }).auth.getUser(bearer.token)
      : null;
    if (!verified?.data.user || verified.error) {
      return NextResponse.json({ error: "Authentication required." }, {
        status: 401, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
      });
    }
    return response;
  }
  const supabase = createServerClient(supabaseUrl!, supabaseAnonKey!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>,
      ) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = continueRequest(request);
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isPublicPath = isPublicAuthPath(request.nextUrl.pathname);

  if (!user) {
    return isPublicPath
      ? response
      : unauthenticatedResponse(request, response);
  }

  if (request.nextUrl.pathname === "/login") {
    const destination = request.nextUrl.clone();
    destination.pathname = "/dashboard";
    destination.search = "";
    return copyCookies(response, NextResponse.redirect(destination));
  }

  return response;
}

export const config = {
  matcher: [
    // API routes are always authenticated, including dynamic values that look
    // like static filenames (for example `/api/processing/example.js`).
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff|woff2|ttf|glb|mp4|webm)$).*)",
  ],
};
