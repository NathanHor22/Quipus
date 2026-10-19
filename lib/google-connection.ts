import type { OAuth2Client } from "google-auth-library";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_CALENDAR_FREEBUSY_SCOPE,
  type GoogleOAuthConfig,
  createAuthorizedGoogleOAuthClient,
  getGoogleOAuthConfig,
  loadGoogleCredentialSnapshot,
  authorizedGoogleCredentialSnapshot,
  updateAuthorizedGoogleCredentials,
  requireApprovalSecret,
} from "./providers/google-calendar";

export type GoogleConnectionState =
  "not_connected" | "connected" | "needs_reconnect" | "unavailable";
export interface GoogleConnectionStatus {
  state: GoogleConnectionState;
  email: string | null;
  checkedAt: string | null;
  scopes: string[];
}

export function hasCalendarGrants(scopes: readonly string[]): boolean {
  const grants = new Set(scopes);
  const full = grants.has("https://www.googleapis.com/auth/calendar");
  return (
    (full ||
      grants.has(GOOGLE_CALENDAR_SCOPE) ||
      grants.has("https://www.googleapis.com/auth/calendar.events")) &&
    (full ||
      grants.has(GOOGLE_CALENDAR_FREEBUSY_SCOPE) ||
      grants.has("https://www.googleapis.com/auth/calendar.freebusy"))
  );
}

/** No provider requests on ordinary dashboard loads. Use check explicitly to verify tokens. */
export async function readGoogleConnection(
  client: SupabaseClient,
  userId: string,
): Promise<GoogleConnectionStatus> {
  const { data, error } = await client
    .from("provider_connections")
    .select("account_email,connection_status,checked_at,scopes")
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle();
  if (error) throw new Error("Google connection status is unavailable.");
  if (!data) return { state: "not_connected", email: null, checkedAt: null, scopes: [] };
  const scopes = Array.isArray(data.scopes)
    ? data.scopes.filter((scope: unknown): scope is string => typeof scope === "string")
    : [];
  return {
    state:
      data.connection_status === "needs_reconnect" || !hasCalendarGrants(scopes)
        ? "needs_reconnect"
        : "connected",
    email: typeof data.account_email === "string" ? data.account_email : null,
    checkedAt: typeof data.checked_at === "string" ? data.checked_at : null,
    scopes,
  };
}

export async function checkGoogleConnection(
  client: SupabaseClient,
  userId: string,
  options: { config?: GoogleOAuthConfig; oauthClient?: OAuth2Client } = {},
): Promise<GoogleConnectionStatus> {
  const previous = await readGoogleConnection(client, userId);
  if (previous.state === "not_connected") return previous;
  const checkedAt = new Date().toISOString();
  let oauth: Awaited<ReturnType<typeof createAuthorizedGoogleOAuthClient>> | undefined;
  try {
    oauth = await createAuthorizedGoogleOAuthClient({ client, userId, ...options });
    const token = await oauth.getAccessToken();
    if (!token.token) throw new Error("No access token.");
    const info = await oauth.getTokenInfo(token.token);
    const scopes = info.scopes ?? [];
    const snapshot = await authorizedGoogleCredentialSnapshot(oauth);
    if (!snapshot) return readGoogleConnection(client, userId);
    const state = hasCalendarGrants(scopes) ? "connected" : "needs_reconnect";
    const email = typeof info.email === "string" ? info.email.toLowerCase() : snapshot.accountEmail;
    await updateAuthorizedGoogleCredentials(
      oauth,
      { scope: scopes.join(" ") },
      { account_email: email, connection_status: state, checked_at: checkedAt, scopes },
    );
    return readGoogleConnection(client, userId);
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    const code = (error as { code?: string })?.code;
    const invalid =
      status === 400 ||
      status === 401 ||
      code === "invalid_credentials" ||
      code === "not_connected";
    if (invalid && oauth) {
      await updateAuthorizedGoogleCredentials(
        oauth,
        {},
        { connection_status: "needs_reconnect", checked_at: checkedAt },
      );
      return readGoogleConnection(client, userId);
    }
    const current = await readGoogleConnection(client, userId);
    return current.state === "not_connected"
      ? current
      : { ...current, state: invalid ? "needs_reconnect" : "unavailable" };
  }
}

export async function disconnectGoogle(
  client: SupabaseClient,
  userId: string,
  options: { config?: GoogleOAuthConfig; oauthClient?: OAuth2Client } = {},
): Promise<{ revoked: boolean; disconnected: boolean; connection: GoogleConnectionStatus }> {
  const config = options.config ?? getGoogleOAuthConfig();
  const snapshot = await loadGoogleCredentialSnapshot(
    client,
    userId,
    requireApprovalSecret(config.approvalSecret),
  );
  if (!snapshot)
    return {
      revoked: true,
      disconnected: true,
      connection: await readGoogleConnection(client, userId),
    };
  // Refresh keeps the generation; a newly authorised account gets a fresh one.
  let deletion = client
    .from("provider_connections")
    .delete()
    .eq("user_id", userId)
    .eq("provider", "google");
  deletion = snapshot.generation
    ? deletion.eq("connection_generation", snapshot.generation)
    : deletion.eq("encrypted_credentials", snapshot.encryptedCredentials);
  const removed = await deletion.select("user_id").maybeSingle();
  if (removed.error) throw new Error("The Google connection could not be removed.");
  const current = await readGoogleConnection(client, userId);
  if (!removed.data || current.state !== "not_connected")
    return { revoked: false, disconnected: false, connection: current };
  try {
    const { createGoogleOAuthClient } = await import("./providers/google-calendar");
    const oauth = options.oauthClient ?? createGoogleOAuthClient(config);
    const token = snapshot.credentials.refresh_token || snapshot.credentials.access_token;
    if (token) await oauth.revokeToken(token);
    const connection = await readGoogleConnection(client, userId);
    return { revoked: true, disconnected: connection.state === "not_connected", connection };
  } catch {
    const connection = await readGoogleConnection(client, userId);
    return { revoked: false, disconnected: connection.state === "not_connected", connection };
  }
}
