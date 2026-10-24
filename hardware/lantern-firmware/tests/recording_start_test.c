#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "prompt_enum_under_test.h"

typedef int esp_err_t;
typedef unsigned TickType_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_STATE -2
#define ESP_ERROR_CHECK_WITHOUT_ABORT(expr) ((void)(expr))
#define ESP_LOGI(...) ((void)0)
#define ESP_LOGW(...) ((void)0)
#define ESP_LOGE(...) ((void)0)
#define TAG "recording-start-test"
#define LANTERN_HAS_SD_CARD 1
#define LANTERN_SCREEN_CONNECTING 1
#define RECOVERY_NONE 0
#define RECOVERY_RECORDING_START 1

typedef struct { int placeholder; } lantern_agora_transport_t;
typedef struct {
  bool offline_local;
  char session_id[37], owner_id[37], local_date[12], local_time[16];
} test_session_t;
static test_session_t s_cloud_session;
static struct { char owner_id[37]; } s_config;
static bool s_power_off_requested, s_recording_connection_notice;
static bool s_agora_active, s_used_agora;
static bool s_sd_recording_active, s_sd_archive_required;
static bool s_transcript_uploaded, s_audio_uploaded;
static unsigned s_recording_duration_seconds, s_last_recording_second;
static TickType_t s_state_entered_at;
static int s_state, s_recovery;
enum { LOCAL_AWAITING_CONSENT, LOCAL_RECORDING, LOCAL_ERROR };
enum point { NONE, BEGIN, CONFIRM, AGORA, PROMPT, CLOCK, SD, START_CUE, PHONE };
static enum point injection;
static int begin_result, confirm_result, agora_result, clock_result, sd_result;
static unsigned begin_calls, confirms, agora_calls, prompts, clocks, sd_begins;
static unsigned local_cues, sequence, sd_order, cue_order, phone_order, mic_order;
static unsigned phone_begins, microphone_starts, aborts, error_calls, clears;
static bool microphone_active, phone_active, archive_open, archive_preserved;
static bool stream_active;
static void inject(enum point point) { if (injection == point) s_power_off_requested = true; }
static TickType_t xTaskGetTickCount(void) { return 1234; }
static int begin_recording_session(void) {
  ++begin_calls;
  inject(BEGIN);
  if (begin_result == ESP_OK) strcpy(s_cloud_session.session_id, "recording-under-test");
  return begin_result;
}
static void lantern_display_show(int screen, const char *detail) {
  assert(screen == LANTERN_SCREEN_CONNECTING && detail);
}
static int lantern_network_confirm_consent(test_session_t *session, bool yes,
                                            lantern_agora_transport_t *transport) {
  assert(session == &s_cloud_session && yes && transport);
  ++confirms;
  inject(CONFIRM);
  return confirm_result;
}
static void show_error(int recovery, const char *detail, const char *prompt) {
  assert(recovery >= 0 && detail && prompt);
  ++error_calls;
  s_state = LOCAL_ERROR;
}
static void lantern_transcript_reset(void) {}
static int lantern_agora_start(lantern_agora_transport_t *transport) {
  assert(transport);
  ++agora_calls;
  inject(AGORA);
  return agora_result;
}
static int lantern_network_play_prompt(const char *kind) {
  assert(!strcmp(kind, "local_recording"));
  ++prompts;
  inject(PROMPT);
  return ESP_OK;
}
static int quipus_play_prompt(quipus_prompt_t prompt) {
  assert(prompt==QUIPUS_PROMPT_RECORDING_STARTED && archive_open);
  assert(!microphone_active && !phone_active);
  ++local_cues; cue_order=++sequence; assert(sd_order < cue_order);
  inject(START_CUE); return ESP_OK;
}
static void lantern_audio_chime(int count) { assert(count > 0); }
static int lantern_network_capture_started(test_session_t *session) {
  assert(session == &s_cloud_session);
  ++clocks;
  inject(CLOCK);
  return clock_result;
}
static void lantern_sd_set_session(test_session_t *session) {
  assert(session == &s_cloud_session && !strcmp(session->owner_id, s_config.owner_id));
}
static int lantern_sd_recording_begin(const char *session_id) {
  assert(!strcmp(session_id, s_cloud_session.session_id));
  ++sd_begins; sd_order=++sequence;
  archive_open = sd_result == ESP_OK;
  inject(SD);
  return sd_result;
}
static int lantern_network_abort_session(test_session_t *session) {
  assert(session == &s_cloud_session);
  ++aborts;
  return ESP_OK;
}
static void clear_active_session(void) { ++clears; }
static int quipus_phone_audio_begin(const char *session_id) {
  assert(!strcmp(session_id, s_cloud_session.session_id));
  ++phone_begins; phone_order=++sequence;
  assert(cue_order && cue_order < phone_order);
  phone_active = true;
  inject(PHONE);
  return ESP_OK;
}
static void lantern_audio_set_recording(bool enabled) {
  if (enabled) { ++microphone_starts; mic_order=++sequence; assert(phone_order < mic_order); }
  microphone_active = enabled;
}
static void lantern_audio_set_streaming(bool enabled) { stream_active = enabled; }
static void show_recording_progress(void) { assert(microphone_active); }
static void lantern_wake_set_enabled(bool enabled) { assert(!enabled); }
static void lantern_agora_stop(void) { s_agora_active = false; }
static int quipus_phone_audio_stop(void) { phone_active = false; return ESP_OK; }
static bool quipus_phone_audio_idle(void) { return !phone_active; }
static bool lantern_sd_capture_active(void) { return archive_open; }
static int checkpoint_phone_timing(void) { return ESP_OK; }
static void lantern_sd_recording_abort(void) {
  assert(archive_open);
  archive_preserved = true;
  archive_open = false;
}

#include "recording_start_under_test.c"

static void reset_case(void) {
  memset(&s_cloud_session, 0, sizeof(s_cloud_session));
  strcpy(s_config.owner_id, "owner-under-test");
  s_power_off_requested = false;
  s_recording_connection_notice=true;
  s_agora_active = s_used_agora = s_sd_recording_active = s_sd_archive_required = false;
  s_transcript_uploaded = s_audio_uploaded = false;
  s_recording_duration_seconds = s_last_recording_second = 0;
  s_state = LOCAL_AWAITING_CONSENT;
  s_recovery = 0;
  injection = NONE;
  begin_result = confirm_result = agora_result = clock_result = sd_result = ESP_OK;
  begin_calls = confirms = agora_calls = prompts = clocks = sd_begins = 0;
  phone_begins = microphone_starts = aborts = error_calls = clears = 0;
  local_cues=sequence=sd_order=cue_order=phone_order=mic_order=0;
  microphone_active = phone_active = archive_open = archive_preserved = stream_active = false;
}
static void assert_not_recording(void) {
  assert(!microphone_active && microphone_starts == 0 && s_state != LOCAL_RECORDING);
}

int main(void) {
  reset_case();
  assert(accept_recording_consent() == ESP_OK);
  assert(microphone_starts == 1 && s_state == LOCAL_RECORDING && archive_open);
  assert(!s_recording_connection_notice);
  assert(begin_calls == 1 && confirms == 1 && clocks == 1 && sd_begins == 1);

  reset_case();
  s_cloud_session.offline_local = true;
  assert(accept_recording_consent() == ESP_OK);
  assert(microphone_starts == 1 && confirms == 0 && agora_calls == 0 && clocks == 0);

  reset_case();
  agora_result = ESP_FAIL;
  assert(accept_recording_consent() == ESP_OK);
  assert(microphone_starts == 1 && prompts == 1 && !stream_active && archive_open);

  reset_case();
  s_power_off_requested = true;
  assert(accept_recording_consent() != ESP_OK);
  assert_not_recording();
  assert(begin_calls == 0 && sd_begins == 0);

  for (enum point point = BEGIN; point <= PHONE; ++point) {
    reset_case();
    injection = point;
    if (point == PROMPT) agora_result = ESP_FAIL;
    assert(accept_recording_consent() != ESP_OK);
    assert(s_power_off_requested);
    assert_not_recording();
    if (point < SD) assert(sd_begins == 0);
    else {
      assert(sd_begins == 1 && !archive_open && archive_preserved);
      assert(!s_sd_recording_active && !phone_active && !stream_active);
    }
    // Requested shutdown must not invoke spoken error/retry work.
    assert(error_calls == 0 && aborts == 0);
  }

  // A failed blocking operation with a concurrent power request takes shutdown,
  // instead of playing a second error prompt or progressing toward recording.
  reset_case();
  injection = CONFIRM;
  confirm_result = ESP_FAIL;
  assert(accept_recording_consent() != ESP_OK);
  assert_not_recording();
  assert(error_calls == 0 && sd_begins == 0);
  reset_case();
  injection = CLOCK;
  clock_result = ESP_FAIL;
  assert(accept_recording_consent() != ESP_OK);
  assert_not_recording();
  assert(error_calls == 0 && sd_begins == 0);

  reset_case();
  begin_result = ESP_FAIL;
  assert(accept_recording_consent() != ESP_OK);
  assert_not_recording();
  assert(confirms == 0 && sd_begins == 0);
  reset_case();
  confirm_result = ESP_FAIL;
  assert(accept_recording_consent() != ESP_OK);
  assert_not_recording();
  assert(error_calls == 1 && sd_begins == 0);
  reset_case();
  clock_result = ESP_FAIL;
  assert(accept_recording_consent() != ESP_OK);
  assert_not_recording();
  assert(error_calls == 1 && sd_begins == 0);
  reset_case();
  sd_result = ESP_FAIL;
  assert(accept_recording_consent() != ESP_OK);
  assert_not_recording();
  assert(aborts == 1 && clears == 1 && error_calls == 1 && !archive_open);

  reset_case(); s_cloud_session.offline_local=true; sd_result=ESP_FAIL;
  assert(accept_recording_consent()!=ESP_OK);
  assert_not_recording();
  assert(aborts==0 && clears==1 && error_calls==1 && local_cues==0);

  puts("Actual recording acceptance and cleanup: 19 startup/shutdown cases passed");
  return 0;
}
