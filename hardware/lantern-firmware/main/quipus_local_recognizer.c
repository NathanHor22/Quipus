#include "quipus_local_recognizer.h"
#include "quipus_local_inference.h"
#include "esp_log.h"
#include <stdatomic.h>
#include <string.h>

static atomic_bool s_available;
static atomic_flag s_owner = ATOMIC_FLAG_INIT;
static bool s_self_test_active;

/* Prototype admission gates, not measured accuracy. Unknown/silence never vote
 * YES. Two overlapping confident YES windows are required; any confident NO
 * wins, and even an uncertain dominant NO prevents affirmative admission.
 * Votes require speech support; verified background never casts a word vote. */
#define TRUSTED_SCORE 200U
#define TRUSTED_MARGIN 32U
#define POSSIBLE_NO_SCORE 128U
// A weak (untrusted) NO vetoes YES only with real speech in its context; a
// quiet tail holding the last few ms of an explained word is not a refusal.
// A trusted NO still wins with any voiced support.
#define POSSIBLE_NO_VOICED_MS 100U

typedef struct {
  unsigned yes_votes, silence_votes, windows;
  bool trusted_no, possible_no;
  uint8_t yes_score, no_score;
} decision_t;

static bool trusted(const uint8_t scores[4], unsigned label) {
  uint8_t other = 0;
  for (unsigned i = 0; i < 4; ++i)
    if (i != label && scores[i] > other) other = scores[i];
  return scores[label] >= TRUSTED_SCORE && scores[label] >= other + TRUSTED_MARGIN;
}

static void observe(decision_t *decision, quipus_local_diagnostics_t *diagnostics,
                    const uint8_t scores[4], uint16_t end_ms, uint16_t rms, uint16_t voiced_ms) {
  ++decision->windows;
  if (!s_self_test_active) ESP_LOGI("quipus_local", "window_end_ms=%u rms=%u vad_available=%u voiced_ms=%u scores_silence_unknown_yes_no=%u,%u,%u,%u",
      end_ms, rms, diagnostics->vad_available, voiced_ms, scores[0], scores[1], scores[2], scores[3]);
  // Every window is inspected/logged, including the full quiet tail, but a
  // keyword probability over verified background is not a spoken word.
  if (!s_self_test_active && (!diagnostics->vad_available || !voiced_ms)) return;
  if (trusted(scores, QUIPUS_LOCAL_YES)) ++decision->yes_votes;
  diagnostics->yes_windows = (uint16_t)decision->yes_votes;
  if (trusted(scores, QUIPUS_LOCAL_NO)) {
    decision->trusted_no = true;
    if (!diagnostics->no_windows) {
      diagnostics->first_no_end_ms = end_ms;
      diagnostics->first_no_rms = rms;
      diagnostics->first_no_voiced_ms = voiced_ms;
    }
    diagnostics->last_no_rms = rms;
    diagnostics->last_no_voiced_ms = voiced_ms;
    diagnostics->last_no_end_ms = end_ms;
    ++diagnostics->no_windows;
  }
  if (trusted(scores, QUIPUS_LOCAL_SILENCE)) ++decision->silence_votes;
  if (scores[QUIPUS_LOCAL_NO] >= POSSIBLE_NO_SCORE &&
      (s_self_test_active || voiced_ms >= POSSIBLE_NO_VOICED_MS)) {
    decision->possible_no = true;
    ++diagnostics->possible_no_windows;
  }
  if (scores[QUIPUS_LOCAL_YES] > decision->yes_score) {
    diagnostics->peak_yes_end_ms = end_ms;
    diagnostics->peak_yes_rms = rms;
    diagnostics->peak_yes_voiced_ms = voiced_ms;
    memcpy(diagnostics->peak_yes_scores, scores, 4);
  }
  if (scores[QUIPUS_LOCAL_NO] > decision->no_score) {
    diagnostics->peak_no_end_ms = end_ms;
    diagnostics->peak_no_rms = rms;
    diagnostics->peak_no_voiced_ms = voiced_ms;
    memcpy(diagnostics->peak_no_scores, scores, 4);
  }
  if (scores[QUIPUS_LOCAL_YES] > decision->yes_score) decision->yes_score = scores[QUIPUS_LOCAL_YES];
  if (scores[QUIPUS_LOCAL_NO] > decision->no_score) decision->no_score = scores[QUIPUS_LOCAL_NO];
}

static uint16_t integer_sqrt(uint32_t value) {
  uint32_t root = 0, bit = 1U << 30;
  while (bit > value) bit >>= 2;
  while (bit) {
    if (value >= root + bit) {
      value -= root + bit;
      root = (root >> 1) + bit;
    } else root >>= 1;
    bit >>= 2;
  }
  return (uint16_t)root;
}

static uint16_t window_rms(const int16_t *samples, size_t count) {
  uint64_t energy = 0;
  for (size_t i = 0; i < count; ++i) {
    int32_t value = samples[i];
    energy += (uint64_t)((int64_t)value * value);
  }
  return integer_sqrt((uint32_t)(energy / count));
}

#define SHADOW_VAD_MAX_FRAMES (QUIPUS_LOCAL_MAX_SAMPLES / QUIPUS_LOCAL_FRAME_STRIDE)
static void shadow_vad(const int16_t *samples, size_t count,
                       uint8_t voiced[SHADOW_VAD_MAX_FRAMES], quipus_local_diagnostics_t *d) {
  size_t frames = (count + QUIPUS_LOCAL_FRAME_STRIDE - 1) / QUIPUS_LOCAL_FRAME_STRIDE;
  for (size_t frame = 0; frame < frames; ++frame) {
    bool speech = false;
    const int16_t *input = samples + frame * QUIPUS_LOCAL_FRAME_STRIDE;
    size_t remaining = count - frame * QUIPUS_LOCAL_FRAME_STRIDE;
    int16_t partial[QUIPUS_LOCAL_FRAME_STRIDE] = {0};
    if (remaining < QUIPUS_LOCAL_FRAME_STRIDE) {
      memcpy(partial, input, remaining * sizeof(int16_t));
      input = partial;
    }
    esp_err_t detected = quipus_local_inference_vad_frame(input, &speech);
    memset(partial, 0, sizeof(partial));
    if (detected != ESP_OK) {
      // Unavailable/partial VAD evidence is never displayed as verified silence.
      memset(voiced, 0, SHADOW_VAD_MAX_FRAMES);
      d->vad_available = false;
      d->vad_frames = d->vad_speech_frames = d->vad_last_speech_end_ms = 0;
      return;
    }
    voiced[frame] = speech;
    ++d->vad_frames;
    if (speech) {
      ++d->vad_speech_frames;
      size_t end = (frame + 1) * QUIPUS_LOCAL_FRAME_STRIDE;
      if (end > count) end = count;
      d->vad_last_speech_end_ms = (uint16_t)(end * 1000U / QUIPUS_LOCAL_SAMPLE_RATE);
    }
  }
  d->vad_available = true;
}

static uint16_t voiced_overlap_ms(const uint8_t voiced[SHADOW_VAD_MAX_FRAMES],
                                  size_t first_frame, size_t last_frame) {
  uint16_t ms = 0;
  // The model context comprises49 complete20ms blocks plus a final10ms.
  for (size_t i = first_frame; i <= last_frame; ++i)
    if (voiced[i]) ms += 20;
  if (last_frame + 1 < SHADOW_VAD_MAX_FRAMES && voiced[last_frame + 1]) ms += 10;
  return ms;
}

/* Conservative background proof for this prototype. Calibrate from the
 * unvoiced prefix or, when the answer starts at once, from 500ms of silence
 * that begins 200ms after the last voiced frame. A noisy room, DC drift, a
 * sustained above-floor run or a strong burst prevents YES; these bounds cannot
 * prove speech below the background was absent. */
#define CALIBRATION_FRAMES 25U
#define MIN_PREFIX_FRAMES 5U
#define VAD_GUARD_FRAMES 5U
// Any spoken word, including a quiet "no", lasts well over100ms; shorter,
// weaker fluctuations are room noise. Above 3 x floor + 8 counts at once.
#define AMBIGUOUS_RUN_FRAMES 5U
// Unvoiced word endings (the /s/ of "yes") often fall silent to VAD; a
// contiguous above-floor tail of up to200ms belongs to the preceding word.
#define VAD_OFFSET_FRAMES 10U
static void qualify_activity(const int16_t *samples, size_t count,
                             const uint8_t voiced[SHADOW_VAD_MAX_FRAMES],
                             uint8_t associated[SHADOW_VAD_MAX_FRAMES],
                             quipus_local_diagnostics_t *d) {
  if (!d->vad_available) return;
  size_t frames = (count + QUIPUS_LOCAL_FRAME_STRIDE - 1) / QUIPUS_LOCAL_FRAME_STRIDE;
  uint16_t calibration[CALIBRATION_FRAMES];
  size_t first_voice = 0, last_voice = 0;
  while (first_voice < frames && !voiced[first_voice]) ++first_voice;
  for (size_t frame = 0; frame < frames; ++frame) if (voiced[frame]) last_voice = frame;
  // VAD inherently reports an onset late. Reserve100ms from calibration;
  // those samples are not automatically accepted as speech or background.
  size_t prefix_limit = first_voice > VAD_GUARD_FRAMES ? first_voice - VAD_GUARD_FRAMES : 0;
  size_t calibration_first = 0, calibration_count = 0;
  if (prefix_limit >= MIN_PREFIX_FRAMES) {
    calibration_count = prefix_limit < CALIBRATION_FRAMES ? prefix_limit : CALIBRATION_FRAMES;
  } else if (first_voice < frames) {
    // Prompt answers leave no prefix. Use the quiet after the word instead,
    // beyond the200ms an unvoiced word ending may still occupy.
    size_t tail = last_voice + 1 + VAD_OFFSET_FRAMES;
    size_t complete = count / QUIPUS_LOCAL_FRAME_STRIDE;
    if (tail + CALIBRATION_FRAMES > complete) return;
    for (size_t frame = tail; frame < tail + CALIBRATION_FRAMES; ++frame)
      if (voiced[frame]) return;
    calibration_first = tail;
    calibration_count = CALIBRATION_FRAMES;
  }
  if (calibration_count < MIN_PREFIX_FRAMES) return;
  for (size_t i = 0; i < calibration_count; ++i)
    calibration[i] = window_rms(samples + (calibration_first + i) * QUIPUS_LOCAL_FRAME_STRIDE,
                                QUIPUS_LOCAL_FRAME_STRIDE);
  for (size_t i = 1; i < calibration_count; ++i) {
    uint16_t value = calibration[i];
    size_t j = i;
    while (j && calibration[j - 1] > value) { calibration[j] = calibration[j - 1]; --j; }
    calibration[j] = value;
  }
  uint16_t floor = calibration[calibration_count / 2];
  d->background_rms = floor;
  if (floor > 96) return; // Conservative prototype ceiling; noisy/uncertain means no YES.
  uint32_t upper = floor ? (3U * floor + 1U) / 2U + 2U : 0;
  uint32_t strong = floor ? 3U * floor + 8U : 0;
  int64_t calibration_sum = 0;
  const int16_t *calibration_samples = samples + calibration_first * QUIPUS_LOCAL_FRAME_STRIDE;
  for (size_t i = 0; i < calibration_count * QUIPUS_LOCAL_FRAME_STRIDE; ++i)
    calibration_sum += calibration_samples[i];
  int32_t calibration_dc = (int32_t)(calibration_sum /
      (int64_t)(calibration_count * QUIPUS_LOCAL_FRAME_STRIDE));
  uint32_t dc_tolerance = floor > 8 ? floor : 8;
  // Associate only a contiguous above-floor rise immediately adjoining an
  // actual VAD onset. A quiet gap stops the walk, and100ms is a hard limit.
  // Live YES must later explain the entire expanded region in isolation.
  for (size_t frame = 0; frame < frames; ++frame) {
    if (!voiced[frame] || (frame && voiced[frame - 1])) continue;
    for (size_t back = 1; back <= VAD_GUARD_FRAMES && back <= frame; ++back) {
      size_t index = frame - back;
      if (voiced[index]) break;
      const int16_t *block = samples + index * QUIPUS_LOCAL_FRAME_STRIDE;
      if (window_rms(block, QUIPUS_LOCAL_FRAME_STRIDE) <= upper) break;
      if (!associated[index]) { associated[index] = 1; ++d->onset_attached_frames; }
    }
  }
  for (size_t frame = 0; frame < frames; ++frame) {
    if (!voiced[frame] || (frame + 1 < frames && voiced[frame + 1])) continue;
    for (size_t ahead = 1; ahead <= VAD_OFFSET_FRAMES && frame + ahead < frames; ++ahead) {
      size_t index = frame + ahead;
      if (voiced[index]) break;
      size_t remaining = count - index * QUIPUS_LOCAL_FRAME_STRIDE;
      size_t block_count = remaining < QUIPUS_LOCAL_FRAME_STRIDE ? remaining : QUIPUS_LOCAL_FRAME_STRIDE;
      if (window_rms(samples + index * QUIPUS_LOCAL_FRAME_STRIDE, block_count) <= upper) break;
      if (!associated[index]) { associated[index] = 1; ++d->onset_attached_frames; }
    }
  }
  d->background_verified = true;
  // Classify every unassociated block, then flag sustained runs and strong or
  // drifting blocks. A flagged calibration block invalidates the background.
  uint8_t level[SHADOW_VAD_MAX_FRAMES] = {0}; // 0 quiet, 1 above floor, 2 always ambiguous
  uint16_t level_rms[SHADOW_VAD_MAX_FRAMES] = {0};
  for (size_t frame = 0; frame < frames; ++frame) {
    if (associated[frame]) continue;
    const int16_t *block = samples + frame * QUIPUS_LOCAL_FRAME_STRIDE;
    size_t remaining = count - frame * QUIPUS_LOCAL_FRAME_STRIDE;
    size_t block_count = remaining < QUIPUS_LOCAL_FRAME_STRIDE ? remaining : QUIPUS_LOCAL_FRAME_STRIDE;
    int32_t sum = 0;
    for (size_t i = 0; i < block_count; ++i) sum += block[i];
    int32_t dc = sum / (int32_t)block_count - calibration_dc;
    uint32_t drift = (uint32_t)(dc < 0 ? -dc : dc);
    uint16_t rms = window_rms(block, block_count);
    level_rms[frame] = rms;
    if (rms > strong || drift > dc_tolerance) level[frame] = 2;
    else if (rms > upper) level[frame] = 1;
  }
  for (size_t frame = 0; frame < frames;) {
    if (!level[frame]) { ++frame; continue; }
    size_t run_end = frame;
    while (run_end < frames && level[run_end]) ++run_end;
    if (run_end - frame > d->longest_above_floor_frames)
      d->longest_above_floor_frames = (uint16_t)(run_end - frame);
    bool sustained = run_end - frame >= AMBIGUOUS_RUN_FRAMES;
    for (; frame < run_end; ++frame) {
      if (!sustained && level[frame] != 2) continue;
      size_t end = (frame + 1) * QUIPUS_LOCAL_FRAME_STRIDE;
      if (end > count) end = count;
      uint16_t end_ms = (uint16_t)(end * 1000U / QUIPUS_LOCAL_SAMPLE_RATE);
      if (!d->ambiguous_frames) {
        d->first_ambiguous_end_ms = end_ms;
        d->first_ambiguous_rms = level_rms[frame];
      }
      d->last_ambiguous_end_ms = end_ms;
      d->last_ambiguous_rms = level_rms[frame];
      ++d->ambiguous_frames;
      if (frame >= calibration_first && frame < calibration_first + calibration_count)
        d->background_verified = false;
    }
  }
  unsigned duration_ms = (unsigned)(count * 1000U / QUIPUS_LOCAL_SAMPLE_RATE);
  d->response_truncated = d->vad_speech_frames &&
      (unsigned)d->vad_last_speech_end_ms + 200U > duration_ms;
}

static void finish_decision(const decision_t *decision, quipus_local_result_t *result,
                            quipus_local_purpose_t purpose) {
  const quipus_local_diagnostics_t *d = &result->diagnostics;
  result->windows = (uint16_t)decision->windows;
  bool consent_activity = d->background_verified && !d->ambiguous_frames &&
      !d->response_truncated && !d->unexplained_speech_frames;
  bool affirmative_allowed = s_self_test_active || (d->vad_available &&
      (purpose == QUIPUS_LOCAL_PURPOSE_NAVIGATION || consent_activity));
  if (decision->trusted_no) {
    result->intent = QUIPUS_LOCAL_NO;
    result->confidence = decision->no_score;
  } else if (decision->yes_votes >= 2 && !decision->possible_no && affirmative_allowed) {
    result->intent = QUIPUS_LOCAL_YES;
    result->confidence = decision->yes_score;
  }
}

#define MAX_VOICE_REGIONS 8U
typedef struct {
  uint16_t first, last;
  bool explained;
} voice_region_t;
typedef struct {
  voice_region_t items[MAX_VOICE_REGIONS];
  unsigned count;
  bool overflow;
} voice_regions_t;

static voice_regions_t describe_regions(const uint8_t voiced[SHADOW_VAD_MAX_FRAMES], size_t frames) {
  voice_regions_t regions = {0};
  size_t previous = SHADOW_VAD_MAX_FRAMES;
  unsigned total = 0;
  for (size_t frame = 0; frame < frames; ++frame) {
    if (!voiced[frame]) continue;
    // Bridge only within-word gaps shorter than100ms. Separate bursts need
    // independent attribution, even if an earlier YES context overlaps them.
    if (previous == SHADOW_VAD_MAX_FRAMES || frame - previous > 5) {
      ++total;
      if (total <= MAX_VOICE_REGIONS) {
        regions.items[total - 1].first = (uint16_t)frame;
        regions.count = total;
      } else regions.overflow = true;
    }
    if (total <= MAX_VOICE_REGIONS) regions.items[total - 1].last = (uint16_t)frame;
    previous = frame;
  }
  return regions;
}

static void explain_isolated_yes(voice_regions_t *regions, size_t start, size_t count) {
  unsigned overlaps = 0, candidate = 0;
  size_t end = start + count;
  for (unsigned i = 0; i < regions->count; ++i) {
    size_t first = regions->items[i].first * QUIPUS_LOCAL_FRAME_STRIDE;
    size_t last = (regions->items[i].last + 1) * QUIPUS_LOCAL_FRAME_STRIDE;
    if (first < end && last > start) { ++overlaps; candidate = i; }
  }
  if (overlaps != 1) return;
  voice_region_t *region = &regions->items[candidate];
  if (start <= region->first * QUIPUS_LOCAL_FRAME_STRIDE &&
      end >= (region->last + 1) * QUIPUS_LOCAL_FRAME_STRIDE) region->explained = true;
}

static bool measure(const int16_t *samples, size_t count,
                    quipus_local_diagnostics_t *diagnostics) {
  uint64_t energy = 0;
  int64_t sum = 0;
  bool constant = true;
  for (size_t i = 0; i < count; ++i) {
    int32_t value = samples[i];
    uint32_t magnitude = (uint32_t)(value < 0 ? -value : value);
    if (magnitude > diagnostics->peak_abs) diagnostics->peak_abs = (uint16_t)magnitude;
    energy += (uint64_t)((int64_t)value * value);
    sum += value;
    if (value == INT16_MAX || value == INT16_MIN) ++diagnostics->clipped_samples;
    if (value != samples[0]) constant = false;
  }
  diagnostics->rms = integer_sqrt((uint32_t)(energy / count));
  diagnostics->dc_mean = (int16_t)(sum / (int64_t)count);
  return constant;
}

static void log_diagnostics(const quipus_local_result_t *result) {
  if (s_self_test_active) return;
  const quipus_local_diagnostics_t *d = &result->diagnostics;
  ESP_LOGI("quipus_local", "decision=%d windows=%u yes=%u no=%u maybe_no=%u no_end_ms=%u..%u "
      "yes_peak=%u@%u no_peak=%u@%u pcm_peak=%u rms=%u dc=%d clipped=%lu",
      result->intent, result->windows, d->yes_windows, d->no_windows, d->possible_no_windows,
      d->first_no_end_ms, d->last_no_end_ms,
      d->peak_yes_scores[QUIPUS_LOCAL_YES], d->peak_yes_end_ms,
      d->peak_no_scores[QUIPUS_LOCAL_NO], d->peak_no_end_ms,
      d->peak_abs, d->rms, (int)d->dc_mean, (unsigned long)d->clipped_samples);
  ESP_LOGI("quipus_local", "shadow_vad_available=%u frames=%u speech_frames=%u last_speech_end_ms=%u "
      "first_no_voiced_ms=%u last_no_voiced_ms=%u peak_yes_voiced_ms=%u peak_no_voiced_ms=%u",
      d->vad_available, d->vad_frames, d->vad_speech_frames, d->vad_last_speech_end_ms,
      d->first_no_voiced_ms, d->last_no_voiced_ms, d->peak_yes_voiced_ms, d->peak_no_voiced_ms);
  ESP_LOGI("quipus_local", "background_verified=%u background_rms=%u ambiguous_frames=%u "
      "unexplained_speech_frames=%u response_truncated=%u", d->background_verified, d->background_rms,
      d->ambiguous_frames, d->unexplained_speech_frames, d->response_truncated);
  ESP_LOGI("quipus_local", "ambiguous_first_end_ms=%u first_rms=%u last_end_ms=%u last_rms=%u onset_attached_frames=%u longest_above_floor_frames=%u",
      d->first_ambiguous_end_ms, d->first_ambiguous_rms,
      d->last_ambiguous_end_ms, d->last_ambiguous_rms, d->onset_attached_frames,
      d->longest_above_floor_frames);
  (void)d; // Host fixtures may compile logging out.
}

static esp_err_t classify_owned(const int16_t *samples, size_t sample_count,
                                quipus_local_result_t *result);
static esp_err_t classify_owned_for(const int16_t *samples, size_t sample_count,
    quipus_local_result_t *result, quipus_local_purpose_t purpose);

bool quipus_local_recognizer_available(void) { return atomic_load(&s_available); }

esp_err_t quipus_local_recognizer_init(void) {
  if (quipus_local_recognizer_available()) return ESP_OK;
  if (atomic_flag_test_and_set(&s_owner)) return ESP_ERR_INVALID_STATE;
  esp_err_t result = quipus_local_inference_init();
  if (result == ESP_OK) {
    s_self_test_active = true;
    result = quipus_local_inference_self_test(classify_owned);
    s_self_test_active = false;
  }
  atomic_store(&s_available, result == ESP_OK);
  atomic_flag_clear(&s_owner);
  return result;
}

static esp_err_t classify_for(const int16_t *samples, size_t sample_count,
    quipus_local_result_t *result, quipus_local_purpose_t purpose) {
  if (!result) return ESP_ERR_INVALID_ARG;
  *result = (quipus_local_result_t){.intent = QUIPUS_LOCAL_UNKNOWN};
  if (!samples || sample_count > QUIPUS_LOCAL_MAX_SAMPLES) return ESP_ERR_INVALID_ARG;
  if (sample_count < QUIPUS_LOCAL_SAMPLE_RATE) return ESP_ERR_INVALID_SIZE;
  if (!quipus_local_recognizer_available()) return ESP_ERR_NOT_SUPPORTED;
  if (atomic_flag_test_and_set(&s_owner)) return ESP_ERR_INVALID_STATE;
  esp_err_t status = classify_owned_for(samples, sample_count, result, purpose);
  atomic_flag_clear(&s_owner);
  return status;
}

esp_err_t quipus_local_recognizer_classify(const int16_t *samples,
    size_t sample_count, quipus_local_result_t *result) {
  return classify_for(samples, sample_count, result, QUIPUS_LOCAL_PURPOSE_CONSENT);
}

esp_err_t quipus_local_recognizer_classify_navigation(const int16_t *samples,
    size_t sample_count, quipus_local_result_t *result) {
  return classify_for(samples, sample_count, result, QUIPUS_LOCAL_PURPOSE_NAVIGATION);
}

/* Startup self-testing retains the same strict callback contract. */
static esp_err_t classify_owned(const int16_t *samples, size_t sample_count,
                                quipus_local_result_t *result) {
  return classify_owned_for(samples, sample_count, result, QUIPUS_LOCAL_PURPOSE_CONSENT);
}

/* Caller already owns the gate, including during the startup self-test. */
static esp_err_t classify_owned_for(const int16_t *samples, size_t sample_count,
    quipus_local_result_t *result, quipus_local_purpose_t purpose) {
  *result = (quipus_local_result_t){.intent = QUIPUS_LOCAL_UNKNOWN};
  quipus_local_inference_reset();
  uint8_t voiced[SHADOW_VAD_MAX_FRAMES] = {0};
  shadow_vad(samples, sample_count, voiced, &result->diagnostics);
  uint8_t associated[SHADOW_VAD_MAX_FRAMES];
  memcpy(associated, voiced, sizeof(associated));
  qualify_activity(samples, sample_count, voiced, associated, &result->diagnostics);
  bool constant = measure(samples, sample_count, &result->diagnostics);
  if (constant) {
    if (samples[0] == 0 && result->diagnostics.vad_available) {
      result->intent = QUIPUS_LOCAL_SILENCE;
      result->confidence = 255;
    }
    quipus_local_inference_reset();
    log_diagnostics(result);
    return ESP_OK;
  }

  decision_t decision = {0};
  voice_regions_t regions = describe_regions(associated,
      (sample_count + QUIPUS_LOCAL_FRAME_STRIDE - 1) / QUIPUS_LOCAL_FRAME_STRIDE);
  esp_err_t status = ESP_OK;
  size_t frames = (sample_count - QUIPUS_LOCAL_FRAME_SAMPLES) / QUIPUS_LOCAL_FRAME_STRIDE + 1;
  for (size_t frame = 0; frame < frames; ++frame) {
    bool complete = frame + 1 >= QUIPUS_LOCAL_FEATURE_FRAMES;
    bool infer = complete && ((frame + 1 - QUIPUS_LOCAL_FEATURE_FRAMES) % 5U == 0 || frame + 1 == frames);
    uint8_t scores[4] = {0};
    status = quipus_local_inference_frame(samples + frame * QUIPUS_LOCAL_FRAME_STRIDE,
                                         infer, scores);
    if (status != ESP_OK) break;
    if (infer) {
      uint16_t end_ms = (uint16_t)((frame * QUIPUS_LOCAL_FRAME_STRIDE +
          QUIPUS_LOCAL_FRAME_SAMPLES) * 1000U / QUIPUS_LOCAL_SAMPLE_RATE);
      size_t first = (frame + 1 - QUIPUS_LOCAL_FEATURE_FRAMES) * QUIPUS_LOCAL_FRAME_STRIDE;
      size_t count = (QUIPUS_LOCAL_FEATURE_FRAMES - 1) * QUIPUS_LOCAL_FRAME_STRIDE + QUIPUS_LOCAL_FRAME_SAMPLES;
      observe(&decision, &result->diagnostics, scores, end_ms, window_rms(samples + first, count),
          voiced_overlap_ms(voiced, frame + 1 - QUIPUS_LOCAL_FEATURE_FRAMES, frame));
      if (trusted(scores, QUIPUS_LOCAL_YES)) explain_isolated_yes(&regions, first, count);
    }
  }
  /* Clear raw frontend input and derived features before relinquishing owner. */
  quipus_local_inference_reset();
  if (status == ESP_OK) {
    if (regions.overflow) ++result->diagnostics.unexplained_speech_frames;
    for (unsigned region = 0; region < regions.count; ++region) {
      if (regions.items[region].explained) continue;
      for (size_t frame = regions.items[region].first; frame <= regions.items[region].last; ++frame)
        if (associated[frame]) ++result->diagnostics.unexplained_speech_frames;
    }
    finish_decision(&decision, result, purpose);
  }
  log_diagnostics(result);
  return status;
}
