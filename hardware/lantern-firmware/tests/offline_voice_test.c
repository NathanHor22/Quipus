/* Actual controller functions; inference, I2S, SD and HTTP boundaries are mocks. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "quipus_local_recognizer.h"
#include "prompt_enum_under_test.h"
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_STATE -2
#define ESP_ERR_INVALID_ARG -3
#define ESP_ERR_NOT_SUPPORTED -4
#define ESP_ERR_INVALID_SIZE -5
#define ESP_ERR_NOT_FOUND -6
#define LANTERN_REPORT_INTERRUPTED -7
#define LANTERN_HAS_SD_CARD TEST_SD_CARD
#define LANTERN_MIC_SAMPLE_RATE 16000
#define pdMS_TO_TICKS(ms) (ms)
#define ESP_ERROR_CHECK_WITHOUT_ABORT(x) ((void)(x))
#define ESP_LOGI(...) ((void)0)
#define ESP_LOGW(...) ((void)0)
#define ESP_LOGE(...) ((void)0)
#define TAG "offline-voice-test"
typedef unsigned TickType_t;
enum {LOCAL_READY,LOCAL_AWAITING_CONSENT,LOCAL_RECORDING,LOCAL_ERROR,LOCAL_COMMAND_LISTENING,LOCAL_COMMAND_PROCESSING};
enum {RECOVERY_NONE,RECOVERY_SESSION_START,RECOVERY_RECORDING_START,RECOVERY_COMMAND};
enum {LANTERN_SCREEN_CONNECTING,LANTERN_SCREEN_CONSENT,LANTERN_SCREEN_LISTENING,LANTERN_SCREEN_UNDERSTANDING};
typedef struct {bool wifi_connected,paired;} lantern_network_status_t;
typedef struct {bool offline_local;char session_id[37],owner_id[37],local_date[12],local_time[16];} lantern_cloud_session_t;
typedef struct {int unused;} lantern_agora_transport_t;
static lantern_cloud_session_t s_cloud_session;
static struct {char owner_id[37];} s_config;
static lantern_network_status_t network;
static int s_state,s_recovery,s_battery_level=75;
static bool s_power_off_requested,s_agora_active,s_used_agora,s_sd_recording_active,s_sd_archive_required;
static bool s_transcript_uploaded,s_audio_uploaded,s_recording_connection_notice;
static unsigned s_recording_duration_seconds,s_last_recording_second;
static TickType_t s_state_entered_at;
static int16_t scratch[QUIPUS_LOCAL_MAX_SAMPLES];
static int16_t *s_local_voice_samples=scratch;
static bool available,secure,sd_open,mic,phone,heard[8],short_copy;
static esp_err_t infer_results[8],cloud_result,begin_result,sd_result,prompt_result,remount_result;
static quipus_local_intent_t answers[8];
static size_t captured_samples[8],buffered,last_copy_offset,last_copy_count;
static bool capture_early_silence[8];
static unsigned capture_duration[8],full_captures,short_captures;
static unsigned capture_at,current_capture,classifications,navigation_classifications,consent_classifications,clears,cloud_calls,cloud_begins,offline_begins,remounts;
static unsigned cloud_consent_calls,cloud_command_calls;
static const char *cloud_consent_intents[8];
static unsigned prompts[QUIPUS_PROMPT_COUNT],consent_questions,ready_calls,errors,unclear,reports,report_dialogues;
static unsigned confirms,agora_calls,capture_receipts,aborts,sd_begins,phone_begins,mic_starts;
static unsigned ticks,sequence,manifest_order,start_cue_order,phone_order,mic_order;
static const char *cloud_intent;
enum inject {NOTHING,QUESTION,CAPTURE,INFER,BEGIN,START_CUE,PHONE};
static enum inject inject_at;
static void inject(enum inject point) {if(inject_at==point)s_power_off_requested=true;}
static TickType_t xTaskGetTickCount(void) {return ticks;}
static int64_t esp_timer_get_time(void) {return (int64_t)ticks*1000;}
static void vTaskDelay(unsigned ms) {ticks+=ms;}
static void lantern_network_get_status(lantern_network_status_t *out) {*out=network;}
static void lantern_display_show(int screen,const char *text) {(void)screen;assert(text);}
static void lantern_wake_set_enabled(bool enabled) {assert(!enabled);}
static void lantern_network_set_realtime(bool enabled) {assert(enabled);}
static void clear_active_session(void) {memset(&s_cloud_session,0,sizeof(s_cloud_session));}
static void show_ready(void) {s_state=LOCAL_READY;++ready_calls;}
static void show_error(int recovery,const char *detail,const char *prompt) {(void)recovery;(void)prompt;assert(detail);++errors;s_state=LOCAL_ERROR;}
static bool ready_for_cloud_action(void) {return network.wifi_connected&&network.paired;}
static void command_not_recognised(void) {++unclear;show_ready();}
static void play_status_report(void) {++reports;show_ready();}
static void report_dialogue(esp_err_t result) {(void)result;++report_dialogues;show_ready();}
static void open_wifi_screen(void) {show_ready();}
bool quipus_local_recognizer_available(void) {return available;}
static size_t lantern_audio_buffered_samples(void) {return buffered;}
static size_t lantern_audio_copy_samples(int16_t *out,size_t offset,size_t count) {
  assert(out==scratch&&count<=QUIPUS_LOCAL_MAX_SAMPLES&&offset+count==buffered);
  last_copy_offset=offset;last_copy_count=count;
  for(size_t i=0;i<count;++i)out[i]=123;
  return short_copy ? count-1:count;
}
static esp_err_t classify_mock(const int16_t *samples,size_t count,quipus_local_result_t *out,bool navigation) {
  assert(samples==scratch&&count>0&&count<=QUIPUS_LOCAL_MAX_SAMPLES);
  for(size_t i=0;i<count;++i)assert(samples[i]==123);
  ++classifications;
  if(navigation)++navigation_classifications;else ++consent_classifications;
  out->intent=answers[current_capture];out->confidence=240;out->windows=10;
  inject(INFER);return infer_results[current_capture];
}
esp_err_t quipus_local_recognizer_classify(const int16_t *samples,size_t count,quipus_local_result_t *out) {
  return classify_mock(samples,count,out,false);
}
esp_err_t quipus_local_recognizer_classify_navigation(const int16_t *samples,size_t count,quipus_local_result_t *out) {
  return classify_mock(samples,count,out,true);
}
static void lantern_audio_clear_private_buffer(void) {++clears;buffered=0;}
static bool capture_utterance(unsigned ms,bool early_silence) {
  assert(ms==5000&&capture_at<8&&!mic&&!phone);
  // Only strict consent requires the full activity-validation window.
  // Non-authorizing menu navigation and online commands use bounded STT capture.
  assert(early_silence==(s_state!=LOCAL_AWAITING_CONSENT));
  capture_early_silence[capture_at]=early_silence;
  capture_duration[capture_at]=ms;
  if(early_silence)++short_captures;else ++full_captures;
  assert(!s_cloud_session.session_id[0]);
  current_capture=capture_at++;buffered=captured_samples[current_capture];inject(CAPTURE);
  return heard[current_capture];
}
static bool capture_short_utterance(unsigned ms) {return capture_utterance(ms,true);}
static void lantern_audio_chime(unsigned n) {assert(n>0);}
static esp_err_t quipus_play_consent_prompt(void) {++consent_questions;assert(!mic&&!phone);inject(QUESTION);return prompt_result;}
static esp_err_t quipus_play_prompt(quipus_prompt_t prompt) {
  assert(prompt<QUIPUS_PROMPT_COUNT);++prompts[prompt];
  if(prompt==QUIPUS_PROMPT_RECORDING_STARTED) {
    assert(sd_open||!TEST_SD_CARD);assert(!mic&&!phone);
    start_cue_order=++sequence;assert(manifest_order<start_cue_order);inject(START_CUE);
  } else if(prompt==QUIPUS_PROMPT_OFFLINE_RECORD_CHOICE||prompt==QUIPUS_PROMPT_OFFLINE_REPORT_CHOICE) {
    inject(QUESTION);
  }
  return prompt_result;
}
static esp_err_t lantern_network_run_voice_command(const char *context,int battery,char *intent,size_t capacity) {
  assert(context&&battery==75&&network.wifi_connected);++cloud_calls;
  bool consent=!strcmp(context,"consent")||!strcmp(context,"consent_retry");
  if(consent)++cloud_consent_calls;else ++cloud_command_calls;
  assert(buffered>0);snprintf(intent,capacity,"%s",consent?cloud_consent_intents[current_capture]:cloud_intent);return cloud_result;
}
#if LANTERN_HAS_SD_CARD
static bool lantern_sd_secure_ready(void) {return secure;}
static esp_err_t lantern_sd_init(void *status) {assert(!status);++remounts;if(remount_result==ESP_OK)secure=true;return remount_result;}
static esp_err_t lantern_network_begin_offline(lantern_cloud_session_t *out) {
  ++offline_begins;inject(BEGIN);assert(out==&s_cloud_session&&secure);
  if(begin_result==ESP_OK){out->offline_local=true;strcpy(out->session_id,"local-durable-id");}return begin_result;
}
#else
static esp_err_t lantern_network_begin_quick(lantern_cloud_session_t *out) {
  ++cloud_begins;inject(BEGIN);assert(out==&s_cloud_session);
  if(begin_result==ESP_OK){out->offline_local=false;strcpy(out->session_id,"cloud-id");}return begin_result;
}
#endif
static esp_err_t lantern_network_confirm_consent(lantern_cloud_session_t *session,bool yes,lantern_agora_transport_t *transport) {
  assert(session==&s_cloud_session);++confirms;
  assert(yes ? transport!=NULL:transport==NULL);return ESP_OK;
}
static void lantern_network_restart_session(void) {assert(false);}
static void lantern_transcript_reset(void) {}
static esp_err_t lantern_agora_start(lantern_agora_transport_t *transport) {assert(transport);++agora_calls;return ESP_OK;}
static esp_err_t lantern_network_play_prompt(const char *name) {assert(name);return ESP_OK;}
static esp_err_t lantern_network_capture_started(lantern_cloud_session_t *session) {assert(session);++capture_receipts;return ESP_OK;}
static void lantern_sd_set_session(lantern_cloud_session_t *session) {assert(session==&s_cloud_session&&!strcmp(session->owner_id,s_config.owner_id));}
static esp_err_t lantern_sd_recording_begin(const char *id) {
  assert(!strcmp(id,s_cloud_session.session_id));++sd_begins;manifest_order=++sequence;sd_open=sd_result==ESP_OK;return sd_result;
}
#if LANTERN_HAS_SD_CARD
static esp_err_t lantern_network_abort_session(lantern_cloud_session_t *session) {assert(session);++aborts;return ESP_OK;}
#endif
static esp_err_t quipus_phone_audio_begin(const char *id) {
  assert(id&&start_cue_order&&!mic);++phone_begins;phone_order=++sequence;phone=true;inject(PHONE);return ESP_OK;
}
static void lantern_audio_set_recording(bool enabled) {
  mic=enabled;if(enabled){++mic_starts;mic_order=++sequence;assert(start_cue_order<mic_order);}
}
static void lantern_audio_set_streaming(bool enabled) {(void)enabled;}
static void show_recording_progress(void) {assert(mic);}
static void lantern_agora_stop(void) {s_agora_active=false;}
static esp_err_t quipus_phone_audio_stop(void) {phone=false;return ESP_OK;}
static bool quipus_phone_audio_idle(void) {return !phone;}
static bool lantern_sd_capture_active(void) {return sd_open;}
static esp_err_t checkpoint_phone_timing(void) {return ESP_OK;}
static void lantern_sd_recording_abort(void) {sd_open=false;}
#include "offline_voice_under_test.c"

static void reset(void) {
  clear_active_session();strcpy(s_config.owner_id,"paired-owner");
  network=(lantern_network_status_t){.paired=true,.wifi_connected=false};
  s_state=LOCAL_READY;s_recovery=RECOVERY_NONE;s_power_off_requested=false;
  s_agora_active=s_used_agora=s_sd_recording_active=s_sd_archive_required=false;
  s_transcript_uploaded=s_audio_uploaded=s_recording_connection_notice=false;
  available=secure=true;sd_open=mic=phone=short_copy=false;s_local_voice_samples=scratch;
  cloud_result=begin_result=sd_result=prompt_result=ESP_OK;remount_result=ESP_FAIL;
  full_captures=short_captures=navigation_classifications=consent_classifications=0;
  memset(capture_early_silence,0,sizeof(capture_early_silence));
  memset(capture_duration,0,sizeof(capture_duration));
  capture_at=current_capture=classifications=clears=cloud_calls=cloud_begins=offline_begins=remounts=0;
  consent_questions=ready_calls=errors=unclear=reports=report_dialogues=0;
  confirms=agora_calls=capture_receipts=aborts=sd_begins=phone_begins=mic_starts=0;
  ticks=sequence=manifest_order=start_cue_order=phone_order=mic_order=0;buffered=last_copy_count=last_copy_offset=0;
  memset(prompts,0,sizeof(prompts));memset(scratch,0,sizeof(scratch));
  for(unsigned i=0;i<8;++i){heard[i]=true;captured_samples[i]=QUIPUS_LOCAL_MAX_SAMPLES;infer_results[i]=ESP_OK;answers[i]=QUIPUS_LOCAL_YES;}
  cloud_intent="consent_yes";inject_at=NOTHING;cloud_consent_calls=cloud_command_calls=0;
  for(unsigned i=0;i<8;++i)cloud_consent_intents[i]="consent_yes";
}
static void private_wiped(void) {for(size_t i=0;i<QUIPUS_LOCAL_MAX_SAMPLES;++i)assert(scratch[i]==0);}
static void no_recording(void) {assert(!mic&&!phone&&mic_starts==0&&sd_begins==0&&cloud_begins==0&&offline_begins==0);}
int main(void) {
  // Execute the actual single-attempt menu controller and capture policy.
  reset();captured_samples[0]=1900*16;assert(ask_local_choice(QUIPUS_PROMPT_OFFLINE_RECORD_CHOICE)==QUIPUS_LOCAL_YES);
  assert(capture_at==1&&full_captures==0&&short_captures==1);
  assert(capture_duration[0]==5000&&capture_early_silence[0]&&last_copy_count==1900*16);
  assert(navigation_classifications==1&&consent_classifications==0);
  no_recording();private_wiped();
  reset();captured_samples[0]=1180*16;answers[0]=QUIPUS_LOCAL_NO;
  assert(ask_local_choice(QUIPUS_PROMPT_OFFLINE_RECORD_CHOICE)==QUIPUS_LOCAL_NO);
  assert(capture_at==1&&full_captures==0&&short_captures==1);no_recording();private_wiped();
  reset();answers[0]=answers[1]=QUIPUS_LOCAL_UNKNOWN;
  assert(ask_local_choice(QUIPUS_PROMPT_OFFLINE_REPORT_CHOICE)==QUIPUS_LOCAL_UNKNOWN);
  assert(capture_at==1&&full_captures==0&&short_captures==1);
  assert(capture_duration[0]==5000&&prompts[QUIPUS_PROMPT_OFFLINE_REPORT_CHOICE]==1);
  no_recording();private_wiped();
  /* Actual choice YES must open a fresh consent prompt/capture before admission. */
  reset();capture_wake_command();
  assert(capture_at==2&&consent_questions==1&&prompts[QUIPUS_PROMPT_OFFLINE_RECORD_CHOICE]==1);
  assert(full_captures==1&&short_captures==1);
  assert(navigation_classifications==1&&consent_classifications==1);
  assert(capture_early_silence[0]&&!capture_early_silence[1]);
  assert(mic&&phone&&mic_starts==1&&cloud_calls==0&&s_state==LOCAL_RECORDING);
  assert(manifest_order<start_cue_order&&start_cue_order<phone_order&&phone_order<mic_order);
#if LANTERN_HAS_SD_CARD
  assert(offline_begins==1&&cloud_begins==0&&confirms==0&&agora_calls==0&&capture_receipts==0);
#else
  assert(cloud_begins==1&&offline_begins==0&&confirms==1&&agora_calls==1&&capture_receipts==1);
#endif
  private_wiped();
  reset();answers[1]=answers[2]=QUIPUS_LOCAL_NO;capture_wake_command();
  assert(capture_at==3&&consent_questions==1&&prompts[QUIPUS_PROMPT_CONSENT_RETRY]==1&&prompts[QUIPUS_PROMPT_CONSENT_REFUSED]==1);
  assert(s_state==LOCAL_READY&&navigation_classifications==1&&consent_classifications==2);
  assert(short_captures==1&&full_captures==2);no_recording();private_wiped();
  reset();answers[1]=QUIPUS_LOCAL_NO;capture_wake_command();
  assert(mic&&capture_at==3&&prompts[QUIPUS_PROMPT_CONSENT_RETRY]==1&&cloud_calls==0);
  reset();answers[0]=QUIPUS_LOCAL_NO;capture_wake_command();
  assert(capture_at==2&&reports==1&&consent_questions==0&&prompts[QUIPUS_PROMPT_OFFLINE_REPORT_CHOICE]==1);no_recording();
  reset();answers[0]=answers[1]=QUIPUS_LOCAL_NO;capture_wake_command();
  assert(capture_at==2&&reports==0&&s_state==LOCAL_READY);no_recording();
  reset();answers[0]=answers[1]=QUIPUS_LOCAL_UNKNOWN;capture_wake_command();
  assert(capture_at==1&&unclear==1&&cloud_calls==0&&s_state==LOCAL_READY);
  assert(prompts[QUIPUS_PROMPT_OFFLINE_RECORD_CHOICE]==1&&prompts[QUIPUS_PROMPT_OFFLINE_REPORT_CHOICE]==0);
  assert(navigation_classifications==1&&consent_classifications==0);no_recording();private_wiped();
  // A rejected first choice may offer exactly one distinct report question.
  reset();answers[0]=QUIPUS_LOCAL_NO;answers[1]=QUIPUS_LOCAL_UNKNOWN;capture_wake_command();
  assert(capture_at==2&&unclear==1&&s_state==LOCAL_READY&&consent_questions==0);
  assert(prompts[QUIPUS_PROMPT_OFFLINE_RECORD_CHOICE]==1&&prompts[QUIPUS_PROMPT_OFFLINE_REPORT_CHOICE]==1);
  assert(navigation_classifications==2&&consent_classifications==0);no_recording();private_wiped();
  reset();available=false;capture_wake_command();
  assert(capture_at==0&&prompts[QUIPUS_PROMPT_NETWORK_REQUIRED]==1);no_recording();
  reset();network.paired=false;capture_wake_command();assert(capture_at==0);no_recording();
  reset();s_power_off_requested=true;capture_wake_command();assert(capture_at==0);no_recording();
  for(unsigned online=0;online<2;++online) for(unsigned answer=QUIPUS_LOCAL_SILENCE;answer<=QUIPUS_LOCAL_NO;++answer) {
    reset();network.wifi_connected=online;answers[0]=(quipus_local_intent_t)answer;
    s_state=LOCAL_AWAITING_CONSENT;char intent[32];
    assert(capture_consent_response("consent",intent)==ESP_OK);
    if(online) {
      assert(!strcmp(intent,"consent_yes")&&cloud_calls==1&&cloud_consent_calls==1&&classifications==0);
    } else if(answer==QUIPUS_LOCAL_YES||answer==QUIPUS_LOCAL_NO) {
      assert(!strcmp(intent,answer==QUIPUS_LOCAL_YES?"consent_yes":"consent_no")&&cloud_calls==0);
    } else {assert(!strcmp(intent,"unknown")&&cloud_calls==0);}
    assert(clears==1&&buffered==0);private_wiped();no_recording();
  }
  // Cloud full-utterance consent wins online even if the local label disagrees.
  reset();network.wifi_connected=true;answers[0]=QUIPUS_LOCAL_YES;
  cloud_consent_intents[0]="consent_no";s_state=LOCAL_AWAITING_CONSENT;
  char online_intent[32];
  assert(capture_consent_response("consent",online_intent)==ESP_OK&&!strcmp(online_intent,"consent_no"));
  assert(classifications==0&&cloud_consent_calls==1);no_recording();
  reset();network.wifi_connected=true;answers[0]=QUIPUS_LOCAL_YES;
  cloud_result=ESP_FAIL;start_spoken_consent(true);
  assert(s_state==LOCAL_READY&&classifications==0&&cloud_consent_calls==2&&prompts[QUIPUS_PROMPT_CONSENT_REFUSED]==1);no_recording();
  reset();network.wifi_connected=true;answers[0]=answers[1]=QUIPUS_LOCAL_YES;
  cloud_consent_intents[0]=cloud_consent_intents[1]="consent_no";start_spoken_consent(true);
  assert(s_state==LOCAL_READY&&classifications==0&&cloud_consent_calls==2&&prompts[QUIPUS_PROMPT_CONSENT_RETRY]==1);no_recording();
  reset();network.wifi_connected=true;
  cloud_consent_intents[0]="consent_no";start_spoken_consent(true);
  assert(s_state==LOCAL_RECORDING&&classifications==0&&cloud_consent_calls==2&&prompts[QUIPUS_PROMPT_CONSENT_RETRY]==1);
  reset();available=false;network.wifi_connected=true;s_state=LOCAL_AWAITING_CONSENT;
  char intent[32];assert(capture_consent_response("consent",intent)==ESP_OK&&cloud_calls==1&&classifications==0);
  reset();infer_results[0]=ESP_FAIL;s_state=LOCAL_AWAITING_CONSENT;
  assert(capture_consent_response("consent",intent)==ESP_OK&&!strcmp(intent,"unknown")&&cloud_calls==0);private_wiped();
  reset();heard[0]=false;s_state=LOCAL_AWAITING_CONSENT;
  assert(capture_consent_response("consent",intent)!=ESP_OK&&classifications==0&&clears==1);no_recording();
  reset();captured_samples[0]=7999;s_state=LOCAL_AWAITING_CONSENT;
  assert(capture_consent_response("consent",intent)!=ESP_OK&&classifications==0&&clears==1);no_recording();
  reset();captured_samples[0]=QUIPUS_LOCAL_MAX_SAMPLES+160;s_state=LOCAL_AWAITING_CONSENT;
  assert(capture_consent_response("consent",intent)==ESP_OK&&last_copy_count==QUIPUS_LOCAL_MAX_SAMPLES&&last_copy_offset==160);private_wiped();
  reset();short_copy=true;s_state=LOCAL_AWAITING_CONSENT;
  assert(capture_consent_response("consent",intent)==ESP_OK&&!strcmp(intent,"unknown")&&classifications==0);private_wiped();
  for(enum inject point=QUESTION;point<=INFER;++point) {
    reset();inject_at=point;capture_wake_command();assert(s_power_off_requested);no_recording();private_wiped();
    reset();inject_at=point;start_spoken_consent(true);assert(s_power_off_requested);no_recording();private_wiped();
  }
  /* Wi-Fi does not change SD admission: no cloud start/key/consent/clock calls. */
  reset();network.wifi_connected=true;assert(accept_recording_consent()==ESP_OK);
#if LANTERN_HAS_SD_CARD
  assert(offline_begins==1&&cloud_begins==0&&confirms==0&&capture_receipts==0);
  reset();secure=false;assert(accept_recording_consent()!=ESP_OK);no_recording();assert(remounts==1);
  reset();secure=false;remount_result=ESP_OK;assert(accept_recording_consent()==ESP_OK&&remounts==1&&offline_begins==1);
  reset();sd_result=ESP_FAIL;assert(accept_recording_consent()!=ESP_OK&&aborts==0&&mic_starts==0&&phone_begins==0);
#endif
  reset();begin_result=ESP_FAIL;assert(accept_recording_consent()!=ESP_OK&&sd_begins==0&&mic_starts==0);
  for(enum inject point=BEGIN;point<=PHONE;++point) {
    reset();inject_at=point;assert(accept_recording_consent()!=ESP_OK);
    assert(s_power_off_requested&&!mic&&!phone&&mic_starts==0);
  }
  /* Cloud exact commands remain online; failed Internet still exposes local menu. */
  reset();network.wifi_connected=true;cloud_intent="start_recording";capture_wake_command();
  assert(cloud_calls==2&&cloud_command_calls==1&&cloud_consent_calls==1&&classifications==0&&capture_at==2&&mic&&prompts[QUIPUS_PROMPT_OFFLINE_RECORD_CHOICE]==0);
  assert(short_captures==1&&full_captures==1&&capture_early_silence[0]&&!capture_early_silence[1]);
  reset();network.wifi_connected=true;cloud_intent="status_report";capture_wake_command();
  assert(cloud_calls==1&&reports==1&&capture_at==1);no_recording();
  reset();network.wifi_connected=true;cloud_result=ESP_FAIL;capture_wake_command();
  assert(cloud_calls==3&&cloud_command_calls==1&&cloud_consent_calls==2&&capture_at==4&&!mic&&prompts[QUIPUS_PROMPT_OFFLINE_RECORD_CHOICE]==1);
  assert(classifications==1&&s_state==LOCAL_READY);no_recording();
  printf("Actual offline voice, fresh consent and %s admission: bounded safety cases passed\n",TEST_SD_CARD?"SD-first":"legacy cloud");
  return 0;
}
