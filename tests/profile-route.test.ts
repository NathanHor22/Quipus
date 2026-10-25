import assert from "node:assert/strict";
import test from "node:test";
import { loadRoute } from "./helpers/route-harness";

type ProfileRoute = { GET(): Promise<Response> };
type State = { user: { id: string; email: string | null; displayName: string | null } | null; row: unknown; error: unknown; filters: unknown[][] };
const stateKey = Symbol.for("quipus.profile.route.test");
const prelude = 'const state=globalThis[Symbol.for("quipus.profile.route.test")];';
const mocks = {
  "@/lib/supabase/session": "export async function getAuthenticatedLanternUser(){return state.user;}",
  "@/lib/supabase/server": `export function getServerSupabase(){const q={select(...a){state.filters.push(["select",...a]);return q;},
    eq(...a){state.filters.push(["eq",...a]);return q;},async maybeSingle(){return {data:state.row,error:state.error};}};
    return {from(table){state.filters.push(["from",table]);return q;}};}`,
  "@/lib/quipus-profile": "export function validTimezone(value){return value;}",
};

async function withRoute(state: State, run: (route: ProfileRoute) => Promise<void>) {
  Reflect.set(globalThis, stateKey, state);
  const loaded = await loadRoute<ProfileRoute>("app/api/profile/route.ts", mocks, prelude);
  try { await run(loaded.module); } finally { loaded.cleanup(); Reflect.deleteProperty(globalThis, stateKey); }
}

test("profile GET returns only the verified user's greeting name and timezone", async () => {
  const state: State = { user: { id: "u-1", email: "owner@example.test", displayName: "Google Name" },
    row: { name: "Nathan", timezone: "Asia/Kuala_Lumpur" }, error: null, filters: [] };
  await withRoute(state, async (route) => {
    const response = await route.GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { name: "Nathan", email: "owner@example.test", timezone: "Asia/Kuala_Lumpur" });
    assert.deepEqual(state.filters, [["from", "profiles"], ["select", "name,timezone"], ["eq", "id", "u-1"]]);
  });
});

test("profile GET falls back to the identity name and fails closed without a user", async () => {
  const state: State = { user: { id: "u-2", email: null, displayName: "Google Name" }, row: null, error: null, filters: [] };
  await withRoute(state, async (route) => {
    assert.deepEqual(await (await route.GET()).json(), { name: "Google Name", email: null, timezone: null });
    state.user = null;
    const denied = await route.GET();
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("cache-control"), "no-store");
    state.user = { id: "u-3", email: null, displayName: null };
    state.error = { message: "relation details must stay private" };
    const failed = await route.GET();
    assert.equal(failed.status, 500);
    assert.doesNotMatch(await failed.text(), /relation details/u);
  });
});
