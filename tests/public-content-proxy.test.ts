import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

test("public landing and sample render without auth configuration while private endpoints fail closed", async () => {
  const keys = ["NODE_ENV", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
  const previous = keys.map(key => process.env[key]);
  try {
    Reflect.set(process.env, "NODE_ENV", "production");
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    for (const path of ["/", "/demo", "/login", "/privacy", "/terms"]) {
      const result = await proxy(new NextRequest("https://quipus.invalid" + path));
      assert.equal(result.status, 200, path);
      assert.equal(result.headers.get("x-middleware-next"), "1", path);
    }
    for (const path of ["/dashboard", "/api/meetings", "/api/processing/private.glb", "/api/processing/private.mp4", "/api/processing/private.webm"]) {
      const result = await proxy(new NextRequest("https://quipus.invalid" + path));
      assert.equal(result.status, 503, path);
      assert.equal(result.headers.get("x-middleware-next"), null, path);
    }
    const legacy = await proxy(new NextRequest("https://quipus.invalid/?mode=sample&view=calendar&conversation=sample%3A1"));
    assert.equal(legacy.status, 307);
    assert.equal(legacy.headers.get("location"), "https://quipus.invalid/demo?mode=sample&view=calendar&conversation=sample%3A1");
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else Reflect.set(process.env, key, previous[index]);
    });
  }
});
