import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { OAuth2Client } from "google-auth-library";
import {
  authorizedGoogleCredentialSnapshot,
  createAuthorizedGoogleOAuthClient,
  decryptGoogleCredentials,
  encryptGoogleCredentials,
  loadGoogleCredentialSnapshot,
  persistGoogleCredentials,
  persistRefreshedGoogleCredentials,
} from "../lib/providers/google-calendar";
import { disconnectGoogle } from "../lib/google-connection";

const secret = "test-only-approval-secret-at-least-32-bytes";
const user = "11111111-1111-4111-8111-111111111111";
const generation = "22222222-2222-4222-8222-222222222222";
const config = {
  clientId: "test",
  clientSecret: "test",
  redirectUri: "https://example.com/api/google/callback",
  calendarId: "primary",
  approvalSecret: secret,
};
const scope =
  "https://www.googleapis.com/auth/calendar.events.owned https://www.googleapis.com/auth/calendar.events.freebusy";
function connection() {
  return {
    user_id: user,
    provider: "google",
    encrypted_credentials: encryptGoogleCredentials(
      { access_token: "old-access", refresh_token: "old-refresh", scope },
      secret,
    ),
    connection_generation: generation,
    account_email: "old@example.com",
    connection_status: "connected",
    scopes: scope.split(" "),
    checked_at: null,
  };
}
function store() {
  let row: Record<string, unknown> | null = connection();
  let posts = 0;
  let beforeDelete: (() => void) | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method || "GET";
    if (method === "POST") {
      posts++;
      row = JSON.parse(String(init?.body));
      return Response.json(row);
    }
    if (method === "DELETE") beforeDelete?.();
    const matches =
      row &&
      [...url.searchParams.entries()]
        .filter(([key]) => !["select"].includes(key))
        .every(
          ([key, filter]) => !filter.startsWith("eq.") || String(row![key]) === filter.slice(3),
        );
    if (method === "PATCH" && matches) row = { ...row, ...JSON.parse(String(init?.body)) };
    const result = matches ? [{ ...row }] : [];
    if (method === "DELETE" && matches) row = null;
    return Response.json(result);
  };
  const client = createClient("https://test.invalid", "test-service-role", {
    auth: { persistSession: false },
    global: { fetch: fetchImpl },
  });
  return {
    client,
    get row() {
      return row;
    },
    set row(value: Record<string, unknown> | null) {
      row = value;
    },
    get posts() {
      return posts;
    },
    set beforeDelete(value: (() => void) | undefined) {
      beforeDelete = value;
    },
  };
}

test("a late token refresh cannot resurrect a disconnected Google account", async () => {
  const state = store();
  const oauth = await createAuthorizedGoogleOAuthClient({
    client: state.client,
    userId: user,
    config,
    oauthClient: new OAuth2Client(),
  });
  state.row = null;
  oauth.emit("tokens", { access_token: "late-access", expiry_date: Date.now() + 3600000 });
  assert.equal(await authorizedGoogleCredentialSnapshot(oauth), null);
  assert.equal(state.row, null);
  assert.equal(state.posts, 0);
});

test("an old account refresh cannot overwrite a reconnected account", async () => {
  const state = store();
  const snapshot = await loadGoogleCredentialSnapshot(state.client, user, secret);
  assert.ok(snapshot);
  const next = {
    ...connection(),
    connection_generation: "33333333-3333-4333-8333-333333333333",
    encrypted_credentials: encryptGoogleCredentials(
      { refresh_token: "new-account-refresh", scope },
      secret,
    ),
    account_email: "new@example.com",
  };
  state.row = next;
  assert.equal(
    await persistRefreshedGoogleCredentials(
      state.client,
      user,
      snapshot,
      { access_token: "old-account-access" },
      secret,
    ),
    null,
  );
  assert.deepEqual(state.row, next);
});

test("compare-and-swap prevents a stale health check overwriting newer tokens", async () => {
  const state = store();
  const snapshot = await loadGoogleCredentialSnapshot(state.client, user, secret);
  assert.ok(snapshot);
  const refreshed = await persistRefreshedGoogleCredentials(
    state.client,
    user,
    snapshot,
    { access_token: "fresh-access", refresh_token: "rotated-refresh" },
    secret,
  );
  assert.ok(refreshed);
  assert.equal(
    await persistRefreshedGoogleCredentials(
      state.client,
      user,
      snapshot,
      { access_token: "stale-access" },
      secret,
      { connection_status: "needs_reconnect" },
    ),
    null,
  );
  assert.equal(
    decryptGoogleCredentials(String(state.row?.encrypted_credentials), secret).refresh_token,
    "rotated-refresh",
  );
  assert.equal(state.row?.connection_status, "connected");
});

test("serialised token events preserve a rotated refresh token", async () => {
  const state = store();
  const oauth = await createAuthorizedGoogleOAuthClient({
    client: state.client,
    userId: user,
    config,
    oauthClient: new OAuth2Client(),
  });
  oauth.emit("tokens", { refresh_token: "rotated-refresh", access_token: "first-access" });
  oauth.emit("tokens", { access_token: "second-access" });
  const snapshot = await authorizedGoogleCredentialSnapshot(oauth);
  assert.equal(snapshot?.credentials.refresh_token, "rotated-refresh");
  assert.equal(snapshot?.credentials.access_token, "second-access");
});

test("new OAuth completion never borrows the previous account's refresh token", async () => {
  const state = store();
  await assert.rejects(
    persistGoogleCredentials(
      state.client,
      user,
      { access_token: "another-account-access" },
      secret,
    ),
    /refresh token/i,
  );
  assert.equal(state.posts, 0);
  assert.equal(state.row?.account_email, "old@example.com");
});

test("disconnect cannot remove or revoke a concurrently reconnected account", async () => {
  const state = store();
  const oauth = new OAuth2Client();
  let revoked = false;
  oauth.revokeToken = (async () => {
    revoked = true;
    return {};
  }) as unknown as typeof oauth.revokeToken;
  state.beforeDelete = () => {
    state.row = {
      ...connection(),
      connection_generation: "33333333-3333-4333-8333-333333333333",
      account_email: "new@example.com",
    };
  };
  const result = await disconnectGoogle(state.client, user, { config, oauthClient: oauth });
  assert.equal(result.disconnected, false);
  assert.equal(revoked, false);
  assert.equal(result.connection.email, "new@example.com");
});
