import { z } from "zod";
import voiceProfile from "./quipus-voice-profile.json";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const serverEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_SCRIBE_MODEL_ID: z.string().default("scribe_v2"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_TRANSCRIPTION_MODEL: z.string().default("whisper-large-v3-turbo"),
  QWEN_API_KEY: z.string().optional(),
  QWEN_BASE_URL: optionalUrl,
  QWEN_MODEL: z.string().default("qwen-plus"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default("gpt-4o-transcribe-diarize"),
  OPENAI_EXTRACTION_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_RELAY_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_SPEECH_MODEL: z.string().default(voiceProfile.model),
  OPENAI_SPEECH_VOICE: z.string().default(voiceProfile.voice),
  EXA_API_KEY: z.string().optional(),
  RELAY_EVENT_NAME: z.string().trim().min(1).max(160).default("AITKL · Agents, Everywhere"),
  RELAY_EVENT_VENUE: z.string().trim().min(1).max(200).default("WORQ Bangsar"),
  DEVIN_API_KEY: z.string().optional(),
  DEVIN_API_BASE_URL: optionalUrl,
  DEVIN_ORG_ID: z.string().optional(),
  DEVIN_POLL_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(300_000).default(60_000),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: optionalUrl,
  GOOGLE_CALENDAR_ID: z.string().default("primary"),
  WHATSAPP_RELAY_URL: optionalUrl,
  WHATSAPP_RELAY_TOKEN: z.string().optional(),
  WHATSAPP_ALLOWED_RECIPIENT: z.string().regex(/^60\d{8,11}$/).default("601154444038"),
  WHATSAPP_WORKSPACE_KEY: z.string().min(1).max(80).default("lantern"),
  NEXT_PUBLIC_AGORA_APP_ID: z.string().optional(),
  AGORA_APP_CERTIFICATE: z.string().optional(),
  AGORA_CUSTOMER_ID: z.string().optional(),
  AGORA_CUSTOMER_SECRET: z.string().optional(),
  AGORA_CONVOAI_ASR_LANGUAGE: z.string().default("en-US"),
  AGORA_CONVOAI_TTS: z.string().optional(),
  AGORA_STT_LANGUAGES: z.string().default("ms-MY,en-SG"),
  AGORA_STT_KEYWORDS: z.string().default("Quipus,Malaysia,ringgit"),
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  KV_REST_API_URL: optionalUrl,
  KV_REST_API_TOKEN: z.string().optional(),
  APP_TIMEZONE: z.string().default("Asia/Kuala_Lumpur"),
  ACTION_APPROVAL_SECRET: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (cached) return cached;
  const result = serverEnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }
  cached = result.data;
  return cached;
}

export function integrationStatus() {
  const value = env();
  return {
    supabase: Boolean(value.NEXT_PUBLIC_SUPABASE_URL && value.SUPABASE_SERVICE_ROLE_KEY),
    openai: Boolean(value.OPENAI_API_KEY),
    exa: Boolean(value.EXA_API_KEY),
    // Calendar is connected per user. /api/integrations changes this to true
    // only when the signed-in user has a saved provider connection.
    google: false as boolean,
    agora: Boolean(
      value.NEXT_PUBLIC_AGORA_APP_ID &&
      value.AGORA_APP_CERTIFICATE &&
      value.AGORA_CUSTOMER_ID &&
      value.AGORA_CUSTOMER_SECRET,
    ),
  };
}
