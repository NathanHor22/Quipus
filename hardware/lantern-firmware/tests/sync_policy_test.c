#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "quipus_sync_policy.h"

#define LANTERN_HAS_TOUCHSCREEN 0
#ifndef LANTERN_HAS_SD_CARD
#define LANTERN_HAS_SD_CARD 1
#endif
#define LANTERN_PRIMARY_BUTTON_LABEL "MIDDLE"
#define LANTERN_SCREEN_BLUETOOTH 1
#define LANTERN_SCREEN_READY 2
#define LANTERN_SCREEN_SETUP 3
#define LANTERN_SCREEN_CONNECTING 4
#define RECOVERY_NONE 0
#define pdMS_TO_TICKS(ms) (ms)
typedef uint32_t TickType_t;
enum { LOCAL_READY, LOCAL_RECORDING, LOCAL_SAVING, LOCAL_ERROR, LOCAL_STATUS };
static int s_state, s_recovery;
static bool s_boot_complete, s_display_asleep, s_wake_available, s_wifi_screen_open;
static bool pending_wake;
static unsigned wake_disables, report_ends;
static bool s_summary_retry_pending, s_summary_retrying, s_power_off_requested;
static TickType_t now_ticks, s_last_interaction_at, s_last_summary_retry_at, s_state_entered_at;
static TickType_t s_summary_retry_delay;
static unsigned redraws;
static char last_detail[96];
typedef struct {
  bool setup_portal_active, wifi_connected, paired;
  char setup_ssid[33], setup_password[17], last_error[96];
} lantern_network_status_t;
static TickType_t xTaskGetTickCount(void) { return now_ticks; }
static void lantern_wake_set_enabled(bool enabled) { assert(!enabled); ++wake_disables; pending_wake=false; }
static void lantern_network_end_report(void) { ++report_ends; }
static void lantern_network_set_realtime(bool enabled) { assert(!enabled); }
static void lantern_network_get_status(lantern_network_status_t *network) {
  *network = (lantern_network_status_t){.wifi_connected = true, .paired = true};
}
static void lantern_bluetooth_passkey(char pin[7]) { pin[0] = '\0'; }
static void lantern_display_show(int screen, const char *detail) {
  assert(screen >= 1 && screen <= 4 && detail);
  snprintf(last_detail, sizeof(last_detail), "%s", detail);
  ++redraws;
}
static void lantern_display_show_setup(const char *ssid, const char *password, const char *error) {
  assert(ssid && password && error);
}
static bool lantern_sd_secure_ready(void) { return true; }
static void sync_idle_wake_listener(void) {}


typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define LANTERN_SCREEN_SAVING 2
#define LANTERN_SCREEN_COMPLETE 2
#define TAG "sync-test"
static void test_log(const char *tag,const char *format,...) { (void)tag; (void)format; }
#define ESP_LOGW test_log
typedef struct { char session_id[37]; bool offline_local, archive_verified, discarded; } lantern_cloud_session_t;
static struct { char owner_id[37], device_id[37]; } s_config;
#if !LANTERN_HAS_SD_CARD
static lantern_cloud_session_t s_pending_completion;
#endif
static int selected_result, close_result, upload_result, checkpoint_result, complete_result, cleanup_result;
static bool fixture_verified, fixture_matches, fixture_offline, fixture_stopped, fixture_uploaded, fixture_phone;
static unsigned completed, cleanups, selected_count, remaining, protected_only;
static TickType_t completion_duration;
static const char *esp_err_to_name(int error) { (void)error; return "fixture"; }
static bool quipus_phone_audio_idle(void) { return true; }
static bool lantern_sd_capture_active(void) { return false; }
static void stop_local_capture(void) {}
static unsigned lantern_sd_pending_count(void) { return remaining + protected_only; }
static unsigned lantern_sd_upload_pending_count(void) { return remaining; }
static esp_err_t lantern_sd_next_pending(const char *owner,const char *device,lantern_cloud_session_t *pending,bool *stopped,bool *audio,bool *phone) {
  (void)owner; (void)device; ++selected_count;
  *pending=(lantern_cloud_session_t){.session_id="same-persisted-id",.offline_local=fixture_offline};
  *stopped=fixture_stopped; *audio=fixture_uploaded; *phone=!fixture_phone; return selected_result;
}
static esp_err_t lantern_network_import_recording(lantern_cloud_session_t *pending) { (void)pending; return close_result; }
static esp_err_t lantern_network_stop_recording(lantern_cloud_session_t *pending) { (void)pending; return close_result; }
static esp_err_t lantern_sd_checkpoint(const lantern_cloud_session_t *pending,bool stopped,bool audio,bool phone) {
  (void)pending; (void)stopped; (void)audio; (void)phone; return checkpoint_result;
}
static void announce_upload_started(const lantern_cloud_session_t *pending) { (void)pending; }
static esp_err_t lantern_network_upload_audio(lantern_cloud_session_t *pending) { (void)pending; return upload_result; }
static unsigned lantern_sd_phone_size(void) { return fixture_phone ? 32044 : 0; }
static esp_err_t lantern_network_upload_phone(lantern_cloud_session_t *pending) { (void)pending; return upload_result; }
static esp_err_t lantern_network_complete_session(lantern_cloud_session_t *pending,bool *ready) {
  ++completed; now_ticks+=completion_duration; *ready=false;
  assert(!strcmp(pending->session_id,"same-persisted-id")); pending->archive_verified=fixture_verified; return complete_result;
}
static void announce_upload_verified(const lantern_cloud_session_t *pending) { assert(pending->archive_verified); }
static bool lantern_sd_recording_matches_session(const char *id) { assert(!strcmp(id,"same-persisted-id")); return fixture_matches; }
static int64_t lantern_network_trusted_time(void) { return 1780000000; }
static esp_err_t lantern_sd_recording_confirm_uploaded_at(int64_t at) {
  assert(at==1780000000); ++cleanups;
  if(cleanup_result==ESP_OK && remaining) --remaining;
  return cleanup_result;
}
static void show_ready(void);

#include "sync_under_test.c"

static void reset_case(void) {
  protected_only = 0;
  s_wifi_screen_open=pending_wake=false; wake_disables=report_ends=0;
  last_detail[0] = 0;
  now_ticks = s_last_interaction_at = s_last_summary_retry_at = s_state_entered_at = 0;
  s_state = LOCAL_READY;
  s_recovery = RECOVERY_NONE;
  s_boot_complete = s_summary_retry_pending = s_wake_available = true;
  s_display_asleep = s_summary_retrying = s_power_off_requested = false;
  redraws = 0;
  s_summary_retry_delay=30000;
  selected_result=close_result=upload_result=checkpoint_result=complete_result=cleanup_result=ESP_OK;
  fixture_verified=false; fixture_matches=true; fixture_offline=true;
  fixture_stopped=fixture_uploaded=true; fixture_phone=false;
  completed=cleanups=selected_count=0; remaining=2; completion_duration=6000;
}
int main(void) {
#if !LANTERN_HAS_SD_CARD
  reset_case(); now_ticks=60000; s_summary_retry_delay=2000;
  snprintf(s_pending_completion.session_id,sizeof(s_pending_completion.session_id),"same-persisted-id");
  complete_result=ESP_FAIL;
  retry_pending_summary(false);
  assert(s_summary_retry_pending && !s_summary_retrying && s_last_summary_retry_at==66000);
  assert(s_summary_retry_delay==30000 && completed==1 && selected_count==0);
  now_ticks=95999; assert(!production_sync_due());
  now_ticks=96000; assert(production_sync_due());
  complete_result=ESP_OK; retry_pending_summary(false);
  assert(!s_summary_retry_pending && !s_pending_completion.session_id[0]);
  assert(s_summary_retry_delay==30000 && selected_count==0 && cleanups==0);
  puts("PASS: legacy RAM completion retry retains 30s failure backoff and END timestamps");
  return 0;
#endif
  // The actual READY transition must preserve an already-latched wake during
  // heartbeat repaints, while a real report exit cancels obsolete speech once.
  reset_case(); pending_wake=true;
  show_ready(); show_ready();
  assert(pending_wake && wake_disables==0 && report_ends==0);
  s_state=LOCAL_STATUS; show_ready();
  assert(!pending_wake && wake_disables==1 && report_ends==1 && s_state==LOCAL_READY);

  // Reproduce normal successful heartbeat callbacks redrawing READY every 15 s.
  reset_case();
  unsigned attempts = 0;
  for (now_ticks = 15000; now_ticks <= 120000; now_ticks += 15000) {
    show_ready();
    assert(s_last_interaction_at == 0);
    if (production_sync_due()) {
      ++attempts;
      s_last_summary_retry_at = now_ticks;
    }
  }
  assert(redraws == 8 && attempts == 4);

  // Real user activity restarts the quiet interval; heartbeats do not.
  reset_case();
  now_ticks = s_last_interaction_at = 29000;
  now_ticks = 30000; show_ready(); assert(!production_sync_due());
  now_ticks = 45000; show_ready(); assert(!production_sync_due());
  now_ticks = 58999; assert(!production_sync_due());
  now_ticks = 59000; assert(production_sync_due());
  assert(s_last_interaction_at == 29000);

  // The retry spacing and all existing phase/shutdown gates remain enforced.
  reset_case();
  now_ticks = 60000; s_last_summary_retry_at = 30001;
  assert(!production_sync_due());
  now_ticks = 60001; assert(production_sync_due());
  s_summary_retry_pending = false; assert(!production_sync_due());
  s_summary_retry_pending = true; s_summary_retrying = true; assert(!production_sync_due());
  s_summary_retrying = false; s_boot_complete = false; assert(!production_sync_due());
  s_boot_complete = true; s_power_off_requested = true; assert(!production_sync_due());
  s_power_off_requested = false;
  const int blocked_states[] = {LOCAL_RECORDING, LOCAL_SAVING, LOCAL_ERROR, LOCAL_STATUS};
  for (unsigned i = 0; i < sizeof(blocked_states) / sizeof(blocked_states[0]); ++i) {
    s_state = blocked_states[i]; assert(!production_sync_due());
  }
  s_state = LOCAL_READY; assert(production_sync_due());

  // Tick subtraction remains valid when the 32-bit RTOS clock wraps.
  reset_case();
  now_ticks = 9999;
  s_last_interaction_at = s_last_summary_retry_at = UINT32_MAX - 20000;
  assert(production_sync_due());
  now_ticks = 9998; assert(!production_sync_due());
  assert(!quipus_sync_due(NULL, 30000));

  // Accepted completion polls its SAME idempotent receipt five seconds after
  // the actual network attempt ENDS; no cleanup or newer archive is advanced.
  reset_case(); now_ticks=60000;
  retry_pending_summary(false);
  assert(completed==1 && selected_count==1 && cleanups==0 && remaining==2);
  assert(s_last_summary_retry_at==66000 && s_summary_retry_delay==5000);
  now_ticks=70999; assert(!production_sync_due());
  now_ticks=71000; assert(production_sync_due());
  retry_pending_summary(false);
  assert(completed==2 && selected_count==2 && cleanups==0 && remaining==2);

  // Only a verified receipt AND matching successful local cleanup permits the
  // next queued archive after two seconds, still respecting real user quiet.
  reset_case(); now_ticks=60000; fixture_verified=true;
  retry_pending_summary(false);
  assert(cleanups==1 && remaining==1 && s_summary_retry_delay==2000);
  assert(s_last_summary_retry_at==66000);
  now_ticks=67999; assert(!production_sync_due());
  now_ticks=68000; assert(production_sync_due());
  s_last_interaction_at=now_ticks; assert(!production_sync_due());
  now_ticks+=29999; assert(!production_sync_due());
  ++now_ticks; assert(production_sync_due());

  // Protected evidence without upload candidates must remain visible without
  // scheduling fictional uploads forever or weakening the private-data guard.
  reset_case(); now_ticks=60000; fixture_verified=true;
  remaining=1; protected_only=15;
  retry_pending_summary(false);
  assert(remaining==0 && lantern_sd_pending_count()==15);
  assert(!s_summary_retry_pending);
  assert(!strcmp(last_detail,"READY - SAY COMPUTER"));
  now_ticks+=60000; assert(!production_sync_due());

  // Any failed network/checkpoint/cleanup/matching stage retains thirty-second
  // backoff. A prior fast schedule cannot leak through a later failed attempt.
  for(unsigned failure=0;failure<8;++failure) {
    reset_case(); now_ticks=60000; s_summary_retry_delay=2000;
    if(failure==0) complete_result=ESP_FAIL;
    if(failure==1) checkpoint_result=ESP_FAIL;
    if(failure==2) { fixture_verified=true; cleanup_result=ESP_FAIL; }
    if(failure==3) { fixture_verified=true; fixture_matches=false; }
    if(failure==4) { fixture_stopped=false; close_result=ESP_FAIL; }
    if(failure==5) { fixture_uploaded=false; upload_result=ESP_FAIL; }
    if(failure==6) { fixture_phone=true; upload_result=ESP_FAIL; }
    if(failure==7) selected_result=ESP_FAIL;
    retry_pending_summary(false);
    assert(s_summary_retry_delay==30000 && remaining==2 && !s_summary_retrying);
    TickType_t ended=now_ticks; assert(s_last_summary_retry_at==ended);
    now_ticks=ended+29999; assert(!production_sync_due());
    now_ticks=ended+30000; assert(production_sync_due());
  }
  puts("PASS: actual READY/heartbeat and retry lifecycle; 5s same-receipt polls, 2s verified cleanup advance, 30s failures/user quiet, END timestamps, guards and tick wrap");
  return 0;
}
