import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { isMachineAuthenticatedPath } from "../lib/request-security";

const root = realpathSync(process.cwd());
const folder = mkdtempSync(path.join(root, ".tmp-voice-build-test-"));
const key = Symbol.for("quipus.voice.build.test");
const state = { calls: 0 };
Reflect.set(globalThis, key, state);
const previous = process.env.QUIPUS_VOICE_BUILD_TOKEN;
let post: (request: Request, context: { params: Promise<{ asset: string }> }) => Promise<Response>;
before(async () => {
  const result = await build({ entryPoints: [path.join(root, "app/api/internal/voice-build/[asset]/route.ts")],
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
    plugins: [{ name: "voice-build-test", setup(builder) {
      builder.onResolve({ filter: /providers\/openai-speech$/ }, () => ({ path: "speech", namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ loader: "js", contents:
        'export async function createOpenAISpeech(){globalThis[Symbol.for("quipus.voice.build.test")].calls++;return new Response(new Uint8Array([1,0,2,0]));}' }));
    } }],
  });
  const file = path.join(folder, "route.cjs"); writeFileSync(file, result.outputFiles[0].contents);
  post = (createRequire(path.join(root, "package.json"))(file) as { POST: typeof post }).POST;
});
after(() => {
  if (previous === undefined) delete process.env.QUIPUS_VOICE_BUILD_TOKEN;
  else process.env.QUIPUS_VOICE_BUILD_TOKEN = previous;
  Reflect.deleteProperty(globalThis, key);
  const resolved = realpathSync(folder);
  assert.ok(resolved.startsWith(root + path.sep) && path.basename(resolved).startsWith(".tmp-voice-build-test-"));
  rmSync(resolved, { recursive: true, force: true });
});
function request(token?: string) {
  return new Request("https://quipus.test/api/internal/voice-build/listening", { method: "POST",
    headers: token === undefined ? {} : { authorization: "Bearer " + token } });
}
test("voice build is disabled by default and rejects invalid tokens without synthesizing", async () => {
  const before = state.calls;
  delete process.env.QUIPUS_VOICE_BUILD_TOKEN;
  assert.equal((await post(request("a".repeat(64)), { params: Promise.resolve({ asset: "listening" }) })).status, 404);
  process.env.QUIPUS_VOICE_BUILD_TOKEN = "a".repeat(64);
  for (const token of [undefined, "b".repeat(64), "a".repeat(63), "\u00e9".repeat(64), "z".repeat(64)]) {
    const response = await post(request(token), { params: Promise.resolve({ asset: "listening" }) });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(state.calls, before);
});
test("authorized generation accepts only fixed catalog phrases and returns private PCM", async () => {
  process.env.QUIPUS_VOICE_BUILD_TOKEN = "a".repeat(64);
  const before = state.calls;
  assert.equal((await post(request("a".repeat(64)), { params: Promise.resolve({ asset: "arbitrary-text" }) })).status, 404);
  assert.equal(state.calls, before);
  const response = await post(request("a".repeat(64)), { params: Promise.resolve({ asset: "listening" }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("content-type"), "audio/pcm");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 0, 2, 0]);
  assert.equal(state.calls, before + 1);
});
test("machine-route exception is limited to the authenticated build route shape", () => {
  assert.equal(isMachineAuthenticatedPath("/api/internal/voice-build/listening"), true);
  for (const value of ["/api/internal/voice-build", "/api/internal/voice-build/../other",
    "/api/internal/voice-build/listening/extra", "/api/internal/other"]) {
    assert.equal(isMachineAuthenticatedPath(value), false);
  }
});
