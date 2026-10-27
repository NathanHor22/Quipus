import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateLantern, hashLanternSecret } from "../lib/lantern-device-auth";
import { supportsDeviceFactoryReset } from "../lib/device-reset";
import { loadRoute } from "./helpers/route-harness";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DEVICE = "33333333-3333-4333-8333-333333333333";
const RESET = "44444444-4444-4444-8444-444444444444";
const SECRET = "a".repeat(43);
type Row = Record<string, unknown>;
const state = {
  authorized: true, configured: true, userId: OWNER, lookupError: false, acknowledgements: 0,
  resets: [] as Row[], devices: [] as Row[], revokes: 0,
};
const stateKey = Symbol.for("quipus.reset.routes.test");
Reflect.set(globalThis, stateKey, state);
const client = {
  from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let columns: string | undefined;
    const list = () => (table === "devices" ? state.devices : table === "device_reset_requests" ? state.resets : [])
      .filter(row => filters.every(filter => filter(row)));
    const response = () => ({ data: list().map(row => columns ? Object.fromEntries(columns.split(",").map(key => [key, row[key]])) : row), error: state.lookupError ? { code: "42P01" } : null });
    const query = {
      select: (value?: string) => { columns = value; return query; },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      is: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      or: () => { filters.push(row => row.revoked_at == null || row.hardware_id != null); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      order: () => query,
      maybeSingle: async () => { const result = response(); return { ...result, data: result.data[0] || null }; },
      then: (resolve: (value: ReturnType<typeof response>) => unknown) => Promise.resolve(response()).then(resolve),
    };
    return query;
  },
  async rpc(name: string, input: Record<string, string>) {
    if (name === "request_quipus_device_reset") {
      const device = state.devices.find(row => row.id === input.p_device_id && row.user_id === input.p_user_id);
      if (!device) return { data: null, error: { code: "P0002" } };
      state.revokes++;
      return { data: [{ reset_id: RESET, reset_state: "pending" }], error: null };
    }
    assert.equal(name, "acknowledge_quipus_device_reset");
    assert.equal(input.p_device_id, DEVICE);
    assert.equal(input.p_reset_id, RESET);
    assert.equal(input.p_credential_hash, hashLanternSecret(SECRET));
    state.acknowledgements++;
    return { data: null, error: null };
  },
};
Reflect.set(globalThis, Symbol.for("quipus.reset.routes.client"), client);
const prelude = 'const state=globalThis[Symbol.for("quipus.reset.routes.test")];const client=globalThis[Symbol.for("quipus.reset.routes.client")];';
const mocks = {
  "@/lib/supabase/server": "export const getServerSupabase=()=>state.configured?client:null;export const resolveWorkspaceUserId=async()=>state.userId;",
  "@/lib/api-security": "export const requireAuthenticatedSession=async()=>state.authorized?null:new Response(null,{status:401});export const requireProductionPersistence=()=>null;",
  "@/lib/server-rate-limit": "export const enforceUserRateLimit=async()=>null;",
};
let devicePost: (request: Request) => Promise<Response>;
let ownerPatch: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
let ownerGet: () => Promise<Response>;
const cleanups: Array<() => void> = [];
before(async () => {
  const reset = await loadRoute<{ POST: typeof devicePost }>("app/api/device/v1/reset/route.ts", mocks, prelude);
  const owner = await loadRoute<{ PATCH: typeof ownerPatch }>("app/api/devices/[id]/route.ts", mocks, prelude);
  const listing = await loadRoute<{ GET: typeof ownerGet }>("app/api/devices/route.ts", mocks, prelude);
  devicePost = reset.module.POST; ownerPatch = owner.module.PATCH; ownerGet = listing.module.GET;
  cleanups.push(reset.cleanup, owner.cleanup, listing.cleanup);
});
after(() => {
  cleanups.forEach(cleanup => cleanup());
  Reflect.deleteProperty(globalThis, stateKey);
  Reflect.deleteProperty(globalThis, Symbol.for("quipus.reset.routes.client"));
});
beforeEach(() => {
  Object.assign(state, { authorized: true, configured: true, userId: OWNER, lookupError: false, acknowledgements: 0, revokes: 0 });
  state.devices = [{ id: DEVICE, user_id: OWNER, hardware_id: "esp32s3:test", credential_hash: null,
    revoked_at: "2026-10-27T00:00:00Z", device_state: "ready", state_version: 0, firmware_version: "0.14.1-quipus" }];
  state.resets = [{ id: RESET, device_id: DEVICE, user_id: OWNER, credential_hash: hashLanternSecret(SECRET),
    state: "pending", requested_at: "2026-10-27T00:00:00Z", completed_at: null }];
});
const resetRequest = (body: unknown = { action: "status" }, secret = SECRET) => new Request("https://quipus.test/api/device/v1/reset", {
  method: "POST", headers: { authorization: `Device ${DEVICE}.${secret}`, "content-type": "application/json" }, body: JSON.stringify(body),
});
const revokeRequest = (origin = "https://quipus.test") => new Request(`https://quipus.test/api/devices/${DEVICE}`, {
  method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ action: "revoke" }),
});
const context = () => ({ params: Promise.resolve({ id: DEVICE }) });

test("revocation refuses cross-site and unauthenticated callers before any mutation", async () => {
  assert.equal((await ownerPatch(revokeRequest("https://attacker.test"), context())).status, 403);
  state.authorized = false;
  assert.equal((await ownerPatch(revokeRequest(), context())).status, 401);
  assert.equal(state.revokes, 0);
});
test("revocation is owner-scoped and reports the pending physical wipe", async () => {
  state.userId = OTHER;
  assert.equal((await ownerPatch(revokeRequest(), context())).status, 404);
  state.userId = OWNER;
  const response = await ownerPatch(revokeRequest(), context());
  assert.deepEqual(await response.json(), { revoked: true, deviceId: DEVICE, resetId: RESET, resetPending: true, resetState: "pending", resetSupported: true });
});
test("wrong credentials and a bare hardware identity cannot authorise reset", async () => {
  assert.equal((await devicePost(resetRequest(undefined, "b".repeat(43)))).status, 403);
  const response = await devicePost(new Request("https://quipus.test/api/device/v1/reset", { method: "POST", body: JSON.stringify({ action: "status", hardwareId: "esp32s3:test" }) }));
  assert.equal(response.status, 400);
  assert.equal(state.acknowledgements, 0);
});
test("only the explicit reset protocol authorises erase; the retained verifier cannot access meeting data", async () => {
  assert.equal(await authenticateLantern(resetRequest(), client as unknown as SupabaseClient), null);
  const response = await devicePost(resetRequest());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reset: { id: RESET, deviceId: DEVICE, mode: "factory", completed: false } });
  assert.equal(state.acknowledgements, 0);
});
test("active authenticated devices without a reset receive no instruction to wipe", async () => {
  state.resets = [];
  state.devices[0].credential_hash = hashLanternSecret(SECRET);
  state.devices[0].revoked_at = null;
  assert.equal((await devicePost(resetRequest())).status, 204);
});
test("a missing reset table never falls back to destructive or unauthenticated reset", async () => {
  state.lookupError = true;
  assert.equal((await devicePost(resetRequest())).status, 503);
  assert.equal(state.acknowledgements, 0);
});
test("reset acknowledgement is bound to its request and repeats after a lost response", async () => {
  assert.equal((await devicePost(resetRequest({ action: "acknowledge", resetId: OTHER }))).status, 409);
  const body = { action: "acknowledge", resetId: RESET };
  assert.deepEqual(await (await devicePost(resetRequest(body))).json(), { resetComplete: true });
  state.resets[0].state = "completed";
  assert.deepEqual(await (await devicePost(resetRequest(body))).json(), { resetComplete: true });
  assert.equal(state.acknowledgements, 2);
});
test("owner listing retains reset progress but excludes verifiers and released historical devices", async () => {
  state.devices.push({ id: OTHER, user_id: OTHER, hardware_id: "esp32s3:foreign", revoked_at: null });
  state.devices.push({ id: RESET, user_id: OWNER, hardware_id: null, revoked_at: "2026-10-26T00:00:00Z" });
  const response = await ownerGet();
  const payload = await response.json();
  assert.equal(payload.devices.length, 1);
  assert.equal(payload.devices[0].reset.state, "pending");
  const text = JSON.stringify(payload);
  assert(!text.includes("credential_hash"));
  assert(!text.includes(hashLanternSecret(SECRET)));
});


test("legacy or unknown firmware is reported as recovery required rather than a reset that will finish automatically", async () => {
  for (const version of ["0.13.3-quipus", "0.14.0-quipus", "custom", null, undefined]) {
    state.devices[0].firmware_version = version;
    const result = await (await ownerPatch(revokeRequest(), context())).json();
    assert.equal(result.revoked, true);
    assert.equal(result.resetState, "recovery_required");
    assert.equal(result.resetSupported, false);
    const listing = await (await ownerGet()).json();
    assert.equal(listing.devices[0].reset.state, "recovery_required");
    assert.equal(listing.devices[0].resetSupported, false);
  }
});

test("reset capability starts at the released protocol version and stored legacy versions do not block an explicit authenticated reset", async () => {
  for (const version of ["0.14.1-quipus", "0.14.2-quipus", "0.15.0-quipus", "1.0.0"]) {
    assert.equal(supportsDeviceFactoryReset(version), true);
  }
  state.devices[0].firmware_version = "0.13.3-quipus";
  assert.equal((await devicePost(resetRequest())).status, 200);
  assert.deepEqual(await (await devicePost(resetRequest({ action: "acknowledge", resetId: RESET }))).json(), { resetComplete: true });
});
