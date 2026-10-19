import assert from "node:assert/strict";
import test from "node:test";
import { readPlaybackSources } from "../lib/workspace/playback-sources";

test("replay source discovery admits only known sources in stable order", () => {
  assert.deepEqual(
    readPlaybackSources(["phone", "onboard", "combined", "phone", "https://untrusted.example"]),
    ["combined", "onboard", "phone"],
  );
  assert.deepEqual(readPlaybackSources(["onboard"]), ["onboard"]);
  for (const invalid of [null, undefined, "phone", { phone: true }, []])
    assert.deepEqual(readPlaybackSources(invalid), []);
});
