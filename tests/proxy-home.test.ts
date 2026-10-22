import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

const site = "https://quipus.example";
const configKeys = ["NODE_ENV", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;

test("anonymous home stays public and private-cache safe without an auth round trip", async () => {
  const previous = Object.fromEntries(configKeys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  Object.assign(process.env, {
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://auth-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
  });
  globalThis.fetch = async () => { fetches++; throw new Error("Anonymous home must not call auth"); };
  try {
    const response = await proxy(new NextRequest(site + "/"));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /private.*no-store/u);
    assert.equal(response.headers.get("cdn-cache-control"), "no-store");
    assert.equal(response.headers.get("vercel-cdn-cache-control"), "no-store");
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of configKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else Object.assign(process.env, { [key]: previous[key] });
    }
  }
});

test("signed-in home verifies the session and keeps its response private", async () => {
  const previous = Object.fromEntries(configKeys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const user = {
    id: "b6f4a2cd-9025-4426-b11f-c87080289994", email: "nathan@example.test",
    aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const tokenPart = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = tokenPart({ alg: "HS256", typ: "JWT" }) + "." +
    tokenPart({ sub: user.id, exp: expiry }) + ".test-signature";
  const session = {
    access_token: token, refresh_token: "test-refresh-token",
    expires_at: expiry, expires_in: 3600, token_type: "bearer", user,
  };
  const cookie = "sb-auth-test-auth-token=base64-" +
    Buffer.from(JSON.stringify(session)).toString("base64url");
  let fetches = 0;
  Object.assign(process.env, {
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://auth-test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
  });
  globalThis.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    assert.match(url, /^https:\/\/auth-test\.supabase\.co\/auth\/v1\/user/u);
    fetches++;
    return Response.json(user);
  };
  try {
    const response = await proxy(new NextRequest(site + "/", { headers: { cookie } }));
    assert.equal(response.status, 200);
    assert.equal(fetches, 1);
    assert.match(response.headers.get("cache-control") || "", /private.*no-store/u);
    assert.equal(response.headers.get("vercel-cdn-cache-control"), "no-store");
    assert.equal(response.headers.has("location"), false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of configKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else Object.assign(process.env, { [key]: previous[key] });
    }
  }
});
