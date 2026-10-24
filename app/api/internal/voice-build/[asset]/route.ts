import { timingSafeEqual } from "node:crypto";
import catalog from "@/lib/quipus-prompt-text.json";
import { createOpenAISpeech } from "@/lib/providers/openai-speech";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Private build tool: disabled unless an ephemeral deployment-only token is set. */
export async function POST(request: Request, context: { params: Promise<{ asset: string }> }) {
  const expected = process.env.QUIPUS_VOICE_BUILD_TOKEN;
  const provided = request.headers.get("authorization")?.replace(/^Bearer /u, "");
  const unavailable = () => Response.json({ error: "Not found" }, { status: 404,
    headers: { "cache-control": "no-store" } });
  if (!expected || !/^[a-f0-9]{64}$/u.test(expected) || !provided || !/^[a-f0-9]{64}$/u.test(provided) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) return unavailable();
  const { asset } = await context.params;
  const item = catalog.prompts.find(value => value.symbol === asset);
  if (!item) return unavailable();
  try {
    const audio = await createOpenAISpeech(item.text);
    return new Response(audio.body, { headers: { "content-type": "audio/pcm",
      "cache-control": "private, no-store", "x-quipus-audio-rate": "24000" } });
  } catch {
    return Response.json({ error: "Voice generation unavailable" }, { status: 502,
      headers: { "cache-control": "no-store" } });
  }
}
