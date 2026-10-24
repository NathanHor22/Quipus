#include "lantern_wake.h"

#include <string.h>
#include <stdatomic.h>

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_wn_iface.h"
#include "esp_wn_models.h"
#include "model_path.h"

static const char *TAG = "lantern_wake";
static srmodel_list_t *s_models;
static const esp_wn_iface_t *s_wakenet;
static model_iface_data_t *s_model_data;
static int16_t *s_frame;
static size_t s_frame_samples;
static size_t s_frame_filled;
enum { WAKE_DISABLED, WAKE_LISTENING, WAKE_DETECTED };
// Phase and epoch share one atomic word so cancellation cannot race detection.
static atomic_uint s_control;
static unsigned s_feed_generation;
static atomic_uint s_frames;
static atomic_uint s_activations;
static atomic_uint s_consumed;

esp_err_t lantern_wake_init(void) {
  s_models = esp_srmodel_init("model");
  if (!s_models) {
    ESP_LOGW(TAG, "WakeNet model partition is unavailable; button control remains active");
    return ESP_ERR_NOT_FOUND;
  }

  char *model_name = esp_srmodel_filter(
    s_models, ESP_WN_PREFIX, LANTERN_WAKE_MODEL_MATCH);
  if (!model_name) {
    ESP_LOGW(TAG, "WakeNet model containing '%s' is not installed", LANTERN_WAKE_MODEL_MATCH);
    esp_srmodel_deinit(s_models);
    s_models = NULL;
    return ESP_ERR_NOT_FOUND;
  }

  s_wakenet = esp_wn_handle_from_name(model_name);
  if (!s_wakenet) {
    ESP_LOGE(TAG, "WakeNet interface is unavailable for %s", model_name);
    esp_srmodel_deinit(s_models);
    s_models = NULL;
    return ESP_FAIL;
  }

  s_model_data = s_wakenet->create(model_name, DET_MODE_90);
  if (!s_model_data) {
    ESP_LOGE(TAG, "WakeNet could not create %s", model_name);
    esp_srmodel_deinit(s_models);
    s_models = NULL;
    s_wakenet = NULL;
    return ESP_ERR_NO_MEM;
  }

  int frame_samples = s_wakenet->get_samp_chunksize(s_model_data);
  int sample_rate = s_wakenet->get_samp_rate(s_model_data);
  int channels = s_wakenet->get_channel_num(s_model_data);
  if (frame_samples <= 0 || sample_rate != 16000 || channels != 1) {
    ESP_LOGE(TAG, "Unsupported WakeNet audio frame=%d rate=%d channels=%d",
      frame_samples, sample_rate, channels);
    s_wakenet->destroy(s_model_data);
    esp_srmodel_deinit(s_models);
    s_model_data = NULL;
    s_models = NULL;
    s_wakenet = NULL;
    return ESP_ERR_INVALID_SIZE;
  }

  s_frame_samples = (size_t)frame_samples;
  s_frame = heap_caps_malloc(
    s_frame_samples * sizeof(int16_t), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  if (!s_frame) {
    s_wakenet->destroy(s_model_data);
    esp_srmodel_deinit(s_models);
    s_model_data = NULL;
    s_models = NULL;
    s_wakenet = NULL;
    return ESP_ERR_NO_MEM;
  }

  ESP_LOGI(TAG, "WakeNet ready model=%s phrase=%s frame=%u",
    model_name, LANTERN_WAKE_PHRASE, (unsigned)s_frame_samples);
  return ESP_OK;
}

void lantern_wake_set_enabled(bool enabled) {
  if (!s_model_data || !s_wakenet) return;
  if (enabled) {
    unsigned expected = atomic_load(&s_control);
    while ((expected & 3U) == WAKE_DISABLED &&
           !atomic_compare_exchange_weak(&s_control, &expected,
               (expected & ~3U) | WAKE_LISTENING)) {}
  } else {
    unsigned expected = atomic_load(&s_control);
    while (!atomic_compare_exchange_weak(&s_control, &expected,
        (expected + 4U) & ~3U)) {}
  }
  // Only the microphone task owns partial frames and model state. Never call
  // WakeNet9 clean(): this installed direct-input model cannot safely use it.
}

bool lantern_wake_is_available(void) {
  return s_model_data && s_wakenet && s_frame;
}

bool lantern_wake_is_enabled(void) {
  return (atomic_load(&s_control) & 3U) == WAKE_LISTENING;
}

bool lantern_wake_take_detection(void) {
  unsigned expected = atomic_load(&s_control);
  bool accepted = (expected & 3U) == WAKE_DETECTED &&
      atomic_compare_exchange_strong(&s_control, &expected, expected & ~3U);
  if (accepted) atomic_fetch_add(&s_consumed, 1);
  return accepted;
}

void lantern_wake_get_diagnostics(lantern_wake_diagnostics_t *diagnostics) {
  if (!diagnostics) return;
  diagnostics->frames = atomic_load(&s_frames);
  diagnostics->activations = atomic_load(&s_activations);
  diagnostics->consumed = atomic_load(&s_consumed);
  diagnostics->listening = lantern_wake_is_enabled();
}

void lantern_wake_feed(const int16_t *samples, size_t count) {
  if (!lantern_wake_is_enabled() || !s_model_data || !s_wakenet || !s_frame || !samples) return;
  unsigned control = atomic_load(&s_control);
  unsigned generation = control & ~3U;
  if (s_feed_generation != generation) {
    s_frame_filled = 0;
    s_feed_generation = generation;
  }
  while (count && lantern_wake_is_enabled()) {
    if ((atomic_load(&s_control) & ~3U) != generation) return;
    size_t needed = s_frame_samples - s_frame_filled;
    size_t copied = count < needed ? count : needed;
    memcpy(s_frame + s_frame_filled, samples, copied * sizeof(int16_t));
    s_frame_filled += copied;
    samples += copied;
    count -= copied;
    if (s_frame_filled != s_frame_samples) continue;
    s_frame_filled = 0;
    atomic_fetch_add(&s_frames, 1);
    wakenet_state_t result = s_wakenet->detect(s_model_data, s_frame);
    if ((atomic_load(&s_control) & ~3U) != generation) return;
    if (result == WAKENET_DETECTED) {
      unsigned expected = generation | WAKE_LISTENING;
      if (atomic_compare_exchange_strong(&s_control, &expected, generation | WAKE_DETECTED)) {
        atomic_fetch_add(&s_activations, 1);
        ESP_LOGI(TAG, "Wake phrase detected: %s", LANTERN_WAKE_PHRASE);
      }
    }
  }
}
