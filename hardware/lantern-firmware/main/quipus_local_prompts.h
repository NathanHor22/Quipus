#pragma once

#include "esp_err.h"

// Fixed, nonprivate consent speech stored in flash. This only asks the question;
// it never confirms consent or starts recording. Playback is synchronous.
esp_err_t quipus_play_consent_prompt(void);

// Fixed audio-first recovery guidance; no provider or session-state changes.
esp_err_t quipus_play_error_prompt(void);

// Fixed delivery guidance only. The controller must separately verify the
// upload/save outcome before choosing its matching spoken announcement.
esp_err_t quipus_play_uploading_prompt(void);
esp_err_t quipus_play_uploaded_prompt(void);
esp_err_t quipus_play_saved_offline_prompt(void);

// Essential interface speech is local and bounded. The caller owns priority,
// issue/interaction deduplication and whether a safety statement is valid.
typedef enum {
  QUIPUS_PROMPT_CONSENT,
  QUIPUS_PROMPT_ERROR,
  QUIPUS_PROMPT_UPLOADING,
  QUIPUS_PROMPT_UPLOADED,
  QUIPUS_PROMPT_SAVED_OFFLINE,
  QUIPUS_PROMPT_LISTENING,
  QUIPUS_PROMPT_COMMAND_RETRY,
  QUIPUS_PROMPT_COMMAND_UNCLEAR,
  QUIPUS_PROMPT_VOICE_UNAVAILABLE,
  QUIPUS_PROMPT_SD_FAILURE,
  QUIPUS_PROMPT_CONNECTION_LOST_RECORDING,
  QUIPUS_PROMPT_UPLOAD_DELAYED,
  QUIPUS_PROMPT_CONSENT_RETRY,
  QUIPUS_PROMPT_CONSENT_REFUSED,
  QUIPUS_PROMPT_MEETING_PROCESSING,
  QUIPUS_PROMPT_REPORT_DONE,
  QUIPUS_PROMPT_NETWORK_REQUIRED,
  QUIPUS_PROMPT_RECOVERY_LISTENING,
  QUIPUS_PROMPT_SHORT_RECORDING_SKIPPED,
  QUIPUS_PROMPT_OFFLINE_RECORD_CHOICE,
  QUIPUS_PROMPT_OFFLINE_REPORT_CHOICE,
  QUIPUS_PROMPT_RECORDING_STARTED,
  QUIPUS_PROMPT_REPORT_OFFLINE,
  QUIPUS_PROMPT_CACHED_REPORT,
  QUIPUS_PROMPT_NO_CACHED_REPORT,
  QUIPUS_PROMPT_COUNT,
} quipus_prompt_t;
esp_err_t quipus_play_prompt(quipus_prompt_t prompt);
