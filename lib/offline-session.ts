import { createHash } from "node:crypto";
import { z } from "zod";
import { createLanternMachine, lanternMachineSchema } from "./lantern-state";
import { MAX_AUDIO_BYTES } from "./audio-upload";

export const offlineSessionSchema = z
  .object({
    sessionId: z.string().uuid(),
    eventId: z.string().uuid(),
    capturedAt: z.string().datetime({ offset: true }).nullable(),
    timeUncertain: z.boolean(),
    durationSeconds: z
      .number()
      .int()
      .min(1)
      .max(Math.floor((MAX_AUDIO_BYTES - 44) / 32_000)),
    consentAccepted: z.literal(true),
    ownerDeviceId: z.string().uuid(),
    ownerId: z.string().uuid(),
    audioSources: z
      .array(z.enum(["onboard", "phone"]))
      .min(1)
      .max(2)
      .default(["onboard"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (!value.capturedAt && !value.timeUncertain) ||
      !value.audioSources.includes("onboard") ||
      new Set(value.audioSources).size !== value.audioSources.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid offline recording metadata.",
      });
    }
  });
export type OfflineSession = z.infer<typeof offlineSessionSchema>;

export function prepareOfflineSession(input: OfflineSession, now = Date.now()) {
  const captured = input.capturedAt
    ? Date.parse(input.capturedAt)
    : now - input.durationSeconds * 1000;
  if (captured > now + 120_000 || captured < now - 90 * 24 * 3_600_000) {
    throw new RangeError("The recording timestamp is outside the accepted retention window.");
  }
  const startedAt = new Date(captured).toISOString();
  const captureEndedAt = new Date(captured + input.durationSeconds * 1000).toISOString();
  if (Date.parse(captureEndedAt) > now + 120_000)
    throw new RangeError("Recording end time is in the future.");
  const machine = lanternMachineSchema.parse({
    ...createLanternMachine("ready"),
    state: "finalising",
    version: 1,
    mode: "quick",
    sessionId: input.sessionId,
    recordingStartedAt: startedAt,
    consentConfirmedAt: startedAt,
  });
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        ...input,
        audioSources: [...input.audioSources].sort(),
      }),
    )
    .digest("hex");
  return { machine, startedAt, captureEndedAt, fingerprint };
}
