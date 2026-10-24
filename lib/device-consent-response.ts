import { createAcknowledgementTone, deviceAudioRate } from "./device-audio";
import type { DeviceCommandIntent } from "./device-command";

/** Consent recognition never waits for speech synthesis or starts a session. */
export function deviceConsentResponse(intent: DeviceCommandIntent, intentOnly: boolean) {
  const command = intent === "consent_yes" || intent === "consent_no" ? intent : "unknown";
  const headers: Record<string, string> = {
    "cache-control": "private, no-store",
    "x-lantern-command": command,
  };
  if (intentOnly) return new Response(null, { status: 204, headers });

  // Legacy firmware expects a PCM body before accepting the command header.
  // Keep that wire format with a short tone, without any cloud voice request.
  return new Response(createAcknowledgementTone(command), {
    status: 200,
    headers: {
      ...headers,
      "content-type": "audio/pcm",
      "x-lantern-audio-rate": String(deviceAudioRate()),
      "x-lantern-voice-output": "tone",
    },
  });
}
