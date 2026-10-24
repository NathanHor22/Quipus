#include "quipus_barge_in.h"
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include "lantern_board.h"

#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
#include "esp_aec.h"
#include "esp_vad.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"

#define REFERENCE_SAMPLES 8192U
#define PREROLL_SAMPLES 5120U
#define CAPTURE_SAMPLES (16000U * 7U)
#define WARMUP_SAMPLES 8000U
static const char *TAG = "quipus_barge";
static aec_handle_t *s_aec;
static vad_handle_t s_vad;
static int16_t *s_mic, *s_ref, *s_clean, *s_reference, *s_preroll, *s_capture;
static size_t s_chunk, s_fill, s_preroll_write, s_preroll_count, s_capture_count;
static unsigned s_age, s_speech, s_silence;
static int16_t s_vad_frame[320];
static size_t s_vad_fill;
static atomic_uint s_capture_generation;
static atomic_uint s_ref_read, s_ref_write, s_generation;
static portMUX_TYPE s_reference_lock = portMUX_INITIALIZER_UNLOCKED;
static unsigned s_feed_generation;
static atomic_bool s_enabled, s_event, s_capturing, s_ready, s_overflow;

esp_err_t quipus_barge_in_init(void) {
  s_aec = aec_create(16000, 4, 1, AEC_MODE_SR_LOW_COST);
  if (!s_aec) return ESP_ERR_NO_MEM;
  int chunk = aec_get_chunksize(s_aec);
  if (chunk <= 0 || chunk > 1024) goto failed;
  s_chunk = (size_t)chunk;
  s_mic = heap_caps_aligned_alloc(16, s_chunk * 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  s_ref = heap_caps_aligned_alloc(16, s_chunk * 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  s_clean = heap_caps_aligned_alloc(16, s_chunk * 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  s_reference = heap_caps_malloc(REFERENCE_SAMPLES * 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  s_preroll = heap_caps_malloc(PREROLL_SAMPLES * 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  s_capture = heap_caps_malloc(CAPTURE_SAMPLES * 2, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  s_vad = vad_create(VAD_MODE_3);
  if (!s_mic || !s_ref || !s_clean || !s_reference || !s_preroll || !s_capture || !s_vad) goto failed;
  ESP_LOGI(TAG, "report echo listener ready frame=%u; acoustic acceptance still required", (unsigned)s_chunk);
  return ESP_OK;
failed:
  free(s_mic); free(s_ref); free(s_clean); free(s_reference); free(s_preroll); free(s_capture);
  s_mic = s_ref = s_clean = s_reference = s_preroll = s_capture = NULL;
  if (s_vad) vad_destroy(s_vad);
  s_vad = NULL;
  if (s_aec) aec_destroy(s_aec);
  s_aec = NULL;
  return ESP_ERR_NO_MEM;
}

void quipus_barge_in_enable(bool enabled) {
  if (!s_aec) return;
  if (enabled && !atomic_load(&s_enabled)) {
    atomic_fetch_add(&s_generation, 1);
    portENTER_CRITICAL(&s_reference_lock);
    atomic_store(&s_ref_read, 0);
    atomic_store(&s_ref_write, 0);
    atomic_store(&s_overflow, false);
    portEXIT_CRITICAL(&s_reference_lock);
  }
  atomic_store(&s_enabled, enabled);
}
void quipus_barge_in_reset(void) {
  atomic_store(&s_enabled, false);
  atomic_store(&s_event, false);
  atomic_store(&s_capturing, false);
  atomic_store(&s_ready, false);
  atomic_fetch_add(&s_generation, 1);
}
void quipus_barge_in_reference(const int16_t *samples, size_t count) {
  if (!atomic_load(&s_enabled) || !samples) return;
  // Copies are bounded to one DAC chunk (<=240samples). A short critical
  // section also serializes reset; a task spinlock could deadlock on this core.
  portENTER_CRITICAL(&s_reference_lock);
  if (!atomic_load(&s_enabled)) {
    portEXIT_CRITICAL(&s_reference_lock);
    return;
  }
  unsigned written = atomic_load_explicit(&s_ref_write, memory_order_relaxed);
  unsigned read = atomic_load_explicit(&s_ref_read, memory_order_acquire);
  if (count > REFERENCE_SAMPLES || written - read + count > REFERENCE_SAMPLES) {
    // Never block I2S or overwrite a reference still owned by the mic task.
    atomic_store(&s_overflow, true);
    portEXIT_CRITICAL(&s_reference_lock);
    return;
  }
  for (size_t i = 0; i < count; ++i) s_reference[(written + i) % REFERENCE_SAMPLES] = samples[i];
  atomic_store_explicit(&s_ref_write, written + (unsigned)count, memory_order_release);
  portEXIT_CRITICAL(&s_reference_lock);
}
static uint32_t mean_absolute(const int16_t *samples, size_t count) {
  uint32_t total = 0;
  for (size_t i = 0; i < count; ++i) {
    int32_t value = samples[i];
    total += (uint32_t)(value < 0 ? -value : value);
  }
  return count ? total / count : 0;
}
static void process_frame(void) {
  bool enabled = atomic_load(&s_enabled) && !atomic_load(&s_overflow);
  if (enabled) {
    portENTER_CRITICAL(&s_reference_lock);
    if (s_feed_generation != atomic_load(&s_generation)) {
      portEXIT_CRITICAL(&s_reference_lock);
      return;
    }
    unsigned read = atomic_load_explicit(&s_ref_read, memory_order_relaxed);
    unsigned written = atomic_load_explicit(&s_ref_write, memory_order_acquire);
    size_t available = written - read;
    if (available > s_chunk) available = s_chunk;
    for (size_t i = 0; i < available; ++i) s_ref[i] = s_reference[(read + i) % REFERENCE_SAMPLES];
    memset(s_ref + available, 0, (s_chunk - available) * sizeof(int16_t));
    atomic_store_explicit(&s_ref_read, read + (unsigned)available, memory_order_release);
    portEXIT_CRITICAL(&s_reference_lock);
    aec_process(s_aec, s_mic, s_ref, s_clean);
  } else {
    memcpy(s_clean, s_mic, s_chunk * sizeof(int16_t));
  }
  s_age += (unsigned)s_chunk;
  // Bridge32ms AEC and20ms VAD without discarding the tail of each AEC frame.
  bool speech = false;
  for (size_t offset = 0; offset < s_chunk;) {
    size_t copy = 320 - s_vad_fill;
    if (copy > s_chunk - offset) copy = s_chunk - offset;
    memcpy(s_vad_frame + s_vad_fill, s_clean + offset, copy * sizeof(int16_t));
    s_vad_fill += copy;
    offset += copy;
    if (s_vad_fill == 320) {
      speech |= vad_process(s_vad, s_vad_frame, 16000, 20) == VAD_SPEECH;
      s_vad_fill = 0;
    }
  }
  if (s_feed_generation != atomic_load(&s_generation)) return;
  uint32_t residual = mean_absolute(s_clean, s_chunk);
  uint32_t raw = mean_absolute(s_mic, s_chunk);
  // Startup echo is allowed to adapt. A residual-energy check prevents a tiny
  // AEC remainder from stopping playback; this is not speaker identification.
  speech = speech && residual >= 180 && (uint64_t)residual * 100 >= (uint64_t)raw * 30;
  if (atomic_load(&s_capturing)) {
    size_t remaining = CAPTURE_SAMPLES - s_capture_count;
    size_t copy = s_chunk < remaining ? s_chunk : remaining;
    memcpy(s_capture + s_capture_count, s_clean, copy * sizeof(int16_t));
    s_capture_count += copy;
    s_silence = speech ? 0 : s_silence + (unsigned)s_chunk;
    if (s_capture_count == CAPTURE_SAMPLES ||
        (s_capture_count >= 16000 && s_silence >= 11200)) {
      atomic_store(&s_capturing, false);
      atomic_store(&s_capture_generation, s_feed_generation);
      atomic_store_explicit(&s_ready, true, memory_order_release);
    }
    return;
  }
  if (!enabled || atomic_load(&s_ready)) return;
  for (size_t i = 0; i < s_chunk; ++i) {
    s_preroll[s_preroll_write] = s_clean[i];
    s_preroll_write = (s_preroll_write + 1) % PREROLL_SAMPLES;
    if (s_preroll_count < PREROLL_SAMPLES) ++s_preroll_count;
  }
  s_speech = speech && s_age >= WARMUP_SAMPLES ? s_speech + (unsigned)s_chunk : 0;
  if (s_speech >= 2560) { //160ms of sustained near-end speech after adaptation.
    size_t oldest = (s_preroll_write + PREROLL_SAMPLES - s_preroll_count) % PREROLL_SAMPLES;
    for (size_t i = 0; i < s_preroll_count; ++i)
      s_capture[i] = s_preroll[(oldest + i) % PREROLL_SAMPLES];
    s_capture_count = s_preroll_count;
    s_silence = 0;
    atomic_store(&s_capture_generation, s_feed_generation);
    atomic_store(&s_capturing, true);
    atomic_store(&s_event, true);
  }
}
void quipus_barge_in_feed(const int16_t *samples, size_t count) {
  if (!s_aec || (!atomic_load(&s_enabled) && !atomic_load(&s_capturing)) || !samples) return;
  unsigned generation = atomic_load(&s_generation);
  if (s_feed_generation != generation) {
    // Only this mic owner mutates capture storage. A frame canceled between its
    // check and publish must never migrate into the next interaction.
    if (s_capture_count) memset(s_capture, 0, s_capture_count * sizeof(int16_t));
    s_capture_count = 0;
    atomic_store(&s_capturing, false);
    atomic_store(&s_ready, false);
    atomic_store(&s_event, false);
    s_feed_generation = generation;
    s_fill = s_age = s_speech = s_silence = 0;
    s_vad_fill = 0;
    s_preroll_write = s_preroll_count = 0;
    vad_reset_trigger(s_vad);
  }
  if (!atomic_load(&s_enabled) && !atomic_load(&s_capturing)) return;
  while (count && generation == atomic_load(&s_generation)) {
    size_t copy = s_chunk - s_fill;
    if (copy > count) copy = count;
    memcpy(s_mic + s_fill, samples, copy * sizeof(int16_t));
    s_fill += copy; samples += copy; count -= copy;
    if (s_fill == s_chunk) { s_fill = 0; process_frame(); }
  }
}
bool quipus_barge_in_take_event(void) {
  bool event = atomic_exchange(&s_event, false);
  return event && atomic_load(&s_capture_generation) == atomic_load(&s_generation);
}
bool quipus_barge_in_capture_pending(void) {
  return (atomic_load(&s_capturing) || atomic_load(&s_ready)) &&
      atomic_load(&s_capture_generation) == atomic_load(&s_generation);
}
bool quipus_barge_in_capture_ready(void) {
  return atomic_load_explicit(&s_ready, memory_order_acquire) &&
      atomic_load(&s_capture_generation) == atomic_load(&s_generation);
}
size_t quipus_barge_in_take_audio(int16_t *destination, size_t capacity) {
  if (!destination || !quipus_barge_in_capture_ready() || capacity < s_capture_count) return 0;
  size_t count = s_capture_count;
  memcpy(destination, s_capture, count * sizeof(int16_t));
  // No private PCM remains in the report scratch buffer after handoff.
  memset(s_capture, 0, count * sizeof(int16_t));
  atomic_store(&s_ready, false);
  return count;
}
#else
esp_err_t quipus_barge_in_init(void) { return ESP_ERR_NOT_SUPPORTED; }
void quipus_barge_in_enable(bool enabled) { (void)enabled; }
void quipus_barge_in_reset(void) {}
void quipus_barge_in_reference(const int16_t *s, size_t n) { (void)s; (void)n; }
void quipus_barge_in_feed(const int16_t *s, size_t n) { (void)s; (void)n; }
bool quipus_barge_in_take_event(void) { return false; }
bool quipus_barge_in_capture_pending(void) { return false; }
bool quipus_barge_in_capture_ready(void) { return false; }
size_t quipus_barge_in_take_audio(int16_t *s, size_t n) { (void)s; (void)n; return 0; }
#endif
