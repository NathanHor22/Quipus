#include <assert.h>
#include <setjmp.h>
#include <stdint.h>

#include "quipus_button_tap.h"
#include "quipus_controls.h"
#include "quipus_volume.h"
#include "prompt_enum_under_test.h"
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_STATE -2
#define RECOVERY_SESSION_START 1
#define LANTERN_SCREEN_CONNECTING 3
#define LANTERN_HAS_SD_CARD 1
#define LANTERN_HAS_PHYSICAL_BUTTONS 1
#define CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154 1
#define LANTERN_BUTTON_MAIN_GPIO 5
#define LANTERN_POWER_BUTTON_GPIO 5
#define LANTERN_BUTTON_UP_GPIO 0
#define LANTERN_BUTTON_DOWN_GPIO 4
#define pdMS_TO_TICKS(ms) (ms)
#define LANTERN_PRIMARY_BUTTON_LABEL "MIDDLE"
#define LANTERN_SCREEN_CONSENT 1
#define LANTERN_SCREEN_SAVING 2
#define RECOVERY_NONE 0
#define LANTERN_POWER_HOLD_GPIO 2
#define ESP_ERROR_CHECK(expr) assert((expr) == ESP_OK)
#define TAG "consent-test"
#define ESP_LOGI(...) ((void)0)
#define ESP_LOGW(...) ((void)0)

typedef enum { LOCAL_READY, LOCAL_AWAITING_CONSENT, LOCAL_RECORDING,
  LOCAL_COMPLETE, LOCAL_STATUS, LOCAL_ERROR, LOCAL_COMMAND_LISTENING,
  LOCAL_COMMAND_PROCESSING, LOCAL_SAVING } local_state_t;
typedef unsigned TickType_t;
static local_state_t s_state;
static TickType_t s_state_entered_at;
static TickType_t s_last_interaction_at;
static TickType_t s_input_polled_at;
static int s_recovery;
typedef struct { bool paired; bool wifi_connected; } lantern_network_status_t;
static lantern_network_status_t test_network;
static struct { bool offline_local; char session_id[37]; } s_cloud_session;
static int begin_result, offline_result, prompt_result, confirm_result;
static unsigned cloud_begins, offline_begins, secure_sd_checks, archive_key_requests;
static int response_result;
static const char *response_intent;
static const char *retry_intent;
static int retry_result;
static bool retry_prompt_fails;
static unsigned reboots;
static bool sd_secure = true;
static bool power_during_prompt, power_during_capture;
static int remount_result = ESP_FAIL;
static unsigned remounts;
static bool local_model;
static unsigned accepted, captured, prompted, declined, reset_calls, chimes;
static char screen[96];
static bool s_controls_ready = true;
static bool s_wifi_screen_open;
static unsigned retry_questions, refusal_cues, network_cues, sd_cues;
static bool s_power_off_requested;
static bool s_boot_complete = true;
static unsigned task_clock_ms, task_stop_ms, simulated_outer_pin;
static bool simulated_middle_held, simulated_chord, simulated_middle_delayed;
static unsigned report_interrupts, pcm_cancellations;
static unsigned volume_percent = 80, volume_changes;
static jmp_buf task_finished, shutdown_finished;
static bool finish_ok = true, phone_idle = true, sd_power_safe = true;
static int checkpoint_result = ESP_OK;
static bool s_agora_active;
static unsigned finish_calls, checkpoint_calls, power_cuts, sleep_calls, errors;
static unsigned sequence, finalized_order, checkpoint_order, cut_order;
static bool report_cache_open;
static unsigned report_ends, report_end_order, sd_guard_order;

static bool finish_local_recording(void) {
  ++finish_calls;
  finalized_order = ++sequence;
  if (finish_ok) s_state = LOCAL_SAVING;
  return finish_ok;
}
static void lantern_wake_set_enabled(bool enabled) { assert(!enabled); }
static void lantern_audio_set_streaming(bool enabled) { assert(!enabled); }
static void lantern_agora_stop(void) {}
static bool quipus_phone_audio_idle(void) { return phone_idle; }
static void lantern_network_end_report(void) {
  ++report_ends;
  report_end_order = ++sequence;
  report_cache_open = false;
}
static bool lantern_sd_can_power_down(void) {
  sd_guard_order = ++sequence;
  return sd_power_safe && !report_cache_open;
}
static void show_error(int recovery, const char *detail, const char *prompt) {
  assert(recovery >= RECOVERY_NONE && detail && prompt == NULL);
  ++errors;
  s_state = LOCAL_ERROR;
}
static int lantern_sd_checkpoint(void *session, bool stopped, bool uploaded,
                                 bool phone_uploaded) {
  assert(session == &s_cloud_session && !stopped && !uploaded && !phone_uploaded);
  ++checkpoint_calls;
  checkpoint_order = ++sequence;
  return checkpoint_result;
}
static void lantern_display_set_awake(bool awake) { assert(!awake); }
static void lantern_board_speaker_enable(bool enabled) { assert(!enabled); }
static int esp_sleep_enable_ext0_wakeup(int pin, int level) {
  assert(pin == LANTERN_POWER_BUTTON_GPIO && level == 0);
  return ESP_OK;
}
static int rtc_gpio_pullup_en(int pin) {
  assert(pin == LANTERN_POWER_BUTTON_GPIO);
  return ESP_OK;
}
static int rtc_gpio_pulldown_dis(int pin) {
  assert(pin == LANTERN_POWER_BUTTON_GPIO);
  return ESP_OK;
}
static void gpio_set_level(int pin, int level) {
  assert(pin == LANTERN_POWER_HOLD_GPIO && level == 0);
  assert(phone_idle && sd_power_safe);
  ++power_cuts;
  cut_order = ++sequence;
}
static void esp_deep_sleep_start(void) {
  ++sleep_calls;
  longjmp(shutdown_finished, 1);
}


static void vTaskDelay(unsigned milliseconds) {
  task_clock_ms += milliseconds;
  if (task_stop_ms && task_clock_ms >= task_stop_ms)
    longjmp(task_finished, 1);
}
static int64_t esp_timer_get_time(void) { return (int64_t)task_clock_ms * 1000; }
static int gpio_get_level(int pin) {
  if (pin == LANTERN_BUTTON_MAIN_GPIO && (simulated_middle_held ||
      (simulated_middle_delayed && task_clock_ms >= 830 && task_clock_ms < 3500))) return 0;
  bool held = task_clock_ms >= 830 && task_clock_ms < 890;
  if (held && (pin == (int)simulated_outer_pin ||
      (simulated_chord && (pin == LANTERN_BUTTON_UP_GPIO ||
                          pin == LANTERN_BUTTON_DOWN_GPIO)))) return 0;
  return 1;
}
static unsigned lantern_audio_adjust_volume(int delta) {
  ++volume_changes;
  volume_percent = quipus_volume_clamp((int)volume_percent + delta);
  return volume_percent;
}
static void lantern_display_set_volume(unsigned volume) {
  assert(volume == volume_percent);
}
static bool lantern_audio_take_speech_interrupt(void) { return false; }
static bool lantern_network_report_playing(void) { return false; }
static bool lantern_audio_is_speaker_active(void) { return false; }
static void lantern_network_interrupt_report(void) { ++report_interrupts; }
static void lantern_audio_pcm_cancel(void) { ++pcm_cancellations; }


static void clear_active_session(void) {
  memset(&s_cloud_session, 0, sizeof(s_cloud_session));
}
static void show_ready(void) { s_state = LOCAL_READY; }
static bool ready_for_cloud_action(void) { return true; }
static void finalise_recording(void) { s_state = LOCAL_COMPLETE; }
static void retry_error(void) { s_state = LOCAL_READY; }
static TickType_t xTaskGetTickCount(void) { return task_clock_ms; }
static void lantern_network_get_status(lantern_network_status_t *network) {
  *network = test_network;
}
static void lantern_network_set_realtime(bool enabled) { assert(enabled); }
static bool lantern_sd_secure_ready(void) { ++secure_sd_checks; return sd_secure; }
static bool local_voice_ready(void) { return local_model; }
static int lantern_sd_init(void *unused) {
  assert(!unused); ++remounts;
  if (remount_result == ESP_OK) sd_secure=true;
  return remount_result;
}
static int lantern_network_begin_offline(void *session) {
  assert(session == &s_cloud_session);
  ++offline_begins;
  if (offline_result == ESP_OK) {
    strcpy(s_cloud_session.session_id, "offline-session-under-test");
    s_cloud_session.offline_local = true;
  }
  return offline_result;
}
static esp_err_t quipus_play_consent_prompt(void) {
  ++prompted;
  if (power_during_prompt) s_power_off_requested = true;
  return retry_prompt_fails && prompted > 1 ? ESP_FAIL : prompt_result;
}
static esp_err_t quipus_play_prompt(quipus_prompt_t prompt) {
  if(prompt==QUIPUS_PROMPT_CONSENT_RETRY) {
    ++retry_questions; ++prompted;
    return retry_prompt_fails ? ESP_FAIL : prompt_result;
  }
  if(prompt==QUIPUS_PROMPT_CONSENT_REFUSED) { ++refusal_cues; return ESP_OK; }
  if(prompt==QUIPUS_PROMPT_SD_FAILURE) { ++sd_cues; return ESP_OK; }
  assert(prompt==QUIPUS_PROMPT_NETWORK_REQUIRED); ++network_cues; return ESP_OK;
}
static void lantern_display_show(int page, const char *detail) {
  assert(page == LANTERN_SCREEN_CONSENT || page == LANTERN_SCREEN_SAVING ||
         page == LANTERN_SCREEN_CONNECTING);
  snprintf(screen, sizeof(screen), "%s", detail);
}
static void lantern_audio_chime(int count) { chimes += (unsigned)count; }
static int capture_consent_response(const char *context, char intent[32]) {
  assert(!strcmp(context, "consent") || !strcmp(context, "consent_retry"));
  ++captured;
  if (power_during_capture) s_power_off_requested = true;
  assert(cloud_begins == 0 && offline_begins == 0 && archive_key_requests == 0);
  snprintf(intent, 32, "%s", captured > 1 ? retry_intent : response_intent);
  return captured > 1 ? retry_result : response_result;
}
static esp_err_t begin_recording_session(void);
static esp_err_t accept_recording_consent(void) {
  if (begin_recording_session() != ESP_OK) return ESP_FAIL;
  ++accepted;
  s_state = LOCAL_RECORDING;
  return ESP_OK;
}
static esp_err_t lantern_network_confirm_consent(void *session, bool yes,
                                                void *transport) {
  assert(session == &s_cloud_session && !yes && transport == NULL);
  ++declined;
  return confirm_result;
}
static void lantern_network_restart_session(void) { ++reset_calls; }
#define esp_restart() (++reboots)

#include "consent_under_test.c"

static void reset_case(bool offline, int speech) {
  clear_active_session();
  s_state = LOCAL_READY;
  s_power_off_requested = false;
  s_boot_complete = true;
  begin_result = offline ? ESP_FAIL : ESP_OK;
  offline_result = confirm_result = ESP_OK;
  test_network = (lantern_network_status_t){.paired = true, .wifi_connected = !offline};
  cloud_begins = offline_begins = secure_sd_checks = archive_key_requests = 0;
  sd_secure = true;
  remount_result = ESP_FAIL; remounts=0; local_model=false;
  power_during_prompt = power_during_capture = false;
  errors = 0;
  s_wifi_screen_open=false;
  retry_questions=refusal_cues=network_cues=sd_cues=0;
  response_result = ESP_OK;
  response_intent = retry_intent = "consent_yes";
  retry_result = ESP_OK;
  retry_prompt_fails = false;
  reboots = 0;
  s_recovery = 0;
  task_clock_ms = task_stop_ms = 0;
  simulated_middle_held = simulated_middle_delayed = simulated_chord = false;
  prompt_result = speech;
  accepted = captured = prompted = declined = reset_calls = chimes = 0;
  screen[0] = '\0';
}

static void simulate_outer_tap(unsigned pin, bool middle, bool chord) {
  task_clock_ms = 0;
  task_stop_ms = 950;
  simulated_middle_delayed = false;
  report_interrupts = pcm_cancellations = 0;
  s_last_interaction_at = 0;
  simulated_outer_pin = pin;
  simulated_middle_held = middle;
  simulated_chord = chord;
  volume_percent = 80;
  volume_changes = 0;
  s_input_polled_at = 0;
  if (setjmp(task_finished) == 0) tested_input_monitor(NULL);
  assert(s_input_polled_at > 0);
  task_stop_ms = 0;
}

static void reset_power_case(void) {
  reset_case(false, ESP_OK);
  s_state = LOCAL_RECORDING;
  s_power_off_requested = true;
  s_agora_active = true;
  finish_ok = phone_idle = sd_power_safe = true;
  checkpoint_result = ESP_OK;
  finish_calls = checkpoint_calls = power_cuts = sleep_calls = errors = 0;
  sequence = finalized_order = checkpoint_order = cut_order = 0;
  report_cache_open = false;
  report_ends = report_end_order = sd_guard_order = 0;
  simulated_middle_held = simulated_chord = false;
  task_clock_ms = 10000;
}
static void exercise_shutdown(void) {
  if (setjmp(shutdown_finished) == 0) power_off_safely();
}
static void safe_shutdown_paths(void) {
  reset_power_case();
  exercise_shutdown();
  assert(finish_calls == 1 && checkpoint_calls == 1 && power_cuts == 1 && sleep_calls == 1);
  assert(finalized_order < checkpoint_order && checkpoint_order < cut_order);
  assert(!s_agora_active && errors == 0);

  reset_power_case();
  finish_ok = false;
  exercise_shutdown();
  assert(finish_calls == 1 && checkpoint_calls == 0 && power_cuts == 0 && sleep_calls == 0);
  assert(!s_power_off_requested);

  reset_power_case();
  phone_idle = false;
  exercise_shutdown();
  assert(finish_calls == 1 && checkpoint_calls == 0 && power_cuts == 0 && errors == 1);
  assert(!s_power_off_requested);

  reset_power_case();
  sd_power_safe = false;
  exercise_shutdown();
  assert(finish_calls == 1 && checkpoint_calls == 0 && power_cuts == 0 && errors == 1);
  assert(!s_power_off_requested);

  reset_power_case();
  checkpoint_result = ESP_FAIL;
  exercise_shutdown();
  assert(finish_calls == 1 && checkpoint_calls == 1 && power_cuts == 0 && errors == 1);
  assert(!s_power_off_requested);

  // Finalized unsynced archives permit power-off; no cloud request or deletion.
  reset_power_case();
  s_state = LOCAL_READY;
  exercise_shutdown();
  assert(finish_calls == 0 && checkpoint_calls == 0 && power_cuts == 1 && sleep_calls == 1);
  assert(declined == 0 && reset_calls == 0);

  // Between report pages, abort the optional cache writer before the SD guard.
  // Otherwise an idle device could refuse every subsequent power-off attempt.
  reset_power_case();
  s_state = LOCAL_STATUS;
  report_cache_open = true;
  exercise_shutdown();
  assert(report_ends == 1 && !report_cache_open);
  assert(report_end_order < sd_guard_order && sd_guard_order < cut_order);
  assert(finish_calls == 0 && checkpoint_calls == 0);
  assert(power_cuts == 1 && sleep_calls == 1 && errors == 0);
}

static void assert_no_session_before_yes(void) {
  assert(accepted == 0 && cloud_begins == 0 && offline_begins == 0);
  // Reading SD readiness before the question is allowed; opening a session
  // or requesting a key is not.
  assert(archive_key_requests == 0);
  assert(!s_cloud_session.session_id[0]);
}

static void assert_no_restart_or_recording(void) {
  assert_no_session_before_yes();
  assert(reboots == 0 && declined == 0 && reset_calls == 0);
}

int main(void) {
  // Recognition unavailable offline or after a failed local question cancels.
  reset_case(true, ESP_OK);
  handle_short_press();
  assert(s_state == LOCAL_READY && captured == 0 && prompted == 1);
  assert_no_restart_or_recording();
  handle_short_press();
  assert(s_state == LOCAL_READY && accepted == 0 && prompted == 2);
  assert_no_restart_or_recording();
  reset_case(false, ESP_FAIL);
  handle_short_press();
  assert(s_state == LOCAL_READY && captured == 0 && prompted == 1);
  assert_no_restart_or_recording();

  // A provisioned local model enables spoken consent with no Internet.
  reset_case(true, ESP_OK); local_model=true;
  handle_short_press();
  assert(captured==1 && accepted==1 && offline_begins==1 && cloud_begins==0);
  reset_case(true, ESP_OK); local_model=true;
  response_intent=retry_intent="consent_no";
  handle_short_press();
  assert(captured==2 && accepted==0 && s_state==LOCAL_READY);
  assert_no_session_before_yes();

  // Neither physical Start taps nor touchscreen consent taps may authorize.
  reset_case(false, ESP_OK);
  s_state = LOCAL_AWAITING_CONSENT;
  for (unsigned tap = 0; tap < 5; ++tap) handle_short_press();
  assert(s_state == LOCAL_AWAITING_CONSENT && captured == 0 && prompted == 0);
  assert_no_restart_or_recording();
  for (unsigned tap = 0; tap < 5; ++tap) tested_touch_consent_dispatch();
  assert(s_state == LOCAL_AWAITING_CONSENT && captured == 0 && prompted == 0);
  assert_no_restart_or_recording();

  // Only explicit affirmative speech starts a new recording session.
  reset_case(false, ESP_OK);
  handle_short_press();
  assert(captured == 1 && prompted == 1 && accepted == 1 && cloud_begins == 0 && offline_begins == 1);
  assert(s_state == LOCAL_RECORDING && reboots == 0);

  // First spoken NO asks again; a second NO cancels to READY, never rebooting.
  reset_case(false, ESP_OK);
  response_intent = retry_intent = "consent_no";
  handle_short_press();
  assert(captured == 2 && prompted == 2 && reboots == 0 && s_state == LOCAL_READY);
  assert(retry_questions==1 && refusal_cues==1);
  assert(declined == 0 && reset_calls == 0 && test_network.paired);
  assert_no_session_before_yes();

  // A fresh spoken YES after the first NO may authorize the second attempt.
  reset_case(false, ESP_OK);
  response_intent = "consent_no";
  handle_short_press();
  assert(captured == 2 && prompted == 2 && accepted == 1 && cloud_begins == 0 && offline_begins == 1);
  assert(retry_questions==1 && refusal_cues==0);
  assert(reboots == 0 && s_state == LOCAL_RECORDING);

  // Unknown speech, silence and provider errors have a bounded second attempt.
  reset_case(false, ESP_OK);
  response_intent = retry_intent = "unknown";
  handle_short_press();
  assert(captured == 2 && prompted == 2 && s_state == LOCAL_READY);
  assert_no_restart_or_recording();
  reset_case(false, ESP_OK);
  response_result = retry_result = ESP_FAIL;
  handle_short_press();
  assert(captured == 2 && prompted == 2 && s_state == LOCAL_READY);
  assert_no_restart_or_recording();

  // An affirmative retry can authorize; a negative final retry cancels.
  reset_case(false, ESP_OK);
  response_intent = "unknown";
  handle_short_press();
  assert(captured == 2 && prompted == 2 && accepted == 1 && cloud_begins == 0 && offline_begins == 1);
  reset_case(false, ESP_OK);
  response_result = ESP_FAIL;
  handle_short_press();
  assert(captured == 2 && prompted == 2 && accepted == 1 && cloud_begins == 0 && offline_begins == 1);
  reset_case(false, ESP_OK);
  response_intent = "unknown";
  retry_intent = "consent_no";
  handle_short_press();
  assert(captured == 2 && reboots == 0 && s_state == LOCAL_READY);
  assert_no_session_before_yes();
  // No followed by uncertainty or a recognition error also cancels safely.
  reset_case(false, ESP_OK);
  response_intent = "consent_no";
  retry_intent = "unknown";
  handle_short_press();
  assert(captured == 2 && prompted == 2 && s_state == LOCAL_READY);
  assert_no_restart_or_recording();
  reset_case(false, ESP_OK);
  response_intent = "consent_no";
  retry_result = ESP_FAIL;
  handle_short_press();
  assert(captured == 2 && prompted == 2 && s_state == LOCAL_READY);
  assert_no_restart_or_recording();

  reset_case(false, ESP_OK);
  response_intent = "unknown";
  retry_prompt_fails = true;
  handle_short_press();
  assert(captured == 1 && prompted == 2 && s_state == LOCAL_READY);
  assert_no_restart_or_recording();

  // Existing cloud recovery IDs retain normal rejection acknowledgement.
  reset_case(false, ESP_OK);
  strcpy(s_cloud_session.session_id, "existing-cloud-session");
  cancel_pending_consent();
  assert(declined == 1 && reset_calls == 0 && reboots == 0);
  reset_case(false, ESP_OK);
  strcpy(s_cloud_session.session_id, "existing-cloud-session");
  confirm_result = ESP_FAIL;
  cancel_pending_consent();
  assert(declined == 1 && reset_calls == 1 && reboots == 0);

  // Unpaired, booting or shutting-down boards cannot start consent capture.
  reset_case(false, ESP_OK);
  test_network.paired = false;
  handle_short_press();
  assert(prompted == 0 && captured == 0);
  assert_no_restart_or_recording();
  reset_case(false, ESP_OK);
  s_boot_complete = false;
  handle_short_press();
  assert(prompted == 0 && captured == 0);
  assert_no_restart_or_recording();
  reset_case(false, ESP_OK);
  s_power_off_requested = true;
  handle_short_press();
  assert(prompted == 0 && captured == 0);
  assert_no_restart_or_recording();
  reset_case(false, ESP_OK);
  power_during_prompt = true;
  handle_short_press();
  assert(prompted == 1 && captured == 0);
  assert_no_restart_or_recording();
  reset_case(false, ESP_OK);
  power_during_capture = true;
  handle_short_press();
  assert(captured == 1);
  assert_no_restart_or_recording();
  reset_case(false, ESP_OK);
  power_during_capture = true;
  response_intent = "consent_no";
  handle_short_press();
  assert(captured == 1 && reboots == 0);
  assert_no_session_before_yes();

  // Secure SD work remains after spoken YES, never after buttons or silence.
  reset_case(false, ESP_OK);
  sd_secure = false;
  handle_short_press();
  assert(archive_key_requests == 0 && cloud_begins == 0 && accepted == 0 && remounts == 1);
  reset_case(false, ESP_OK);
  sd_secure=false; remount_result=ESP_OK;
  handle_short_press();
  assert(accepted==1 && offline_begins==1 && cloud_begins==0 && remounts==1);
  reset_case(false, ESP_OK);
  begin_result = offline_result = ESP_FAIL;
  handle_short_press();
  assert(cloud_begins == 0 && offline_begins == 1 && accepted == 0 && errors == 1);
  // A missing or unsecured card is named before any consent question, so
  // nobody consents to a recording the device cannot save.
  reset_case(false, ESP_OK);
  sd_secure = false;
  remount_result = ESP_FAIL;
  handle_short_press();
  assert(archive_key_requests == 0 && cloud_begins == 0 && offline_begins == 0 && remounts == 1);
  assert(accepted == 0 && errors == 0 && sd_cues == 1 && prompted == 0 && captured == 0);

  // Outer volume controls never decide consent, and respect middle/reset chords.
  reset_case(false, ESP_OK);
  s_state = LOCAL_AWAITING_CONSENT;
  simulate_outer_tap(LANTERN_BUTTON_UP_GPIO, false, false);
  assert(volume_changes == 1 && volume_percent == 90 && s_state == LOCAL_AWAITING_CONSENT);
  assert_no_restart_or_recording();
  reset_case(false, ESP_OK);
  simulate_outer_tap(LANTERN_BUTTON_UP_GPIO, false, false);
  assert(volume_changes == 1 && volume_percent == 90 && s_last_interaction_at == 890);
  simulate_outer_tap(LANTERN_BUTTON_DOWN_GPIO, false, false);
  assert(volume_changes == 1 && volume_percent == 70 && s_last_interaction_at == 890);
  simulate_outer_tap(LANTERN_BUTTON_UP_GPIO, true, false);
  assert(volume_changes == 0);
  simulate_outer_tap(LANTERN_BUTTON_DOWN_GPIO, true, false);
  assert(volume_changes == 0);
  simulate_outer_tap(LANTERN_BUTTON_UP_GPIO, false, true);
  assert(volume_changes == 0);

  safe_shutdown_paths();
  // Actual monitor interrupts speaker output once during a deliberate hold.
  reset_case(false, ESP_OK);
  simulated_outer_pin = 99;
  simulated_middle_held = simulated_chord = false;
  simulated_middle_delayed = true;
  task_clock_ms = 0;
  task_stop_ms = 4000;
  report_interrupts = pcm_cancellations = volume_changes = 0;
  if (setjmp(task_finished) == 0) tested_input_monitor(NULL);
  task_stop_ms = 0;
  assert(s_power_off_requested && report_interrupts == 1 && pcm_cancellations == 1);
  assert(volume_changes == 0 && accepted == 0);

  puts("Voice-only consent, touch/button rejection, bounded retries and safe shutdown passed");
  return 0;
}
