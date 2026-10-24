import configuration from "./quipus-voice-profile.json";

/** Also read directly by the firmware prompt generator; do not copy these values. */
export const QUIPUS_VOICE_PROFILE = Object.freeze(configuration);
export type QuipusVoiceProfile = typeof QUIPUS_VOICE_PROFILE;

export function quipusVoiceProfile(configured: { model?: string; voice?: string } = {}): QuipusVoiceProfile {
  if ((configured.model !== undefined && configured.model !== QUIPUS_VOICE_PROFILE.model) ||
      (configured.voice !== undefined && configured.voice !== QUIPUS_VOICE_PROFILE.voice)) {
    throw new Error("Speech configuration must match the shared Quipus voice profile. Update OPENAI_SPEECH_MODEL and OPENAI_SPEECH_VOICE together with the local prompt assets.");
  }
  return QUIPUS_VOICE_PROFILE;
}
