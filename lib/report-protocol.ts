import { z } from "zod";

/** Optional additions to protocol 3; omitted headers keep older binaries working. */
export function reportProtocol(request: Request) {
  const optionalId = (name: string) => z.string().uuid().optional().parse(request.headers.get(name) || undefined);
  const optionalPage = (name: string) => {
    const value = request.headers.get(name);
    return value === null ? undefined : z.coerce.number().int().min(0).max(10000).parse(value);
  };
  const lastSpokenPage = optionalPage("x-quipus-last-spoken-page");
  const interactionId = optionalId("x-quipus-interaction-id");
  const conversational = request.headers.get("x-quipus-report-mode") === "conversation";
  return {
    contextId: optionalId("x-quipus-context-id"),
    playbackId: optionalId("x-quipus-playback-id"),
    playbackPage: optionalPage("x-quipus-playback-page"),
    ...(lastSpokenPage === undefined ? {} : { lastSpokenPage }),
    ...(interactionId ? { interactionId } : {}),
    ...(conversational ? { conversational: true } : {}),
  };
}
