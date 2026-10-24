#include "lantern_audio.h"

#include <limits.h>
#include <stdatomic.h>
#include <stdlib.h>

#include "driver/i2s_std.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/stream_buffer.h"
#include "freertos/task.h"

#include "lantern_board.h"
#include "lantern_board_io.h"
#include "lantern_display.h"
#include "quipus_pcm.h"
#include "quipus_barge_in.h"
#include "quipus_volume.h"

#define AUDIO_READ_SAMPLES 320
#define AUDIO_WRITE_SAMPLES 240
#define PCM_STREAM_BUFFER_BYTES (64 * 1024)
#define PCM_PREFILL_BYTES (LANTERN_TTS_SAMPLE_RATE * sizeof(int16_t) / 8)
#define RETRY_BUFFER_SECONDS 30
#define RETRY_BUFFER_SAMPLES (LANTERN_MIC_SAMPLE_RATE * RETRY_BUFFER_SECONDS)

static const char *TAG = "lantern_audio";
static i2s_chan_handle_t s_speaker;
static i2s_chan_handle_t s_microphone;
static int16_t *s_retry_buffer;
static size_t s_write_index;
static size_t s_sample_count;
static volatile bool s_recording;
static volatile bool s_streaming;
static volatile uint32_t s_level;
static lantern_audio_frame_callback_t s_frame_callback;
static lantern_audio_frame_callback_t s_monitor_callback;
static lantern_audio_frame_callback_t s_archive_callback;
static SemaphoreHandle_t s_speaker_lock;
static SemaphoreHandle_t s_pcm_finished;
static StreamBufferHandle_t s_pcm_stream;
static StaticStreamBuffer_t s_pcm_stream_state;
static uint8_t *s_pcm_stream_storage;
static TaskHandle_t s_pcm_task;
static volatile bool s_pcm_playing;
static volatile bool s_pcm_input_finished;
static volatile bool s_pcm_failed;
static volatile bool s_pcm_cancelled;
static volatile bool s_speaker_active;
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
static atomic_uint s_volume = QUIPUS_VOLUME_DEFAULT;
#else
static atomic_uint s_volume = 100;
#endif

unsigned lantern_audio_output_stack_free(void) {
  return s_pcm_task ? (unsigned)uxTaskGetStackHighWaterMark(s_pcm_task) : 0U;
}

unsigned lantern_audio_volume(void) {
  return atomic_load_explicit(&s_volume, memory_order_relaxed);
}

unsigned lantern_audio_adjust_volume(int delta) {
  unsigned current = lantern_audio_volume();
  unsigned next;
  do {
    next = quipus_volume_clamp((int)current + delta);
  } while (!atomic_compare_exchange_weak_explicit(
      &s_volume, &current, next, memory_order_relaxed, memory_order_relaxed));
  return next;
}

static int16_t speaker_sample(int16_t sample) {
  return quipus_volume_sample(sample, lantern_audio_volume());
}

#if LANTERN_AUDIO_SHARED_BUS
typedef int16_t i2s_output_sample_t;
static i2s_output_sample_t output_sample(int16_t sample) {
  return speaker_sample(sample);
}
#define I2S_OUTPUT_CHANNELS (LANTERN_AUDIO_ADC_ES7210 ? 2 : 1)
#else
typedef int32_t i2s_output_sample_t;
static i2s_output_sample_t output_sample(int16_t sample) {
  return (int32_t)speaker_sample(sample) * 32768;
}
#define I2S_OUTPUT_CHANNELS 1
#endif

static esp_err_t speaker_start_silent(void) {
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  // Only the owner of s_speaker_lock may inspect/repair the output codec.
  // This verifies register state, not physical audibility.
  lantern_board_speaker_state_t state = {0};
  esp_err_t prepared = lantern_board_speaker_prepare_output(lantern_audio_volume(), &state);
  ESP_LOGI(TAG, "speaker prepare volume=%u result=%s valid=0x%02x regs31_32_0d_12=%02x,%02x,%02x,%02x "
      "read_status=%d,%d,%d,%d control=%d repair=%u verified=%u",
      lantern_audio_volume(), esp_err_to_name(prepared), (unsigned)state.valid_mask,
      state.values[0], state.values[1], state.values[2], state.values[3],
      state.read_status[0], state.read_status[1], state.read_status[2], state.read_status[3],
      state.control_error, state.repair_attempted, state.repair_verified);
  if (prepared != ESP_OK) return prepared;
#endif
  static const i2s_output_sample_t silence[AUDIO_WRITE_SAMPLES * I2S_OUTPUT_CHANNELS] = {0};
#if LANTERN_AUDIO_SHARED_BUS
  // Keep both directions of the codec's full-duplex clock domain running.
  // Muting is handled by the external amplifier instead of stopping TX.
  size_t bytes_written = 0;
  esp_err_t result = i2s_channel_write(s_speaker, silence, sizeof(silence),
                                       &bytes_written, 100);
  if (result != ESP_OK || bytes_written != sizeof(silence)) {
    ESP_LOGE(TAG, "speaker silence preload failed: %s bytes=%u/%u", esp_err_to_name(result),
        (unsigned)bytes_written, (unsigned)sizeof(silence));
    return result != ESP_OK ? result : ESP_FAIL;
  }
  lantern_board_speaker_enable(true);
  return ESP_OK;
#else
  size_t bytes_loaded = 0;
  ESP_RETURN_ON_ERROR(i2s_channel_preload_data(s_speaker, silence,
                                               sizeof(silence), &bytes_loaded),
                      TAG, "speaker silence preload");
  if (bytes_loaded != sizeof(silence)) {
    ESP_LOGW(TAG, "speaker silence preload accepted %u of %u bytes",
             (unsigned)bytes_loaded, (unsigned)sizeof(silence));
  }
  esp_err_t result = i2s_channel_enable(s_speaker);
  if (result == ESP_OK)
    lantern_board_speaker_enable(true);
  return result;
#endif
}

static void speaker_stop_silent(void) {
  static const i2s_output_sample_t silence[AUDIO_WRITE_SAMPLES * I2S_OUTPUT_CHANNELS] = {0};
  size_t bytes_written = 0;
  if (i2s_channel_write(s_speaker, silence, sizeof(silence), &bytes_written,
                        100) == ESP_OK) {
    vTaskDelay(pdMS_TO_TICKS(20));
  }
  lantern_board_speaker_enable(false);
#if !LANTERN_AUDIO_SHARED_BUS
  ESP_ERROR_CHECK_WITHOUT_ABORT(i2s_channel_disable(s_speaker));
#endif
}

// Natural acoustic barge-in has not passed acceptance on the Wave pilot. Keep
// deterministic speaker/user turns there: echo must never become a command.
// These gates also avoid allocating or running the unused AEC/VAD pipeline.
static void report_listener_init(void) {
#if !CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  esp_err_t echo = quipus_barge_in_init();
  if (echo != ESP_OK && echo != ESP_ERR_NOT_SUPPORTED)
    ESP_LOGW(TAG, "Echo listener unavailable: %s; physical interrupt retained", esp_err_to_name(echo));
#endif
}

static void report_listener_reference(const int16_t *samples, size_t count) {
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  (void)samples;
  (void)count;
#else
  quipus_barge_in_reference(samples, count);
#endif
}

static void report_listener_feed(const int16_t *samples, size_t count) {
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  (void)samples;
  (void)count;
#else
  quipus_barge_in_feed(samples, count);
#endif
}

static void pcm_playback_task(void *argument) {
  (void)argument;
  // This task is the sole owner. Keep fixed payload buffers off its call stack
  // so codec checks and driver/log calls retain bounded stack headroom.
  static uint8_t input[AUDIO_WRITE_SAMPLES * sizeof(int16_t)];
  static i2s_output_sample_t output[AUDIO_WRITE_SAMPLES * I2S_OUTPUT_CHANNELS];
  static int16_t reference[AUDIO_WRITE_SAMPLES];
  while (true) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    bool speaker_started = false;
    uint32_t output_frames = 0, written_frames = 0, nonzero_frames = 0;
    uint16_t output_peak = 0;
    while (s_pcm_playing) {
      if (s_pcm_cancelled)
        break;
      size_t available = xStreamBufferBytesAvailable(s_pcm_stream);
      if (!speaker_started) {
        // Hold a small amount of PCM before enabling I2S. This absorbs normal
        // HTTPS/hotspot jitter without waiting for the complete reply.
        if (!s_pcm_input_finished && available < PCM_PREFILL_BYTES) {
          vTaskDelay(pdMS_TO_TICKS(5));
          continue;
        }
        esp_err_t started = available ? speaker_start_silent() : ESP_ERR_INVALID_SIZE;
        if (started != ESP_OK) {
          ESP_LOGE(TAG, "PCM speaker start failed: %s", esp_err_to_name(started));
          s_pcm_failed = true;
          break;
        }
        speaker_started = true;
      }

      if (!available) {
        if (s_pcm_input_finished)
          break;
        vTaskDelay(pdMS_TO_TICKS(5));
        continue;
      }

      size_t wanted = sizeof(input);
      if (available < wanted) {
        if (!s_pcm_input_finished) {
          vTaskDelay(pdMS_TO_TICKS(2));
          continue;
        }
        wanted = available;
      }
      wanted &= ~(size_t)1;
      if (!wanted) {
        s_pcm_failed = true;
        break;
      }
      size_t received = xStreamBufferReceive(s_pcm_stream, input, wanted, 0);
      received &= ~(size_t)1;
      size_t source_count = received / sizeof(int16_t);
      size_t sample_count =
          source_count * LANTERN_SPK_SAMPLE_RATE / LANTERN_TTS_SAMPLE_RATE;
      if (!sample_count && source_count)
        sample_count = 1;
      uint32_t speech_absolute = 0;
      for (size_t index = 0; index < sample_count; ++index) {
        size_t source_index =
            index * LANTERN_TTS_SAMPLE_RATE / LANTERN_SPK_SAMPLE_RATE;
        if (source_index >= source_count)
          source_index = source_count - 1;
        int16_t sample =
            (int16_t)((uint16_t)input[source_index * 2] |
                      ((uint16_t)input[source_index * 2 + 1] << 8));
        int32_t audible = speaker_sample(sample);
        reference[index] = (int16_t)audible;
        uint32_t magnitude = (uint32_t)(audible < 0 ? -audible : audible);
        speech_absolute += magnitude;
        ++output_frames;
        if (magnitude) ++nonzero_frames;
        if (magnitude > output_peak) output_peak = (uint16_t)magnitude;
        for (size_t channel = 0; channel < I2S_OUTPUT_CHANNELS; ++channel) {
          output[index * I2S_OUTPUT_CHANNELS + channel] = output_sample(sample);
        }
      }
      size_t bytes_written = 0;
      const size_t output_bytes =
          sample_count * I2S_OUTPUT_CHANNELS * sizeof(output[0]);
      esp_err_t result = i2s_channel_write(s_speaker, output, output_bytes,
                                           &bytes_written, 250);
      if (result != ESP_OK || bytes_written != output_bytes) {
        ESP_LOGE(TAG, "PCM I2S write failed: %s bytes=%u/%u", esp_err_to_name(result),
            (unsigned)bytes_written, (unsigned)output_bytes);
        s_pcm_failed = true;
        break;
      }
      written_frames += (uint32_t)sample_count;
      // Same post-volume16k samples as the DAC; bounded SPSC reference only.
      report_listener_reference(reference, sample_count);
      unsigned level = sample_count ?
          (unsigned)((speech_absolute / sample_count) * 100U / 4000U) : 0;
      lantern_display_set_speech_level(level > 100 ? 100 : level, true);
    }
    lantern_display_set_speech_level(0, false);

    if (speaker_started)
      speaker_stop_silent();
    ESP_LOGI(TAG, "PCM submitted_frames=%lu written_frames=%lu nonzero=%lu peak=%u volume=%u failed=%u cancelled=%u",
        (unsigned long)output_frames, (unsigned long)written_frames, (unsigned long)nonzero_frames, (unsigned)output_peak,
        lantern_audio_volume(), s_pcm_failed, s_pcm_cancelled);
    s_pcm_playing = false;
    s_speaker_active = false;
    xSemaphoreGive(s_speaker_lock);
    xSemaphoreGive(s_pcm_finished);
  }
}

static int16_t buffered_sample(size_t chronological_index) {
  size_t oldest = s_sample_count == RETRY_BUFFER_SAMPLES ? s_write_index : 0;
  return s_retry_buffer[(oldest + chronological_index) % RETRY_BUFFER_SAMPLES];
}

static void microphone_task(void *argument) {
  (void)argument;
  bool capture_logged = false;
#if LANTERN_AUDIO_SHARED_BUS
  int16_t raw[AUDIO_READ_SAMPLES * I2S_OUTPUT_CHANNELS];
#else
  int32_t raw[AUDIO_READ_SAMPLES];
#endif
  int16_t converted[AUDIO_READ_SAMPLES];
  while (true) {
    size_t bytes_read = 0;
    esp_err_t result = i2s_channel_read(s_microphone, raw, sizeof(raw),
                                        &bytes_read, 250);
    if (result != ESP_OK || !bytes_read) {
      if (!capture_logged) {
        ESP_LOGW(TAG, "first microphone read failed: %s, bytes=%u",
                 esp_err_to_name(result), (unsigned)bytes_read);
        capture_logged = true;
      }
      continue;
    }
    size_t samples = bytes_read / sizeof(raw[0]);
    if (!capture_logged) {
      int32_t minimum = raw[0];
      int32_t maximum = raw[0];
      for (size_t index = 1; index < samples; ++index) {
        if (raw[index] < minimum)
          minimum = raw[index];
        if (raw[index] > maximum)
          maximum = raw[index];
      }
      ESP_LOGI(TAG,
               "first microphone frame: bytes=%u samples=%u min=%ld max=%ld",
               (unsigned)bytes_read, (unsigned)samples, (long)minimum,
               (long)maximum);
      capture_logged = true;
    }
#if LANTERN_AUDIO_SHARED_BUS
    samples = quipus_pcm_select_channel(raw, samples, I2S_OUTPUT_CHANNELS, 0,
                                        converted, AUDIO_READ_SAMPLES);
#endif
    uint64_t absolute_total = 0;
    for (size_t index = 0; index < samples; ++index) {
      // The microphone delivers left-aligned 24-bit samples in a 32-bit I2S
      // slot. A 12-bit shift over-amplified room noise and clipped speech,
      // leaving the AFE VAD permanently in its speech state. Preserve two bits
      // of useful gain while restoring enough headroom for speech/silence.
#if LANTERN_AUDIO_SHARED_BUS
      int32_t value = converted[index];
#else
      int32_t value = raw[index] >> 14;
#endif
      if (value > INT16_MAX)
        value = INT16_MAX;
      if (value < INT16_MIN)
        value = INT16_MIN;
      int16_t sample = (int16_t)value;
      converted[index] = sample;
      absolute_total += sample < 0 ? (uint32_t)(-sample) : (uint32_t)sample;
      if (s_recording && s_retry_buffer) {
        s_retry_buffer[s_write_index] = sample;
        s_write_index = (s_write_index + 1) % RETRY_BUFFER_SAMPLES;
        if (s_sample_count < RETRY_BUFFER_SAMPLES)
          ++s_sample_count;
      }
    }
    s_level = samples ? (uint32_t)(absolute_total / samples) : 0;
    report_listener_feed(converted, samples);
    lantern_audio_frame_callback_t archive = s_archive_callback;
    if (s_recording && archive && samples)
      archive(converted, samples);
    lantern_audio_frame_callback_t monitor = s_monitor_callback;
    if (monitor && !s_speaker_active && samples)
      monitor(converted, samples);
    lantern_audio_frame_callback_t callback = s_frame_callback;
    if (s_streaming && callback && samples)
      callback(converted, samples);
  }
}

esp_err_t lantern_audio_init(void) {
  // Playback is opened by the HTTPS callback and closed by the PCM worker, so
  // this gate must allow a different task to release it. A FreeRTOS mutex has
  // owner-only priority-inheritance semantics and asserts in that pattern.
  s_speaker_lock = xSemaphoreCreateBinary();
  s_pcm_finished = xSemaphoreCreateBinary();
  s_pcm_stream_storage = heap_caps_malloc(PCM_STREAM_BUFFER_BYTES,
                                          MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!s_speaker_lock || !s_pcm_finished || !s_pcm_stream_storage)
    return ESP_ERR_NO_MEM;
  xSemaphoreGive(s_speaker_lock);
  s_pcm_stream = xStreamBufferCreateStatic(
      PCM_STREAM_BUFFER_BYTES, 1, s_pcm_stream_storage, &s_pcm_stream_state);
  if (!s_pcm_stream)
    return ESP_ERR_NO_MEM;

  i2s_chan_config_t speaker_channel =
      I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  speaker_channel.dma_desc_num = 6;
  speaker_channel.dma_frame_num = 240;
  speaker_channel.auto_clear = true;
#if LANTERN_AUDIO_SHARED_BUS
  ESP_RETURN_ON_ERROR(
      i2s_new_channel(&speaker_channel, &s_speaker, &s_microphone), TAG,
      "shared audio channel");
  i2s_std_config_t speaker = {
      .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(LANTERN_SPK_SAMPLE_RATE),
      .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,
                          LANTERN_AUDIO_ADC_ES7210 ? I2S_SLOT_MODE_STEREO
                                                   : I2S_SLOT_MODE_MONO),
      .gpio_cfg =
          {
              .mclk = LANTERN_SPK_MCLK_GPIO,
              .bclk = LANTERN_SPK_BCLK_GPIO,
              .ws = LANTERN_SPK_LRCK_GPIO,
              .dout = LANTERN_SPK_DATA_GPIO,
              .din = LANTERN_MIC_DATA_GPIO,
              .invert_flags = {false, false, false},
          },
  };
  speaker.clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256;
  speaker.slot_cfg.slot_mask = LANTERN_AUDIO_ADC_ES7210 ? I2S_STD_SLOT_BOTH
                                                      : I2S_STD_SLOT_LEFT;
  ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(s_speaker, &speaker), TAG,
                      "speaker mode");

  i2s_std_config_t microphone = speaker;
  microphone.gpio_cfg.dout = LANTERN_SPK_DATA_GPIO;
  microphone.gpio_cfg.din = LANTERN_MIC_DATA_GPIO;
  ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(s_microphone, &microphone), TAG,
                      "microphone mode");
  i2s_output_sample_t
      startup_silence[AUDIO_WRITE_SAMPLES * I2S_OUTPUT_CHANNELS] = {0};
  size_t startup_bytes = 0;
  ESP_RETURN_ON_ERROR(i2s_channel_preload_data(s_speaker, startup_silence,
                                               sizeof(startup_silence),
                                               &startup_bytes),
                      TAG, "shared audio preload");
  ESP_RETURN_ON_ERROR(i2s_channel_enable(s_speaker), TAG,
                      "shared speaker clock enable");
  ESP_RETURN_ON_ERROR(i2s_channel_enable(s_microphone), TAG,
                      "microphone enable");
  ESP_RETURN_ON_ERROR(lantern_board_audio_codec_init(s_speaker, s_microphone),
                      TAG, "ES8311 init");
  lantern_board_speaker_enable(false);
#else
  ESP_RETURN_ON_ERROR(i2s_new_channel(&speaker_channel, &s_speaker, NULL), TAG,
                      "speaker channel");
  i2s_std_config_t speaker = {
      .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(LANTERN_SPK_SAMPLE_RATE),
      .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT,
                                                      I2S_SLOT_MODE_MONO),
      .gpio_cfg =
          {
              .mclk = I2S_GPIO_UNUSED,
              .bclk = LANTERN_SPK_BCLK_GPIO,
              .ws = LANTERN_SPK_LRCK_GPIO,
              .dout = LANTERN_SPK_DATA_GPIO,
              .din = I2S_GPIO_UNUSED,
              .invert_flags = {false, false, false},
          },
  };
  speaker.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
  ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(s_speaker, &speaker), TAG,
                      "speaker mode");

  i2s_chan_config_t microphone_channel =
      I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_MASTER);
  microphone_channel.dma_desc_num = 6;
  microphone_channel.dma_frame_num = 320;
  ESP_RETURN_ON_ERROR(i2s_new_channel(&microphone_channel, NULL, &s_microphone),
                      TAG, "microphone channel");
  i2s_std_config_t microphone = {
      .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(LANTERN_MIC_SAMPLE_RATE),
      .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT,
                                                      I2S_SLOT_MODE_MONO),
      .gpio_cfg =
          {
              .mclk = I2S_GPIO_UNUSED,
              .bclk = LANTERN_MIC_SCK_GPIO,
              .ws = LANTERN_MIC_WS_GPIO,
              .dout = I2S_GPIO_UNUSED,
              .din = LANTERN_MIC_DATA_GPIO,
              .invert_flags = {false, false, false},
          },
  };
  microphone.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
  ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(s_microphone, &microphone), TAG,
                      "microphone mode");
  ESP_RETURN_ON_ERROR(i2s_channel_enable(s_microphone), TAG,
                      "microphone enable");
#endif

  s_retry_buffer = heap_caps_malloc(RETRY_BUFFER_SAMPLES * sizeof(int16_t),
                                    MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!s_retry_buffer)
    return ESP_ERR_NO_MEM;
  if (xTaskCreatePinnedToCore(pcm_playback_task, "lantern_pcm", 6144, NULL, 7,
                              &s_pcm_task, 1) != pdPASS) {
    return ESP_ERR_NO_MEM;
  }
  report_listener_init();
  // Agora's synchronous PCM encode/send path runs inside this callback task
  // and needs substantially more stack than the I2S capture loop alone.
  xTaskCreatePinnedToCore(microphone_task, "lantern_mic", 12288, NULL, 6, NULL,
                          1);
  ESP_LOGI(TAG,
           "I2S microphone and speaker ready (%d kHz capture, %d kHz output); "
           "meeting retry buffer allocated",
           LANTERN_MIC_SAMPLE_RATE / 1000, LANTERN_SPK_SAMPLE_RATE / 1000);
  return ESP_OK;
}

void lantern_audio_chime(unsigned count) {
  if (!s_speaker || !s_speaker_lock ||
      xSemaphoreTake(s_speaker_lock, pdMS_TO_TICKS(500)) != pdTRUE)
    return;
  s_speaker_active = true;
  esp_err_t started = speaker_start_silent();
  if (started != ESP_OK) {
    ESP_LOGE(TAG, "chime speaker start failed: %s", esp_err_to_name(started));
    s_speaker_active = false;
    xSemaphoreGive(s_speaker_lock);
    return;
  }
  // Shared only while this caller owns s_speaker_lock.
  static i2s_output_sample_t samples[AUDIO_WRITE_SAMPLES * I2S_OUTPUT_CHANNELS];
  esp_err_t output_result = ESP_OK;
  uint32_t output_frames = 0;
  uint32_t microphone_before = lantern_audio_level(), microphone_peak = microphone_before;
  for (unsigned tone = 0; tone < count && output_result == ESP_OK; ++tone) {
    for (int chunk = 0; chunk < 12; ++chunk) {
      for (size_t index = 0; index < AUDIO_WRITE_SAMPLES; ++index) {
        int phase = (int)((index + chunk * AUDIO_WRITE_SAMPLES) % 48);
        int triangle = phase < 24 ? phase : 48 - phase;
        int16_t value = (int16_t)((triangle - 12) * 420);
        for (size_t channel = 0; channel < I2S_OUTPUT_CHANNELS; ++channel) {
          samples[index * I2S_OUTPUT_CHANNELS + channel] = output_sample(value);
        }
      }
      size_t bytes_written = 0;
      output_result = i2s_channel_write(s_speaker, samples, sizeof(samples), &bytes_written, 100);
      if (output_result != ESP_OK || bytes_written != sizeof(samples)) {
        ESP_LOGE(TAG, "chime I2S write failed: %s bytes=%u/%u", esp_err_to_name(output_result),
            (unsigned)bytes_written, (unsigned)sizeof(samples));
        if (output_result == ESP_OK) output_result = ESP_FAIL;
        break;
      }
      output_frames += AUDIO_WRITE_SAMPLES;
      uint32_t microphone_level = lantern_audio_level();
      if (microphone_level > microphone_peak) microphone_peak = microphone_level;
    }
    if (output_result == ESP_OK && tone + 1 < count)
      vTaskDelay(pdMS_TO_TICKS(90));
  }
  speaker_stop_silent();
  ESP_LOGI(TAG, "chime output frames=%lu volume=%u status=%s mic_before=%lu mic_peak=%lu",
      (unsigned long)output_frames, lantern_audio_volume(), esp_err_to_name(output_result),
      (unsigned long)microphone_before, (unsigned long)microphone_peak);
  s_speaker_active = false;
  xSemaphoreGive(s_speaker_lock);
}

esp_err_t lantern_audio_pcm_begin(void) {
  if (!s_speaker || !s_speaker_lock || !s_pcm_stream || !s_pcm_task ||
      s_pcm_playing) {
    return ESP_ERR_INVALID_STATE;
  }
  if (xSemaphoreTake(s_speaker_lock, pdMS_TO_TICKS(1000)) != pdTRUE)
    return ESP_ERR_TIMEOUT;
  xStreamBufferReset(s_pcm_stream);
  xSemaphoreTake(s_pcm_finished, 0);
  s_pcm_playing = true;
  s_pcm_input_finished = false;
  s_pcm_failed = false;
  s_pcm_cancelled = false;
  s_speaker_active = true;
  xTaskNotifyGive(s_pcm_task);
  ESP_LOGI(TAG, "%d kHz buffered PCM playback opened",
           LANTERN_TTS_SAMPLE_RATE / 1000);
  return ESP_OK;
}

esp_err_t lantern_audio_pcm_write(const void *data, size_t length) {
  if (!s_pcm_playing || !data || !length)
    return length ? ESP_ERR_INVALID_STATE : ESP_OK;
  const uint8_t *bytes = data;
  size_t sent = 0;
  TickType_t progress_at = xTaskGetTickCount();
  while (sent < length && s_pcm_playing && !s_pcm_cancelled) {
    size_t chunk = xStreamBufferSend(s_pcm_stream, bytes + sent, length - sent,
                                     pdMS_TO_TICKS(100));
    if (!chunk) {
      if (s_pcm_cancelled)
        return ESP_FAIL;
      if ((xTaskGetTickCount() - progress_at) * portTICK_PERIOD_MS < 2000)
        continue;
      s_pcm_failed = true;
      return ESP_ERR_TIMEOUT;
    }
    sent += chunk;
    progress_at = xTaskGetTickCount();
  }
  return sent == length ? ESP_OK : ESP_FAIL;
}

void lantern_audio_pcm_cancel(void) {
  s_pcm_cancelled = true;
  // Only the playback task owns the I2S channel; it stops and drains safely.
}

esp_err_t lantern_audio_pcm_end(void) {
  if (!s_pcm_playing)
    return s_pcm_failed || s_pcm_cancelled ? ESP_FAIL : ESP_OK;
  s_pcm_input_finished = true;
  xTaskNotifyGive(s_pcm_task);
  if (xSemaphoreTake(s_pcm_finished, pdMS_TO_TICKS(5000)) != pdTRUE) {
    ESP_LOGE(TAG, "PCM playback drain timed out");
    s_pcm_failed = true;
    // The playback task owns I2S and the speaker lock. Ask it to stop rather
    // than releasing those resources while a late write may still be active.
    s_pcm_cancelled = true;
    xTaskNotifyGive(s_pcm_task);
    return ESP_ERR_TIMEOUT;
  }
  bool failed = s_pcm_failed || s_pcm_cancelled;
  ESP_LOGI(TAG, "PCM playback finished%s", failed ? " with errors" : "");
  return failed ? ESP_FAIL : ESP_OK;
}

void lantern_audio_set_recording(bool recording) {
  if (recording && !s_recording) {
    s_write_index = 0;
    s_sample_count = 0;
  }
  s_recording = recording;
  ESP_LOGI(TAG, "recording=%s buffered=%u", recording ? "true" : "false",
           (unsigned)s_sample_count);
}

void lantern_audio_set_streaming(bool streaming) {
  s_streaming = streaming;
  ESP_LOGI(TAG, "Agora microphone stream=%s", streaming ? "true" : "false");
}

void lantern_audio_set_frame_callback(lantern_audio_frame_callback_t callback) {
  s_frame_callback = callback;
}

void lantern_audio_set_monitor_callback(
    lantern_audio_frame_callback_t callback) {
  s_monitor_callback = callback;
}

void lantern_audio_set_archive_callback(
    lantern_audio_frame_callback_t callback) {
  s_archive_callback = callback;
}

bool lantern_audio_is_recording(void) { return s_recording; }
bool lantern_audio_is_speaker_active(void) { return s_speaker_active; }
uint32_t lantern_audio_level(void) { return s_level; }
size_t lantern_audio_buffered_samples(void) { return s_sample_count; }
unsigned lantern_audio_buffered_seconds(void) {
  return (unsigned)(s_sample_count / LANTERN_MIC_SAMPLE_RATE);
}

size_t lantern_audio_copy_samples(int16_t *destination, size_t offset,
                                  size_t capacity) {
  if (!destination || !capacity || !s_retry_buffer || s_recording ||
      offset >= s_sample_count)
    return 0;
  size_t available = s_sample_count - offset;
  size_t copied = capacity < available ? capacity : available;
  for (size_t index = 0; index < copied; ++index) {
    destination[index] = buffered_sample(offset + index);
  }
  return copied;
}

unsigned lantern_audio_play_latest(unsigned max_seconds) {
  if (!s_speaker || !s_speaker_lock || !s_retry_buffer || s_recording ||
      !s_sample_count)
    return 0;
  if (max_seconds == 0 || max_seconds > RETRY_BUFFER_SECONDS)
    max_seconds = RETRY_BUFFER_SECONDS;
  size_t input_count = s_sample_count;
  size_t maximum = (size_t)max_seconds * LANTERN_MIC_SAMPLE_RATE;
  if (input_count > maximum)
    input_count = maximum;
  size_t first = s_sample_count - input_count;
  size_t output_count =
      input_count * LANTERN_SPK_SAMPLE_RATE / LANTERN_MIC_SAMPLE_RATE;
  if (xSemaphoreTake(s_speaker_lock, pdMS_TO_TICKS(500)) != pdTRUE)
    return 0;
  if (speaker_start_silent() != ESP_OK) {
    xSemaphoreGive(s_speaker_lock);
    return 0;
  }
  i2s_output_sample_t output[AUDIO_WRITE_SAMPLES * I2S_OUTPUT_CHANNELS];
  for (size_t output_offset = 0; output_offset < output_count;) {
    size_t chunk = output_count - output_offset;
    if (chunk > AUDIO_WRITE_SAMPLES)
      chunk = AUDIO_WRITE_SAMPLES;
    for (size_t index = 0; index < chunk; ++index) {
      size_t input_index =
          first + ((output_offset + index) * LANTERN_MIC_SAMPLE_RATE /
                   LANTERN_SPK_SAMPLE_RATE);
      i2s_output_sample_t sample = output_sample(buffered_sample(input_index));
      for (size_t channel = 0; channel < I2S_OUTPUT_CHANNELS; ++channel) {
        output[index * I2S_OUTPUT_CHANNELS + channel] = sample;
      }
    }
    size_t bytes_written = 0;
    i2s_channel_write(s_speaker, output,
                      chunk * I2S_OUTPUT_CHANNELS * sizeof(output[0]),
                      &bytes_written, 200);
    output_offset += chunk;
  }
  speaker_stop_silent();
  xSemaphoreGive(s_speaker_lock);
  unsigned played = (unsigned)(input_count / LANTERN_MIC_SAMPLE_RATE);
  ESP_LOGI(TAG, "played %u seconds from microphone retry buffer", played);
  return played;
}

void lantern_audio_clear_private_buffer(void) {
  if (s_recording)
    return;
  s_sample_count = 0;
  s_write_index = 0;
  if (s_retry_buffer) {
    volatile int16_t *samples = s_retry_buffer;
    for (size_t i = 0; i < RETRY_BUFFER_SAMPLES; ++i)
      samples[i] = 0;
  }
}

void lantern_audio_set_report_listening(bool enabled) {
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  (void)enabled;
#else
  quipus_barge_in_enable(enabled);
#endif
}
void lantern_audio_reset_report_listening(void) {
#if !CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  quipus_barge_in_reset();
#endif
}
bool lantern_audio_take_speech_interrupt(void) {
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  return false;
#else
  return quipus_barge_in_take_event();
#endif
}
bool lantern_audio_capture_interruption(unsigned maximum_ms) {
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  (void)maximum_ms;
  return false;
#else
  if (!quipus_barge_in_capture_pending()) return false;
  TickType_t started = xTaskGetTickCount();
  while (!quipus_barge_in_capture_ready() &&
         (xTaskGetTickCount() - started) * portTICK_PERIOD_MS < maximum_ms)
    vTaskDelay(pdMS_TO_TICKS(20));
  if (!quipus_barge_in_capture_ready()) { quipus_barge_in_reset(); return false; }
  if (s_recording) return false;
  size_t count = quipus_barge_in_take_audio(s_retry_buffer, RETRY_BUFFER_SAMPLES);
  if (!count) return false;
  s_sample_count = count;
  s_write_index = count % RETRY_BUFFER_SAMPLES;
  return true;
#endif
}
