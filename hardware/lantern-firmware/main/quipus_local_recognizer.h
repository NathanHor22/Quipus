#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define QUIPUS_LOCAL_SAMPLE_RATE 16000U
#define QUIPUS_LOCAL_MAX_SAMPLES (QUIPUS_LOCAL_SAMPLE_RATE * 5U)

typedef enum {
  QUIPUS_LOCAL_SILENCE = 0,
  QUIPUS_LOCAL_UNKNOWN = 1,
  QUIPUS_LOCAL_YES = 2,
  QUIPUS_LOCAL_NO = 3
} quipus_local_intent_t;

/* Navigation selects a question only; it must never authorize recording. */
typedef enum {
  QUIPUS_LOCAL_PURPOSE_CONSENT,
  QUIPUS_LOCAL_PURPOSE_NAVIGATION
} quipus_local_purpose_t;

/* Bounded metadata for acoustic debugging: no PCM, text or persistent history.
 * Window times refer to the end of each approximately one-second context. */
typedef struct {
  uint16_t yes_windows, no_windows, possible_no_windows;
  uint16_t first_no_end_ms, last_no_end_ms, peak_yes_end_ms, peak_no_end_ms;
  uint16_t peak_abs, rms;
  uint16_t first_no_rms, last_no_rms, peak_yes_rms, peak_no_rms;
  int16_t dc_mean;
  uint32_t clipped_samples;
  bool vad_available;
  bool background_verified, response_truncated;
  uint16_t background_rms, ambiguous_frames, unexplained_speech_frames;
  uint16_t first_ambiguous_end_ms, last_ambiguous_end_ms;
  uint16_t first_ambiguous_rms, last_ambiguous_rms, onset_attached_frames;
  uint16_t vad_frames, vad_speech_frames, vad_last_speech_end_ms;
  uint16_t first_no_voiced_ms, last_no_voiced_ms, peak_yes_voiced_ms, peak_no_voiced_ms;
  uint8_t peak_yes_scores[4], peak_no_scores[4];
} quipus_local_diagnostics_t;

typedef struct {
  quipus_local_intent_t intent;
  uint8_t confidence; /* Quantized probability, 0..255; not a calibrated accuracy. */
  uint16_t windows;
  quipus_local_diagnostics_t diagnostics;
} quipus_local_result_t;

/* Initialize once after audio setup. Does not own I2S or start a task. */
esp_err_t quipus_local_recognizer_init(void);
bool quipus_local_recognizer_available(void);

/* Call from the serialized application task, never the realtime mic callback.
 * Samples are signed16-bit mono16kHz, at most5s; caller retains the buffer.
 * Fixed internal workspaces are reused; inference allocates no heap memory.
 * Only YES/NO keywords are trained, with unknown/silence classes. This is not
 * a general command transcriber; out-of-vocabulary speech can be misclassified.
 * All windows are inspected before a decision; a later trusted NO takes priority.
 * An error always leaves result.intent UNKNOWN. No raw audio is retained here.
 */
/* Strict consent admission is the default and remains separate from menus. */
esp_err_t quipus_local_recognizer_classify(const int16_t *samples,
    size_t sample_count, quipus_local_result_t *result);

/* Non-authorizing YES/NO menu selection. Uses the same bounded inference and
 * speech-supported word votes, including later NO priority within the captured
 * response. Environmental affirmative-admission checks remain consent-only.
 * A menu YES must be erased before a fresh, strict consent response is captured.
 */
esp_err_t quipus_local_recognizer_classify_navigation(const int16_t *samples,
    size_t sample_count, quipus_local_result_t *result);

#ifdef __cplusplus
}
#endif
