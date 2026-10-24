#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "recovery_types_under_test.h"
#include "prompt_enum_under_test.h"

typedef int esp_err_t;
typedef uint32_t TickType_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NOT_FOUND -2
#define ESP_LOGI(...) ((void)0)
#define TAG "recovery-test"
#define pdTRUE 1
#define LANTERN_HAS_SD_CARD TEST_SD_CARD
#define LANTERN_HAS_TOUCHSCREEN TEST_TOUCHSCREEN
#define LANTERN_MIC_SAMPLE_RATE 16000
#define LANTERN_SCREEN_READY 4
#define LANTERN_SCREEN_ERROR 1
#define LANTERN_SCREEN_LISTENING 2
#define LANTERN_SCREEN_UNDERSTANDING 3
#define pdMS_TO_TICKS(ms) (ms)

typedef struct { bool wifi_connected, paired; } lantern_network_status_t;
static lantern_network_status_t network;
static local_state_t s_state;
static recovery_action_t s_recovery, expected_recovery;
static ui_view_t s_ui_view;
static bool s_audio_uploaded, s_boot_complete, s_wake_available, s_power_off_requested;
static bool wake_enabled, heard_voice, power_during_capture, power_during_command, s_wifi_screen_open;
static unsigned network_cues, recovery_cues;
static int recovery_prompt_result;
static bool alter_recovery_during_command;
static char s_last_error_detail[96], displayed_detail[96];
static TickType_t now_ticks, s_last_interaction_at, s_state_entered_at;
static int s_battery_level = 70, command_result;
static const char *command_intent;
static size_t buffered_samples;
static unsigned captures, requests, retries, cancels, reports, wifi_setups;
static uint32_t raw_audio_sentinel, archive_sentinel;
static bool s_summary_retry_pending, s_summary_retrying, sd_ready, phone_idle, mutex_available;
static TickType_t s_last_summary_retry_at;
static const int s_control_mutex = 1;
static unsigned automatic_retries;
static bool lantern_sd_recording_ready(void) { return sd_ready; }
static bool quipus_phone_audio_idle(void) { return phone_idle; }
static int xSemaphoreTake(int mutex, unsigned wait) {
  assert(mutex == s_control_mutex && wait == 0);
  return mutex_available ? pdTRUE : 0;
}
static void xSemaphoreGive(int mutex) { assert(mutex == s_control_mutex); }
static void retry_pending_summary(bool user_requested) {
  assert(!user_requested && s_state == LOCAL_READY && sd_ready && phone_idle);
  ++automatic_retries;
  s_last_summary_retry_at = now_ticks;
}


static void lantern_network_get_status(lantern_network_status_t *status) { *status = network; }
static void lantern_wake_set_enabled(bool enabled) { wake_enabled = enabled; }
static TickType_t xTaskGetTickCount(void) { return now_ticks; }
static void lantern_display_show(int screen, const char *detail) {
  assert(screen >= LANTERN_SCREEN_ERROR && screen <= LANTERN_SCREEN_READY);
  snprintf(displayed_detail, sizeof(displayed_detail), "%s", detail);
}
static esp_err_t quipus_play_prompt(quipus_prompt_t prompt) {
  if(prompt==QUIPUS_PROMPT_NETWORK_REQUIRED) { ++network_cues; return ESP_OK; }
  assert(prompt==QUIPUS_PROMPT_RECOVERY_LISTENING);
  assert(s_state==LOCAL_COMMAND_LISTENING && !wake_enabled && captures==0 && requests==0);
  ++recovery_cues; return recovery_prompt_result;
}
static void vTaskDelay(TickType_t delay) { now_ticks += delay; }
static bool capture_short_utterance(unsigned maximum_ms) {
  assert(maximum_ms > 0 && maximum_ms <= 7000);
  assert(recovery_cues==1);
  ++captures;
  raw_audio_sentinel = 0;
  if (power_during_capture) s_power_off_requested = true;
  return heard_voice;
}
static size_t lantern_audio_buffered_samples(void) { return buffered_samples; }
static int lantern_network_run_voice_command(const char *context, int battery,
                                              char *intent, size_t capacity) {
  assert(!strcmp(context, "recovery") && battery == s_battery_level);
  ++requests;
  if (alter_recovery_during_command) s_recovery = RECOVERY_NONE;
  if (power_during_command) s_power_off_requested = true;
  snprintf(intent, capacity, "%s", command_intent);
  return command_result;
}
static void assert_restored_before_action(void) {
  assert(s_state == LOCAL_ERROR && s_recovery == expected_recovery);
  assert(!strcmp(displayed_detail, "READY - SAY COMPUTER"));
  assert(!strcmp(s_last_error_detail,"UPLOAD PAUSED - ORIGINAL ERROR"));
}
static void retry_error(void) {
  assert_restored_before_action();
  ++retries;
  s_state = LOCAL_SAVING;
}
static void cancel_error(void) {
  assert_restored_before_action();
  ++cancels;
  s_state = LOCAL_READY;
}
static void play_status_report(void) {
  assert_restored_before_action();
  ++reports;
  s_state = LOCAL_STATUS;
}
static void open_wifi_screen(void) {
  assert_restored_before_action();
  ++wifi_setups;
  s_state = LOCAL_READY;
}

#include "recovery_under_test.c"

static void reset_case(void) {
  network = (lantern_network_status_t){.wifi_connected = true, .paired = true};
  s_wifi_screen_open=false; network_cues=recovery_cues=0; recovery_prompt_result=ESP_OK;
  s_state = LOCAL_ERROR;
  s_recovery = expected_recovery = RECOVERY_STATUS;
  s_ui_view = UI_WIFI_LIST;
  s_audio_uploaded = false;
  s_boot_complete = s_wake_available = true;
  s_power_off_requested = wake_enabled = false;
  heard_voice = true;
  power_during_capture = power_during_command = alter_recovery_during_command = false;
  strcpy(s_last_error_detail, "UPLOAD PAUSED - ORIGINAL ERROR");
  displayed_detail[0] = '\0';
  now_ticks = 1000;
  s_last_interaction_at = s_state_entered_at = 0;
  command_result = ESP_OK;
  command_intent = "unknown";
  buffered_samples = LANTERN_MIC_SAMPLE_RATE;
  captures = requests = retries = cancels = reports = wifi_setups = 0;
  raw_audio_sentinel = 0x12345678;
  archive_sentinel = 0x9abcdef0;
  s_summary_retry_pending = sd_ready = phone_idle = mutex_available = true;
  s_summary_retrying = false;
  s_last_summary_retry_at = 0;
  automatic_retries = 0;
}
static void assert_no_actions(void) {
  assert(retries == 0 && cancels == 0 && reports == 0 && wifi_setups == 0);
  assert(archive_sentinel == 0x9abcdef0);
}
static void assert_error_restored(void) {
  assert_no_actions();
  assert(s_state == LOCAL_ERROR && s_recovery == expected_recovery);
  assert(!strcmp(displayed_detail, "READY - SAY COMPUTER"));
  assert(!strcmp(s_last_error_detail,"UPLOAD PAUSED - ORIGINAL ERROR"));
  assert(wake_enabled);
}

static void reset_automatic_case(void) {
  reset_case();
  s_recovery = RECOVERY_UPLOAD;
  now_ticks = 30000;
}
static void automatic_network_recovery(void) {
  const recovery_action_t permitted[] = {RECOVERY_UPLOAD, RECOVERY_STOP, RECOVERY_SUMMARY};
  for (unsigned i = 0; i < sizeof(permitted) / sizeof(permitted[0]); ++i) {
    reset_automatic_case(); s_recovery = permitted[i];
    tested_automatic_recovery();
    assert(automatic_retries == (LANTERN_HAS_SD_CARD ? 1U : 0U));
    assert_no_actions();
  }
  reset_automatic_case(); s_recovery = RECOVERY_NONE;
  tested_automatic_recovery(); assert(automatic_retries == 0);
  reset_automatic_case(); sd_ready = false;
  tested_automatic_recovery(); assert(automatic_retries == 0);
  reset_automatic_case(); phone_idle = false;
  tested_automatic_recovery(); assert(automatic_retries == 0);
  reset_automatic_case(); mutex_available = false;
  tested_automatic_recovery(); assert(automatic_retries == 0);
  reset_automatic_case(); network.wifi_connected = false;
  tested_automatic_recovery(); assert(automatic_retries == 0);
  reset_automatic_case(); network.paired = false;
  tested_automatic_recovery(); assert(automatic_retries == 0);
  reset_automatic_case(); s_power_off_requested = true;
  tested_automatic_recovery(); assert(automatic_retries == 0);
  reset_automatic_case(); s_summary_retrying = true;
  tested_automatic_recovery(); assert(automatic_retries == 0);
  reset_automatic_case(); s_summary_retry_pending = false;
  tested_automatic_recovery(); assert(automatic_retries == 0);
  reset_automatic_case(); s_state = LOCAL_RECORDING;
  tested_automatic_recovery(); assert(automatic_retries == 0);
  reset_automatic_case(); now_ticks = 29999;
  tested_automatic_recovery(); assert(automatic_retries == 0);
#if LANTERN_HAS_SD_CARD
  reset_automatic_case();
  tested_automatic_recovery(); assert(automatic_retries == 1);
  s_state = LOCAL_ERROR; now_ticks = 59999;
  tested_automatic_recovery(); assert(automatic_retries == 1);
  now_ticks = 60000;
  tested_automatic_recovery(); assert(automatic_retries == 2);
#endif
}

int main(void) {
  // Only ERROR/READY permit listening; active recording/processing never do.
  reset_case(); sync_idle_wake_listener(); assert(wake_enabled);
  s_state = LOCAL_RECORDING; sync_idle_wake_listener(); assert(!wake_enabled);
  s_state = LOCAL_COMMAND_LISTENING; sync_idle_wake_listener(); assert(!wake_enabled);
  s_state = LOCAL_STATUS; sync_idle_wake_listener(); assert(!wake_enabled);
  s_state = LOCAL_ERROR;
  network.wifi_connected = false; sync_idle_wake_listener(); assert(wake_enabled);
  network.wifi_connected = true; network.paired = false;
  sync_idle_wake_listener(); assert(!wake_enabled);
  network.paired = true; s_boot_complete = false;
  sync_idle_wake_listener(); assert(!wake_enabled);
  s_boot_complete = true; s_wake_available = false;
  sync_idle_wake_listener(); assert(!wake_enabled);
#if LANTERN_HAS_TOUCHSCREEN
  s_wake_available = true; s_state = LOCAL_READY;
  sync_idle_wake_listener(); assert(!wake_enabled);
  s_ui_view = UI_HOME; sync_idle_wake_listener(); assert(wake_enabled);
  s_ui_view = UI_WIFI_LIST; s_state = LOCAL_ERROR;
  sync_idle_wake_listener(); assert(wake_enabled);
#endif

  reset_case(); s_wifi_screen_open=true;
  sync_idle_wake_listener(); assert(!wake_enabled);
  reset_case(); recovery_prompt_result=ESP_FAIL;
  capture_recovery_command(); assert(captures==0 && requests==0 && recovery_cues==1); assert_error_restored();

  // Every permitted command delegates exactly once with the original error.
  const char *allowed[] = {"retry_recovery", "cancel_recovery", "status_report", "wifi_setup"};
  for (unsigned i = 0; i < sizeof(allowed) / sizeof(allowed[0]); ++i) {
    reset_case();
    command_intent = allowed[i];
    alter_recovery_during_command = true;
    capture_recovery_command();
    assert(captures == 1 && requests == 1);
    assert(retries == (i == 0) && cancels == (i == 1));
    assert(reports == (i == 2) && wifi_setups == (i == 3));
    assert(archive_sentinel == 0x9abcdef0);
  }

  const char *forbidden[] = {"start_recording", "consent_yes", "consent_no", "stop_recording", "wake_detected", "report_answer", "", "unknown"};
  for (unsigned i = 0; i < sizeof(forbidden) / sizeof(forbidden[0]); ++i) {
    reset_case(); command_intent = forbidden[i];
    capture_recovery_command();
    assert(captures == 1 && requests == 1);
    assert_error_restored();
  }
  reset_case(); command_result = ESP_FAIL;
  capture_recovery_command(); assert_error_restored();
  reset_case(); command_result = ESP_ERR_NOT_FOUND;
  capture_recovery_command(); assert_error_restored();
  reset_case(); heard_voice = false;
  capture_recovery_command(); assert(requests == 0); assert_error_restored();
  reset_case(); buffered_samples = LANTERN_MIC_SAMPLE_RATE / 2 - 1;
  capture_recovery_command(); assert(requests == 0); assert_error_restored();

  // Ineligible entry never overwrites audio or reaches the command service.
  reset_case(); s_state = LOCAL_READY;
  capture_recovery_command(); assert(captures == 0 && requests == 0); assert_no_actions();
  reset_case(); network.wifi_connected = false;
  capture_recovery_command(); assert(captures == 0 && requests == 0 && network_cues==1);
  assert(wake_enabled); assert_no_actions();
  reset_case(); network.paired = false;
  capture_recovery_command(); assert(captures == 0 && requests == 0); assert_no_actions();
  reset_case(); s_power_off_requested = true;
  capture_recovery_command(); assert(captures == 0 && requests == 0); assert_no_actions();
  reset_case(); power_during_capture = true;
  capture_recovery_command(); assert(captures == 1 && requests == 0); assert_no_actions();
  reset_case(); power_during_command = true;
  capture_recovery_command(); assert(captures == 1 && requests == 1); assert_no_actions();

  // A RAM-only board must preserve its pending audio instead of capturing speech.
  const recovery_action_t unsafe_ram[] = {RECOVERY_UPLOAD, RECOVERY_STOP};
  for (unsigned i = 0; i < sizeof(unsafe_ram) / sizeof(unsafe_ram[0]); ++i) {
    reset_case(); s_recovery = expected_recovery = unsafe_ram[i];
    sync_idle_wake_listener();
#if LANTERN_HAS_SD_CARD
    assert(wake_enabled);
#else
    assert(!wake_enabled);
    capture_recovery_command();
    assert(captures == 0 && requests == 0 && raw_audio_sentinel == 0x12345678);
    assert_no_actions();
    s_audio_uploaded = true;
    sync_idle_wake_listener(); assert(wake_enabled);
    command_intent = "retry_recovery";
    capture_recovery_command();
    assert(captures == 1 && retries == 1);
#endif
  }
  automatic_network_recovery();
  printf("Recovery command whitelist, restored errors, bounded automatic retry and RAM protection passed (SD=%d touch=%d)\n", LANTERN_HAS_SD_CARD, LANTERN_HAS_TOUCHSCREEN);
  return 0;
}
