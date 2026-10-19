import assert from "node:assert/strict";
import test from "node:test";
import { introductionResponse } from "../app/api/profile/introduction/introduction-response";

const origin = "https://quipus.example";
const completedAt = "2026-10-16T08:30:00.000Z";
const now = () => new Date(completedAt);

function request(body: unknown = { completed: true }, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/profile/introduction`, {
    method: "PATCH",
    headers: { origin, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function session(options: { user?: boolean; authError?: boolean; saveError?: boolean; metadata?: Record<string, unknown> } = {}) {
  const updates: Array<{ data: Record<string, string> }> = [];
  return {
    updates,
    auth: {
      async getUser() {
        return {
          data: { user: options.user === false ? null : { user_metadata: options.metadata || { full_name: "Nathan Hor" } } },
          error: options.authError ? new Error("expired") : null,
        };
      },
      async updateUser(attributes: { data: Record<string, string> }) {
        updates.push(attributes);
        return { error: options.saveError ? new Error("unavailable") : null };
      },
    },
  };
}

test("introduction completion saves only a server timestamp on the authenticated account", async () => {
  const client = session();
  const response = await introductionResponse(request(), async () => client, now);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.deepEqual(await response.json(), { completedAt });
  assert.deepEqual(client.updates, [{ data: { quipus_workspace_introduction_completed_at: completedAt } }]);
});

test("introduction completion refuses cross-site, opaque, foreign and missing origins before session access", async () => {
  let accessedSession = false;
  const getSession = async () => { accessedSession = true; return session(); };
  const invalid = [
    request(undefined, { origin: "https://other.example" }),
    request(undefined, { origin: "null" }),
    request(undefined, { "sec-fetch-site": "cross-site" }),
    new Request(`${origin}/api/profile/introduction`, { method: "PATCH" }),
  ];
  for (const value of invalid) {
    const response = await introductionResponse(value, getSession, now);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  }
  assert.equal(accessedSession, false);
});

test("introduction completion requires a verified user even for malformed input", async () => {
  for (const client of [null, session({ user: false }), session({ authError: true })]) {
    const response = await introductionResponse(request({ completed: false }), async () => client, now);
    assert.equal(response.status, 401);
    if (client) assert.deepEqual(client.updates, []);
  }
});

test("introduction completion cannot accept a different account, client timestamp or reset instruction", async () => {
  const client = session();
  for (const input of [
    { completed: false },
    { completed: true, userId: "another-account" },
    { completed: true, completedAt: "2000-01-01T00:00:00.000Z" },
    {},
    null,
  ]) {
    const response = await introductionResponse(request(input), async () => client, now);
    assert.equal(response.status, 400);
  }
  const malformed = new Request(`${origin}/api/profile/introduction`, {
    method: "PATCH", headers: { origin }, body: "{",
  });
  assert.equal((await introductionResponse(malformed, async () => client, now)).status, 400);
  assert.deepEqual(client.updates, []);
});

test("replaying or retrying the introduction preserves its existing account completion", async () => {
  const earlier = "2026-10-15T08:30:00.000Z";
  const client = session({ metadata: { quipus_workspace_introduction_completed_at: earlier } });
  const response = await introductionResponse(request(), async () => client, now);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { completedAt: earlier });
  assert.deepEqual(client.updates, []);
});

test("failed introduction persistence never returns a completed timestamp", async () => {
  for (const getSession of [
    async () => session({ saveError: true }),
    async () => { throw new Error("session unavailable"); },
  ]) {
    const response = await introductionResponse(request(), getSession, now);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.deepEqual(await response.json(), { error: "Your introduction preference could not be saved. Try again." });
  }
});
