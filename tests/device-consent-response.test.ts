import assert from "node:assert/strict";
import test from "node:test";
import { deviceConsentResponse } from "../lib/device-consent-response";

for (const intent of ["consent_yes", "consent_no", "unknown"] as const) {
  test(`intent-only consent returns ${intent} without waiting for audio`, async () => {
    const response = deviceConsentResponse(intent, true);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("x-lantern-command"), intent);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.has("content-type"), false);
    assert.equal(response.headers.has("x-lantern-voice-output"), false);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });

  test(`legacy consent keeps PCM transport for ${intent} without TTS`, async () => {
    const response = deviceConsentResponse(intent, false);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-lantern-command"), intent);
    assert.equal(response.headers.get("content-type"), "audio/pcm");
    assert.equal(response.headers.get("x-lantern-audio-rate"), "24000");
    assert.equal(response.headers.get("x-lantern-voice-output"), "tone");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((await response.arrayBuffer()).byteLength, 11_520);
  });
}

test("an unrelated command can never become consent", async () => {
  const response = deviceConsentResponse("start_recording", true);
  assert.equal(response.headers.get("x-lantern-command"), "unknown");
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});
