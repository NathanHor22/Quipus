import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { loadRoute } from "./helpers/route-harness";

const stateKey = Symbol.for("quipus.offline.import.route.test");
const owner = "11111111-1111-4111-8111-111111111111";
const device = "22222222-2222-4222-8222-222222222222";
const state = {
  authorized: true,
  calls: 0,
  error: null as { code: string; message: string; details?: string } | null,
};
Reflect.set(globalThis, stateKey, state);
let cleanup = () => {};
after(() => {
  Reflect.deleteProperty(globalThis, stateKey);
  cleanup();
});
const prelude = 'const state=globalThis[Symbol.for("quipus.offline.import.route.test")];';
const mocked: Record<string, string> = {
  "@/lib/supabase/server": `export const getServerSupabase=()=>({
    from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{timezone:"Asia/Kuala_Lumpur"},error:null})}),
    rpc:async(name,args)=>{state.calls++;if(name!=="import_quipus_offline_session")throw Error("Unexpected RPC");return {data:args.p_machine,error:state.error};}
  });`,
  "@/lib/lantern-device-auth": `export const authenticateLantern=async()=>state.authorized ? {id:"${device}",userId:"${owner}"} : null;`,
  "@/lib/server-rate-limit": "export const enforceUserRateLimit=async()=>null;",
};
let POST: (request: Request) => Promise<Response>;
before(async () => {
  const loaded = await loadRoute<{ POST: typeof POST }>("app/api/device/v1/sessions/import/route.ts", mocked, prelude);
  POST = loaded.module.POST;
  cleanup = loaded.cleanup;
});
function request(overrides: Record<string, unknown> = {}) {
  return new Request("https://quipus.example/api/device/v1/sessions/import", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: "33333333-3333-4333-8333-333333333333",
      eventId: "44444444-4444-4444-8444-444444444444",
      ownerId: owner, ownerDeviceId: device,
      capturedAt: new Date(Date.now() - 60_000).toISOString(),
      timeUncertain: false, durationSeconds: 24, consentAccepted: true,
      ...overrides,
    }),
  });
}

test("actual import route logs safe conflict reasons and retains generic retry responses", async () => {
  const messages: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { messages.push(args); };
  try {
    for (const [code, message, status, expected] of [
      ["23505", 'duplicate key value violates unique constraint "lantern_one_open_session_per_device"', 409, "Unique constraint conflict: lantern_one_open_session_per_device"],
      ["P0001", "Conflicting offline import", 409, "Conflicting offline import"],
      ["P0001", `Private row ${owner} contains a secret-token`, 409, "Unrecognized offline import database failure; inspect restricted database logs."],
      ["PGRST202", "Private schema detail", 503, "Offline import database function is unavailable."],
    ] as const) {
      state.error = { code, message, details: `Private owner ${owner} secret-token` };
      const response = await POST(request());
      assert.equal(response.status, status);
      const body = await response.text();
      assert.match(body, /Keep the recording and retry/);
      assert.doesNotMatch(body, /secret-token|11111111|constraint/u);
      assert.match(response.headers.get("cache-control") || "", /no-store/u);
      assert.deepEqual(messages.at(-1), ["[quipus-offline-import]", { code, message: expected }]);
    }
    assert.doesNotMatch(JSON.stringify(messages), /11111111|secret-token|Private owner/u);
  } finally {
    console.error = original;
    state.error = null;
  }
});

test("authentication, owner and consent boundaries reject imports before the database RPC", async () => {
  const before = state.calls;
  state.authorized = false;
  try { assert.equal((await POST(request())).status, 403); }
  finally { state.authorized = true; }
  assert.equal((await POST(request({ ownerId: "55555555-5555-4555-8555-555555555555" }))).status, 403);
  assert.equal((await POST(request({ consentAccepted: false }))).status, 400);
  assert.equal(state.calls, before);
});

test("successful offline imports keep the existing finalized session and clock response", async () => {
  const response = await POST(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.session.state, "finalising");
  assert.equal(body.session.sessionId, "33333333-3333-4333-8333-333333333333");
  assert.ok(body.clock);
  assert.equal(body.timeUncertain, false);
});
