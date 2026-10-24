#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef int esp_err_t;
typedef unsigned TickType_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define TAG "delivery-host"
#include "delivery_types.h"
#include "quipus_sync_policy.h"
#define pdMS_TO_TICKS(ms) (ms)

static lantern_cloud_session_t s_cloud_session;
static bool s_agora_active, s_used_agora, s_transcript_uploaded, s_audio_uploaded;
static bool s_phone_uploaded, s_sd_archive_required;
static unsigned s_recording_duration_seconds;
static local_state_t s_state;
static recovery_action_t s_recovery;
static TickType_t s_state_entered_at, s_summary_retry_delay, s_last_summary_retry_at;
static char s_upload_notice_session[37], s_uploaded_notice_session[37];
static esp_err_t uploading_result, uploaded_result;
static unsigned starts, verified, chimes_one, chimes_two, clock_ms, saved_cues, ready_calls;
static unsigned idle_order;
static bool idle_wake;
static esp_err_t saved_result, skipped_result;
static unsigned skipped;
static unsigned sequence, display_order, voice_order, complete_calls;
static char screen_detail[96];
static lantern_screen_t displayed_screen;
static bool completing;
static unsigned fallback_buffer_reads;

static void test_log(const char *tag,const char *format,...) {
  assert(tag && format);
}
#define ESP_LOGI(...) test_log(__VA_ARGS__)
static unsigned lantern_audio_buffered_seconds(void) {
  ++fallback_buffer_reads; return 30;
}
static esp_err_t quipus_play_uploading_prompt(void) {
  ++starts; return uploading_result;
}
static esp_err_t quipus_play_uploaded_prompt(void) {
  ++verified; voice_order=++sequence;
  if(completing) {
    assert(s_state==LOCAL_COMPLETE && s_cloud_session.archive_verified);
    assert(s_cloud_session.session_id[0] && displayed_screen==LANTERN_SCREEN_COMPLETE);
    assert(display_order && display_order<voice_order);
  }
  return uploaded_result;
}
static esp_err_t quipus_play_prompt(quipus_prompt_t prompt) {
  assert(prompt==QUIPUS_PROMPT_SHORT_RECORDING_SKIPPED);
  ++skipped; voice_order=++sequence;
  if(completing) {
    assert(s_state==LOCAL_COMPLETE && s_cloud_session.archive_verified && s_cloud_session.discarded);
    assert(!strstr(screen_detail,"UPLOADED") && !strstr(screen_detail,"DASHBOARD"));
    assert(display_order && display_order<voice_order);
  }
  return skipped_result;
}
static esp_err_t quipus_play_saved_offline_prompt(void) {
  ++saved_cues; voice_order=++sequence;
  assert(s_state==LOCAL_COMPLETE && s_cloud_session.session_id[0]);
  assert(display_order<voice_order); return saved_result;
}
static void show_ready(void) {
  unsigned char zeros[sizeof(s_cloud_session)]={0};
  assert(!memcmp(&s_cloud_session,zeros,sizeof(zeros)));
  assert(!s_agora_active && !s_used_agora && !s_audio_uploaded);
  idle_order=++sequence; ++ready_calls;
  assert(idle_order>display_order && idle_order>voice_order);
  s_state=LOCAL_READY; s_recovery=RECOVERY_NONE; idle_wake=true;
}
static void lantern_audio_chime(int count) {
  assert(count==1 || count==2);
  if(count==1) ++chimes_one; else ++chimes_two;
}
static void lantern_display_show(lantern_screen_t screen,const char *detail) {
  displayed_screen=screen; display_order=++sequence;
  snprintf(screen_detail,sizeof(screen_detail),"%s",detail);
}
static TickType_t xTaskGetTickCount(void) { return clock_ms; }
#include "delivery_under_test.c"

static lantern_cloud_session_t session(const char *id,bool accepted) {
  lantern_cloud_session_t result={.archive_accepted=true,.archive_verified=accepted};
  snprintf(result.session_id,sizeof(result.session_id),"%s",id);
  return result;
}
static void reset(void) {
  clear_active_session();
  s_upload_notice_session[0]=s_uploaded_notice_session[0]='\0';
  uploading_result=uploaded_result=saved_result=skipped_result=ESP_OK; skipped=0;
  starts=verified=chimes_one=chimes_two=sequence=display_order=voice_order=0;
  clock_ms=7250; completing=false;
  saved_cues=ready_calls=idle_order=0; idle_wake=false;
  s_summary_retry_delay=s_last_summary_retry_at=0;
  fallback_buffer_reads=0; screen_detail[0]='\0';
}
static void begin_runtime(lantern_cloud_session_t recording) {
  s_cloud_session=recording;
  s_state=LOCAL_SAVING; s_recovery=RECOVERY_UPLOAD;
  s_agora_active=s_used_agora=s_transcript_uploaded=s_audio_uploaded=true;
  s_phone_uploaded=s_sd_archive_required=true;
  s_recording_duration_seconds=174;
}
static void complete(bool pending) {
  completing=true; session_complete(pending); completing=false; ++complete_calls;
  assert(s_state==LOCAL_READY && idle_wake && s_recovery==RECOVERY_NONE && s_state_entered_at==clock_ms);
  unsigned char zeros[sizeof(s_cloud_session)]={0};
  assert(!memcmp(&s_cloud_session,zeros,sizeof(zeros)));
  assert(!s_agora_active && !s_used_agora && !s_transcript_uploaded && !s_audio_uploaded);
  assert(!s_phone_uploaded && !s_sd_archive_required && s_recording_duration_seconds==0);
}
int main(void) {
  const char *a_id="11111111-1111-4111-8111-111111111111";
  const char *b_id="22222222-2222-4222-8222-222222222222";
  lantern_cloud_session_t a=session(a_id,false), b=session(b_id,true), empty={0};
  reset();
  announce_upload_started(NULL); announce_upload_started(&empty);
  announce_upload_verified(NULL); announce_upload_verified(&empty);
  announce_upload_verified(&a); assert(starts==0 && verified==0);
  // An accepted storage object without integrity verification is not success.
  a.archive_accepted=true; announce_upload_verified(&a); assert(verified==0);
  announce_upload_started(&a); announce_upload_started(&a);
  assert(starts==1 && !strcmp(s_upload_notice_session,a_id));
  announce_upload_verified(&a); assert(verified==0 && s_uploaded_notice_session[0]=='\0');
  a.archive_verified=true;
  announce_upload_verified(&a); announce_upload_verified(&a);
  assert(verified==1 && !strcmp(s_uploaded_notice_session,a_id));
  announce_upload_started(&a); assert(starts==1);
  announce_upload_started(&b); announce_upload_started(&b);
  announce_upload_verified(&b); announce_upload_verified(&b);
  assert(starts==2 && verified==2);
  assert(!strcmp(s_upload_notice_session,b_id) && !strcmp(s_uploaded_notice_session,b_id));
  // Local PCM failure produces one fallback chime, with no repeated notice on retry.
  reset(); uploading_result=ESP_FAIL;
  announce_upload_started(&a); announce_upload_started(&a);
  assert(starts==1 && chimes_one==1);
  uploaded_result=ESP_FAIL;
  announce_upload_verified(&a); announce_upload_verified(&a);
  assert(verified==1 && chimes_two==1);
  // Pending completion never falsely says uploaded or announces verified success.
  for(unsigned pending=0;pending<2;++pending) {
    reset(); a.archive_verified=false; begin_runtime(a); complete(pending!=0);
    assert(!strcmp(screen_detail,"AUDIO SENT - VERIFICATION PENDING"));
    assert(!strstr(screen_detail,"UPLOADED") && verified==0 && chimes_two==0);
    assert(fallback_buffer_reads==0);
  }
  // Both processed and queued summaries allow delivery speech only after verification.
  for(unsigned pending=0;pending<2;++pending) {
    reset(); a.archive_verified=true; begin_runtime(a); complete(pending!=0);
    assert(verified==1 && voice_order>display_order);
    assert(!strcmp(screen_detail,pending ? "UPLOADED - SUMMARY PROCESSING" : "UPLOADED TO DASHBOARD"));
    begin_runtime(a); complete(pending!=0);
    assert(verified==1); // Runtime cleanup must not erase the per-session notice guard.
    begin_runtime(b); complete(false); assert(verified==2);
  }
  reset(); a.archive_verified=true; uploaded_result=ESP_FAIL;
  begin_runtime(a); complete(false);
  assert(verified==1 && chimes_two==1);
  begin_runtime(a); complete(false); assert(verified==1 && chimes_two==1);
  reset(); a.archive_verified=false; begin_runtime(a);
  s_recording_duration_seconds=0; complete(true); assert(fallback_buffer_reads==1);
  for(unsigned failure=0;failure<2;++failure) {
    reset(); begin_runtime(a); saved_result=failure ? ESP_FAIL : ESP_OK;
    saved_for_later();
    assert(saved_cues==1 && ready_calls==1 && idle_wake && s_state==LOCAL_READY);
    assert(chimes_two==failure && verified==0);
    assert(s_summary_retry_delay==30000 && s_last_summary_retry_at==clock_ms);
    assert(!s_cloud_session.session_id[0] && idle_order>voice_order);
  }
  // A discarded short-silence receipt is verified but is not a dashboard
  // conversation. Neither the ordinary success cue nor caption may leak through.
  for(unsigned pending=0;pending<2;++pending) {
    reset(); a.archive_verified=true; a.discarded=true;
    begin_runtime(a); complete(pending!=0);
    assert(skipped==1 && verified==0 && !strcmp(screen_detail,"SHORT RECORDING SKIPPED"));
    begin_runtime(a); complete(pending!=0); assert(skipped==1 && verified==0);
    b.discarded=true; begin_runtime(b); complete(false); assert(skipped==2 && verified==0);
  }
  reset(); a.archive_verified=false; a.discarded=true;
  begin_runtime(a); complete(false);
  assert(skipped==0 && verified==0 && !strcmp(screen_detail,"AUDIO SENT - VERIFICATION PENDING"));
  reset(); a.archive_verified=true; a.discarded=true; skipped_result=ESP_FAIL;
  begin_runtime(a); complete(false); assert(skipped==1 && verified==0 && chimes_two==1);
  begin_runtime(a); complete(false); assert(skipped==1 && chimes_two==1);
  printf("PASS: verified discard selects neutral speech/caption once, verified-only delivery speech, retry guards, new sessions, pending captions, PCM fallback, cleanup-before-idle and immediate restored wake (%u completions)\n",complete_calls);
  return 0;
}
