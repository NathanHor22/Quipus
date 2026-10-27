import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

test("the exact device reset endpoint reaches its own credential guard without a browser login", async () => {
  const keys = ["NODE_ENV", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let requests = 0;
  Object.assign(process.env, { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://reset-test.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key" });
  globalThis.fetch = async () => { requests++; throw new Error("Device reset must not look up a browser session."); };
  try {
    const request = new NextRequest("https://quipus.example/api/device/v1/reset", { method: "POST", headers: {
      authorization: "Device 33333333-3333-4333-8333-333333333333." + "a".repeat(43),
    } });
    const response = await proxy(request);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else Object.assign(process.env, { [key]: previous[key] });
    }
  }
});
