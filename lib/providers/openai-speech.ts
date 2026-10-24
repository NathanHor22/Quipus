import { env } from "@/lib/env";
import { quipusVoiceProfile } from "../quipus-voice-profile";

function providerCode(body: string) {
  try {
    const value = (JSON.parse(body) as { error?: { code?: unknown } }).error?.code;
    return typeof value === "string" && /^[a-zA-Z0-9._-]{1,80}$/u.test(value) ? value : null;
  } catch { return null; }
}

/** Stream the agreed voice only; an unavailable model must never change actors. */
export async function createOpenAISpeech(input: string, options: {
  apiKey?: string | null; model?: string; voice?: string;
  fetchImpl?: typeof fetch; timeoutMs?: number;
} = {}) {
  if (!input.trim() || input.length > 4096)
    throw new Error("Speech must contain 1 to 4096 characters; split long reports into pages.");
  const runtime = env();
  const profile = quipusVoiceProfile({
    model: options.model ?? runtime.OPENAI_SPEECH_MODEL,
    voice: options.voice ?? runtime.OPENAI_SPEECH_VOICE,
  });
  const apiKey = (options.apiKey === undefined ? runtime.OPENAI_API_KEY : options.apiKey)?.trim();
  if (!apiKey) throw new Error("OpenAI speech is not configured. Add OPENAI_API_KEY.");
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
      body: JSON.stringify({ model: profile.model, voice: profile.voice,
        instructions: profile.instructions, input, speed: profile.speed,
        response_format: profile.responseFormat, stream_format: "audio" }),
    });
  } catch {
    throw new Error("Quipus speech is temporarily unavailable. Keep the same voice and retry.");
  }
  if (response.ok && response.body) return response;
  const code = providerCode((await response.text()).slice(0, 2048));
  throw new Error(`Quipus speech is unavailable (HTTP ${response.status}${code ? `; ${code}` : ""}). No alternate voice was used.`);
}
