// Experimental offline DS-CNN backend. Enabled explicitly for the pilot board.
#include "quipus_local_inference.h"
#include "sdkconfig.h"

#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154 && CONFIG_QUIPUS_EXPERIMENTAL_OFFLINE_DSCNN
#include "quipus_dscnn.h"
#include "quipus_mfcc.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_vad.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <algorithm>
#include <cstring>
#include <cstdlib>

extern const uint8_t model_start[] asm("_binary_kws_ref_model_tflite_start");
extern const uint8_t model_end[] asm("_binary_kws_ref_model_tflite_end");
extern const uint8_t yes_pcm_start[] asm("_binary_micro_speech_self_test_yes_pcm_start");
extern const uint8_t yes_pcm_end[] asm("_binary_micro_speech_self_test_yes_pcm_end");
extern const uint8_t no_pcm_start[] asm("_binary_kws_self_test_no_pcm_start");
extern const uint8_t no_pcm_end[] asm("_binary_kws_self_test_no_pcm_end");

namespace {
constexpr const char *kTag = "quipus_local_dscnn";
constexpr size_t kModelBytes = 53936;
constexpr size_t kContextSamples =
    (QUIPUS_LOCAL_FEATURE_FRAMES - 1) * QUIPUS_LOCAL_FRAME_STRIDE +
    QUIPUS_LOCAL_FRAME_SAMPLES;
static_assert(kContextSamples == 15840, "DS-CNN context is990ms before zero padding");
static_assert(QUIPUS_MFCC_FEATURES == QUIPUS_DSCNN_FEATURES, "frontend/model contract");

// One allocation for the serialized recognizer. The live interpreter arena is
// never cleared by per-turn resets; only its variables and input are reset.
struct alignas(16) Workspace {
  uint8_t arena[QUIPUS_DSCNN_ARENA_BYTES];
  int16_t pcm[kContextSamples];
  quipus_mfcc_workspace_t frontend;
  int8_t features[QUIPUS_MFCC_FEATURES];
  int16_t vad_frame[QUIPUS_LOCAL_FRAME_STRIDE];
};
struct Timing {
  unsigned contexts, invokes, zero_contexts;
  int64_t started_at, mfcc_us, invoke_us, max_mfcc_us, max_invoke_us;
};
Workspace *s_workspace;
vad_handle_t s_vad;
bool s_ready, s_attempted;
size_t s_frames;
Timing s_timing;
uint8_t s_other_word_score;
uint8_t s_other_word_label = UINT8_MAX;

void clear_other_word_context() {
  s_other_word_score = 0;
  s_other_word_label = UINT8_MAX;
}

void log_memory(const char *phase) {
  ESP_LOGI(kTag, "phase=%s internal_free=%u internal_largest=%u psram_free=%u "
      "psram_largest=%u stack_free=%u", phase,
      unsigned(heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)),
      unsigned(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT)),
      unsigned(heap_caps_get_free_size(MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)),
      unsigned(heap_caps_get_largest_free_block(MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)),
      unsigned(uxTaskGetStackHighWaterMark(nullptr)));
  (void)phase; // Test builds may suppress logging.
}
void release_failed_workspace() {
  clear_other_word_context();
  quipus_dscnn_close();
  if (!s_workspace) return;
  volatile uint8_t *bytes = reinterpret_cast<volatile uint8_t *>(s_workspace);
  for (size_t i = 0; i < sizeof(*s_workspace); ++i) bytes[i] = 0;
  std::free(s_workspace);
  s_workspace = nullptr;
}
void log_turn_timing() {
  if (!s_timing.contexts) return;
  ESP_LOGI(kTag, "experimental contexts=%u invokes=%u zero_contexts=%u "
      "mfcc_total_us=%lld invoke_total_us=%lld mfcc_max_us=%lld invoke_max_us=%lld "
      "loop_us=%lld arena_used=%u arena_cap=%u stack_free=%u",
      s_timing.contexts, s_timing.invokes, s_timing.zero_contexts,
      static_cast<long long>(s_timing.mfcc_us), static_cast<long long>(s_timing.invoke_us),
      static_cast<long long>(s_timing.max_mfcc_us), static_cast<long long>(s_timing.max_invoke_us),
      static_cast<long long>(esp_timer_get_time() - s_timing.started_at),
      unsigned(quipus_dscnn_arena_used()), QUIPUS_DSCNN_ARENA_BYTES,
      unsigned(uxTaskGetStackHighWaterMark(nullptr)));
}
}

extern "C" esp_err_t quipus_local_inference_init(void) {
  clear_other_word_context();
  if (s_ready) return ESP_OK;
  if (s_attempted) return ESP_FAIL;
  s_attempted = true;
  const size_t model_bytes = static_cast<size_t>(model_end - model_start);
  if (model_bytes != kModelBytes) {
    ESP_LOGE(kTag, "embedded model length=%u expected=%u", unsigned(model_bytes), unsigned(kModelBytes));
    return ESP_ERR_INVALID_SIZE;
  }
  log_memory("before_init");
  s_workspace = static_cast<Workspace *>(heap_caps_aligned_alloc(
      16, sizeof(Workspace), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (!s_workspace) {
    ESP_LOGE(kTag, "experimental workspace allocation failed bytes=%u", unsigned(sizeof(Workspace)));
    log_memory("allocation_failed");
    return ESP_ERR_NO_MEM;
  }
  std::memset(s_workspace, 0, sizeof(*s_workspace));
  const int64_t initialized_at = esp_timer_get_time();
  const auto model_status = quipus_dscnn_init_with_arena(model_start, model_bytes,
      s_workspace->arena, sizeof(s_workspace->arena));
  const int64_t initialization_us = esp_timer_get_time() - initialized_at;
  ESP_LOGI(kTag, "experimental model_status=%d init_us=%lld workspace=%u "
      "arena_used=%u arena_cap=%u stack_free=%u", int(model_status),
      static_cast<long long>(initialization_us), unsigned(sizeof(Workspace)),
      unsigned(quipus_dscnn_arena_used()), QUIPUS_DSCNN_ARENA_BYTES,
      unsigned(uxTaskGetStackHighWaterMark(nullptr)));
  (void)initialization_us;
  if (model_status != QUIPUS_DSCNN_OK) {
    release_failed_workspace();
    log_memory("model_failed");
    return ESP_FAIL;
  }
  s_vad = vad_create(VAD_MODE_0);
  if (!s_vad) {
    ESP_LOGE(kTag, "experimental activity VAD unavailable");
    release_failed_workspace();
    return ESP_ERR_NOT_SUPPORTED;
  }
  s_ready = true;
  quipus_local_inference_reset();
  log_memory("after_init");
  return s_ready ? ESP_OK : ESP_FAIL;
}

extern "C" esp_err_t quipus_local_inference_self_test(quipus_local_classify_fn classify) {
  constexpr size_t fixture_bytes = QUIPUS_LOCAL_SAMPLE_RATE * sizeof(int16_t);
  if (!s_ready || !classify ||
      static_cast<size_t>(yes_pcm_end - yes_pcm_start) != fixture_bytes ||
      static_cast<size_t>(no_pcm_end - no_pcm_start) != fixture_bytes) {
    ESP_LOGE(kTag, "experimental public fixture bounds or backend state invalid");
    return ESP_FAIL;
  }
  auto *samples = static_cast<int16_t *>(heap_caps_aligned_alloc(16,
      QUIPUS_LOCAL_MAX_SAMPLES * sizeof(int16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (!samples) return ESP_ERR_NO_MEM;
  const int64_t self_test_at = esp_timer_get_time();
  esp_err_t status = ESP_OK;
  for (unsigned word = 0; word < 2; ++word) {
    std::memset(samples, 0, QUIPUS_LOCAL_MAX_SAMPLES * sizeof(int16_t));
    std::memcpy(samples + QUIPUS_LOCAL_SAMPLE_RATE,
        word ? no_pcm_start : yes_pcm_start, fixture_bytes);
    quipus_local_result_t result = {};
    const auto expected = word ? QUIPUS_LOCAL_NO : QUIPUS_LOCAL_YES;
    const int64_t tested_at = esp_timer_get_time();
    const esp_err_t tested = classify(samples, QUIPUS_LOCAL_MAX_SAMPLES, &result);
    const bool passed = tested == ESP_OK && result.intent == expected && result.windows == 41;
    ESP_LOGI(kTag, "public fixture self-test %s: decision=%d confidence=%u "
        "windows=%u elapsed_ms=%lld outcome=%s", word ? "NO" : "YES", result.intent,
        result.confidence, result.windows,
        static_cast<long long>((esp_timer_get_time() - tested_at) / 1000), passed ? "PASS" : "FAIL");
    (void)tested_at;
    if (!passed) status = ESP_FAIL;
  }
  volatile int16_t *clear = samples;
  for (size_t i = 0; i < QUIPUS_LOCAL_MAX_SAMPLES; ++i) clear[i] = 0;
  std::free(samples);
  quipus_local_inference_reset();
  ESP_LOGI(kTag, "experimental startup self-test status=%d elapsed_ms=%lld stack_free=%u",
      status, static_cast<long long>((esp_timer_get_time() - self_test_at) / 1000),
      unsigned(uxTaskGetStackHighWaterMark(nullptr)));
  (void)self_test_at;
  return status;
}

extern "C" uint8_t quipus_local_inference_other_word_score(void) {
  return s_other_word_score;
}

extern "C" uint8_t quipus_local_inference_other_word_label(void) {
  return s_other_word_label;
}

extern "C" void quipus_local_inference_reset(void) {
  clear_other_word_context();
  log_turn_timing();
  s_timing = {};
  s_frames = 0;
  if (s_vad) vad_reset_trigger(s_vad);
  if (!s_workspace) return;
  std::memset(s_workspace->pcm, 0, sizeof(s_workspace->pcm));
  std::memset(&s_workspace->frontend, 0, sizeof(s_workspace->frontend));
  std::memset(s_workspace->features, 0, sizeof(s_workspace->features));
  std::memset(s_workspace->vad_frame, 0, sizeof(s_workspace->vad_frame));
  if (s_ready && quipus_dscnn_reset() != QUIPUS_DSCNN_OK) {
    ESP_LOGE(kTag, "experimental interpreter reset failed; local recognition disabled");
    s_ready = false;
  }
}

extern "C" esp_err_t quipus_local_inference_vad_frame(const int16_t *frame, bool *speech) {
  if (speech) *speech = false;
  if (!speech || !frame) return ESP_ERR_INVALID_ARG;
  if (!s_ready || !s_workspace || !s_vad) return ESP_ERR_NOT_SUPPORTED;
  std::memcpy(s_workspace->vad_frame, frame, sizeof(s_workspace->vad_frame));
  *speech = vad_process(s_vad, s_workspace->vad_frame, QUIPUS_LOCAL_SAMPLE_RATE, 20) == VAD_SPEECH;
  std::memset(s_workspace->vad_frame, 0, sizeof(s_workspace->vad_frame));
  return ESP_OK;
}

extern "C" esp_err_t quipus_local_inference_frame(const int16_t *frame, bool classify,
                                                   uint8_t probabilities[4]) {
  clear_other_word_context();
  if (probabilities) std::memset(probabilities, 0, 4);
  if (!s_ready || !s_workspace || !frame || !probabilities) return ESP_ERR_INVALID_STATE;
  if (!s_frames) {
    s_timing.started_at = esp_timer_get_time();
    std::memcpy(s_workspace->pcm, frame, QUIPUS_LOCAL_FRAME_SAMPLES * sizeof(int16_t));
  } else {
    size_t used = s_frames * QUIPUS_LOCAL_FRAME_STRIDE +
        (QUIPUS_LOCAL_FRAME_SAMPLES - QUIPUS_LOCAL_FRAME_STRIDE);
    if (used > kContextSamples) used = kContextSamples;
    if (used == kContextSamples) {
      std::memmove(s_workspace->pcm, s_workspace->pcm + QUIPUS_LOCAL_FRAME_STRIDE,
          (kContextSamples - QUIPUS_LOCAL_FRAME_STRIDE) * sizeof(int16_t));
      used -= QUIPUS_LOCAL_FRAME_STRIDE;
    }
    std::memcpy(s_workspace->pcm + used,
        frame + (QUIPUS_LOCAL_FRAME_SAMPLES - QUIPUS_LOCAL_FRAME_STRIDE),
        QUIPUS_LOCAL_FRAME_STRIDE * sizeof(int16_t));
  }
  if (s_frames < QUIPUS_LOCAL_FEATURE_FRAMES) ++s_frames;
  if (!classify) return ESP_OK;
  if (s_frames < QUIPUS_LOCAL_FEATURE_FRAMES) return ESP_ERR_INVALID_STATE;
  ++s_timing.contexts;
  const int64_t frontend_at = esp_timer_get_time();
  // Training frontend normalizes the990ms context and pads160 zeros to1s.
  const auto frontend_status = quipus_mfcc_compute(&s_workspace->frontend,
      s_workspace->pcm, kContextSamples, nullptr, s_workspace->features);
  const int64_t frontend_us = esp_timer_get_time() - frontend_at;
  s_timing.mfcc_us += frontend_us;
  s_timing.max_mfcc_us = std::max(s_timing.max_mfcc_us, frontend_us);
  if (frontend_status != QUIPUS_MFCC_OK) {
    bool zero = frontend_status == QUIPUS_MFCC_NO_POSITIVE_PEAK;
    for (size_t i = 0; zero && i < kContextSamples; ++i) zero = s_workspace->pcm[i] == 0;
    if (zero) {
      ++s_timing.zero_contexts;
      probabilities[QUIPUS_LOCAL_SILENCE] = 255;
      return ESP_OK;
    }
    ESP_LOGW(kTag, "experimental frontend failed status=%d", int(frontend_status));
    return ESP_FAIL;
  }
  int8_t raw[QUIPUS_DSCNN_CLASSES];
  const int64_t invoke_at = esp_timer_get_time();
  const auto model_status = quipus_dscnn_predict(s_workspace->features,
      sizeof(s_workspace->features), raw);
  const int64_t invoke_us = esp_timer_get_time() - invoke_at;
  ++s_timing.invokes;
  s_timing.invoke_us += invoke_us;
  s_timing.max_invoke_us = std::max(s_timing.max_invoke_us, invoke_us);
  // One real tick blocks this task so both watched idle tasks can progress.
  // Keep the full response; do not break early on an affirmative window.
  vTaskDelay(1);
  if (model_status != QUIPUS_DSCNN_OK) {
    ESP_LOGW(kTag, "experimental inference failed status=%d", int(model_status));
    return ESP_FAIL;
  }
  const auto mapped = quipus_dscnn_map4(raw, probabilities);
  if (mapped != QUIPUS_DSCNN_OK) {
    ESP_LOGW(kTag, "experimental score distribution invalid status=%d", int(mapped));
    return ESP_FAIL;
  }
  // Preserve all model outputs and the four-class mapping. This separate
  // evidence only identifies another trained word; it never relabels it NO.
  for (unsigned label = 0; label < QUIPUS_DSCNN_CLASSES; ++label) {
    if (label == QUIPUS_DSCNN_YES || label == QUIPUS_DSCNN_NO ||
        label == QUIPUS_DSCNN_SILENCE || label == QUIPUS_DSCNN_UNKNOWN) continue;
    const uint8_t score = static_cast<uint8_t>(int(raw[label]) + 128);
    if (score > s_other_word_score) {
      s_other_word_score = score;
      s_other_word_label = static_cast<uint8_t>(label);
    }
  }
  return ESP_OK;
}
#endif
