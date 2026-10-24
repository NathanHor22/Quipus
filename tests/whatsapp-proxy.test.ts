import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeOwnerPairPhone,
  parseWhatsAppPairingCode,
  parseWhatsAppStatus,
  requestWhatsAppRelay,
  WHATSAPP_OWNER_PHONE,
  WhatsAppRelayError,
} from "../lib/whatsapp-relay";
import { POST as disconnectWhatsApp } from "../app/api/whatsapp/disconnect/route";
import { POST as pairWhatsApp } from "../app/api/whatsapp/pair/route";

const configuration = {
  url: "https://relay.example.test/base/",
  token: "relay-secret-that-must-never-leak",
};

test("relay calls keep authorization server-side and disable caching", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  const payload = await requestWhatsAppRelay(
    "/status",
    {},
    {
      configuration,
      fetcher: async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return new Response(JSON.stringify({ status: "connected" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  );

  assert.deepEqual(payload, { status: "connected" });
  assert.equal(capturedUrl, "https://relay.example.test/status");
  assert.equal(capturedInit?.cache, "no-store");
  assert.equal(capturedInit?.redirect, "error");
  assert.equal(
    new Headers(capturedInit?.headers).get("authorization"),
    `Bearer ${configuration.token}`,
  );
  assert.ok(capturedInit?.signal instanceof AbortSignal);
});

test("relay preserves a safe upstream status but redacts secret-bearing errors", async () => {
  await assert.rejects(
    requestWhatsAppRelay(
      "/pair",
      { method: "POST", body: { phone: WHATSAPP_OWNER_PHONE } },
      {
        configuration,
        fetcher: async () =>
          new Response(JSON.stringify({ error: `bad ${configuration.token}` }), {
            status: 409,
          }),
      },
    ),
    (error: unknown) =>
      error instanceof WhatsAppRelayError &&
      error.status === 409 &&
      !error.message.includes(configuration.token) &&
      error.message === "The WhatsApp relay rejected the request.",
  );
});

test("relay converts timeouts and unsafe upstream statuses", async () => {
  await assert.rejects(
    requestWhatsAppRelay("/status", {}, {
      configuration,
      fetcher: async () => {
        throw new DOMException("timed out", "TimeoutError");
      },
    }),
    (error: unknown) => error instanceof WhatsAppRelayError && error.status === 504,
  );

  await assert.rejects(
    requestWhatsAppRelay("/status", {}, {
      configuration,
      fetcher: async () => new Response("redirected", { status: 302 }),
    }),
    (error: unknown) => error instanceof WhatsAppRelayError && error.status === 502,
  );
});

test("pairing is permanently locked to the approved owner number", () => {
  assert.equal(normalizeOwnerPairPhone(undefined), WHATSAPP_OWNER_PHONE);
  assert.equal(normalizeOwnerPairPhone("011-5444 4038"), WHATSAPP_OWNER_PHONE);
  assert.throws(
    () => normalizeOwnerPairPhone("011-5644 4038"),
    (error: unknown) => error instanceof WhatsAppRelayError && error.status === 403,
  );
  assert.deepEqual(
    parseWhatsAppPairingCode({
      code: "1234-5678",
      phone: WHATSAPP_OWNER_PHONE,
      token: configuration.token,
    }),
    { code: "1234-5678", phone: WHATSAPP_OWNER_PHONE },
  );
});

test("status responses are strictly whitelisted before reaching a browser", () => {
  assert.deepEqual(
    parseWhatsAppStatus({
      status: "connected",
      phone: WHATSAPP_OWNER_PHONE,
      since: "2026-08-23T08:30:00.000Z",
      qrAvailable: false,
      reconnectAttempt: 0,
      authorization: `Bearer ${configuration.token}`,
    }),
    {
      status: "connected",
      phone: WHATSAPP_OWNER_PHONE,
      since: "2026-08-23T08:30:00.000Z",
      qrAvailable: false,
      reconnectAttempt: 0,
    },
  );
});

test("while WhatsApp is coming soon, pairing and disconnecting are refused", async () => {
  delete process.env.NEXT_PUBLIC_WHATSAPP_ENABLED;
  for (const handler of [disconnectWhatsApp, pairWhatsApp]) {
    const response = await handler(new Request("http://localhost/api/whatsapp/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true, phone: "011-5644 4038" }),
    }));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "WhatsApp delivery is coming soon." });
  }
});

test("an unbound account cannot pair or disconnect the shared prototype relay", async (t) => {
  process.env.NEXT_PUBLIC_WHATSAPP_ENABLED = "true";
  t.after(() => { delete process.env.NEXT_PUBLIC_WHATSAPP_ENABLED; });
  const missingApproval = await disconnectWhatsApp(
    new Request("http://localhost/api/whatsapp/disconnect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
  assert.equal(missingApproval.status, 403);
  assert.match(missingApproval.headers.get("cache-control") || "", /no-store/u);

  const wrongPhone = await pairWhatsApp(
    new Request("http://localhost/api/whatsapp/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true, phone: "011-5644 4038" }),
    }),
  );
  assert.equal(wrongPhone.status, 403);
  assert.deepEqual(await wrongPhone.json(), {
    error: "WhatsApp account setup is required.",
  });
  assert.match(wrongPhone.headers.get("cache-control") || "", /no-store/u);
});
