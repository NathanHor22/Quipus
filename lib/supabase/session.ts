import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { readBearerCredential, type BearerCredential } from "./bearer";

export type AuthenticatedLanternUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  introductionCompletedAt?: string | null;
};

export function publicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
  return { url, anonKey };
}

async function requestBearerCredential(): Promise<BearerCredential> {
  return readBearerCredential((await headers()).get("authorization"));
}

/**
 * Anon-key Supabase client for the signed-in user. Browsers use cookies; the
 * native app sends its access token, and then cookies are never consulted.
 */
export async function createSessionSupabase() {
  const { url, anonKey } = publicSupabaseConfig();
  if (!url || !anonKey) return null;

  const bearer = await requestBearerCredential();
  if (bearer.kind === "invalid") return null;
  if (bearer.kind === "token") {
    // RLS and storage policies run as the token's user, exactly as for cookies.
    return createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer.token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>,
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. Middleware refreshes them;
          // Route Handlers and Server Actions can write through this same helper.
        }
      },
    },
  });
}

/** Returns the Google-backed user represented by the request's cookies or bearer token. */
export async function getAuthenticatedLanternUser(): Promise<AuthenticatedLanternUser | null> {
  const supabase = await createSessionSupabase();
  if (!supabase) return null;

  // A bearer client has no stored session, so the token is verified explicitly.
  const bearer = await requestBearerCredential();
  const {
    data: { user },
    error,
  } = bearer.kind === "token"
    ? await supabase.auth.getUser(bearer.token)
    : await supabase.auth.getUser();
  if (error || !user) return null;

  const rawName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : "";
  const rawIntroductionCompletedAt = user.user_metadata?.quipus_workspace_introduction_completed_at;
  // This is a display preference only. Never use user metadata for permissions.
  const introductionCompletedAt =
    typeof rawIntroductionCompletedAt === "string" &&
    Number.isFinite(Date.parse(rawIntroductionCompletedAt)) &&
    new Date(rawIntroductionCompletedAt).toISOString() === rawIntroductionCompletedAt
      ? rawIntroductionCompletedAt
      : null;

  return {
    id: user.id,
    email: user.email?.trim().toLowerCase() || null,
    displayName: rawName.trim() || null,
    introductionCompletedAt,
  };
}
