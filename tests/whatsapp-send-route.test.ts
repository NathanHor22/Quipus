import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { loadRoute } from "./helpers/route-harness";

const stateKey = Symbol.for("quipus.whatsapp.send.route.test");
const state = { databaseCalls: 0, user: null as { id: string } | null };
Reflect.set(globalThis, stateKey, state);

let POST: (request: Request) => Promise<Response>;
let cleanup = () => {};
before(async () => {
  const loaded = await loadRoute<{ POST: typeof POST }>(
    "app/api/actions/whatsapp/send/route.ts",
    {
      "@/lib/supabase/server": `export const getServerSupabase=()=>{state.databaseCalls++;return null;};
        export const resolveWorkspaceUserId=async()=>{state.databaseCalls++;return null;};`,
      "@/lib/supabase/session": `export const getAuthenticatedLanternUser=async()=>state.user;`,
    },
    'const state=globalThis[Symbol.for("quipus.whatsapp.send.route.test")];',
    // lib/whatsapp-owner-auth loads ./supabase/session relatively.
    { mockRelativeImports: true },
  );
  POST = loaded.module.POST;
  cleanup = loaded.cleanup;
});
after(() => {
  cleanup();
  Reflect.deleteProperty(globalThis, stateKey);
  delete process.env.WHATSAPP_OWNER_USER_ID;
});

function sendRequest() {
  return new Request("http://localhost/api/actions/whatsapp/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      followUpId: "follow-up", meetingId: "meeting", body: "Hello",
      recipient: "011-5444 4038", approved: true,
    }),
  });
}

test("sending through the linked WhatsApp relay is limited to its configured owner", async () => {
  delete process.env.WHATSAPP_OWNER_USER_ID;
  const unconfigured = await POST(sendRequest());
  assert.equal(unconfigured.status, 403);
  assert.match(unconfigured.headers.get("cache-control") || "", /no-store/u);

  process.env.WHATSAPP_OWNER_USER_ID = "11111111-1111-4111-8111-111111111111";
  state.user = { id: "22222222-2222-4222-8222-222222222222" };
  const otherUser = await POST(sendRequest());
  assert.equal(otherUser.status, 403);
  assert.equal(state.databaseCalls, 0, "authorization must run before any workspace lookup");

  // The owner passes authorization and reaches the next boundary (relay not configured here).
  state.user = { id: "11111111-1111-4111-8111-111111111111" };
  const owner = await POST(sendRequest());
  assert.notEqual(owner.status, 403);
});
