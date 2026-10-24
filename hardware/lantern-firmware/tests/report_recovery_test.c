/* The controller is production code; only storage/network/audio edges are stubbed. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
typedef int esp_err_t;
typedef unsigned TickType_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NOT_FOUND -2
#define ESP_ERR_INVALID_STATE -3
#define LANTERN_HAS_SD_CARD TEST_SD_CARD
#define LANTERN_HAS_TOUCHSCREEN 0
#define ESP_LOGE(...) ((void)0)
#define ESP_LOGW(...) ((void)0)
#define pdMS_TO_TICKS(ms) (ms)
#include "report_recovery_types.h"

static local_state_t s_state;
static recovery_action_t s_recovery, s_announced_recovery;
static TickType_t s_state_entered_at, s_error_announced_at, ticks;
static bool s_sd_recording_active, s_agora_active, s_boot_complete;
static bool s_display_asleep, s_wifi_screen_open, s_wake_available, s_power_off_requested;
static char s_last_error_detail[96], s_announced_error[96];
static struct { char owner_id[37], device_id[37]; } s_config;
static int s_battery_level=75;
static lantern_network_status_t network;
static lantern_cloud_session_t pending, s_pending_completion;
static bool capture_active, audio_recording, phone_idle, secure, queued, stopped, audio_uploaded, phone_uploaded;
static bool cloud_stopped, wake, realtime, durable_retry_pending;
static esp_err_t select_result, receipt_result, checkpoint_result, briefing_result, prompt_result;
static unsigned selects, stops, imports, checkpoints, briefings, dialogues;
static unsigned aborts, record_stops, stream_stops, phone_stops, ready_wake_updates, prompts, chimes;
static unsigned report_exits, sequence, receipt_order, checkpoint_order, briefing_order, cases;
static unsigned cache_calls;
static esp_err_t cache_result;
static bool power_during_cache;
static uint8_t sd_archive[32], ram_archive[32];
static char displayed[96];

static TickType_t xTaskGetTickCount(void) { return ticks; }
static void lantern_wake_set_enabled(bool enabled) { wake=enabled; }
static void lantern_network_set_realtime(bool enabled) { realtime=enabled; }
static bool lantern_audio_is_recording(void) { return audio_recording; }
static void lantern_audio_set_recording(bool enabled) { assert(!enabled); audio_recording=false; ++record_stops; }
static void lantern_audio_set_streaming(bool enabled) { assert(!enabled); ++stream_stops; }
static void lantern_agora_stop(void) { s_agora_active=false; }
static esp_err_t quipus_phone_audio_stop(void) { ++phone_stops; return ESP_OK; }
static bool quipus_phone_audio_idle(void) { return phone_idle; }
static bool lantern_sd_capture_active(void) { return capture_active; }
static esp_err_t checkpoint_phone_timing(void) { return ESP_OK; }
static void lantern_sd_recording_abort(void) { ++aborts; }
static bool lantern_sd_secure_ready(void) { return secure; }
#if LANTERN_HAS_SD_CARD
static size_t lantern_sd_upload_pending_count(void) { return queued ? 1U : 0U; }
static esp_err_t lantern_sd_next_pending(const char *owner, const char *device,
    lantern_cloud_session_t *out, bool *out_stopped, bool *out_audio, bool *out_phone) {
  assert(!strcmp(owner,"fixture-owner") && !strcmp(device,"fixture-device"));
  ++selects; if(select_result!=ESP_OK) return select_result;
  *out=pending; *out_stopped=stopped; *out_audio=audio_uploaded; *out_phone=phone_uploaded;
  return ESP_OK;
}
static esp_err_t lantern_network_stop_recording(lantern_cloud_session_t *session) {
  assert(!session->offline_local && !strcmp(session->session_id,pending.session_id));
  ++stops; receipt_order=++sequence;
  if(receipt_result!=ESP_OK) return receipt_result;
  cloud_stopped=true; ++session->version; return ESP_OK;
}
static esp_err_t lantern_network_import_recording(lantern_cloud_session_t *session) {
  assert(session->offline_local && !strcmp(session->session_id,pending.session_id));
  ++imports; receipt_order=++sequence;
  if(receipt_result!=ESP_OK) return receipt_result;
  cloud_stopped=true; session->offline_local=false; ++session->version; return ESP_OK;
}
static esp_err_t lantern_sd_checkpoint(const lantern_cloud_session_t *session,
                                      bool new_stopped, bool new_audio, bool new_phone) {
  assert(cloud_stopped && new_stopped && new_audio==audio_uploaded && new_phone==phone_uploaded);
  assert(!strcmp(session->session_id,pending.session_id));
  ++checkpoints; checkpoint_order=++sequence;
  if(checkpoint_result!=ESP_OK) return checkpoint_result;
  pending=*session; stopped=new_stopped; return ESP_OK;
}
#endif
static void lantern_network_get_status(lantern_network_status_t *out) { *out=network; }
static void lantern_bluetooth_passkey(char out[7]) { out[0]=0; }
static void lantern_network_end_report(void) { ++report_exits; }
static void lantern_display_show(lantern_screen_t screen, const char *detail) {
  assert(screen==LANTERN_SCREEN_READY || screen==LANTERN_SCREEN_STATUS ||
         screen==LANTERN_SCREEN_SETUP || screen==LANTERN_SCREEN_CONNECTING || screen==LANTERN_SCREEN_BLUETOOTH);
  snprintf(displayed,sizeof(displayed),"%s",detail);
}
static void lantern_display_show_setup(const char *ssid,const char *password,const char *error) { assert(ssid && password && error); }
static void sync_idle_wake_listener(void) {
  assert(s_state==LOCAL_READY || s_state==LOCAL_ERROR); ++ready_wake_updates; wake=true;
}
static esp_err_t quipus_play_prompt(quipus_prompt_t prompt) {
  assert(prompt==QUIPUS_PROMPT_VOICE_UNAVAILABLE || prompt==QUIPUS_PROMPT_ERROR || prompt==QUIPUS_PROMPT_SD_FAILURE || prompt==QUIPUS_PROMPT_REPORT_OFFLINE);
  ++prompts; return prompt_result;
}
static void lantern_audio_chime(unsigned count) { assert(count==3); ++chimes; }
static esp_err_t lantern_network_play_briefing(const char *kind,int battery) {
  assert(!strcmp(kind,"status") && battery==75 && s_state==LOCAL_STATUS && realtime);
  ++briefings; briefing_order=++sequence; return briefing_result;
}
static esp_err_t lantern_network_play_cached_report(void) {
  assert(s_state==LOCAL_STATUS&&!network.wifi_connected);++cache_calls;
  if(power_during_cache)s_power_off_requested=true;
  return cache_result;
}
static void report_dialogue(esp_err_t result) {
  ++dialogues;
  if(result!=ESP_OK) show_error(RECOVERY_STATUS,"REPORT UNAVAILABLE","status_error");
}
#include "report_recovery_under_test.c"

static void preserve(void) {
  for(unsigned i=0;i<32;++i) { assert(sd_archive[i]==(uint8_t)(i+31)); assert(ram_archive[i]==(uint8_t)(i+91)); }
  assert(!strcmp(s_pending_completion.session_id,"ram-pending-session"));
  assert(durable_retry_pending);
}
static void reset(void) {
  s_state=LOCAL_READY; s_recovery=s_announced_recovery=RECOVERY_NONE;
  ticks=1000; s_state_entered_at=s_error_announced_at=0;
  s_sd_recording_active=s_agora_active=s_display_asleep=s_wifi_screen_open=false;
  s_boot_complete=s_wake_available=true; s_last_error_detail[0]=s_announced_error[0]=0;
  strcpy(s_config.owner_id,"fixture-owner"); strcpy(s_config.device_id,"fixture-device");
  memset(&network,0,sizeof(network)); network.wifi_connected=network.paired=true;
  memset(&pending,0,sizeof(pending)); strcpy(pending.session_id,"queued-recording"); pending.version=4;
  memset(&s_pending_completion,0,sizeof(s_pending_completion)); strcpy(s_pending_completion.session_id,"ram-pending-session");
  capture_active=audio_recording=stopped=audio_uploaded=phone_uploaded=cloud_stopped=false;
  phone_idle=secure=queued=wake=durable_retry_pending=true; realtime=false;
  select_result=receipt_result=checkpoint_result=briefing_result=prompt_result=ESP_OK;
  selects=stops=imports=checkpoints=briefings=dialogues=0;
  aborts=record_stops=stream_stops=phone_stops=ready_wake_updates=prompts=chimes=0;
  report_exits=sequence=receipt_order=checkpoint_order=briefing_order=0;
  for(unsigned i=0;i<32;++i) { sd_archive[i]=(uint8_t)(i+31); ram_archive[i]=(uint8_t)(i+91); }
  displayed[0]=0; s_power_off_requested=power_during_cache=false; cache_calls=0; cache_result=ESP_OK;
}
static void no_receipt_work(void) { assert(selects==0 && stops==0 && imports==0 && checkpoints==0); preserve(); ++cases; }
static void receipt_tests(void) {
#if LANTERN_HAS_SD_CARD
  for(unsigned offline=0;offline<2;++offline) for(unsigned flags=0;flags<4;++flags) {
    reset(); pending.offline_local=offline; audio_uploaded=(flags&1)!=0; phone_uploaded=(flags&2)!=0;
    play_status_report();
    assert(selects==1 && stops==!offline && imports==offline && checkpoints==1 && stopped);
    assert(briefings==1 && dialogues==1 && receipt_order<checkpoint_order && checkpoint_order<briefing_order);
    assert(pending.version==5 && !pending.offline_local && queued && aborts==0);
    preserve(); ++cases;
  }
  reset(); stopped=true; assert(reconcile_report_capture_receipt()==ESP_OK);
  assert(selects==1 && stops==0 && imports==0 && checkpoints==0); preserve(); ++cases;
  reset(); queued=false; assert(reconcile_report_capture_receipt()==ESP_OK); no_receipt_work();
  reset(); secure=false; assert(reconcile_report_capture_receipt()==ESP_OK); no_receipt_work();
  for(unsigned writer=0;writer<4;++writer) {
    reset();
    if(writer==0) s_state=LOCAL_RECORDING;
    if(writer==1) s_sd_recording_active=true;
    if(writer==2) capture_active=true;
    if(writer==3) phone_idle=false;
    assert(reconcile_report_capture_receipt()==ESP_ERR_INVALID_STATE); no_receipt_work();
  }
  reset(); select_result=ESP_ERR_NOT_FOUND; assert(reconcile_report_capture_receipt()==ESP_OK);
  assert(selects==1 && stops==0 && checkpoints==0); preserve(); ++cases;
  reset(); select_result=ESP_FAIL; assert(reconcile_report_capture_receipt()==ESP_FAIL);
  assert(selects==1 && stops==0 && checkpoints==0); preserve(); ++cases;
  reset(); receipt_result=ESP_FAIL; play_status_report();
  assert(stops==1 && checkpoints==0 && !stopped && queued && briefings==1); preserve(); ++cases;
  reset(); checkpoint_result=ESP_FAIL; play_status_report();
  assert(stops==1 && checkpoints==1 && !stopped && pending.version==4 && queued && briefings==1);
  preserve(); ++cases;
  checkpoint_result=ESP_OK;
  assert(reconcile_report_capture_receipt()==ESP_OK);
  assert(stops==2 && checkpoints==2 && stopped && queued && pending.version==5);
  preserve(); ++cases;
#else
  reset(); assert(reconcile_report_capture_receipt()==ESP_OK); no_receipt_work();
  play_status_report(); assert(briefings==1 && dialogues==1); no_receipt_work();
#endif
}
static void report_entry_gates(void) {
  for(unsigned gate=0;gate<7;++gate) {
    reset();
    if(gate==0) s_state=LOCAL_RECORDING;
    if(gate==1) audio_recording=true;
    if(gate==2) s_sd_recording_active=true;
    if(gate==3) capture_active=true;
    if(gate==4) phone_idle=false;
    if(gate==5) s_power_off_requested=true;
    if(gate==6) { s_power_off_requested=true; network.wifi_connected=false; }
    local_state_t before=s_state;
    play_status_report();
    assert(s_state==before && wake && !realtime && !displayed[0]);
    assert(cache_calls==0 && prompts==0 && briefings==0 && dialogues==0 && record_stops==0 && stream_stops==0 && phone_stops==0 && aborts==0);
    no_receipt_work();
  }
}
static void read_only_error_tests(void) {
  const recovery_action_t read_only[]={RECOVERY_COMMAND,RECOVERY_STATUS};
  for(unsigned i=0;i<2;++i) {
    reset(); s_state=LOCAL_STATUS;
    show_error(read_only[i],"SERVICE UNAVAILABLE","status_error");
    assert(s_state==LOCAL_READY && s_recovery==RECOVERY_NONE && wake && !realtime);
    assert(prompts==1 && chimes==0 && report_exits==1 && ready_wake_updates==1);
    assert(record_stops==1 && stream_stops==1 && phone_stops==1 && aborts==0);
    assert(!strcmp(s_last_error_detail,"SERVICE UNAVAILABLE")); preserve(); ++cases;
    show_error(read_only[i],"SERVICE UNAVAILABLE","status_error");
    assert(prompts==1 && s_state==LOCAL_READY); preserve(); ++cases;
  }
  reset(); briefing_result=ESP_FAIL; play_status_report();
  assert(briefings==1 && dialogues==1 && s_state==LOCAL_READY && wake && queued); preserve(); ++cases;
  reset(); prompt_result=ESP_FAIL;
  show_error(RECOVERY_STATUS,"REPORT UNAVAILABLE",NULL);
  assert(s_state==LOCAL_READY && chimes==1); preserve(); ++cases;
  const recovery_action_t guarded[]={RECOVERY_UPLOAD,RECOVERY_STOP,RECOVERY_SUMMARY,RECOVERY_CONSENT_CAPTURE};
  for(unsigned i=0;i<4;++i) {
    reset(); show_error(guarded[i],"PENDING AUDIO RETAINED",NULL);
    assert(s_state==LOCAL_ERROR && s_recovery==guarded[i] && report_exits==0);
    preserve(); ++cases;
  }
}
static void offline_cached_report_tests(void) {
  reset();network.wifi_connected=false;play_status_report();
  assert(cache_calls==1&&briefings==0&&dialogues==0&&s_state==LOCAL_READY&&prompts==0);
  no_receipt_work();
  reset();network.wifi_connected=false;cache_result=ESP_ERR_NOT_FOUND;play_status_report();
  assert(cache_calls==1&&briefings==0&&dialogues==0&&s_state==LOCAL_READY&&prompts==1);
  no_receipt_work();
  // A deliberate stop is an idle transition, never an offline failure notice.
  reset();network.wifi_connected=false;cache_result=LANTERN_REPORT_INTERRUPTED;play_status_report();
  assert(cache_calls==1&&briefings==0&&dialogues==0&&s_state==LOCAL_READY&&prompts==0);
  assert(ready_wake_updates==1&&report_exits==1);no_receipt_work();
  reset();network.wifi_connected=false;cache_result=ESP_FAIL;power_during_cache=true;play_status_report();
  assert(s_power_off_requested&&cache_calls==1&&briefings==0&&dialogues==0&&prompts==0);
  assert(ready_wake_updates==0);no_receipt_work();
}
int main(void) {
  receipt_tests(); report_entry_gates(); read_only_error_tests(); offline_cached_report_tests();
  printf("Report receipt ordering, writer refusal, retained queue and read-only recovery passed: %u cases (SD=%d)\n",cases,LANTERN_HAS_SD_CARD);
  return 0;
}
