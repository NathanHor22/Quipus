// Generated from the shared Quipus voice profile. See assets/prompts.json.

#include "quipus_local_prompts.h"

#include "quipus_adpcm.h"

#include <stdint.h>

#include "lantern_audio.h"

#include "lantern_board.h"

_Static_assert(LANTERN_TTS_SAMPLE_RATE == 24000, "Local voice requires24kHz output");

extern const uint8_t consent_start[] asm("_binary_consent_request_adpcm_start");

extern const uint8_t consent_end[] asm("_binary_consent_request_adpcm_end");

extern const uint8_t error_start[] asm("_binary_error_help_adpcm_start");

extern const uint8_t error_end[] asm("_binary_error_help_adpcm_end");

extern const uint8_t uploading_start[] asm("_binary_recording_uploading_adpcm_start");

extern const uint8_t uploading_end[] asm("_binary_recording_uploading_adpcm_end");

extern const uint8_t uploaded_start[] asm("_binary_recording_uploaded_adpcm_start");

extern const uint8_t uploaded_end[] asm("_binary_recording_uploaded_adpcm_end");

extern const uint8_t saved_offline_start[] asm("_binary_recording_saved_offline_adpcm_start");

extern const uint8_t saved_offline_end[] asm("_binary_recording_saved_offline_adpcm_end");

extern const uint8_t listening_start[] asm("_binary_listening_adpcm_start");

extern const uint8_t listening_end[] asm("_binary_listening_adpcm_end");

extern const uint8_t command_retry_start[] asm("_binary_command_retry_adpcm_start");

extern const uint8_t command_retry_end[] asm("_binary_command_retry_adpcm_end");

extern const uint8_t command_unclear_start[] asm("_binary_command_unclear_adpcm_start");

extern const uint8_t command_unclear_end[] asm("_binary_command_unclear_adpcm_end");

extern const uint8_t voice_unavailable_start[] asm("_binary_voice_unavailable_adpcm_start");

extern const uint8_t voice_unavailable_end[] asm("_binary_voice_unavailable_adpcm_end");

extern const uint8_t sd_failure_start[] asm("_binary_sd_failure_adpcm_start");

extern const uint8_t sd_failure_end[] asm("_binary_sd_failure_adpcm_end");

extern const uint8_t connection_lost_recording_start[] asm("_binary_connection_lost_recording_adpcm_start");

extern const uint8_t connection_lost_recording_end[] asm("_binary_connection_lost_recording_adpcm_end");

extern const uint8_t upload_delayed_start[] asm("_binary_upload_delayed_adpcm_start");

extern const uint8_t upload_delayed_end[] asm("_binary_upload_delayed_adpcm_end");

extern const uint8_t consent_retry_start[] asm("_binary_consent_retry_adpcm_start");

extern const uint8_t consent_retry_end[] asm("_binary_consent_retry_adpcm_end");

extern const uint8_t consent_refused_start[] asm("_binary_consent_refused_adpcm_start");

extern const uint8_t consent_refused_end[] asm("_binary_consent_refused_adpcm_end");

extern const uint8_t meeting_processing_start[] asm("_binary_meeting_processing_adpcm_start");

extern const uint8_t meeting_processing_end[] asm("_binary_meeting_processing_adpcm_end");

extern const uint8_t report_done_start[] asm("_binary_report_done_adpcm_start");

extern const uint8_t report_done_end[] asm("_binary_report_done_adpcm_end");

extern const uint8_t network_required_start[] asm("_binary_network_required_adpcm_start");

extern const uint8_t network_required_end[] asm("_binary_network_required_adpcm_end");

extern const uint8_t recovery_listening_start[] asm("_binary_recovery_listening_adpcm_start");

extern const uint8_t recovery_listening_end[] asm("_binary_recovery_listening_adpcm_end");

extern const uint8_t short_recording_skipped_start[] asm("_binary_short_recording_skipped_adpcm_start");

extern const uint8_t short_recording_skipped_end[] asm("_binary_short_recording_skipped_adpcm_end");

extern const uint8_t offline_record_choice_start[] asm("_binary_offline_record_choice_adpcm_start");

extern const uint8_t offline_record_choice_end[] asm("_binary_offline_record_choice_adpcm_end");

extern const uint8_t offline_report_choice_start[] asm("_binary_offline_report_choice_adpcm_start");

extern const uint8_t offline_report_choice_end[] asm("_binary_offline_report_choice_adpcm_end");

extern const uint8_t recording_started_start[] asm("_binary_recording_started_adpcm_start");

extern const uint8_t recording_started_end[] asm("_binary_recording_started_adpcm_end");

extern const uint8_t report_offline_start[] asm("_binary_report_offline_adpcm_start");

extern const uint8_t report_offline_end[] asm("_binary_report_offline_adpcm_end");

extern const uint8_t cached_report_start[] asm("_binary_cached_report_adpcm_start");

extern const uint8_t cached_report_end[] asm("_binary_cached_report_adpcm_end");

extern const uint8_t no_cached_report_start[] asm("_binary_no_cached_report_adpcm_start");

extern const uint8_t no_cached_report_end[] asm("_binary_no_cached_report_adpcm_end");

typedef struct { const uint8_t *start; const uint8_t *end; } prompt_asset_t;

static const prompt_asset_t s_prompt_assets[QUIPUS_PROMPT_COUNT] = {

  [QUIPUS_PROMPT_CONSENT] = {consent_start, consent_end},

  [QUIPUS_PROMPT_ERROR] = {error_start, error_end},

  [QUIPUS_PROMPT_UPLOADING] = {uploading_start, uploading_end},

  [QUIPUS_PROMPT_UPLOADED] = {uploaded_start, uploaded_end},

  [QUIPUS_PROMPT_SAVED_OFFLINE] = {saved_offline_start, saved_offline_end},

  [QUIPUS_PROMPT_LISTENING] = {listening_start, listening_end},

  [QUIPUS_PROMPT_COMMAND_RETRY] = {command_retry_start, command_retry_end},

  [QUIPUS_PROMPT_COMMAND_UNCLEAR] = {command_unclear_start, command_unclear_end},

  [QUIPUS_PROMPT_VOICE_UNAVAILABLE] = {voice_unavailable_start, voice_unavailable_end},

  [QUIPUS_PROMPT_SD_FAILURE] = {sd_failure_start, sd_failure_end},

  [QUIPUS_PROMPT_CONNECTION_LOST_RECORDING] = {connection_lost_recording_start, connection_lost_recording_end},

  [QUIPUS_PROMPT_UPLOAD_DELAYED] = {upload_delayed_start, upload_delayed_end},

  [QUIPUS_PROMPT_CONSENT_RETRY] = {consent_retry_start, consent_retry_end},

  [QUIPUS_PROMPT_CONSENT_REFUSED] = {consent_refused_start, consent_refused_end},

  [QUIPUS_PROMPT_MEETING_PROCESSING] = {meeting_processing_start, meeting_processing_end},

  [QUIPUS_PROMPT_REPORT_DONE] = {report_done_start, report_done_end},

  [QUIPUS_PROMPT_NETWORK_REQUIRED] = {network_required_start, network_required_end},

  [QUIPUS_PROMPT_RECOVERY_LISTENING] = {recovery_listening_start, recovery_listening_end},

  [QUIPUS_PROMPT_SHORT_RECORDING_SKIPPED] = {short_recording_skipped_start, short_recording_skipped_end},

  [QUIPUS_PROMPT_OFFLINE_RECORD_CHOICE] = {offline_record_choice_start, offline_record_choice_end},

  [QUIPUS_PROMPT_OFFLINE_REPORT_CHOICE] = {offline_report_choice_start, offline_report_choice_end},

  [QUIPUS_PROMPT_RECORDING_STARTED] = {recording_started_start, recording_started_end},

  [QUIPUS_PROMPT_REPORT_OFFLINE] = {report_offline_start, report_offline_end},

  [QUIPUS_PROMPT_CACHED_REPORT] = {cached_report_start, cached_report_end},

  [QUIPUS_PROMPT_NO_CACHED_REPORT] = {no_cached_report_start, no_cached_report_end},

};


static esp_err_t play_adpcm_asset(const uint8_t *data, size_t length) {
  if (!data || !length || length > 100000U) return ESP_ERR_INVALID_SIZE;
  esp_err_t result = lantern_audio_pcm_begin();
  if (result != ESP_OK) return result;
  quipus_adpcm_state_t state;
  quipus_adpcm_init(&state);
  int16_t output[1024];
  for (size_t offset = 0; offset < length; offset += 512) {
    size_t bytes = length - offset;
    if (bytes > 512) bytes = 512;
    size_t samples = quipus_adpcm_decode(data + offset, bytes, output, 1024, &state);
    if (samples != bytes * 2) { result = ESP_FAIL; break; }
    result = lantern_audio_pcm_write(output, samples * sizeof(output[0]));
    if (result != ESP_OK) break;
  }
  if (result != ESP_OK) lantern_audio_pcm_cancel();
  esp_err_t drained = lantern_audio_pcm_end();
  return result != ESP_OK ? result : drained;
}
esp_err_t quipus_play_prompt(quipus_prompt_t prompt) {
  if (prompt < 0 || prompt >= QUIPUS_PROMPT_COUNT) return ESP_ERR_INVALID_ARG;
  const prompt_asset_t *asset = &s_prompt_assets[prompt];
  return play_adpcm_asset(asset->start, (size_t)(asset->end - asset->start));
}


esp_err_t quipus_play_consent_prompt(void) { return quipus_play_prompt(QUIPUS_PROMPT_CONSENT); }

esp_err_t quipus_play_error_prompt(void) { return quipus_play_prompt(QUIPUS_PROMPT_ERROR); }

esp_err_t quipus_play_uploading_prompt(void) { return quipus_play_prompt(QUIPUS_PROMPT_UPLOADING); }

esp_err_t quipus_play_uploaded_prompt(void) { return quipus_play_prompt(QUIPUS_PROMPT_UPLOADED); }

esp_err_t quipus_play_saved_offline_prompt(void) { return quipus_play_prompt(QUIPUS_PROMPT_SAVED_OFFLINE); }
