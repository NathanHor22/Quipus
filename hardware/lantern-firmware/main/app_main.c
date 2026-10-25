#include <ctype.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

#include "driver/gpio.h"
#include "driver/rtc_io.h"
#include "driver/usb_serial_jtag.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_sleep.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "lantern_agora.h"
#include "lantern_audio.h"
#include "lantern_board.h"
#include "lantern_bluetooth.h"
#if LANTERN_BATTERY_INSTALLED && defined(LANTERN_BATTERY_ADC_DIVIDER)
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
static adc_cali_handle_t s_battery_calibration;
#endif
#include "lantern_board_io.h"
#include "lantern_display.h"
#include "lantern_network.h"
#include "lantern_sd.h"
#include "lantern_storage.h"
#include "lantern_transcript.h"
#include "lantern_wake.h"
#include "quipus_phone_audio.h"
#include "quipus_button_tap.h"
#include "quipus_controls.h"
#include "quipus_local_prompts.h"
#include "quipus_local_recognizer.h"
#include "quipus_volume.h"
#include "quipus_sync_policy.h"
#include "quipus_ota_policy.h"
#include "lantern_ota.h"

typedef enum {
  LOCAL_READY,
  LOCAL_COMMAND_LISTENING,
  LOCAL_COMMAND_PROCESSING,
  LOCAL_AWAITING_CONSENT,
  LOCAL_RECORDING,
  LOCAL_SAVING,
  LOCAL_COMPLETE,
  LOCAL_STATUS,
  LOCAL_ERROR,
} local_state_t;

typedef enum {
  UI_SETUP,
  UI_SPLASH,
  UI_HOME,
  UI_WIFI_LIST,
  UI_WIFI_PASSWORD,
  UI_REPORT_LIST,
  UI_REPORT_DETAIL,
} ui_view_t;

typedef enum {
  RECOVERY_NONE,
  RECOVERY_SESSION_START,
  RECOVERY_COMMAND,
  RECOVERY_CONSENT_CAPTURE,
  RECOVERY_RECORDING_START,
  RECOVERY_STOP,
  RECOVERY_UPLOAD,
  RECOVERY_STATUS,
  RECOVERY_SUMMARY,
} recovery_action_t;

static const char *TAG = "lantern";
static lantern_config_t s_config;
static volatile local_state_t s_state = LOCAL_READY;
static recovery_action_t s_recovery = RECOVERY_NONE;
#if LANTERN_BATTERY_INSTALLED
static adc_oneshot_unit_handle_t s_adc;
#endif
static int s_battery_level = -1;
#if LANTERN_BATTERY_INSTALLED
static int s_battery_raw_average = -1;
#endif
static TickType_t s_state_entered_at;
static TickType_t s_last_summary_retry_at;
static TickType_t s_summary_retry_delay = pdMS_TO_TICKS(30000);
static lantern_cloud_session_t s_cloud_session;
static lantern_cloud_session_t s_pending_completion;
static unsigned s_last_recording_second = UINT32_MAX;
static volatile bool s_network_update_pending;
static volatile bool s_summary_retrying;
static bool s_summary_retry_pending;
static bool s_pair_announcement_shown;
static bool s_agora_active;
static bool s_used_agora;
static volatile bool s_power_off_requested;
static volatile bool s_boot_complete;
static bool s_transcript_uploaded;
static bool s_audio_uploaded;
static bool s_phone_uploaded;
static SemaphoreHandle_t s_control_mutex;
static TaskHandle_t s_button_task;
static TaskHandle_t s_input_task;
static volatile TickType_t s_input_polled_at;
static bool s_wake_available;
static bool s_sd_recording_active;
static bool s_sd_archive_required;
static unsigned s_recording_duration_seconds;
static volatile bool s_controls_ready;
#if LANTERN_HAS_TOUCHSCREEN
static ui_view_t s_ui_view = UI_SPLASH;
static lantern_wifi_network_t s_wifi_networks[LANTERN_WIFI_SCAN_LIMIT];
static size_t s_wifi_network_count;
static size_t s_wifi_selected;
static char s_wifi_password[65];
static bool s_keyboard_uppercase = true;
static lantern_report_item_t s_report_items[LANTERN_REPORT_LIST_LIMIT];
static size_t s_report_item_count;
#endif
static lantern_power_state_t s_previous_power_state = LANTERN_POWER_UNKNOWN;
static int s_charge_anchor_level = -1;
static TickType_t s_charge_anchor_time;
static int s_charge_minutes_per_percent_tenths;
static TickType_t s_last_interaction_at;
static bool s_display_asleep;
static bool s_wifi_screen_open;
static char s_last_error_detail[96];
static recovery_action_t s_announced_recovery;
static char s_announced_error[96];
static TickType_t s_error_announced_at;
static bool s_recording_connection_notice;
// One boot allocation, reused and wiped after each local voice decision.
static int16_t *s_local_voice_samples;


// Both tasks can own the serialized SD + HTTPS control path. Reserve bounded
// internal stack for its deepest TLS/crypto call chains; bulk data uses PSRAM.
#define CLOUD_CONTROL_STACK_BYTES (12 * 1024)
#define VOICE_ACTIVITY_LEVEL 180
#define VOICE_SILENCE_MS 650
#define VOICE_MIN_CAPTURE_MS 1000

static void show_ready(void);
static void start_spoken_consent(bool announce_request);
static void capture_spoken_consent(void);
static esp_err_t accept_recording_consent(void);
static void finalise_recording(void);
static void upload_current_session(bool announce_upload);
static void play_status_report(void);
static void capture_wake_command(void);
static void capture_recovery_command(void);
static void retry_error(void);
static void cancel_error(void);
static void sync_idle_wake_listener(void);
static bool ready_for_cloud_action(void);
static void handle_short_press(void);
static void open_wifi_screen(void);
#if LANTERN_HAS_TOUCHSCREEN
static void show_main_menu(void);
static void open_report_screen(void);
static void handle_touch_release(uint16_t x, uint16_t y);
#endif

static bool capture_utterance(unsigned maximum_ms, bool stop_on_silence) {
  lantern_audio_set_recording(true);
  TickType_t started_at = xTaskGetTickCount();
  TickType_t last_voice_at = started_at;
  TickType_t first_voice_at = started_at;
  bool heard_voice = false;
  while (!s_power_off_requested &&
         (xTaskGetTickCount() - started_at) * portTICK_PERIOD_MS < maximum_ms) {
    TickType_t now = xTaskGetTickCount();
    if (lantern_audio_level() >= VOICE_ACTIVITY_LEVEL) {
      if (!heard_voice) first_voice_at = now;
      heard_voice = true;
      last_voice_at = now;
    } else if (stop_on_silence && heard_voice &&
               (now - first_voice_at) * portTICK_PERIOD_MS >= VOICE_MIN_CAPTURE_MS &&
               (now - last_voice_at) * portTICK_PERIOD_MS >= VOICE_SILENCE_MS) {
      break;
    }
    //30s is a listening/inactivity allowance, not a30s cloud-command upload.
    if (stop_on_silence && heard_voice && maximum_ms > 7000 &&
        (now - first_voice_at) * portTICK_PERIOD_MS >= 7000) break;
    vTaskDelay(pdMS_TO_TICKS(20));
  }
  lantern_audio_set_recording(false);
  ESP_LOGI(TAG, "voice window captured %u ms activity=%s level=%u",
           (unsigned)((xTaskGetTickCount() - started_at) * portTICK_PERIOD_MS),
           heard_voice ? "yes" : "no", (unsigned)lantern_audio_level());
  return heard_voice;
}

static bool capture_short_utterance(unsigned maximum_ms) {
  return capture_utterance(maximum_ms, true);
}

static unsigned elapsed_state_seconds(void) {
  return (unsigned)((xTaskGetTickCount() - s_state_entered_at) *
                    portTICK_PERIOD_MS / 1000);
}

static void show_recording_progress(void) {
  unsigned elapsed = elapsed_state_seconds();
  if (elapsed == s_last_recording_second)
    return;
  s_last_recording_second = elapsed;
  char detail[40];
  quipus_phone_audio_status_t phone;
  quipus_phone_audio_get_status(&phone);
  bool phone_receiving =
      phone.received_samples > 0 && phone.last_packet_device_us > 0 &&
      (uint64_t)esp_timer_get_time() - phone.last_packet_device_us < 2000000;
  const char *source = phone_receiving              ? "QUIPUS + PHONE"
                       : phone.received_samples > 0 ? "QUIPUS; PHONE LOST"
                                                    : "QUIPUS MIC";
  snprintf(detail, sizeof(detail), "%02u:%02u", elapsed / 60, elapsed % 60);
  (void)source; // Source loss remains in diagnostics, not a duplicate caption.
  lantern_display_show(LANTERN_SCREEN_RECORDING, detail);
}

static esp_err_t checkpoint_phone_timing(void) {
  const size_t capacity = 768;
  char *timing =
      heap_caps_malloc(capacity, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!timing)
    return ESP_ERR_NO_MEM;
  quipus_phone_audio_timing_json(timing, capacity);
  esp_err_t result = lantern_sd_set_phone_timing(timing);
  free(timing);
  return result;
}

static void stop_local_capture(void) {
  lantern_wake_set_enabled(false);
  lantern_audio_set_recording(false);
  lantern_audio_set_streaming(false);
  lantern_agora_stop();
  s_agora_active = false;
  if (quipus_phone_audio_stop() != ESP_OK)
    ESP_LOGW(TAG, "Phone capture stopped after an error; retaining samples");
  if ((s_sd_recording_active || lantern_sd_capture_active()) &&
      quipus_phone_audio_idle()) {
    if (checkpoint_phone_timing() != ESP_OK)
      ESP_LOGW(TAG, "Phone timing checkpoint unavailable; archive retained");
    lantern_sd_recording_abort();
    s_sd_recording_active = false;
  }
}

static void show_error(recovery_action_t recovery, const char *detail,
                       const char *prompt) {
  stop_local_capture();
  lantern_network_set_realtime(false);
  s_recovery = recovery;
  s_state = LOCAL_ERROR;
  s_state_entered_at = xTaskGetTickCount();
  snprintf(s_last_error_detail, sizeof(s_last_error_detail), "%s",
           detail ? detail : "PLEASE RETRY");
  ESP_LOGE(TAG, "device error recovery=%d detail=%s sd_error=%s pending=%u",
           recovery, s_last_error_detail,
           esp_err_to_name(lantern_sd_recording_error()),
           (unsigned)lantern_sd_pending_count());
  lantern_display_show(LANTERN_SCREEN_READY, "READY - SAY COMPUTER");
  // Keep diagnostics private. Retry loops speak the same incident only once.
  bool repeated = recovery == s_announced_recovery &&
      !strcmp(s_last_error_detail, s_announced_error) &&
      xTaskGetTickCount() - s_error_announced_at < pdMS_TO_TICKS(60000);
  (void)prompt;
  if (!repeated) {
    s_announced_recovery = recovery;
    snprintf(s_announced_error, sizeof(s_announced_error), "%s", s_last_error_detail);
    s_error_announced_at = xTaskGetTickCount();
    quipus_prompt_t cue = strstr(s_last_error_detail, "SD ")
        ? QUIPUS_PROMPT_SD_FAILURE
        : recovery == RECOVERY_COMMAND
            ? QUIPUS_PROMPT_VOICE_UNAVAILABLE : QUIPUS_PROMPT_ERROR;
    if (quipus_play_prompt(cue) != ESP_OK) lantern_audio_chime(3);
  }
  if (recovery == RECOVERY_STATUS || recovery == RECOVERY_COMMAND) {
    // A read-only voice failure must not block the durable upload queue.
    // Saved archives keep their own manifest/retry state, independently.
    show_ready();
    return;
  }
  sync_idle_wake_listener();
}

static void clear_active_session(void) {

  memset(&s_cloud_session, 0, sizeof(s_cloud_session));
  s_agora_active = false;
  s_used_agora = false;
  s_transcript_uploaded = false;
  s_audio_uploaded = false;
  s_phone_uploaded = false;
  s_sd_archive_required = false;
  s_recording_duration_seconds = 0;
}

#if LANTERN_BATTERY_INSTALLED
static int battery_from_adc(int raw) {
#ifdef LANTERN_BATTERY_ADC_DIVIDER
  int millivolts = 0;
  if (!s_battery_calibration ||
      adc_cali_raw_to_voltage(s_battery_calibration, raw, &millivolts) != ESP_OK)
    return -1;
  millivolts *= LANTERN_BATTERY_ADC_DIVIDER;
  // Far below any lithium cell's cutoff: no battery is connected, so the
  // board is running from USB. Report unknown rather than an empty battery.
  if (millivolts < 2500) return -1;
  const int voltage_points[] = {3300, 3640, 3760, 3880, 4000, 4200};
  const int levels[] = {0, 20, 40, 60, 80, 100};
  if (millivolts <= voltage_points[0]) return 0;
  if (millivolts >= voltage_points[5]) return 100;
  for (int index = 0; index < 5; ++index) {
    if (millivolts < voltage_points[index + 1])
      return levels[index] + (millivolts - voltage_points[index]) *
          (levels[index + 1] - levels[index]) /
          (voltage_points[index + 1] - voltage_points[index]);
  }
  return 100;
#else
  const int adc_points[] = {2030, 2134, 2252, 2370, 2488, 2606};
  const int levels[] = {0, 20, 40, 60, 80, 100};
  raw += 80;
  if (raw <= adc_points[0])
    return 0;
  if (raw >= adc_points[5])
    return 100;
  for (int index = 0; index < 5; ++index) {
    if (raw < adc_points[index + 1]) {
      return levels[index] + (raw - adc_points[index]) *
                                 (levels[index + 1] - levels[index]) /
                                 (adc_points[index + 1] - adc_points[index]);
    }
  }
  return 100;
#endif
}
#endif

static void power_and_battery_init(void) {
#if LANTERN_HAS_POWER_HOLD
  gpio_config_t output = {
      .pin_bit_mask = 1ULL << LANTERN_POWER_HOLD_GPIO,
      .mode = GPIO_MODE_OUTPUT,
  };
  ESP_ERROR_CHECK(gpio_config(&output));
  gpio_set_level(LANTERN_POWER_HOLD_GPIO, 1);
#endif
#if LANTERN_HAS_CHARGING_SIGNAL
  gpio_config_t charging = {
      .pin_bit_mask = 1ULL << LANTERN_CHARGING_GPIO,
      .mode = GPIO_MODE_INPUT,
      .pull_up_en = GPIO_PULLUP_ENABLE,
  };
  ESP_ERROR_CHECK(gpio_config(&charging));
#endif

#if LANTERN_BATTERY_INSTALLED
  adc_oneshot_unit_init_cfg_t init = {.unit_id = ADC_UNIT_1,
                                      .ulp_mode = ADC_ULP_MODE_DISABLE};
  ESP_ERROR_CHECK(adc_oneshot_new_unit(&init, &s_adc));
  adc_oneshot_chan_cfg_t channel = {.atten = ADC_ATTEN_DB_12,
                                    .bitwidth = ADC_BITWIDTH_12};
  ESP_ERROR_CHECK(
      adc_oneshot_config_channel(s_adc, LANTERN_BATTERY_ADC_CHANNEL, &channel));
#ifdef LANTERN_BATTERY_ADC_DIVIDER
  adc_cali_curve_fitting_config_t calibration = {
      .unit_id = ADC_UNIT_1,
      .chan = LANTERN_BATTERY_ADC_CHANNEL,
      .atten = ADC_ATTEN_DB_12,
      .bitwidth = ADC_BITWIDTH_12,
  };
  if (adc_cali_create_scheme_curve_fitting(&calibration,
                                           &s_battery_calibration) != ESP_OK)
    ESP_LOGW(TAG, "battery calibration unavailable; percentage stays unknown");
#endif
#else
  // The first V2 showcase is USB powered. Avoid turning the unconnected
  // battery-divider pin into random dashboard telemetry.
  s_battery_level = -1;
#endif
}

static void update_battery_level(void) {
#if LANTERN_BATTERY_INSTALLED
  int raw = 0;
  if (adc_oneshot_read(s_adc, LANTERN_BATTERY_ADC_CHANNEL, &raw) == ESP_OK) {
    // Smooth ADC noise so the percentage does not flicker while the display,
    // radio, speaker and charger change the board's instantaneous load.
    s_battery_raw_average =
        s_battery_raw_average < 0 ? raw : (s_battery_raw_average * 7 + raw) / 8;
    s_battery_level = battery_from_adc(s_battery_raw_average);
  }
#else
  s_battery_level = -1;
#endif
}

static lantern_power_state_t battery_power_state(void) {
#if LANTERN_HAS_CHARGING_SIGNAL
  return gpio_get_level(LANTERN_CHARGING_GPIO) == LANTERN_CHARGING_ACTIVE_LEVEL
             ? LANTERN_POWER_CHARGING
             : LANTERN_POWER_BATTERY;
#elif LANTERN_HAS_USB_CHARGE_DETECT
  // ES3C28P does not route the TP4054 CHRG output to the ESP32. Its native USB
  // peripheral still distinguishes a connected USB host from battery use.
  return usb_serial_jtag_is_connected() ? LANTERN_POWER_CHARGING
                                        : LANTERN_POWER_BATTERY;
#elif LANTERN_BATTERY_INSTALLED
  return LANTERN_POWER_BATTERY;
#else
  return LANTERN_POWER_UNKNOWN;
#endif
}

static void sync_idle_wake_listener(void) {
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  // Error listening must not overwrite a pending RAM-only recording.
  bool error_voice_safe = LANTERN_HAS_SD_CARD || s_audio_uploaded ||
      (s_recovery != RECOVERY_UPLOAD && s_recovery != RECOVERY_STOP);
  bool listening_state = s_state == LOCAL_READY ||
      (s_state == LOCAL_ERROR && error_voice_safe);
  // Local wake survives Internet loss; only commands still need cloud STT.
  bool enabled = s_boot_complete && s_wake_available && listening_state &&
                 network.paired && !s_power_off_requested && !s_wifi_screen_open;
#if LANTERN_HAS_TOUCHSCREEN
  enabled = enabled && (s_state == LOCAL_ERROR ||
                        s_ui_view == UI_SPLASH || s_ui_view == UI_HOME);
#endif
  // Connectivity and view changes share this policy. Reconnecting must restore
  // idle listening without redrawing the screen or enabling it in a submenu.
  lantern_wake_set_enabled(enabled);
}

static void show_ready(void) {
  if (!s_boot_complete) return;
  // Repainting an already-idle face must not erase a pending wake event.
  if (s_state != LOCAL_READY) {
    lantern_wake_set_enabled(false);
    lantern_network_end_report();
  }
  lantern_network_set_realtime(false);
  s_display_asleep = false;
  // Network/heartbeat redraws must not reset the real user-input clock.
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  s_state = LOCAL_READY;
  s_recovery = RECOVERY_NONE;
  s_state_entered_at = xTaskGetTickCount();
  char bluetooth_pin[7];
  lantern_bluetooth_passkey(bluetooth_pin);
  if (bluetooth_pin[0] && !network.paired) {
    lantern_display_show(LANTERN_SCREEN_BLUETOOTH, bluetooth_pin);
    return;
  }
#if LANTERN_HAS_TOUCHSCREEN
  // The active input view must match setup, even if pairing was revoked while
  // the main menu was visible. Setup taps must never hit stale session controls.
  s_ui_view = UI_SETUP;
  if (network.paired) {
    s_ui_view = UI_SPLASH;
    lantern_display_show_splash();
    sync_idle_wake_listener();
    return;
  }
#endif
  if (s_wifi_screen_open ||
      (network.setup_portal_active && !network.paired)) {
    lantern_display_show_setup(network.setup_ssid, network.last_error);
  } else if (network.paired) {
    lantern_display_show(LANTERN_SCREEN_READY,
        s_wake_available ? "READY - SAY COMPUTER" : "READY - PRESS TO START");
  } else if (network.wifi_connected) {
    lantern_display_show(LANTERN_SCREEN_SETUP, "PAIR IN DASHBOARD");
  } else if (network.paired && LANTERN_HAS_SD_CARD && lantern_sd_secure_ready()) {
    lantern_display_show(LANTERN_SCREEN_READY, "VOICE OFFLINE - CONNECT WIFI");
  } else {
    lantern_display_show(LANTERN_SCREEN_CONNECTING, "CONNECTING TO WIFI");
  }
  sync_idle_wake_listener();
}

static void network_changed(const lantern_network_status_t *status) {
  ESP_LOGI(TAG, "network wifi=%d portal=%d paired=%d ip=%s",
           status->wifi_connected, status->setup_portal_active, status->paired,
           status->ip_address);
  // ESP-IDF invokes this callback on the small sys_evt task. Defer display,
  // speech, and delays to Quipus's health task.
  s_network_update_pending = true;
}

static esp_err_t open_quick_consent(void) {
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  if (!network.paired || s_power_off_requested) {
    show_ready();
    return ESP_ERR_INVALID_STATE;
  }
  // Ask locally first. No cloud session or SD recording exists before YES.
  clear_active_session();
  lantern_wake_set_enabled(false);
  lantern_network_set_realtime(true);
  s_state = LOCAL_AWAITING_CONSENT;
  s_state_entered_at = xTaskGetTickCount();
  lantern_display_show(LANTERN_SCREEN_CONSENT, "SAY YES OR NO");
  return ESP_OK;
}

static esp_err_t begin_recording_session(void) {
  lantern_display_show(LANTERN_SCREEN_CONNECTING, "STARTING SESSION");
#if LANTERN_HAS_SD_CARD
  // Provisioning happens during setup, never between accepted consent and
  // capture. A newly inserted card may be mounted locally without any HTTP.
  if (!lantern_sd_secure_ready()) {
    if (lantern_sd_init(NULL) != ESP_OK || !lantern_sd_secure_ready()) {
      show_error(RECOVERY_SESSION_START, "CONNECT ONCE TO SECURE SD", NULL);
      return ESP_FAIL;
    }
  }
  // Every SD-backed meeting starts locally, even online. Its unique session and
  // the post-consent manifest are durable before the first microphone sample;
  // the existing import/upload queue synchronizes it after capture finishes.
  if (lantern_network_begin_offline(&s_cloud_session) == ESP_OK) return ESP_OK;
#else
  // Original RAM-only demonstration hardware retains its existing cloud flow.
  if (lantern_network_begin_quick(&s_cloud_session) == ESP_OK) return ESP_OK;
#endif
  show_error(RECOVERY_SESSION_START, "SESSION START FAILED", NULL);
  return ESP_FAIL;
}

static bool local_voice_ready(void) {
  return s_local_voice_samples && quipus_local_recognizer_available();
}

static esp_err_t classify_local_yes_no(quipus_local_purpose_t purpose,
                                      quipus_local_result_t *answer) {
  if (!answer) return ESP_ERR_INVALID_ARG;
  *answer = (quipus_local_result_t){.intent = QUIPUS_LOCAL_UNKNOWN};
  if (!local_voice_ready()) return ESP_ERR_NOT_SUPPORTED;
  size_t buffered = lantern_audio_buffered_samples();
  if (!buffered) return ESP_ERR_INVALID_SIZE;
  // A final I2S block may straddle the 5-second deadline. Keep the newest
  // bounded window so a late NO remains visible without overrunning scratch.
  size_t count = buffered < QUIPUS_LOCAL_MAX_SAMPLES ? buffered : QUIPUS_LOCAL_MAX_SAMPLES;
  int64_t classified_at = esp_timer_get_time();
  size_t copied = lantern_audio_copy_samples(s_local_voice_samples, buffered - count, count);
  esp_err_t result = ESP_FAIL;
  if (copied == count) {
    result = purpose == QUIPUS_LOCAL_PURPOSE_NAVIGATION
        ? quipus_local_recognizer_classify_navigation(s_local_voice_samples, count, answer)
        : quipus_local_recognizer_classify(s_local_voice_samples, count, answer);
  }
  // Private utterance PCM never stays in the classifier scratch between turns.
  volatile int16_t *samples = s_local_voice_samples;
  for (size_t i = 0; i < count; ++i) samples[i] = 0;
  if (result != ESP_OK) answer->intent = QUIPUS_LOCAL_UNKNOWN;
  ESP_LOGI(TAG, "local yes/no result=%d confidence=%u windows=%u elapsed_ms=%lld",
      answer->intent, (unsigned)answer->confidence, (unsigned)answer->windows,
      (long long)((esp_timer_get_time() - classified_at) / 1000));
  (void)classified_at; // Host fixtures may compile logging out.
  return result;
}

static esp_err_t capture_consent_response(const char *context,
                                          char intent[32]) {
  intent[0] = 0;
  lantern_display_show(LANTERN_SCREEN_CONSENT, "SAY YES OR NO");
  lantern_audio_chime(1);
  vTaskDelay(pdMS_TO_TICKS(250));
  // Capture the full room response, including a later refusal. Connected
  // consent keeps the proven full-utterance recognizer as its authority; the
  // stock local keyword model must not veto or approve that online decision.
  bool heard_voice = capture_utterance(5000, false);
  if (s_power_off_requested || !heard_voice ||
      lantern_audio_buffered_samples() < LANTERN_MIC_SAMPLE_RATE / 2) {
    lantern_audio_clear_private_buffer();
    return ESP_FAIL;
  }
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  if (network.wifi_connected) {
    lantern_display_show(LANTERN_SCREEN_CONNECTING, "VERIFYING CONSENT");
    esp_err_t result = lantern_network_run_voice_command(context, s_battery_level, intent, 32);
    lantern_audio_clear_private_buffer();
    return result;
  }

  // Offline pilot: only explicit local YES/NO are meaningful. Unknown, silence
  // or inference failure never inherit an earlier menu choice or grant consent.
  quipus_local_result_t answer;
  esp_err_t result = classify_local_yes_no(QUIPUS_LOCAL_PURPOSE_CONSENT, &answer);
  if (s_power_off_requested) {
    lantern_audio_clear_private_buffer();
    return ESP_ERR_INVALID_STATE;
  }
  snprintf(intent, 32, "%s", result == ESP_OK && answer.intent == QUIPUS_LOCAL_YES
      ? "consent_yes" : result == ESP_OK && answer.intent == QUIPUS_LOCAL_NO
          ? "consent_no" : "unknown");
  lantern_audio_clear_private_buffer();
  return ESP_OK;
}

static void cancel_pending_consent(void) {
  if (!s_cloud_session.offline_local && s_cloud_session.session_id[0] &&
      lantern_network_confirm_consent(&s_cloud_session, false, NULL) !=
          ESP_OK) {
    ESP_LOGW(TAG,
             "server did not acknowledge rejected consent; requesting reset");
    lantern_network_restart_session();
  }
  clear_active_session();
  show_ready();
}

static esp_err_t accept_recording_consent(void) {
  if (s_power_off_requested) return ESP_ERR_INVALID_STATE;
  if (begin_recording_session() != ESP_OK || s_power_off_requested)
    return ESP_FAIL;
  lantern_agora_transport_t transport;
  memset(&transport, 0, sizeof(transport));
  bool offline = s_cloud_session.offline_local;
  lantern_display_show(LANTERN_SCREEN_CONNECTING, "STARTING RECORDING");
  esp_err_t confirmed = offline ? ESP_OK :
      lantern_network_confirm_consent(&s_cloud_session, true, &transport);
  if (s_power_off_requested) return ESP_ERR_INVALID_STATE;
  if (confirmed != ESP_OK) {
    show_error(RECOVERY_RECORDING_START, "RECORDING START FAILED",
               "session_error");
    return ESP_FAIL;
  }

  lantern_transcript_reset();
  s_agora_active = !offline && lantern_agora_start(&transport) == ESP_OK;
  s_used_agora = s_agora_active;
  if (s_power_off_requested) return ESP_ERR_INVALID_STATE;
  if (!s_agora_active && !offline) {
    ESP_LOGW(TAG,
             "Agora device join failed; continuing with the local WAV archive");
    esp_err_t prompted = lantern_network_play_prompt("local_recording");
    if (s_power_off_requested) return ESP_ERR_INVALID_STATE;
    if (prompted != ESP_OK) lantern_audio_chime(1);
  }
  esp_err_t clock_synced = offline ? ESP_OK :
      lantern_network_capture_started(&s_cloud_session);
  if (s_power_off_requested) return ESP_ERR_INVALID_STATE;
  if (clock_synced != ESP_OK) {
    show_error(RECOVERY_RECORDING_START, "CLOCK SYNC FAILED", "session_error");
    return ESP_FAIL;
  }

  snprintf(s_cloud_session.owner_id, sizeof(s_cloud_session.owner_id), "%s",
           s_config.owner_id);
  if (s_power_off_requested) return ESP_ERR_INVALID_STATE;
  lantern_sd_set_session(&s_cloud_session);
  esp_err_t sd_start = lantern_sd_recording_begin(s_cloud_session.session_id);
  s_sd_recording_active = sd_start == ESP_OK;
  s_sd_archive_required = s_sd_recording_active;
  s_recording_duration_seconds = 0;
  if (s_power_off_requested) {
    stop_local_capture();
    return ESP_ERR_INVALID_STATE;
  }
#if LANTERN_HAS_SD_CARD
  if (!s_sd_recording_active) {
    ESP_LOGE(TAG, "microSD archive is required on this board: %s",
             esp_err_to_name(sd_start));
    if (!s_cloud_session.offline_local)
      ESP_ERROR_CHECK_WITHOUT_ABORT(lantern_network_abort_session(&s_cloud_session));
    clear_active_session();
    show_error(RECOVERY_NONE, "SD CARD REQUIRED", "upload_error");
    return ESP_FAIL;
  }
#else
  if (!s_sd_recording_active) {
    ESP_LOGW(TAG, "microSD unavailable on this board; retaining the 30-second "
                  "PSRAM archive");
  }
#endif

  if (quipus_play_prompt(QUIPUS_PROMPT_RECORDING_STARTED) != ESP_OK)
    lantern_audio_chime(1);
  if (s_power_off_requested) {
    stop_local_capture();
    return ESP_ERR_INVALID_STATE;
  }
  if (s_sd_recording_active &&
      quipus_phone_audio_begin(s_cloud_session.session_id) != ESP_OK) {
    ESP_LOGW(TAG, "Phone microphone unavailable; onboard recording continues");
  }
  if (s_power_off_requested) {
    stop_local_capture();
    return ESP_ERR_INVALID_STATE;
  }
  s_state = LOCAL_RECORDING;
  s_recording_connection_notice = false;
  s_recovery = RECOVERY_NONE;
  s_state_entered_at = xTaskGetTickCount();
  s_last_recording_second = UINT32_MAX;
  s_transcript_uploaded = false;
  s_audio_uploaded = false;
  lantern_audio_set_recording(true);
  lantern_audio_set_streaming(s_agora_active);
  show_recording_progress();
  ESP_LOGI(TAG, "%s recording started at %s %s Malaysia time",
           s_agora_active ? "Agora and local" : "local fallback",
           s_cloud_session.local_date, s_cloud_session.local_time);
  return ESP_OK;
}

static void capture_spoken_consent(void) {
  for (unsigned attempt = 0; attempt < 2; ++attempt) {
    char consent[32] = {0};
    if (s_power_off_requested) return;
    esp_err_t result = capture_consent_response(
        attempt ? "consent_retry" : "consent", consent);
    if (s_power_off_requested) return;
    if (result == ESP_OK && strcmp(consent, "consent_yes") == 0) {
      accept_recording_consent();
      return;
    }
    if (result == ESP_OK && strcmp(consent, "consent_no") == 0) {
      ESP_LOGI(TAG, "spoken consent refused, attempt=%u", attempt + 1);
    } else {
      ESP_LOGW(TAG, "spoken consent not confirmed, attempt=%u result=%s",
               attempt + 1, esp_err_to_name(result));
    }
    // One repeated question, including after an explicit first NO. No button
    // approval and no reboot: a second refusal simply returns to the main screen.
    if (attempt == 0 &&
        quipus_play_prompt(QUIPUS_PROMPT_CONSENT_RETRY) != ESP_OK) break;
  }
  (void)quipus_play_prompt(QUIPUS_PROMPT_CONSENT_REFUSED);
  cancel_pending_consent();
}

// Never ask for consent the recorder cannot act on: every session saves to
// the secured card first. A newly inserted card may mount locally.
static bool sd_ready_for_recording(void) {
#if LANTERN_HAS_SD_CARD
  // An unpaired recorder has no card key yet; pairing is the real blocker,
  // and open_quick_consent already refuses it.
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  if (!network.paired) return true;
  if (lantern_sd_secure_ready()) return true;
  if (lantern_sd_init(NULL) == ESP_OK && lantern_sd_secure_ready()) return true;
  ESP_LOGW(TAG, "recording unavailable before consent: SD card missing or not yet secured");
  (void)quipus_play_prompt(QUIPUS_PROMPT_SD_FAILURE);
  show_ready();
  return false;
#else
  return true;
#endif
}

static void start_spoken_consent(bool announce_request) {
  if (s_power_off_requested || !sd_ready_for_recording() ||
      open_quick_consent() != ESP_OK) return;
  esp_err_t spoken = announce_request ? quipus_play_consent_prompt() : ESP_OK;
  if (s_power_off_requested) return;
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  if (spoken != ESP_OK || (!local_voice_ready() && !network.wifi_connected)) {
    ESP_LOGW(TAG, "voice consent unavailable: prompt=%s wifi=%d; not recording",
             esp_err_to_name(spoken), network.wifi_connected);
    (void)quipus_play_prompt(QUIPUS_PROMPT_NETWORK_REQUIRED);
    cancel_pending_consent();
    return;
  }
  ESP_LOGI(TAG, "local consent question played; listening for yes or no");
  capture_spoken_consent();
}

// Delivery announcements are once per session, local, and bounded. Retrying a
// network request must not keep speaking the same notification every 30 seconds.
static char s_upload_notice_session[37], s_uploaded_notice_session[37];
static void announce_upload_started(const lantern_cloud_session_t *session) {
  if (!session || !session->session_id[0] ||
      !strcmp(s_upload_notice_session, session->session_id)) return;
  snprintf(s_upload_notice_session, sizeof(s_upload_notice_session), "%s",
           session->session_id);
  if (quipus_play_uploading_prompt() != ESP_OK) lantern_audio_chime(1);
}

static void announce_upload_verified(const lantern_cloud_session_t *session) {
  if (!session || !session->archive_verified || !session->session_id[0] ||
      !strcmp(s_uploaded_notice_session, session->session_id)) return;
  snprintf(s_uploaded_notice_session, sizeof(s_uploaded_notice_session), "%s",
           session->session_id);
  esp_err_t spoken = session->discarded
      ? quipus_play_prompt(QUIPUS_PROMPT_SHORT_RECORDING_SKIPPED)
      : quipus_play_uploaded_prompt();
  if (spoken != ESP_OK) lantern_audio_chime(2);
}

static void session_complete(bool processing_pending) {
  unsigned captured_seconds = s_recording_duration_seconds
                                  ? s_recording_duration_seconds
                                  : lantern_audio_buffered_seconds();
  s_state = LOCAL_COMPLETE;
  s_recovery = RECOVERY_NONE;
  // Storage acknowledgement alone is not the full completion receipt. Keep the
  // local archive and distinguish verification pending from verified delivery.
  const char *detail = s_cloud_session.archive_verified
      ? (s_cloud_session.discarded ? "SHORT RECORDING SKIPPED"
          : processing_pending ? "UPLOADED - SUMMARY PROCESSING"
                               : "UPLOADED TO DASHBOARD")
      : "AUDIO SENT - VERIFICATION PENDING";
  lantern_display_show(LANTERN_SCREEN_COMPLETE, detail);
  announce_upload_verified(&s_cloud_session);
  s_state_entered_at = xTaskGetTickCount();
  ESP_LOGI(TAG, "session delivery seconds=%u verified=%d processing_pending=%d",
           captured_seconds, s_cloud_session.archive_verified, processing_pending);
  clear_active_session();
  show_ready();
}

static void upload_current_session(bool announce_upload) {
  lantern_wake_set_enabled(false);
  s_summary_retry_delay = pdMS_TO_TICKS(
      quipus_sync_retry_delay_ms(QUIPUS_SYNC_FAILED));
  int64_t measured_at = esp_timer_get_time();
  s_state = LOCAL_SAVING;
  s_state_entered_at = xTaskGetTickCount();
  // Progress is immediate; cloud TTS must not delay the WAV transfer.
  lantern_display_show(LANTERN_SCREEN_SAVING, "UPLOADING AUDIO - PREPARING");
  if (announce_upload) announce_upload_started(&s_cloud_session);
  ESP_LOGI(TAG, "Save timing announcement_ms=%lld",
           (long long)((esp_timer_get_time() - measured_at) / 1000));

  measured_at = esp_timer_get_time();
  unsigned caption_packets = lantern_transcript_packet_count();
  if (!s_transcript_uploaded && s_used_agora && caption_packets) {
    lantern_display_show(LANTERN_SCREEN_SAVING, "UPLOADING TRANSCRIPT");
    if (lantern_network_upload_transcript(&s_cloud_session) == ESP_OK) {
      s_transcript_uploaded = true;
    } else {
      ESP_LOGW(
          TAG,
          "Agora captions unavailable; server will transcribe the WAV archive");
    }
  }
  ESP_LOGI(TAG, "Save timing captions_ms=%lld",
           (long long)((esp_timer_get_time() - measured_at) / 1000));

  if (!s_audio_uploaded) {
    if (s_sd_archive_required && !lantern_sd_recording_ready()) {
      ESP_LOGE(TAG, "refusing to replace an SD-backed meeting with the "
                    "30-second fallback");
      show_error(RECOVERY_UPLOAD, "FULL SD AUDIO NOT READY", "upload_error");
      return;
    }
    lantern_display_show(LANTERN_SCREEN_SAVING, "UPLOADING AUDIO");
    if (lantern_network_upload_audio(&s_cloud_session) != ESP_OK) {
      show_error(RECOVERY_UPLOAD, "AUDIO UPLOAD PAUSED", "upload_error");
      return;
    }
    s_audio_uploaded = true;
    if (LANTERN_HAS_SD_CARD && lantern_sd_recording_ready() &&
        lantern_sd_checkpoint(&s_cloud_session, true, true, s_phone_uploaded) != ESP_OK) {
      show_error(RECOVERY_UPLOAD, "UPLOAD RECEIPT SAVE FAILED", "upload_error");
      return;
    }
  }
  if (!s_phone_uploaded && lantern_sd_phone_size() > 44) {
    lantern_display_show(LANTERN_SCREEN_SAVING, "UPLOADING PHONE AUDIO");
    if (lantern_network_upload_phone(&s_cloud_session) != ESP_OK) {
      lantern_sd_checkpoint(&s_cloud_session, true, s_audio_uploaded, false);
      session_complete(true);
      return;
    }
    s_phone_uploaded = true;
    if (lantern_sd_checkpoint(&s_cloud_session, true, s_audio_uploaded, true) != ESP_OK) {
      show_error(RECOVERY_UPLOAD, "PHONE RECEIPT SAVE FAILED", "upload_error");
      return;
    }
  }

  lantern_display_show(LANTERN_SCREEN_SAVING, "PROCESSING SUMMARY");
  bool transcript_ready = false;
  measured_at = esp_timer_get_time();
  esp_err_t completion_result =
      lantern_network_complete_session(&s_cloud_session, &transcript_ready);
  ESP_LOGI(TAG, "Save timing queue_ms=%lld result=%s",
           (long long)((esp_timer_get_time() - measured_at) / 1000),
           esp_err_to_name(completion_result));
  lantern_sd_checkpoint(&s_cloud_session, true, s_audio_uploaded,
                        s_phone_uploaded);
  if (completion_result != ESP_OK) {
    s_pending_completion = s_cloud_session;
    s_summary_retry_pending = true;
    s_last_summary_retry_at = xTaskGetTickCount();
    session_complete(true);
    return;
  }
  if (s_cloud_session.archive_verified && lantern_sd_recording_ready()) {
    if (lantern_sd_recording_confirm_uploaded_at(lantern_network_trusted_time()) != ESP_OK) {
      ESP_LOGW(TAG, "processed cloud WAV is ready but the local SD copy could "
                    "not be cached");
    }
  } else if (lantern_sd_recording_ready()) {
    ESP_LOGW(TAG,
             "transcript unavailable; preserving the complete WAV on microSD");
  }
  if (!s_cloud_session.archive_verified && lantern_sd_recording_ready()) {
    s_pending_completion = s_cloud_session;
    s_summary_retry_pending = true;
    s_summary_retry_delay = pdMS_TO_TICKS(
        quipus_sync_retry_delay_ms(QUIPUS_SYNC_VERIFICATION_PENDING));
    s_last_summary_retry_at = xTaskGetTickCount();
  }
  session_complete(s_cloud_session.processing_queued);
}

static void saved_for_later(void) {
  s_summary_retry_delay = pdMS_TO_TICKS(
      quipus_sync_retry_delay_ms(QUIPUS_SYNC_FAILED));
  s_last_summary_retry_at = xTaskGetTickCount();
  s_state = LOCAL_COMPLETE;
  s_recovery = RECOVERY_NONE;
  s_state_entered_at = xTaskGetTickCount();
  lantern_display_show(LANTERN_SCREEN_COMPLETE,
                       "SAVED LOCALLY - UPLOAD PENDING");
  if (quipus_play_saved_offline_prompt() != ESP_OK) lantern_audio_chime(2);
  clear_active_session();
  show_ready();
}
static void continue_after_stop(void) {
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  bool stopped = false;
  if (network.wifi_connected && network.paired) {
    lantern_display_show(LANTERN_SCREEN_SAVING, "CLOSING SESSION");
    stopped = s_cloud_session.offline_local
                  ? lantern_network_import_recording(&s_cloud_session) == ESP_OK
                  : lantern_network_stop_recording(&s_cloud_session) == ESP_OK;
  }
  if (LANTERN_HAS_SD_CARD && lantern_sd_recording_ready() &&
      lantern_sd_checkpoint(&s_cloud_session, stopped, false, false) != ESP_OK) {
    show_error(RECOVERY_STOP, "SESSION RECEIPT SAVE FAILED", "stop_error");
    return;
  }
  if (!stopped && lantern_sd_recording_ready()) {
    saved_for_later();
    return;
  }
  if (!stopped) {
    show_error(RECOVERY_STOP, "SESSION STOP PAUSED", "stop_error");
    return;
  }
  upload_current_session(true);
}

static bool finish_local_recording(void) {
  unsigned expected_seconds = elapsed_state_seconds();
  s_state = LOCAL_SAVING;
  s_state_entered_at = xTaskGetTickCount();
  lantern_audio_set_recording(false);
  if (quipus_phone_audio_stop() != ESP_OK)
    ESP_LOGW(TAG, "Phone capture interrupted; preserving captured samples");
  if (!quipus_phone_audio_idle()) {
    show_error(RECOVERY_NONE, "PHONE AUDIO STILL SAVING", "upload_error");
    return false;
  }
  if (LANTERN_HAS_SD_CARD && checkpoint_phone_timing() != ESP_OK)
    ESP_LOGW(TAG, "Phone timing checkpoint unavailable; archive retained");
  if (s_sd_recording_active) {
    lantern_display_show(LANTERN_SCREEN_SAVING, "FINALISING SD ARCHIVE");
    if (lantern_sd_recording_finish() != ESP_OK) {
      s_sd_recording_active = false;
      ESP_LOGE(TAG, "microSD finalization failed; the truncated PSRAM fallback "
                    "will not be uploaded");
      clear_active_session();
      show_error(RECOVERY_NONE, "SD ARCHIVE FAILED", "upload_error");
      return false;
    }
    s_sd_recording_active = false;
    size_t archive_bytes = lantern_sd_recording_size();
    if (archive_bytes > 44) {
      s_recording_duration_seconds =
          (unsigned)((archive_bytes - 44) /
                     (LANTERN_MIC_SAMPLE_RATE * sizeof(int16_t)));
    }
    ESP_LOGI(TAG, "complete SD archive ready: %u bytes, %u seconds",
             (unsigned)archive_bytes, s_recording_duration_seconds);
    if (expected_seconds > 5 &&
        s_recording_duration_seconds + 2 < expected_seconds) {
      ESP_LOGE(TAG,
               "SD archive duration mismatch: recorded=%u expected=%u; "
               "preserving local WAV",
               s_recording_duration_seconds, expected_seconds);
      clear_active_session();
      show_error(RECOVERY_NONE, "SD RECORDING INCOMPLETE", "upload_error");
      return false;
    }
  } else {
    s_recording_duration_seconds = lantern_audio_buffered_seconds();
  }
  return true;
}

static void finalise_recording(void) {
  if (!finish_local_recording()) return;
  lantern_display_show(LANTERN_SCREEN_SAVING, "FINALISING SPEECH");
  // Leave the live microphone path open briefly so Agora can finalize the last
  // sentence. The local archive ends exactly at the centre-button press.
  if (s_agora_active)
    vTaskDelay(pdMS_TO_TICKS(3000));
  lantern_audio_set_streaming(false);
  lantern_agora_stop();
  s_agora_active = false;
  continue_after_stop();
}

#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
static void power_off_safely(void) {
  lantern_wake_set_enabled(false);
  bool captured = s_state == LOCAL_RECORDING;
  if (captured && !finish_local_recording()) {
    s_power_off_requested = false;
    return;
  }
  lantern_audio_set_streaming(false);
  lantern_agora_stop();
  s_agora_active = false;
  // The controller owns report-cache teardown. A report can be between HTTP
  // pages with no speaker activity while its encrypted writer is still open.
  // Close it before checking SD quiescence; never do this in the input task.
  lantern_network_end_report();
  if (!quipus_phone_audio_idle() || !lantern_sd_can_power_down()) {
    s_power_off_requested = false;
    show_error(RECOVERY_NONE, "STILL SAVING - TRY POWER AGAIN", NULL);
    return;
  }
  if (captured && lantern_sd_checkpoint(&s_cloud_session, false, false, false) != ESP_OK) {
    s_power_off_requested = false;
    show_error(RECOVERY_NONE, "SD SAVE FAILED - POWER STAYS ON", NULL);
    return;
  }
  // An unconfirmed empty cloud session can expire or be reclaimed next boot.
  // Audio already on SD keeps its owner/key and is resumed after reconnection.
  lantern_display_show(LANTERN_SCREEN_SAVING, "SAVED - POWERING OFF");
  if (s_boot_complete) lantern_audio_chime(1);
  vTaskDelay(pdMS_TO_TICKS(200));
  lantern_display_set_awake(false);
  lantern_board_speaker_enable(false);
  ESP_ERROR_CHECK(esp_sleep_enable_ext0_wakeup(LANTERN_POWER_BUTTON_GPIO, 0));
  ESP_ERROR_CHECK(rtc_gpio_pullup_en(LANTERN_POWER_BUTTON_GPIO));
  ESP_ERROR_CHECK(rtc_gpio_pulldown_dis(LANTERN_POWER_BUTTON_GPIO));
  gpio_set_level(LANTERN_POWER_HOLD_GPIO, 0);
  while (gpio_get_level(LANTERN_POWER_BUTTON_GPIO) == 0)
    vTaskDelay(pdMS_TO_TICKS(20));
  ESP_LOGI(TAG, "safe shutdown complete; entering sleep");
  esp_deep_sleep_start();
}
#endif

static void review_spoken_actions(void) {
  unsigned unanswered = 0;
  const char *failure = NULL;
  while (!s_power_off_requested && lantern_network_review_pending() &&
         unanswered < 2) {
    if (s_power_off_requested) break;
    if (lantern_audio_is_speaker_active()) {
      failure = "REPORT AUDIO BUSY";
      break;
    }
    // Discard report/preroll audio before the local prompt. The fresh capture
    // below resets the RAM window again, after the chime and acoustic tail.
    lantern_audio_reset_report_listening();
    if (s_power_off_requested) break;
    lantern_display_show(LANTERN_SCREEN_LISTENING, "APPROVE? SAY YES OR NO");
    if (s_power_off_requested) break;
    lantern_audio_chime(1);
    if (s_power_off_requested) break;
    vTaskDelay(pdMS_TO_TICKS(250));
    if (s_power_off_requested) break;
    if (lantern_audio_is_speaker_active()) {
      failure = "REPORT AUDIO BUSY";
      break;
    }
    bool heard = capture_short_utterance(4000);
    if (s_power_off_requested) break;
    if (!heard || lantern_audio_buffered_samples() < LANTERN_MIC_SAMPLE_RATE / 2) {
      ++unanswered;
      continue;
    }
    if (lantern_audio_is_speaker_active()) {
      failure = "REPORT AUDIO BUSY";
      break;
    }
    lantern_display_show(LANTERN_SCREEN_UNDERSTANDING, "REVIEWING ACTION");
    if (s_power_off_requested) break;
    char reply[32] = {0};
    esp_err_t result = lantern_network_run_voice_command(
        "action", s_battery_level, reply, sizeof(reply));
    if (s_power_off_requested) break;
    if (result != ESP_OK) {
      failure = "ACTION NOT CONFIRMED";
      break;
    }
    // Only genuinely classified review replies renew the bounded opportunity.
    // Silence/unknown answers cancel; meaningful action reviews may continue.
    unanswered = strcmp(reply, "action_reply") == 0 ? 0 : unanswered + 1;
  }
  lantern_network_cancel_review();
  if (failure && !s_power_off_requested)
    show_error(RECOVERY_STATUS, failure, "status_error");
}

static void report_dialogue(esp_err_t result) {
  unsigned unclear_turns = 0;
  // Meaningful questions may continue; silence and repeated unknown replies end
  // the dialogue. Speaker audio must never become a fresh user request.
  while (!s_power_off_requested) {
    if (result == ESP_ERR_NOT_FOUND) { show_ready(); return; }
    s_state = LOCAL_STATUS;
    s_recovery = RECOVERY_NONE;
    if (result != ESP_OK && result != LANTERN_REPORT_INTERRUPTED) {
      show_error(RECOVERY_STATUS, "REPORT UNAVAILABLE", "status_error");
      return;
    }
    bool interrupted_speech = false;
    if (result == LANTERN_REPORT_INTERRUPTED) {
      interrupted_speech = lantern_audio_capture_interruption(7500);
      // A physical cancel is an exit, not permission to capture another turn.
      if (!interrupted_speech) { show_ready(); return; }
    } else {
      review_spoken_actions();
    }
    if (s_state != LOCAL_STATUS || s_power_off_requested) return;
    lantern_network_cancel_review();
    if (!interrupted_speech) {
      lantern_audio_reset_report_listening();
      // Network playback has drained before returning. Refuse overlapping capture
      // and allow its acoustic tail to settle before opening a new user buffer.
      if (lantern_audio_is_speaker_active()) {
        show_error(RECOVERY_STATUS, "REPORT AUDIO BUSY", "status_error");
        return;
      }
      vTaskDelay(pdMS_TO_TICKS(250));
      if (s_power_off_requested) return;
      if (lantern_audio_is_speaker_active()) {
        show_error(RECOVERY_STATUS, "REPORT AUDIO BUSY", "status_error");
        return;
      }
      lantern_display_show(LANTERN_SCREEN_LISTENING, "LISTENING");
      // set_recording(true) resets the RAM window; no playback/preroll is reused.
      if (!capture_short_utterance(30000)) { show_ready(); return; }
    } else {
      lantern_display_show(LANTERN_SCREEN_LISTENING, "LISTENING");
    }
    if (s_power_off_requested) return;
    lantern_display_show(LANTERN_SCREEN_UNDERSTANDING, "ONE MOMENT");
    char reply[32] = {0};
    result = lantern_network_run_voice_command("report", s_battery_level,
                                               reply, sizeof(reply));
    if (result == ESP_OK && strcmp(reply, "report_stop") == 0) {
      (void)quipus_play_prompt(QUIPUS_PROMPT_REPORT_DONE);
      show_ready();
      return;
    }
    if (result == ESP_OK && strcmp(reply, "report_clarify") == 0) {
      if (++unclear_turns >= 2) { show_ready(); return; }
    } else if (result == ESP_OK) {
      unclear_turns = 0;
    }
  }
}

// Flush only the stopped capture receipt before a report. Never upload/delete
// audio here: the normal durable queue remains responsible for full delivery.
static esp_err_t reconcile_report_capture_receipt(void) {
#if LANTERN_HAS_SD_CARD
  if (s_state == LOCAL_RECORDING || s_sd_recording_active ||
      lantern_sd_capture_active() || !quipus_phone_audio_idle())
    return ESP_ERR_INVALID_STATE;
  if (!lantern_sd_secure_ready() || !lantern_sd_upload_pending_count()) return ESP_OK;
  lantern_cloud_session_t pending;
  bool stopped = false, audio_uploaded = false, phone_uploaded = false;
  esp_err_t selected = lantern_sd_next_pending(s_config.owner_id, s_config.device_id,
      &pending, &stopped, &audio_uploaded, &phone_uploaded);
  if (selected == ESP_ERR_NOT_FOUND) return ESP_OK;
  if (selected != ESP_OK) return selected;
  if (stopped) return ESP_OK;
  esp_err_t result = pending.offline_local
      ? lantern_network_import_recording(&pending)
      : lantern_network_stop_recording(&pending);
  if (result != ESP_OK) return result;
  return lantern_sd_checkpoint(&pending, true, audio_uploaded, phone_uploaded);
#else
  return ESP_OK;
#endif
}

static void play_status_report(void) {
  // Defensive boundary: no caller can turn an active recording into a report.
  if (s_power_off_requested || s_state == LOCAL_RECORDING || lantern_audio_is_recording() ||
      s_sd_recording_active || lantern_sd_capture_active() || !quipus_phone_audio_idle())
    return;
  lantern_wake_set_enabled(false);
  lantern_network_set_realtime(true);
  s_state = LOCAL_STATUS;
  s_recovery = RECOVERY_NONE;
  s_state_entered_at = xTaskGetTickCount();
  lantern_display_show(LANTERN_SCREEN_STATUS, "STATUS REPORT");
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  if (!network.wifi_connected) {
    // Offline playback is the last complete, owner-bound saved report only.
    // Never open a cloud action dialogue or mutate a pending capture receipt.
    esp_err_t cached = lantern_network_play_cached_report();
    if (cached != ESP_OK && cached != LANTERN_REPORT_INTERRUPTED && !s_power_off_requested)
      (void)quipus_play_prompt(QUIPUS_PROMPT_REPORT_OFFLINE);
    if (!s_power_off_requested) show_ready();
    return;
  }
  esp_err_t receipt = reconcile_report_capture_receipt();
  if (receipt != ESP_OK)
    ESP_LOGW(TAG, "report capture receipt remains pending: %s", esp_err_to_name(receipt));
  report_dialogue(lantern_network_play_briefing("status", s_battery_level));
}

static void command_not_recognised(void) {
  s_state = LOCAL_COMMAND_PROCESSING;
  lantern_display_show(LANTERN_SCREEN_LISTENING, "TRY AGAIN");
  (void)quipus_play_prompt(QUIPUS_PROMPT_COMMAND_UNCLEAR);
  show_ready();
}

static quipus_local_intent_t ask_local_choice(quipus_prompt_t question) {
  if (s_power_off_requested) return QUIPUS_LOCAL_UNKNOWN;
  s_state = LOCAL_COMMAND_LISTENING;
  lantern_display_show(LANTERN_SCREEN_LISTENING, "SAY YES OR NO");
  if (quipus_play_prompt(question) != ESP_OK) return QUIPUS_LOCAL_UNKNOWN;
  if (s_power_off_requested) return QUIPUS_LOCAL_UNKNOWN;
  vTaskDelay(pdMS_TO_TICKS(150));
  // Navigation is not consent. Its bounded early-silence capture supplies at
  // least one second of model context; strict consent always captures all5s.
  bool heard = capture_short_utterance(5000);
  if (s_power_off_requested) {
    lantern_audio_clear_private_buffer();
    return QUIPUS_LOCAL_UNKNOWN;
  }
  quipus_local_result_t answer = {.intent = QUIPUS_LOCAL_UNKNOWN};
  esp_err_t classified = heard
      ? classify_local_yes_no(QUIPUS_LOCAL_PURPOSE_NAVIGATION, &answer) : ESP_FAIL;
  // A menu selection is never recording consent. Its PCM is erased before
  // the separate question and fresh, strict consent capture.
  lantern_audio_clear_private_buffer();
  ESP_LOGI(TAG, "local navigation phase=%s heard=%u result=%d status=%s",
      question == QUIPUS_PROMPT_OFFLINE_RECORD_CHOICE ? "record" : "report",
      (unsigned)heard, answer.intent, esp_err_to_name(classified));
  if (s_power_off_requested) return QUIPUS_LOCAL_UNKNOWN;
  return classified == ESP_OK ? answer.intent : QUIPUS_LOCAL_UNKNOWN;
}

static void capture_offline_wake_menu(void) {
  if (!local_voice_ready()) {
    (void)quipus_play_prompt(QUIPUS_PROMPT_NETWORK_REQUIRED);
    show_ready();
    return;
  }
  quipus_local_intent_t choice = ask_local_choice(QUIPUS_PROMPT_OFFLINE_RECORD_CHOICE);
  if (s_power_off_requested) return;
  if (choice == QUIPUS_LOCAL_YES) {
    start_spoken_consent(true);
    return;
  }
  if (choice == QUIPUS_LOCAL_NO) {
    choice = ask_local_choice(QUIPUS_PROMPT_OFFLINE_REPORT_CHOICE);
    if (s_power_off_requested) return;
    if (choice == QUIPUS_LOCAL_YES) {
      play_status_report();
      return;
    }
    if (choice == QUIPUS_LOCAL_NO) { show_ready(); return; }
  }
  command_not_recognised();
}

static void capture_wake_command(void) {
  if (s_state != LOCAL_READY || s_power_off_requested) return;
  lantern_wake_set_enabled(false);
  lantern_network_set_realtime(true);
  s_state = LOCAL_COMMAND_LISTENING;
  s_recovery = RECOVERY_NONE;
  s_state_entered_at = xTaskGetTickCount();
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  if (!network.paired) { show_ready(); return; }
  if (!network.wifi_connected) {
    capture_offline_wake_menu();
    return;
  }
  lantern_display_show(LANTERN_SCREEN_LISTENING, "LISTENING");
  // Exact start/status phrases keep online STT until a verified local command
  // model exists. Offline navigation truthfully uses the trained YES/NO menu.
  if (quipus_play_prompt(QUIPUS_PROMPT_LISTENING) != ESP_OK) {
    show_ready(); return;
  }
  for (unsigned attempt = 0; attempt < 2 && !s_power_off_requested; ++attempt) {
    if (attempt) {
      lantern_display_show(LANTERN_SCREEN_LISTENING, "LISTENING");
      if (quipus_play_prompt(QUIPUS_PROMPT_COMMAND_RETRY) != ESP_OK) break;
    }
    vTaskDelay(pdMS_TO_TICKS(150)); // Room echo settles after speaker drain.
    bool heard = capture_short_utterance(5000);
    if (s_power_off_requested) return;
    if (!heard || lantern_audio_buffered_samples() < LANTERN_MIC_SAMPLE_RATE / 2) continue;
    s_state = LOCAL_COMMAND_PROCESSING;
    lantern_display_show(LANTERN_SCREEN_UNDERSTANDING, "ONE MOMENT");
    char intent[32] = {0};
    esp_err_t result = lantern_network_run_voice_command(
        "wake_command", s_battery_level, intent, sizeof(intent));
    if (s_power_off_requested) return;
    if (result == LANTERN_REPORT_INTERRUPTED ||
        (result == ESP_OK && !strcmp(intent, "report_answer"))) {
      report_dialogue(result); return;
    }
    if (result == ESP_OK && !strcmp(intent, "report_stop")) { show_ready(); return; }
    if (result == ESP_ERR_NOT_FOUND) continue;
    if (result != ESP_OK) {
      // Wi-Fi association is not proof of Internet reachability. A failed
      // command request still leaves the local recording path available.
      if (local_voice_ready()) capture_offline_wake_menu();
      else show_error(RECOVERY_COMMAND, "COMMAND SERVICE OFFLINE", "command_error");
      return;
    }
    if (!strcmp(intent, "start_recording")) { start_spoken_consent(true); return; }
    if (!strcmp(intent, "status_report")) {
      if (ready_for_cloud_action()) play_status_report();
      return;
    }
    if (!strcmp(intent, "wifi_setup")) { open_wifi_screen(); return; }
  }
  if (!s_power_off_requested) command_not_recognised();
}

static void retry_pending_summary(bool user_requested) {
  (void)user_requested;
#if !LANTERN_HAS_SD_CARD
  {
    // Original boards have no SD queue. Keep their accepted-upload completion
    // retry independent of the newer encrypted local archive implementation.
    if (!s_summary_retry_pending || s_summary_retrying ||
        !s_pending_completion.session_id[0])
      return;
    s_summary_retrying = true;
    bool ready = false;
    esp_err_t result =
        lantern_network_complete_session(&s_pending_completion, &ready);
    s_last_summary_retry_at = xTaskGetTickCount();
    s_summary_retry_delay = pdMS_TO_TICKS(
        quipus_sync_retry_delay_ms(QUIPUS_SYNC_FAILED));
    if (result == ESP_OK) {
      s_summary_retry_pending = false;
      memset(&s_pending_completion, 0, sizeof(s_pending_completion));
    }
    s_summary_retrying = false;
    if (user_requested)
      show_ready();
    return;
  }
#endif
  if (s_summary_retrying || s_state != LOCAL_READY)
    return;
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  if (!network.wifi_connected || !network.paired || !lantern_sd_secure_ready())
    return;
  if (!quipus_phone_audio_idle())
    return;
  // Complete a previously timed-out drain before selecting another manifest.
  if (lantern_sd_capture_active())
    stop_local_capture();
  s_summary_retrying = true;
  s_summary_retry_delay = pdMS_TO_TICKS(
      quipus_sync_retry_delay_ms(QUIPUS_SYNC_FAILED));
  lantern_cloud_session_t pending;
  bool stopped = false, audio_uploaded = false, phone_uploaded = false;
  esp_err_t selected =
      lantern_sd_next_pending(s_config.owner_id, s_config.device_id, &pending,
                              &stopped, &audio_uploaded, &phone_uploaded);
  if (selected != ESP_OK) {
    ESP_LOGW(TAG, "pending archive selection failed: %s pending=%u",
             esp_err_to_name(selected), (unsigned)lantern_sd_pending_count());
    s_last_summary_retry_at = xTaskGetTickCount();
    s_summary_retrying = false;
    return;
  }
  s_state = LOCAL_SAVING;
  lantern_wake_set_enabled(false);
  lantern_display_show(LANTERN_SCREEN_SAVING, "SYNCING SAVED MEETING");
  if (!stopped) {
    esp_err_t closed = pending.offline_local
                           ? lantern_network_import_recording(&pending)
                           : lantern_network_stop_recording(&pending);
    if (closed != ESP_OK)
      goto retained;
    stopped = true;
    if (lantern_sd_checkpoint(&pending, true, audio_uploaded, phone_uploaded) !=
        ESP_OK)
      goto retained;
  }
  if (!audio_uploaded) {
    announce_upload_started(&pending);
    if (lantern_network_upload_audio(&pending) != ESP_OK)
      goto retained;
    audio_uploaded = true;
    if (lantern_sd_checkpoint(&pending, true, true, phone_uploaded) != ESP_OK)
      goto retained;
  }
  if (lantern_sd_phone_size() > 44 && !phone_uploaded) {
    if (lantern_network_upload_phone(&pending) != ESP_OK)
      goto retained;
    phone_uploaded = true;
    if (lantern_sd_checkpoint(&pending, true, true, true) != ESP_OK)
      goto retained;
  }
  bool ready = false;
  if (lantern_network_complete_session(&pending, &ready) == ESP_OK) {
    if (lantern_sd_checkpoint(&pending, true, audio_uploaded, phone_uploaded) !=
        ESP_OK)
      goto retained;
    if (pending.archive_verified) {
      lantern_display_show(LANTERN_SCREEN_COMPLETE,
          pending.discarded ? "SHORT RECORDING SKIPPED" : "UPLOADED TO DASHBOARD");
      announce_upload_verified(&pending);
      if (lantern_sd_recording_matches_session(pending.session_id) &&
          lantern_sd_recording_confirm_uploaded_at(lantern_network_trusted_time()) == ESP_OK)
        s_summary_retry_delay = pdMS_TO_TICKS(
            quipus_sync_retry_delay_ms(QUIPUS_SYNC_NEXT_ARCHIVE));
    } else {
      s_summary_retry_delay = pdMS_TO_TICKS(
          quipus_sync_retry_delay_ms(QUIPUS_SYNC_VERIFICATION_PENDING));
    }
  }
retained:
  s_summary_retry_pending = lantern_sd_upload_pending_count() > 0;
  s_summary_retrying = false;
  show_ready();
  s_last_summary_retry_at = xTaskGetTickCount();
}

static void retry_error(void) {
  lantern_wake_set_enabled(false);
  recovery_action_t action = s_recovery;
  switch (action) {
  case RECOVERY_SESSION_START:
    lantern_display_show(LANTERN_SCREEN_CONNECTING, "RETRYING SESSION");
    start_spoken_consent(true);
    break;
  case RECOVERY_COMMAND:
    show_ready();
    capture_wake_command();
    break;
  case RECOVERY_CONSENT_CAPTURE:
  case RECOVERY_RECORDING_START:
    // The original prompt may have expired during speech/network processing.
    // Start a fresh consent exchange; never keep replaying an old yes.
    if (!lantern_sd_has_private_material() &&
        lantern_network_restart_session() != ESP_OK) {
      show_error(RECOVERY_RECORDING_START, "SESSION RESET FAILED",
                 "session_error");
      break;
    }
    clear_active_session();
    start_spoken_consent(true);
    break;
  case RECOVERY_STOP:
    s_state = LOCAL_SAVING;
    continue_after_stop();
    break;
  case RECOVERY_UPLOAD:
    upload_current_session(false);
    break;
  case RECOVERY_STATUS:
    play_status_report();
    break;
  case RECOVERY_SUMMARY:
    s_state = LOCAL_READY;
    retry_pending_summary(true);
    break;
  case RECOVERY_NONE:
  default:
    show_ready();
    break;
  }
}

static void restore_recovery_error(recovery_action_t recovery,
                                    const char *detail) {
  s_state = LOCAL_ERROR;
  s_recovery = recovery;
  s_state_entered_at = xTaskGetTickCount();
  snprintf(s_last_error_detail, sizeof(s_last_error_detail), "%s", detail);
  lantern_display_show(LANTERN_SCREEN_READY, "READY - SAY COMPUTER");
  sync_idle_wake_listener();
}

static void capture_recovery_command(void) {
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  if (s_state != LOCAL_ERROR || s_power_off_requested || !network.paired) return;
  if (!network.wifi_connected) {
    // Name the real blocker: an SD fault needs the card, not Wi-Fi.
    (void)quipus_play_prompt(strstr(s_last_error_detail, "SD ")
        ? QUIPUS_PROMPT_SD_FAILURE : QUIPUS_PROMPT_NETWORK_REQUIRED);
    sync_idle_wake_listener();
    return;
  }
  if (!LANTERN_HAS_SD_CARD && !s_audio_uploaded &&
      (s_recovery == RECOVERY_UPLOAD || s_recovery == RECOVERY_STOP)) return;
  recovery_action_t recovery = s_recovery;
  char detail[sizeof(s_last_error_detail)];
  snprintf(detail, sizeof(detail), "%s", s_last_error_detail);
  lantern_wake_set_enabled(false);
  s_last_interaction_at = xTaskGetTickCount();
  s_state = LOCAL_COMMAND_LISTENING;
  lantern_display_show(LANTERN_SCREEN_LISTENING, "SAY RETRY, STATUS OR CANCEL");
  if (quipus_play_prompt(QUIPUS_PROMPT_RECOVERY_LISTENING) != ESP_OK) {
    restore_recovery_error(recovery, detail); return;
  }
  vTaskDelay(pdMS_TO_TICKS(150));
  bool heard = capture_short_utterance(5000);
  if (s_power_off_requested) return;
  if (!heard || lantern_audio_buffered_samples() < LANTERN_MIC_SAMPLE_RATE / 2) {
    restore_recovery_error(recovery, detail);
    return;
  }
  s_state = LOCAL_COMMAND_PROCESSING;
  lantern_display_show(LANTERN_SCREEN_UNDERSTANDING, "CHECKING RECOVERY COMMAND");
  char intent[32] = {0};
  esp_err_t result = lantern_network_run_voice_command(
      "recovery", s_battery_level, intent, sizeof(intent));
  if (s_power_off_requested) return;
  // Unexpected commands cannot approve consent, start capture or clear SD.
  restore_recovery_error(recovery, detail);
  if (result != ESP_OK) return;
  if (strcmp(intent, "retry_recovery") == 0) retry_error();
  else if (strcmp(intent, "cancel_recovery") == 0) cancel_error();
  else if (strcmp(intent, "status_report") == 0) play_status_report();
  else if (strcmp(intent, "wifi_setup") == 0) open_wifi_screen();
}

static bool ready_for_cloud_action(void) {
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  if (!network.wifi_connected || !network.paired) {
    (void)quipus_play_prompt(QUIPUS_PROMPT_NETWORK_REQUIRED);
    show_ready();
    return false;
  }
  return true;
}

#if LANTERN_HAS_TOUCHSCREEN
static void show_main_menu(void) {
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  if (!network.paired) {
    show_ready();
    return;
  }
  s_ui_view = UI_HOME;
  s_display_asleep = false;
  s_last_interaction_at = xTaskGetTickCount();
  lantern_display_show_home(s_summary_retry_pending ? "SUMMARY WAITING TO SYNC"
                                                    : "");
  lantern_network_set_realtime(false);
  sync_idle_wake_listener();
}

static void render_wifi_list(void) {
  const char *rows[LANTERN_WIFI_SCAN_LIMIT];
  static char labels[LANTERN_WIFI_SCAN_LIMIT][LANTERN_DISPLAY_MENU_TEXT];
  for (size_t index = 0; index < s_wifi_network_count; ++index) {
    snprintf(labels[index], sizeof(labels[index]), "%.25s %s%d",
             s_wifi_networks[index].ssid,
             s_wifi_networks[index].remembered ? "SAVED " : "",
             s_wifi_networks[index].rssi);
    rows[index] = labels[index];
  }
  s_ui_view = UI_WIFI_LIST;
  lantern_display_show_menu("WIFI NETWORKS", rows, s_wifi_network_count,
                            s_wifi_network_count
                                ? "TAP NETWORK - BOTTOM TO CLOSE"
                                : "NO NETWORKS - BOTTOM TO CLOSE");
}

static void open_wifi_screen(void) {
  lantern_wake_set_enabled(false);
  s_ui_view = UI_WIFI_LIST;
  lantern_network_set_realtime(true);
  lantern_display_show(LANTERN_SCREEN_CONNECTING, "SCANNING WIFI");
  s_wifi_network_count = 0;
  esp_err_t result = lantern_network_scan_wifi(
      s_wifi_networks, LANTERN_WIFI_SCAN_LIMIT, &s_wifi_network_count);
  if (result != ESP_OK || !s_wifi_network_count) {
    if (lantern_network_open_setup_portal() == ESP_OK) {
      lantern_network_status_t network;
      lantern_network_get_status(&network);
      s_ui_view = UI_WIFI_LIST;
      char detail[96];
      snprintf(detail, sizeof(detail), "JOIN %.32s THEN OPEN 192.168.4.1",
               network.setup_ssid);
      lantern_display_show_detail("WIFI FALLBACK", detail,
                                  "TAP BOTTOM TO CLOSE");
    } else {
      lantern_display_show_detail("WIFI SETUP", "SCAN FAILED. TRY AGAIN.",
                                  "TAP BOTTOM TO CLOSE");
    }
    return;
  }
  render_wifi_list();
}

static void open_report_screen(void) {
  lantern_wake_set_enabled(false);
  s_ui_view = UI_REPORT_LIST;
  lantern_display_show(LANTERN_SCREEN_STATUS, "LOADING SAVED MEETINGS");
  s_report_item_count = 0;
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  bool cloud_loaded =
      network.wifi_connected && network.paired &&
      lantern_network_get_reports(s_report_items, LANTERN_REPORT_LIST_LIMIT,
                                  &s_report_item_count) == ESP_OK;
  if (!cloud_loaded) {
    ESP_LOGW(TAG,
             "cloud meeting list unavailable; showing local SD state only");
  }
  if (lantern_sd_recording_ready() &&
      s_report_item_count < LANTERN_REPORT_LIST_LIMIT) {
    lantern_report_item_t *local = &s_report_items[s_report_item_count++];
    memset(local, 0, sizeof(*local));
    snprintf(local->title, sizeof(local->title), "LOCAL RECORDING");
    snprintf(local->time, sizeof(local->time), "SD CARD");
    snprintf(local->status, sizeof(local->status), "UPLOAD PENDING");
    snprintf(local->summary, sizeof(local->summary),
             "The complete WAV is safe on microSD and will upload when Quipus "
             "reconnects.");
    snprintf(local->action, sizeof(local->action), "Keep Quipus powered on.");
  }
  if (!s_report_item_count && !cloud_loaded) {
    lantern_display_show_detail(
        "STATUS REPORT",
        "CLOUD IS OFFLINE. NO UNSYNCED SD RECORDING WAS FOUND.",
        "TAP BOTTOM TO CLOSE");
    s_ui_view = UI_REPORT_DETAIL;
    return;
  }
  const char *rows[LANTERN_REPORT_LIST_LIMIT];
  static char labels[LANTERN_REPORT_LIST_LIMIT][LANTERN_DISPLAY_MENU_TEXT];
  for (size_t index = 0; index < s_report_item_count; ++index) {
    snprintf(labels[index], sizeof(labels[index]), "%.10s %.27s",
             s_report_items[index].time, s_report_items[index].title);
    rows[index] = labels[index];
  }
  s_ui_view = UI_REPORT_LIST;
  lantern_display_show_menu("TODAYS MEETINGS", rows, s_report_item_count,
                            s_report_item_count
                                ? "TAP MEETING - BOTTOM TO CLOSE"
                                : "NO PROCESSED MEETINGS TODAY");
}

static const char *remembered_password(const char *ssid) {
  for (size_t index = 0; index < s_config.wifi_profile_count; ++index) {
    if (strcmp(ssid, s_config.wifi_profiles[index].ssid) == 0) {
      return s_config.wifi_profiles[index].password;
    }
  }
  return NULL;
}

static void connect_selected_wifi(void) {
  if (s_wifi_selected >= s_wifi_network_count)
    return;
  lantern_display_show(LANTERN_SCREEN_CONNECTING, "JOINING WIFI");
  esp_err_t result = lantern_network_connect_wifi(
      s_wifi_networks[s_wifi_selected].ssid, s_wifi_password);
  if (result == ESP_OK) {
    lantern_display_show_detail("WIFI CONNECTED",
                                s_wifi_networks[s_wifi_selected].ssid,
                                "RETURNING HOME");
    vTaskDelay(pdMS_TO_TICKS(900));
    show_ready();
  } else {
    lantern_display_show_detail(
        "WIFI FAILED", "CHECK THE PASSWORD OR MOVE CLOSER AND TRY AGAIN.",
        "TAP BOTTOM TO RESCAN");
    s_ui_view = UI_WIFI_LIST;
  }
}

static void handle_touch_release(uint16_t x, uint16_t y) {
  if (s_state != LOCAL_READY) {
    handle_short_press();
    return;
  }
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  if (!network.paired || s_ui_view == UI_SETUP) {
    // Pairing completes through the local portal. Until then, refresh its
    // current instructions instead of opening an unauthenticated session.
    show_ready();
    return;
  }
  if (s_ui_view == UI_SPLASH) {
    show_main_menu();
    return;
  }
  if (s_ui_view == UI_HOME) {
    if (y >= 76 && y < 116) {
      if (LANTERN_HAS_SD_CARD || ready_for_cloud_action())
        start_spoken_consent(true);
    } else if (y >= 122 && y < 162) {
      open_report_screen();
    } else if (y >= 168 && y < 208) {
      open_wifi_screen();
    } else if (y >= 270) {
      show_ready();
    }
    return;
  }
  if (s_ui_view == UI_WIFI_LIST) {
    if (y >= 270) {
      show_main_menu();
      return;
    }
    if (y < 68)
      return;
    size_t index = (size_t)((y - 68) / 38);
    if (index >= s_wifi_network_count) {
      open_wifi_screen();
      return;
    }
    s_wifi_selected = index;
    memset(s_wifi_password, 0, sizeof(s_wifi_password));
    const char *saved = remembered_password(s_wifi_networks[index].ssid);
    if (saved) {
      snprintf(s_wifi_password, sizeof(s_wifi_password), "%s", saved);
      connect_selected_wifi();
    } else if (!s_wifi_networks[index].secured) {
      connect_selected_wifi();
    } else {
      s_ui_view = UI_WIFI_PASSWORD;
      s_keyboard_uppercase = true;
      lantern_display_show_keyboard(s_wifi_networks[index].ssid,
                                    s_wifi_password, s_keyboard_uppercase);
    }
    return;
  }
  if (s_ui_view == UI_WIFI_PASSWORD) {
    if (y >= 91 && y < 247) {
      static const char *rows[] = {"1234567890", "QWERTYUIOP", "ASDFGHJKL-",
                                   "ZXCVBNM._@"};
      int row = (y - 91) / 39;
      int column = x / 24;
      if (row >= 0 && row < 4 && column >= 0 && column < 10) {
        size_t length = strlen(s_wifi_password);
        if (length < sizeof(s_wifi_password) - 1) {
          char value = rows[row][column];
          if (!s_keyboard_uppercase)
            value = (char)tolower((unsigned char)value);
          s_wifi_password[length] = value;
          s_wifi_password[length + 1] = '\0';
          lantern_display_show_keyboard(s_wifi_networks[s_wifi_selected].ssid,
                                        s_wifi_password, s_keyboard_uppercase);
        }
      }
    } else if (y >= 252 && y < 298) {
      if (x < 78) {
        size_t length = strlen(s_wifi_password);
        if (length)
          s_wifi_password[length - 1] = '\0';
        else {
          render_wifi_list();
          return;
        }
      } else if (x < 162) {
        s_keyboard_uppercase = !s_keyboard_uppercase;
      } else {
        connect_selected_wifi();
        return;
      }
      lantern_display_show_keyboard(s_wifi_networks[s_wifi_selected].ssid,
                                    s_wifi_password, s_keyboard_uppercase);
    }
    return;
  }
  if (s_ui_view == UI_REPORT_LIST) {
    if (y >= 270) {
      show_main_menu();
      return;
    }
    if (y < 68)
      return;
    size_t index = (size_t)((y - 68) / 38);
    if (index >= s_report_item_count)
      return;
    char detail[96];
    snprintf(detail, sizeof(detail), "%.58s ACTION: %.26s",
             s_report_items[index].summary, s_report_items[index].action);
    s_ui_view = UI_REPORT_DETAIL;
    lantern_display_show_detail(s_report_items[index].title, detail,
                                "TAP BOTTOM TO GO BACK");
    return;
  }
  if (s_ui_view == UI_REPORT_DETAIL) {
    if (y >= 270) {
      if (s_report_item_count)
        open_report_screen();
      else
        show_main_menu();
    }
  }
}
#else
static void open_wifi_screen(void) {
  lantern_wake_set_enabled(false);
  if (lantern_network_open_setup_portal() == ESP_OK) {
    s_wifi_screen_open = true;
    lantern_network_status_t network;
    lantern_network_get_status(&network);
    lantern_display_show(LANTERN_SCREEN_SETUP, network.setup_ssid);
  } else {
    show_error(RECOVERY_NONE, "WIFI SETUP FAILED", "command_error");
  }
}
#endif

static void handle_short_press(void) {
  if (!s_boot_complete || s_power_off_requested) return;
  if (s_wifi_screen_open) {
    s_wifi_screen_open = false;
    show_ready();
    return;
  }
  switch (s_state) {
  case LOCAL_READY:
    if (!LANTERN_HAS_SD_CARD && !ready_for_cloud_action())
      break;
    start_spoken_consent(true);
    break;
  case LOCAL_RECORDING:
    finalise_recording();
    break;
  case LOCAL_COMPLETE:
  case LOCAL_STATUS:
    show_ready();
    break;
  case LOCAL_ERROR:
    retry_error();
    break;
  case LOCAL_AWAITING_CONSENT:
    // Only capture_spoken_consent can approve. Presses never imply consent.
    break;
  case LOCAL_COMMAND_LISTENING:
  case LOCAL_COMMAND_PROCESSING:
  case LOCAL_SAVING:
    break;
  }
}

static void cancel_error(void) {
  lantern_display_show(LANTERN_SCREEN_CONNECTING, "CANCELLING SESSION");
  stop_local_capture();
  lantern_network_status_t network;
  lantern_network_get_status(&network);
  // A saved WAV owns its existing cloud session until verified. Cancelling an
  // error screen must not invalidate that session or erase retry identities.
  if (network.wifi_connected && network.paired &&
      !lantern_sd_has_private_material() && !s_summary_retry_pending) {
    if (lantern_network_restart_session() != ESP_OK) {
      ESP_LOGW(TAG, "server reset failed while cancelling; local controls are "
                    "returning to ready");
    }
  }
  clear_active_session();
  s_summary_retry_pending =
      s_summary_retry_pending || lantern_sd_upload_pending_count() > 0;
  if (!s_summary_retry_pending)
    memset(&s_pending_completion, 0, sizeof(s_pending_completion));
  show_ready();
}

static void handle_long_press(void) {
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  return; // A 2 s middle hold is handled independently by the power monitor.
#endif
  switch (s_state) {
  case LOCAL_READY:
    if (ready_for_cloud_action())
      play_status_report();
    break;
  case LOCAL_RECORDING:
    finalise_recording();
    break;
  case LOCAL_ERROR:
    cancel_error();
    break;
  case LOCAL_COMPLETE:
  case LOCAL_STATUS:
    show_ready();
    break;
  case LOCAL_AWAITING_CONSENT:
    break;
  case LOCAL_COMMAND_LISTENING:
  case LOCAL_COMMAND_PROCESSING:
  case LOCAL_SAVING:
    break;
  }
}

static void button_task(void *argument) {
  (void)argument;
#if LANTERN_HAS_PHYSICAL_BUTTONS
#if LANTERN_HAS_POWER_BUTTON
  ESP_ERROR_CHECK(rtc_gpio_deinit(LANTERN_POWER_BUTTON_GPIO));
#endif
  uint64_t button_mask = 0;
  const gpio_num_t button_pins[] = {LANTERN_BUTTON_MAIN_GPIO,
                                   LANTERN_BUTTON_UP_GPIO,
                                   LANTERN_BUTTON_DOWN_GPIO,
#if LANTERN_HAS_POWER_BUTTON
                                   LANTERN_POWER_BUTTON_GPIO,
#endif
  };
  for (size_t index = 0; index < sizeof(button_pins) / sizeof(button_pins[0]); ++index)
    if (button_pins[index] != GPIO_NUM_NC)
      button_mask |= 1ULL << button_pins[index];
  gpio_config_t buttons = {
      .pin_bit_mask = button_mask,
      .mode = GPIO_MODE_INPUT,
      .pull_up_en = GPIO_PULLUP_ENABLE,
  };
  ESP_ERROR_CHECK(gpio_config(&buttons));
#elif LANTERN_HAS_TOUCHSCREEN
  ESP_ERROR_CHECK(lantern_board_touch_init());
#endif
  s_controls_ready = true;
  // Opening the CH340 serial port briefly drives BOOT. Ignore that transition.
  vTaskDelay(pdMS_TO_TICKS(800));
  bool was_pressed = false;
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  bool primary_armed = gpio_get_level(LANTERN_BUTTON_MAIN_GPIO) != 0;
#endif
  bool reset_started = false;
  bool reset_consumed = false;
#if LANTERN_HAS_TOUCHSCREEN
  bool touch_reset_announced = false;
  bool touch_wake_only = false;
  uint16_t touch_down_x = 0, touch_down_y = 0;
#endif
  TickType_t pressed_at = 0;
  TickType_t reset_at = 0;
#if LANTERN_HAS_POWER_BUTTON && !CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  bool power_was_pressed = false;
  TickType_t power_pressed_at = 0;
#endif
  while (true) {
    // One owner for session/SD selection and account changes. Audio writers use
    // their own bounded queues and never wait for this control-plane mutex.
    if (xSemaphoreTake(s_control_mutex, 0) != pdTRUE) {
      vTaskDelay(pdMS_TO_TICKS(20));
      continue;
    }
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
    if (s_power_off_requested) power_off_safely();
#endif
    if ((s_state == LOCAL_READY || s_state == LOCAL_ERROR) &&
        lantern_wake_take_detection()) {
      ESP_LOGI(TAG, "WakeNet activation accepted; opening command window");
      s_display_asleep = false;
      s_last_interaction_at = xTaskGetTickCount();
      lantern_display_set_awake(true);
      if (s_state == LOCAL_ERROR) capture_recovery_command();
      else capture_wake_command();
    }
    bool pressed = false;
    bool up_pressed = false;
    bool down_pressed = false;
#if LANTERN_HAS_PHYSICAL_BUTTONS
    pressed = gpio_get_level(LANTERN_BUTTON_MAIN_GPIO) == 0;
    if (LANTERN_BUTTON_UP_GPIO != GPIO_NUM_NC)
      up_pressed = gpio_get_level(LANTERN_BUTTON_UP_GPIO) == 0;
    if (LANTERN_BUTTON_DOWN_GPIO != GPIO_NUM_NC)
      down_pressed = gpio_get_level(LANTERN_BUTTON_DOWN_GPIO) == 0;
#elif LANTERN_HAS_TOUCHSCREEN
    uint16_t touch_x = 0, touch_y = 0;
    pressed = lantern_board_touch_read(&touch_x, &touch_y);
#endif
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
    if (!primary_armed) {
      if (!pressed) primary_armed = true;
      pressed = false;
    }
#endif
    if (LANTERN_RESET_USES_MAIN_AND_UP && up_pressed && pressed)
      reset_consumed = true;
    if (pressed && !was_pressed) {
      pressed_at = xTaskGetTickCount();
      s_last_interaction_at = pressed_at;
#if LANTERN_HAS_TOUCHSCREEN
      touch_down_x = touch_x;
      touch_down_y = touch_y;
      touch_wake_only = s_display_asleep;
      if (s_display_asleep) {
        s_display_asleep = false;
        lantern_display_set_awake(true);
      }
      s_last_interaction_at = pressed_at;
#endif
    }
#if LANTERN_HAS_TOUCHSCREEN
    if (pressed && was_pressed && !touch_wake_only) {
      uint32_t held_ms =
          (uint32_t)((xTaskGetTickCount() - pressed_at) * portTICK_PERIOD_MS);
      if (held_ms >= 8000) {
        lantern_display_show(LANTERN_SCREEN_SETUP, "RESETTING QUIPUS");
        if (lantern_sd_has_private_material()) {
          lantern_display_show(LANTERN_SCREEN_ERROR,
                               "SYNC RECORDINGS BEFORE RESET");
          xSemaphoreGive(s_control_mutex);
          vTaskDelay(pdMS_TO_TICKS(500));
          continue;
        }
        esp_err_t reset_result = lantern_storage_clear();
        if (reset_result != ESP_OK) {
          ESP_LOGE(TAG, "settings reset failed: %s", esp_err_to_name(reset_result));
          show_error(RECOVERY_NONE, "RESET FAILED - TRY AGAIN", NULL);
          xSemaphoreGive(s_control_mutex);
          vTaskDelay(pdMS_TO_TICKS(500));
          continue;
        }
        vTaskDelay(pdMS_TO_TICKS(500));
        esp_restart();
      } else if (held_ms >= 5000 && !touch_reset_announced) {
        touch_reset_announced = true;
        lantern_display_show(LANTERN_SCREEN_SETUP, "KEEP HOLDING TO RESET");
      }
    }
#endif
    if (!pressed && was_pressed && !reset_consumed) {
      uint32_t held_ms =
          (uint32_t)((xTaskGetTickCount() - pressed_at) * portTICK_PERIOD_MS);
#if LANTERN_HAS_TOUCHSCREEN
      if (!touch_wake_only && held_ms >= 1200)
        handle_long_press();
      else if (held_ms >= 40) {
        // A sleeping display consumes the first tap only to wake it.
        if (!touch_wake_only)
          handle_touch_release(touch_down_x, touch_down_y);
        touch_wake_only = false;
      }
#else
      if (held_ms >= 1200)
        handle_long_press();
      else if (held_ms >= 40)
        handle_short_press();
#endif
#if LANTERN_HAS_TOUCHSCREEN
      touch_reset_announced = false;
#endif
    }

    if (up_pressed && (LANTERN_RESET_USES_MAIN_AND_UP ? pressed : down_pressed)) {
      if (!reset_started) {
        reset_started = true;
        reset_at = xTaskGetTickCount();
      } else if (!reset_consumed && (xTaskGetTickCount() - reset_at) * portTICK_PERIOD_MS >=
                 3000) {
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
        // A discoverable, non-destructive recovery path. Pairing and SD keys
        // survive: holding volume buttons can never factory-reset this board.
        reset_consumed = true;
        if (s_state == LOCAL_READY || s_state == LOCAL_ERROR) {
          s_state = LOCAL_READY;
          open_wifi_screen();
        }
#else
        lantern_display_show(LANTERN_SCREEN_SETUP, "CLEARING SETTINGS");
        if (lantern_sd_has_private_material()) {
          lantern_display_show(LANTERN_SCREEN_ERROR,
                               "SYNC RECORDINGS BEFORE RESET");
          xSemaphoreGive(s_control_mutex);
          vTaskDelay(pdMS_TO_TICKS(500));
          continue;
        }
        esp_err_t reset_result = lantern_storage_clear();
        if (reset_result != ESP_OK) {
          ESP_LOGE(TAG, "settings reset failed: %s", esp_err_to_name(reset_result));
          show_error(RECOVERY_NONE, "RESET FAILED - TRY AGAIN", NULL);
          xSemaphoreGive(s_control_mutex);
          vTaskDelay(pdMS_TO_TICKS(500));
          continue;
        }
        vTaskDelay(pdMS_TO_TICKS(500));
        esp_restart();
#endif
      }
    } else {
      reset_started = false;
    }
    if (!pressed && !up_pressed && !down_pressed)
      reset_consumed = false;

#if LANTERN_HAS_POWER_BUTTON && !CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
    bool power_pressed = gpio_get_level(LANTERN_POWER_BUTTON_GPIO) == 0;
    if (power_pressed && !power_was_pressed)
      power_pressed_at = xTaskGetTickCount();
    if (power_pressed && power_was_pressed && s_state == LOCAL_READY &&
        !pressed && !up_pressed &&
        (xTaskGetTickCount() - power_pressed_at) >= pdMS_TO_TICKS(2000) &&
        quipus_phone_audio_idle() && lantern_sd_can_power_down()) {
      lantern_wake_set_enabled(false);
      lantern_audio_chime(1);
      lantern_display_show(LANTERN_SCREEN_SETUP, "POWERING OFF");
      vTaskDelay(pdMS_TO_TICKS(200));
      lantern_display_set_awake(false);
      lantern_board_speaker_enable(false);
      // Battery power ends here. USB keeps the MCU powered, so also enter
      // deep sleep after release; PWR is an RTC-capable wake input.
      ESP_ERROR_CHECK(esp_sleep_enable_ext0_wakeup(LANTERN_POWER_BUTTON_GPIO, 0));
      ESP_ERROR_CHECK(rtc_gpio_pullup_en(LANTERN_POWER_BUTTON_GPIO));
      ESP_ERROR_CHECK(rtc_gpio_pulldown_dis(LANTERN_POWER_BUTTON_GPIO));
      gpio_set_level(LANTERN_POWER_HOLD_GPIO, 0);
      while (gpio_get_level(LANTERN_POWER_BUTTON_GPIO) == 0)
        vTaskDelay(pdMS_TO_TICKS(20));
      esp_deep_sleep_start();
    }
    power_was_pressed = power_pressed;
#endif

    if (s_state == LOCAL_RECORDING) {
      esp_err_t storage_error = lantern_sd_recording_error();
      if (s_sd_recording_active && storage_error != ESP_OK) {
        ESP_LOGE(TAG, "SD capture failed; stopping recording: %s",
                 esp_err_to_name(storage_error));
        // Make failure visible before bounded SD/transport cleanup can wait.
        lantern_display_show(LANTERN_SCREEN_ERROR, "SD ERROR - STOPPING");
        show_error(RECOVERY_NONE, "SD ERROR - RECORDING STOPPED", NULL);
        // The manifest retains the failed recording for recovery. A new session
        // must get a fresh BEGIN event rather than replaying its old consent.
        clear_active_session();
        s_summary_retry_pending |= lantern_sd_upload_pending_count() > 0;
      } else {
        show_recording_progress();
      }
    }
    if ((s_state == LOCAL_COMPLETE || s_state == LOCAL_STATUS) &&
        elapsed_state_seconds() >= 3) {
      show_ready();
    }
    was_pressed = pressed;
    xSemaphoreGive(s_control_mutex);
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

static void input_monitor_task(void *argument) {
  (void)argument;
  unsigned pressed_samples = 0;
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  quipus_volume_button_t volume_down = {0}, volume_up = {0};
  quipus_power_hold_t power_hold = {.pressed = true, .suppressed = true};
  // button_task ignores the first 800 ms after GPIO setup. Do the same here
  // so a held power-on/boot button cannot become a volume change.
  while (!s_controls_ready) vTaskDelay(pdMS_TO_TICKS(30));
  vTaskDelay(pdMS_TO_TICKS(800));
  volume_down.tap.suppressed = volume_up.tap.suppressed = true;
  volume_down.tap.pressed = gpio_get_level(LANTERN_BUTTON_DOWN_GPIO) == 0;
  volume_up.tap.pressed = gpio_get_level(LANTERN_BUTTON_UP_GPIO) == 0;
#endif
  while (true) {
    s_input_polled_at = xTaskGetTickCount();
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
    // This task remains responsive while a cloud report owns s_control_mutex.
    // Outer buttons always control volume; the middle is session/power only.
    uint32_t now_ms = (uint32_t)(esp_timer_get_time() / 1000);
    bool main = gpio_get_level(LANTERN_BUTTON_MAIN_GPIO) == 0;
    bool down = gpio_get_level(LANTERN_BUTTON_DOWN_GPIO) == 0;
    bool boot = gpio_get_level(LANTERN_BUTTON_UP_GPIO) == 0;
    if (quipus_power_hold_update(&power_hold, main, down || boot, now_ms)) {
      s_power_off_requested = true;
      lantern_audio_pcm_cancel();
      lantern_network_interrupt_report();
      ESP_LOGI(TAG, "middle hold requested safe shutdown");
    }
    bool quieter = quipus_volume_button_update(&volume_down, down,
                                               main || boot, now_ms);
    bool louder = quipus_volume_button_update(&volume_up, boot,
                                              main || down, now_ms);
    if (quieter || louder) {
      unsigned volume = lantern_audio_adjust_volume(
          quieter ? -QUIPUS_VOLUME_STEP : QUIPUS_VOLUME_STEP);
      lantern_display_set_volume(volume);
      s_last_interaction_at = xTaskGetTickCount();
      ESP_LOGI(TAG, "speaker volume %u%%", volume);
    }
#endif
    if (lantern_network_report_playing() && lantern_audio_take_speech_interrupt()) {
      lantern_network_interrupt_report();
      s_last_interaction_at = xTaskGetTickCount();
      ESP_LOGI(TAG, "near-end speech interrupted report");
    }
    if (s_controls_ready && lantern_network_report_playing() &&
        lantern_audio_is_speaker_active()) {
      bool pressed = false;
#if LANTERN_HAS_PHYSICAL_BUTTONS
      pressed = gpio_get_level(LANTERN_BUTTON_MAIN_GPIO) == 0;
#elif LANTERN_HAS_TOUCHSCREEN
      uint16_t x = 0, y = 0;
      pressed = lantern_board_touch_read(&x, &y);
#endif
      pressed_samples = pressed ? pressed_samples + 1 : 0;
      if (pressed_samples >= 2) {
        lantern_network_interrupt_report();
        pressed_samples = 0;
      }
    } else
      pressed_samples = 0;
    vTaskDelay(pdMS_TO_TICKS(30));
  }
}

static int update_charging_eta(lantern_power_state_t power_state) {
  TickType_t now = xTaskGetTickCount();
  if (power_state != LANTERN_POWER_CHARGING || s_battery_level < 0) {
    s_previous_power_state = power_state;
    s_charge_anchor_level = -1;
    s_charge_minutes_per_percent_tenths = 0;
    return -1;
  }
  if (s_battery_level >= 99)
    return 0;
  if (s_previous_power_state != LANTERN_POWER_CHARGING ||
      s_charge_anchor_level < 0 || s_battery_level < s_charge_anchor_level) {
    s_charge_anchor_level = s_battery_level;
    s_charge_anchor_time = now;
#if LANTERN_BATTERY_CAPACITY_MAH > 0 && LANTERN_CHARGE_CURRENT_MA > 0
    // Nominal estimate includes 20% conversion/taper overhead. It is replaced
    // by the board's observed charging rate after a stable percentage rise.
    s_charge_minutes_per_percent_tenths = (LANTERN_BATTERY_CAPACITY_MAH * 720) /
                                          (LANTERN_CHARGE_CURRENT_MA * 100);
#endif
  } else if (s_battery_level > s_charge_anchor_level) {
    unsigned elapsed_minutes =
        (unsigned)((now - s_charge_anchor_time) * portTICK_PERIOD_MS / 60000);
    int delta = s_battery_level - s_charge_anchor_level;
    if (elapsed_minutes >= 2 && delta > 0) {
      int observed_tenths = (int)(elapsed_minutes * 10 / (unsigned)delta);
      // Reject obvious ADC/load transients while keeping a bounded EMA.
      if (observed_tenths >= 10 && observed_tenths <= 300) {
        s_charge_minutes_per_percent_tenths =
            s_charge_minutes_per_percent_tenths
                ? (s_charge_minutes_per_percent_tenths * 3 + observed_tenths) /
                      4
                : observed_tenths;
      }
      s_charge_anchor_level = s_battery_level;
      s_charge_anchor_time = now;
    }
  }
  s_previous_power_state = power_state;
  if (!s_charge_minutes_per_percent_tenths)
    return -1;
  return ((100 - s_battery_level) * s_charge_minutes_per_percent_tenths + 9) /
         10;
}

static void telemetry_task(void *argument) {
  (void)argument;
  unsigned seconds = 0;
  char previous_pin[7] = {0};
  while (true) {
    char pin[7];
    lantern_bluetooth_passkey(pin);
    if (strcmp(previous_pin, pin)) {
      memcpy(previous_pin, pin, sizeof(pin));
      s_network_update_pending = true;
    }
    if (s_network_update_pending &&
        xSemaphoreTake(s_control_mutex, 0) == pdTRUE) {
      s_network_update_pending = false;
      lantern_network_status_t network;
      lantern_network_get_status(&network);
      if (!network.paired)
        s_pair_announcement_shown = false;
      if (s_state == LOCAL_RECORDING && !network.wifi_connected &&
          s_sd_recording_active && !s_recording_connection_notice) {
        s_recording_connection_notice = true;
        // The persistent status bar changes immediately. Spoken saved/retry
        // guidance follows Stop, avoiding Quipus speaking over client audio.
      }
      if (s_state == LOCAL_READY) {
#if LANTERN_HAS_TOUCHSCREEN
        bool announced = false;
#endif
        if (network.wifi_connected && network.paired &&
            !s_pair_announcement_shown) {
          s_pair_announcement_shown = true;
#if LANTERN_HAS_TOUCHSCREEN
          announced = true;
#endif
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
          // READY must not hide a blocking cloud greeting. A local chime is
          // enough; the next tap or wake can immediately open a consent flow.
          lantern_audio_chime(1);
#else
          s_state = LOCAL_COMMAND_PROCESSING;
          lantern_wake_set_enabled(false);
          lantern_display_show(LANTERN_SCREEN_READY, "QUIPUS READY");
          if (lantern_network_play_briefing("boot", s_battery_level) != ESP_OK) {
            lantern_audio_chime(2);
            vTaskDelay(pdMS_TO_TICKS(700));
          }
#endif
        }
#if LANTERN_HAS_TOUCHSCREEN
        // A connectivity event only changes the persistent status bar. Do not
        // wake and redraw an idle touch display on every reconnect attempt.
        if (announced || !network.paired)
          show_ready();
#else
        show_ready();
#endif
      }
      sync_idle_wake_listener();
      xSemaphoreGive(s_control_mutex);
    }

    update_battery_level();
    lantern_power_state_t power_state = battery_power_state();
    lantern_display_set_charge_eta(update_charging_eta(power_state));
    lantern_network_status_t display_network;
    lantern_network_get_status(&display_network);
    lantern_display_set_status(
        s_battery_level, power_state, display_network.connectivity,
        display_network.wifi_rssi, display_network.paired);
    if (++seconds % 5 == 0) {
      ESP_LOGI(TAG,
               "health battery=%d%% charging=%d mic_level=%u heap=%u psram=%u "
               "internal_free=%u state=%d wake=%d wake_available=%d",
               s_battery_level, power_state == LANTERN_POWER_CHARGING,
               (unsigned)lantern_audio_level(),
               (unsigned)esp_get_free_heap_size(),
               (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM),
               (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT), s_state,
               lantern_wake_is_enabled(), s_wake_available);
      lantern_wake_diagnostics_t wake_health;
      lantern_wake_get_diagnostics(&wake_health);
      ESP_LOGI(TAG, "wake health frames=%u detections=%u consumed=%u",
          (unsigned)wake_health.frames, (unsigned)wake_health.activations,
          (unsigned)wake_health.consumed);
      static size_t protected_count;
      if (seconds % 60 == 5) protected_count = lantern_sd_pending_count();
      ESP_LOGI(TAG,
               "archive health protected=%u queued=%u ready=%d secure=%d sd_error=%s recovery=%d",
               (unsigned)protected_count,
               (unsigned)lantern_sd_upload_pending_count(), lantern_sd_recording_ready(),
               lantern_sd_secure_ready(), esp_err_to_name(lantern_sd_recording_error()),
               s_recovery);
      ESP_LOGI(TAG, "speaker health volume=%u active=%u controls_ready=%u input_age_ms=%lu input_stack=%u pcm_stack=%u reset_reason=%d",
          lantern_audio_volume(), lantern_audio_is_speaker_active(), s_controls_ready,
          (unsigned long)((xTaskGetTickCount() - s_input_polled_at) * portTICK_PERIOD_MS),
          s_input_task ? (unsigned)uxTaskGetStackHighWaterMark(s_input_task) : 0U,
          lantern_audio_output_stack_free(), (int)esp_reset_reason());
      ESP_LOGI(TAG,
               "stack minimum free buttons=%u health=%u bytes internal_max=%u",
               (unsigned)uxTaskGetStackHighWaterMark(s_button_task),
               (unsigned)uxTaskGetStackHighWaterMark(NULL),
               (unsigned)heap_caps_get_largest_free_block(
                   MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
    }
    if (seconds % 15 == 0 && s_state == LOCAL_READY &&
        xSemaphoreTake(s_control_mutex, 0) == pdTRUE) {
      if (s_state == LOCAL_READY)
        lantern_network_send_heartbeat("ready", 0, s_battery_level);
      xSemaphoreGive(s_control_mutex);
    }
    // A wireless update waits for an idle, powered recorder with nothing
    // unsent; it restarts on success and returns to READY on any failure.
    if (seconds % 15 == 7 && s_state == LOCAL_READY && lantern_ota_offer_ready()) {
      quipus_ota_window_t window = {
          .ready = s_boot_complete && s_state == LOCAL_READY,
          .recording = lantern_audio_is_recording() || s_sd_recording_active,
          .uploads_pending = s_summary_retry_pending,
          .sync_busy = s_summary_retrying,
          .phone_audio_idle = quipus_phone_audio_idle(),
          .shutting_down = s_power_off_requested,
          .external_power = battery_power_state() == LANTERN_POWER_CHARGING,
          .battery_level = s_battery_level,
          .user_idle_ms = pdTICKS_TO_MS(xTaskGetTickCount() - s_last_interaction_at),
      };
      if (quipus_ota_window_open(&window) &&
          xSemaphoreTake(s_control_mutex, 0) == pdTRUE) {
        if (s_state == LOCAL_READY) {
          s_state = LOCAL_COMMAND_PROCESSING;
          lantern_wake_set_enabled(false);
          lantern_ota_install();
          show_ready();
        }
        xSemaphoreGive(s_control_mutex);
      }
    }

#if LANTERN_HAS_TOUCHSCREEN
    if (!s_display_asleep && s_state == LOCAL_READY &&
        (s_ui_view == UI_HOME || s_ui_view == UI_SPLASH) &&
        (xTaskGetTickCount() - s_last_interaction_at) >= pdMS_TO_TICKS(60000)) {
      lantern_display_set_awake(false);
      s_display_asleep = true;
    }
#endif

    // The slot has no detect pin: probe for a removed or newly inserted card
    // while idle, so a swapped card is used (or reported) without a restart.
    if (LANTERN_HAS_SD_CARD && seconds % 2 == 0 && s_state == LOCAL_READY &&
        !s_summary_retrying && !s_power_off_requested && quipus_phone_audio_idle() &&
        xSemaphoreTake(s_control_mutex, 0) == pdTRUE) {
      if (s_state == LOCAL_READY) {
        lantern_sd_change_t change = lantern_sd_poll();
        if (change != LANTERN_SD_UNCHANGED) {
          s_summary_retry_pending = lantern_sd_upload_pending_count() > 0;
          s_network_update_pending = true;
          ESP_LOGI(TAG, "microSD %s; secure=%d pending=%u",
                   change == LANTERN_SD_INSERTED ? "inserted" : "removed",
                   lantern_sd_secure_ready(), (unsigned)lantern_sd_upload_pending_count());
        }
      }
      xSemaphoreGive(s_control_mutex);
    }
    if (LANTERN_HAS_SD_CARD && seconds % 15 == 0 && s_state == LOCAL_READY &&
        display_network.paired && display_network.wifi_connected &&
        !lantern_sd_secure_ready() &&
        xSemaphoreTake(s_control_mutex, 0) == pdTRUE) {
      s_state = LOCAL_COMMAND_PROCESSING;
      lantern_network_prepare_archive_key();
      show_ready();
      xSemaphoreGive(s_control_mutex);
    }
    if (LANTERN_HAS_SD_CARD && seconds % 60 == 0 && s_state == LOCAL_READY &&
        !s_summary_retrying && !s_power_off_requested &&
        xSemaphoreTake(s_control_mutex, 0) == pdTRUE) {
      if (s_state == LOCAL_READY && quipus_phone_audio_idle()) {
        int64_t trusted_now = lantern_network_trusted_time();
        size_t removed = 0;
        esp_err_t cleanup = lantern_sd_retention_cleanup(
            trusted_now, trusted_now > 0, 4, &removed);
        if (cleanup != ESP_OK) ESP_LOGW(TAG, "cache cleanup deferred: %s", esp_err_to_name(cleanup));
        if (removed) ESP_LOGI(TAG, "expired verified local caches removed=%u", (unsigned)removed);
      }
      xSemaphoreGive(s_control_mutex);
    }
    if (LANTERN_HAS_SD_CARD)
      s_summary_retry_pending = lantern_sd_upload_pending_count() > 0;
    // Only recover network-stage errors with a finalized retained archive.
    // Incomplete/corrupt capture stays visible and is never silently approved.
    if (s_state == LOCAL_ERROR && LANTERN_HAS_SD_CARD &&
        (s_recovery == RECOVERY_UPLOAD || s_recovery == RECOVERY_STOP ||
         s_recovery == RECOVERY_SUMMARY) &&
        s_summary_retry_pending && !s_summary_retrying &&
        !s_power_off_requested && lantern_sd_recording_ready() &&
        display_network.paired && display_network.wifi_connected &&
        (xTaskGetTickCount() - s_state_entered_at) >= pdMS_TO_TICKS(30000) &&
        (xTaskGetTickCount() - s_last_summary_retry_at) >= pdMS_TO_TICKS(30000) &&
        xSemaphoreTake(s_control_mutex, 0) == pdTRUE) {
      if (s_state == LOCAL_ERROR && quipus_phone_audio_idle() &&
          lantern_sd_recording_ready()) {
        ESP_LOGI(TAG, "retrying paused upload from retained SD archive");
        s_state = LOCAL_READY;
        retry_pending_summary(false);
      }
      xSemaphoreGive(s_control_mutex);
    }
    quipus_sync_input_t sync_input = {
        .pending = s_summary_retry_pending,
        .busy = s_summary_retrying,
        .ready = s_boot_complete && s_state == LOCAL_READY,
        .shutdown = s_power_off_requested,
        .user_idle_ticks = (uint32_t)(xTaskGetTickCount() - s_last_interaction_at),
        .retry_idle_ticks = (uint32_t)(xTaskGetTickCount() - s_last_summary_retry_at),
        .retry_delay_ticks = (uint32_t)s_summary_retry_delay,
    };
    if (quipus_sync_due(&sync_input, pdMS_TO_TICKS(30000))) {
      lantern_network_status_t network;
      lantern_network_get_status(&network);
      if (network.wifi_connected && network.paired &&
          xSemaphoreTake(s_control_mutex, 0) == pdTRUE) {
        retry_pending_summary(false);
        xSemaphoreGive(s_control_mutex);
      }
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

// Audio initialization can fail after allocating I2S/codec resources. Never
// retry it in-process or reboot automatically: retain setup and saved archives
// until the user explicitly restarts or powers off. Normal control tasks have
// not been created, so no path here can authorize/start a recording.
static void audio_startup_fault(esp_err_t error) {
  (void)error; // Logging can be disabled in production or host builds.
  s_boot_complete = false;
  s_controls_ready = false;
  s_wake_available = false;
  s_state = LOCAL_ERROR;
  s_recovery = RECOVERY_NONE;
  ESP_LOGE(TAG, "audio startup unavailable: %s; explicit restart required", esp_err_to_name(error));
  bool inputs_ready = false;
#if LANTERN_HAS_PHYSICAL_BUTTONS
#if LANTERN_HAS_POWER_BUTTON
  ESP_ERROR_CHECK_WITHOUT_ABORT(rtc_gpio_deinit(LANTERN_POWER_BUTTON_GPIO));
#endif
  gpio_config_t button = {
      .pin_bit_mask = 1ULL << LANTERN_BUTTON_MAIN_GPIO,
      .mode = GPIO_MODE_INPUT,
      .pull_up_en = GPIO_PULLUP_ENABLE,
  };
  inputs_ready = gpio_config(&button) == ESP_OK;
#elif LANTERN_HAS_TOUCHSCREEN
  inputs_ready = lantern_board_touch_init() == ESP_OK;
#endif
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  const char *instructions = "Tap middle: restart. Hold middle: power off. Saved recordings kept.";
#elif LANTERN_HAS_PHYSICAL_BUTTONS
  const char *instructions = "Tap button to restart. Saved recordings kept.";
#else
  const char *instructions = "Tap screen to restart. Saved recordings kept.";
#endif
  if (!inputs_ready) instructions = "Use RESET to restart. Saved recordings kept.";
  lantern_display_show_detail("MICROPHONE OFFLINE", instructions, NULL);
  esp_err_t network = lantern_network_start(&s_config, NULL);
  if (network == ESP_OK) {
    // Setup remains usable without claiming voice readiness or changing the
    // fault screen through the normal network/UI callback.
    ESP_ERROR_CHECK_WITHOUT_ABORT(lantern_network_open_setup_portal());
  } else {
    ESP_LOGW(TAG, "setup network unavailable in audio fault: %s", esp_err_to_name(network));
  }
  quipus_button_tap_t restart_tap = {0};
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  quipus_power_hold_t power_hold = {0};
#endif
  bool armed = false; // A power-on hold must be released before any action.
  TickType_t status_at = xTaskGetTickCount();
  TickType_t diagnostic_at = status_at;
  TickType_t heartbeat_at = status_at;
  TickType_t pressed_at = status_at;
  for (;;) {
    bool pressed = false;
#if LANTERN_HAS_PHYSICAL_BUTTONS
    pressed = inputs_ready && gpio_get_level(LANTERN_BUTTON_MAIN_GPIO) == 0;
#elif LANTERN_HAS_TOUCHSCREEN
    uint16_t x = 0, y = 0;
    pressed = inputs_ready && lantern_board_touch_read(&x, &y);
#endif
    if (!pressed) armed = true;
    else pressed_at = xTaskGetTickCount();
    uint32_t now = (uint32_t)(esp_timer_get_time() / 1000);
    if (armed) {
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
      if (quipus_power_hold_update(&power_hold, pressed, false, now)) {
        if (lantern_sd_can_power_down()) {
          s_power_off_requested = true;
          power_off_safely();
        } else {
          lantern_display_show_detail("MICROPHONE OFFLINE", "Still saving. Release, then try again.", NULL);
        }
      }
#endif
      if (quipus_button_tap_update(&restart_tap, pressed, false, now)) {
        if (lantern_sd_can_power_down()) esp_restart();
        else lantern_display_show_detail("MICROPHONE OFFLINE", "Still saving. Tap again to restart.", NULL);
      }
    }
    if (network == ESP_OK && xTaskGetTickCount() - status_at >= pdMS_TO_TICKS(1000)) {
      lantern_network_status_t current;
      lantern_network_get_status(&current);
      update_battery_level();
      lantern_display_set_status(s_battery_level, battery_power_state(),
          current.connectivity, current.wifi_rssi, current.paired);
      status_at = xTaskGetTickCount();
    }
    // Keep checking in so the dashboard shows the fault and a fixed firmware
    // can still arrive wirelessly. Nothing here records or uploads audio.
    if (network == ESP_OK && xTaskGetTickCount() - heartbeat_at >= pdMS_TO_TICKS(15000)) {
      heartbeat_at = xTaskGetTickCount();
      update_battery_level();
      lantern_network_send_heartbeat("error", 0, s_battery_level);
      quipus_ota_window_t window = {
          .ready = true,
          .uploads_pending = !lantern_sd_can_power_down(),
          .phone_audio_idle = true,
          .shutting_down = s_power_off_requested,
          .external_power = battery_power_state() == LANTERN_POWER_CHARGING,
          .battery_level = s_battery_level,
          .user_idle_ms = pdTICKS_TO_MS(xTaskGetTickCount() - pressed_at),
      };
      if (lantern_ota_offer_ready() && quipus_ota_window_open(&window)) {
        lantern_ota_install();
        lantern_display_show_detail("MICROPHONE OFFLINE", instructions, NULL);
      }
    }
    if (xTaskGetTickCount() - diagnostic_at >= pdMS_TO_TICKS(10000)) {
      ESP_LOGI(TAG, "audio fault idle capture_disabled=1 sd_safe=%d", lantern_sd_can_power_down());
      diagnostic_at = xTaskGetTickCount();
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

void app_main(void) {
  const lantern_board_profile_t *board = lantern_board_profile();
  ESP_LOGI(TAG, "Quipus %s booting on %s (%s, storage=%s)",
           LANTERN_FIRMWARE_VERSION, board->id, board->model,
           board->storage_kind);
  s_state_entered_at = xTaskGetTickCount();
  power_and_battery_init();
  update_battery_level();
  ESP_ERROR_CHECK(lantern_storage_init());
  lantern_ota_boot();
  ESP_ERROR_CHECK(lantern_storage_load(&s_config));
  ESP_ERROR_CHECK(lantern_display_init());
  lantern_display_show(LANTERN_SCREEN_BOOTING, "CHECKING SD CARD");
  lantern_sd_status_t sd_status;
  esp_err_t sd_result = lantern_sd_init(&sd_status);
  if (sd_result != ESP_OK && sd_result != ESP_ERR_NOT_SUPPORTED) {
    ESP_LOGW(TAG, "continuing without microSD archive: %s",
             esp_err_to_name(sd_result));
  }
  char archive_owner[37], archive_device[37];
  uint8_t archive_key[32];
  if (lantern_storage_load_archive_identity(archive_owner, archive_device,
                                            archive_key) == ESP_OK &&
      !strcmp(archive_device, s_config.device_id) &&
      !strcmp(archive_owner, s_config.owner_id)) {
    lantern_sd_configure_identity(archive_owner, archive_device, archive_key);
  }
  memset(archive_key, 0, sizeof(archive_key));
  s_summary_retry_pending = lantern_sd_upload_pending_count() > 0;
  lantern_display_show(LANTERN_SCREEN_BOOTING, "STARTING AUDIO");
  esp_err_t audio_result = lantern_audio_init();
  if (audio_result != ESP_OK) {
    audio_startup_fault(audio_result);
    return;
  }
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  lantern_display_set_volume(lantern_audio_volume());
  // Read-only board routing/clock evidence before any interaction can begin.
  ESP_ERROR_CHECK_WITHOUT_ABORT(lantern_board_speaker_startup_diagnostics());
  // A short local tone tests output before WakeNet is enabled or any session
  // can start. It does not record, persist or upload microphone audio.
  lantern_audio_chime(1);
#endif
  lantern_audio_set_archive_callback(lantern_sd_recording_write);
  lantern_display_show(LANTERN_SCREEN_BOOTING, "STARTING VOICE RECOGNITION");
  esp_err_t local_voice = quipus_local_recognizer_init();
  if (local_voice == ESP_OK) {
    s_local_voice_samples = heap_caps_malloc(
        QUIPUS_LOCAL_MAX_SAMPLES * sizeof(int16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!s_local_voice_samples)
      ESP_LOGW(TAG, "Local voice scratch unavailable; online recognition retained");
  } else {
    ESP_LOGW(TAG, "Local YES/NO unavailable: %s; online recognition retained", esp_err_to_name(local_voice));
  }
  if (lantern_wake_init() == ESP_OK) {
    s_wake_available = true;
    lantern_audio_set_monitor_callback(lantern_wake_feed);
  } else {
    ESP_LOGW(TAG, "WakeNet unavailable; centre-button fallback is active");
  }
  ESP_ERROR_CHECK(lantern_transcript_init());
  if (quipus_phone_audio_init() != ESP_OK)
    ESP_LOGW(TAG,
             "USB phone audio unavailable; onboard capture remains active");
  // HTTPS and Agora calls have deep library call chains even though their bulk
  // buffers live in PSRAM. Keep enough internal task stack for both paths.
  s_control_mutex = xSemaphoreCreateMutex();
  ESP_ERROR_CHECK(s_control_mutex ? ESP_OK : ESP_ERR_NO_MEM);
  ESP_ERROR_CHECK(xTaskCreate(button_task, "lantern_buttons",
                              CLOUD_CONTROL_STACK_BYTES, NULL, 5,
                              &s_button_task) == pdPASS
                      ? ESP_OK
                      : ESP_ERR_NO_MEM);
  ESP_ERROR_CHECK(xTaskCreate(input_monitor_task, "quipus_inputs", 3072,
                              NULL, 5, &s_input_task) == pdPASS
                      ? ESP_OK
                      : ESP_ERR_NO_MEM);
  ESP_ERROR_CHECK(xTaskCreate(telemetry_task, "lantern_health",
                              CLOUD_CONTROL_STACK_BYTES, NULL, 3,
                              NULL) == pdPASS
                      ? ESP_OK
                      : ESP_ERR_NO_MEM);
  lantern_display_show(LANTERN_SCREEN_BOOTING, "CONNECTING");
  ESP_ERROR_CHECK(lantern_network_start(&s_config, network_changed));
  s_boot_complete = true;
  show_ready();
  ESP_LOGI(TAG,
           "bring-up complete; wake phrase=%s, primary=%s, tap=start/stop, "
           "hold=power on Waveshare",
           s_wake_available ? LANTERN_WAKE_PHRASE : "disabled", LANTERN_PRIMARY_BUTTON_LABEL);
}
