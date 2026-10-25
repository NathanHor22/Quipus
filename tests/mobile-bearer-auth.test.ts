import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import { readBearerCredential } from "../lib/supabase/bearer";

const site = "https://quipus.example";
const supabaseUrl = "https://auth-test.supabase.co";
const configKeys = ["NODE_ENV", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
const appUser = {
  id: "0c3b1f0e-7f7c-4a43-9a37-3c5c2a0f1d11", email: "App.User@example.test",
  aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: { full_name: "App User" },
  created_at: "2026-01-01T00:00:00Z",
};
const cookieUser = { ...appUser, id: "b6f4a2cd-9025-4426-b11f-c87080289994", email: "cookie@example.test" };
const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const expiry = Math.floor(Date.now() / 1000) + 3600;
const appToken = part({ alg: "HS256", typ: "JWT" }) + "." + part({ sub: appUser.id, exp: expiry }) + ".app-signature";
const cookieToken = part({ alg: "HS256", typ: "JWT" }) + "." + part({ sub: cookieUser.id, exp: expiry }) + ".cookie-signature";
const sessionCookie = "sb-auth-test-auth-token=base64-" + Buffer.from(JSON.stringify({
  access_token: cookieToken, refresh_token: "test-refresh", expires_at: expiry, expires_in: 3600,
  token_type: "bearer", user: cookieUser,
})).toString("base64url");

type Fetched = { url: string; authorization: string | null };

/** Stub Supabase Auth: each known token resolves to its own user. */
async function withAuth<T>(run: (fetched: Fetched[]) => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(configKeys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const fetched: Fetched[] = [];
  Object.assign(process.env, {
    NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: supabaseUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
  });
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const authorization = request.headers.get("authorization");
    fetched.push({ url: request.url, authorization });
    if (request.url.startsWith(`${supabaseUrl}/auth/v1/user`)) {
      if (authorization === `Bearer ${appToken}`) return Response.json(appUser);
      if (authorization === `Bearer ${cookieToken}`) return Response.json(cookieUser);
      return Response.json({ code: 401, msg: "invalid JWT" }, { status: 401 });
    }
    return Response.json([]);
  };
  try {
    return await run(fetched);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of configKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else Object.assign(process.env, { [key]: previous[key] });
    }
  }
}

type SessionModule = typeof import("../lib/supabase/session");
type RequestState = { headers: Headers; cookies: { name: string; value: string }[] };

/** Bundle the real session helper with Next's request APIs replaced by test state. */
async function loadSession(): Promise<{ session: SessionModule; state: RequestState; cleanup(): void }> {
  const root = realpathSync(process.cwd());
  const folder = mkdtempSync(path.join(root, ".tmp-route-harness-"));
  const cleanup = () => rmSync(folder, { recursive: true, force: true });
  const result = await build({
    entryPoints: [path.join(root, "lib/supabase/session.ts")],
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{
      name: "session-request-mocks",
      setup(builder) {
        builder.onResolve({ filter: /^(server-only|next\/headers)$/ }, args => ({ path: args.path, namespace: "mock" }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({
          loader: "js",
          contents: args.path === "server-only" ? "" : `
            const state = () => globalThis.__quipusRequestState;
            export async function headers() { return state().headers; }
            export async function cookies() {
              return { getAll: () => state().cookies, set() {} };
            }`,
        }));
      },
    }],
  });
  const output = path.join(folder, "session.cjs");
  writeFileSync(output, result.outputFiles[0].contents);
  const state: RequestState = { headers: new Headers(), cookies: [] };
  (globalThis as { __quipusRequestState?: RequestState }).__quipusRequestState = state;
  return { session: createRequire(path.join(root, "package.json"))(output) as SessionModule, state, cleanup };
}

function cookieList(cookie: string) {
  const [name, value] = cookie.split(/=(.*)/su);
  return [{ name, value }];
}

test("bearer headers accept only a compact JWS and treat anything else present as invalid", () => {
  assert.deepEqual(readBearerCredential(null), { kind: "none" });
  assert.deepEqual(readBearerCredential(`Bearer ${appToken}`), { kind: "token", token: appToken });
  for (const value of ["", "Bearer", "Bearer ", `bearer ${appToken}`, `Basic ${appToken}`, `Bearer ${appToken} extra`,
    "Bearer not-a-jwt", "Bearer a.b", `Bearer ${"a".repeat(8200)}.b.c`, `Bearer  ${appToken}`])
    assert.deepEqual(readBearerCredential(value), { kind: "invalid" }, value);
});

test("the proxy verifies a native bearer token and never consults cookies", async () => {
  await withAuth(async (fetched) => {
    const response = await proxy(new NextRequest(site + "/api/devices", {
      headers: { authorization: `Bearer ${appToken}`, cookie: sessionCookie },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.has("set-cookie"), false);
    assert.deepEqual(fetched.map(item => item.authorization), [`Bearer ${appToken}`]);
  });
});

test("malformed, rejected or expired bearer tokens fail closed even beside a valid cookie", async () => {
  await withAuth(async (fetched) => {
    for (const authorization of ["Bearer not-a-jwt", "Bearer", `Bearer ${part({ alg: "none" })}.${part({})}.forged`]) {
      fetched.length = 0;
      const response = await proxy(new NextRequest(site + "/api/meetings", { headers: { authorization, cookie: sessionCookie } }));
      assert.equal(response.status, 401, authorization);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.ok(fetched.every(item => item.authorization !== `Bearer ${cookieToken}`), "cookie session must not be used");
    }
  });
});

test("device and machine routes keep their own bearer authentication", async () => {
  await withAuth(async (fetched) => {
    const response = await proxy(new NextRequest(site + "/api/device/v1/heartbeat", {
      method: "POST", headers: { authorization: "Bearer device-credential" },
    }));
    assert.equal(response.status, 200);
    assert.equal(fetched.length, 0);
  });
});

test("browser cookie requests and cross-site protection are unchanged", async () => {
  await withAuth(async (fetched) => {
    const allowed = await proxy(new NextRequest(site + "/api/devices", { headers: { cookie: sessionCookie } }));
    assert.equal(allowed.status, 200);
    assert.deepEqual(fetched.map(item => item.authorization), [`Bearer ${cookieToken}`]);
    const crossSite = await proxy(new NextRequest(site + "/api/devices/pairing", {
      method: "POST", headers: { cookie: sessionCookie, origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
    }));
    assert.equal(crossSite.status, 403);
    const anonymous = await proxy(new NextRequest(site + "/api/devices"));
    assert.equal(anonymous.status, 401);
  });
});

test("route helpers resolve the bearer user and scope RLS queries to that token", async () => {
  const { session, state, cleanup } = await loadSession();
  try {
    await withAuth(async (fetched) => {
      state.headers = new Headers({ authorization: `Bearer ${appToken}` });
      state.cookies = cookieList(sessionCookie);
      const user = await session.getAuthenticatedLanternUser();
      assert.equal(user?.id, appUser.id);
      assert.equal(user?.email, "app.user@example.test");
      assert.equal(user?.displayName, "App User");

      fetched.length = 0;
      const client = await session.createSessionSupabase();
      assert.ok(client);
      await client.from("recordings").select("id").limit(1);
      assert.equal(fetched.length, 1);
      assert.match(fetched[0].url, /\/rest\/v1\/recordings/u);
      assert.equal(fetched[0].authorization, `Bearer ${appToken}`);
    });
  } finally { cleanup(); }
});

test("route helpers reject invalid bearer tokens without falling back to cookies", async () => {
  const { session, state, cleanup } = await loadSession();
  try {
    await withAuth(async (fetched) => {
      state.cookies = cookieList(sessionCookie);
      for (const authorization of ["Bearer nope", `Bearer ${part({ alg: "HS256" })}.${part({ sub: "x" })}.bad`]) {
        state.headers = new Headers({ authorization });
        assert.equal(await session.getAuthenticatedLanternUser(), null, authorization);
      }
      assert.ok(fetched.every(item => item.authorization !== `Bearer ${cookieToken}`));
      state.headers = new Headers({ authorization: "Bearer nope" });
      assert.equal(await session.createSessionSupabase(), null);

      state.headers = new Headers();
      assert.equal((await session.getAuthenticatedLanternUser())?.id, cookieUser.id);
    });
  } finally { cleanup(); }
});
