/* Production dialogue AND utterance functions are extracted verbatim.
 * Only clock, hardware audio, display and provider boundaries are simulated. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef int esp_err_t;
typedef uint32_t TickType_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NOT_FOUND -2
#define ESP_LOGI(...) ((void)0)
#define pdMS_TO_TICKS(ms) (ms)
#define portTICK_PERIOD_MS 1
#define LANTERN_MIC_SAMPLE_RATE 16000
#include "report_dialogue_types.h"

static local_state_t s_state;
static recovery_action_t s_recovery;
static bool s_power_off_requested, speaker, recording, speech, interrupted_speech;
static bool speaker_after_settle, power_after_settle, power_during_capture;
static bool review_error, review_power, action_pending, error_returns_ready;
static bool power_before_action_post;
static unsigned action_posts, action_reply_count, chimes;
static int s_battery_level=71;
static TickType_t ticks, capture_started, last_capture_duration, voice_delay;
static unsigned resets, settles, captures, capture_stops, interruption_attempts;
static unsigned reviews, cancelled_reviews, posts, errors, ready, done, displays;
static unsigned generation, last_post_generation, sequence, reset_order, settle_order, capture_order, cases;
static bool fresh_audio;
static int16_t audio_window[16];
static struct { const char *reply; esp_err_t result; } replies[80];
static unsigned reply_count;
static struct { const char *reply; esp_err_t result; } action_replies[80];

static TickType_t xTaskGetTickCount(void) { return ticks; }
static void vTaskDelay(TickType_t delay) {
  if(delay==250) {
    ++settles; settle_order=++sequence;
    assert(reset_order && reset_order<settle_order && !recording && !speaker);
    if(speaker_after_settle) speaker=true;
    if(power_after_settle) s_power_off_requested=true;
  }
  ticks+=delay;
  if(recording && power_during_capture && ticks-capture_started>=400)
    s_power_off_requested=true;
}
static void lantern_audio_set_recording(bool enabled) {
  if(enabled) {
    assert(!recording && !speaker && !s_power_off_requested);
    assert(reset_order<settle_order && settle_order>capture_order);
    capture_order=++sequence;
    ++captures; ++generation; capture_started=ticks;
    memset(audio_window,0,sizeof(audio_window));
    fresh_audio=false;
  } else {
    assert(recording); ++capture_stops;
    last_capture_duration=ticks-capture_started;
    assert(last_capture_duration<=30000);
  }
  recording=enabled;
}
static unsigned lantern_audio_level(void) {
  assert(recording);
  unsigned elapsed=ticks-capture_started;
  if(speech && elapsed>=voice_delay && elapsed<voice_delay+1200) {
    audio_window[0]=123; fresh_audio=true; return VOICE_ACTIVITY_LEVEL;
  }
  return 0;
}
static void lantern_audio_reset_report_listening(void) {
  assert(!recording); ++resets; reset_order=++sequence;
  fresh_audio=false;
}
static bool lantern_audio_is_speaker_active(void) { return speaker; }
static bool lantern_audio_capture_interruption(unsigned maximum_ms) {
  assert(maximum_ms==7500); ++interruption_attempts;
  if(interrupted_speech) { ++generation; fresh_audio=true; audio_window[0]=456; }
  return interrupted_speech;
}
static bool lantern_network_review_pending(void) {
  ++reviews;
  if(review_error) s_state=LOCAL_ERROR;
  if(review_power) s_power_off_requested=true;
  return action_pending;
}
static void lantern_audio_chime(unsigned count) {
  assert(count==1 && !speaker && !recording && !s_power_off_requested);
  assert(reset_order>settle_order); ++chimes; audio_window[0]=999;
}
static size_t lantern_audio_buffered_samples(void) {
  assert(!recording); return 16000; /* Even silent PCM occupies a full window. */
}
static void lantern_network_cancel_review(void) { ++cancelled_reviews; action_pending=false; }
static void lantern_display_show(lantern_screen_t screen,const char *detail) {
  assert((screen==LANTERN_SCREEN_LISTENING && (!strcmp(detail,"LISTENING") || !strcmp(detail,"APPROVE? SAY YES OR NO"))) ||
         (screen==LANTERN_SCREEN_UNDERSTANDING && (!strcmp(detail,"ONE MOMENT") || !strcmp(detail,"REVIEWING ACTION"))));
  if(power_before_action_post && screen==LANTERN_SCREEN_UNDERSTANDING && !strcmp(detail,"REVIEWING ACTION"))
    s_power_off_requested=true;
  ++displays;
}
static void show_ready(void) { ++ready; s_state=LOCAL_READY; }
static void show_error(recovery_action_t recovery,const char *detail,const char *prompt) {
  assert(recovery==RECOVERY_STATUS && !strcmp(prompt,"status_error"));
  assert(!strcmp(detail,"REPORT AUDIO BUSY") || !strcmp(detail,"REPORT UNAVAILABLE") || !strcmp(detail,"ACTION NOT CONFIRMED"));
  ++errors; s_recovery=recovery; s_state=error_returns_ready ? LOCAL_READY : LOCAL_ERROR;
}
static esp_err_t quipus_play_prompt(quipus_prompt_t prompt) {
  assert(prompt==QUIPUS_PROMPT_REPORT_DONE); ++done; return ESP_OK;
}
static esp_err_t lantern_network_run_voice_command(const char *context,int battery,char *reply,size_t capacity) {
  assert((!strcmp(context,"report") || !strcmp(context,"action")) && battery==71);
  assert(!recording && !speaker && !s_power_off_requested);
  /* Replaying a TTS/preroll window, or posting it twice, fails immediately. */
  assert(fresh_audio && audio_window[0]!=999 && generation>last_post_generation);
  last_post_generation=generation;
  fresh_audio=false; audio_window[0]=999; /* old speaker residue before next turn */
  if(!strcmp(context,"action")) {
    assert(action_pending && action_posts<action_reply_count);
    unsigned index=action_posts++;
    snprintf(reply,capacity,"%s",action_replies[index].reply);
    if(action_posts==action_reply_count) action_pending=false;
    return action_replies[index].result;
  }
  assert(posts<reply_count);
  unsigned index=posts++;
  snprintf(reply,capacity,"%s",replies[index].reply);
  return replies[index].result;
}
#include "report_dialogue_under_test.c"

static void reset(void) {
  s_state=LOCAL_STATUS; s_recovery=RECOVERY_NONE; s_power_off_requested=false;
  speaker=recording=interrupted_speech=speaker_after_settle=power_after_settle=false;
  power_during_capture=review_error=review_power=fresh_audio=false; speech=true;
  action_pending=error_returns_ready=power_before_action_post=false;
  action_posts=action_reply_count=chimes=0;
  ticks=1000; capture_started=last_capture_duration=voice_delay=0;
  resets=settles=captures=capture_stops=interruption_attempts=0;
  reviews=cancelled_reviews=posts=errors=ready=done=displays=0;
  generation=last_post_generation=sequence=reset_order=settle_order=capture_order=0;
  reply_count=0; memset(replies,0,sizeof(replies)); memset(action_replies,0,sizeof(action_replies));
  for(unsigned i=0;i<16;++i) audio_window[i]=999;
}
static void answer(const char *reply,esp_err_t result) {
  assert(reply_count<80); replies[reply_count].reply=reply; replies[reply_count++].result=result;
}
static void action_answer(const char *reply,esp_err_t result) {
  assert(action_reply_count<80); action_pending=true;
  action_replies[action_reply_count].reply=reply;
  action_replies[action_reply_count++].result=result;
}
static void idle_without_post(void) {
  assert(s_state==LOCAL_READY && ready==1 && posts==0 && errors==0 && !recording);
  assert(done==0); ++cases;
}
static void silence_and_fresh_window(void) {
  reset(); speech=false; report_dialogue(ESP_OK);
  assert(captures==1 && capture_stops==1 && resets==1 && settles==1);
  assert(last_capture_duration==30000 && audio_window[0]==0);
  idle_without_post();

  reset(); voice_delay=27000; answer("report_stop",ESP_OK); report_dialogue(ESP_OK);
  assert(posts==1 && captures==1 && last_capture_duration>28000 && last_capture_duration<=30000);
  assert(resets==1 && settles==1 && done==1 && ready==1 && !errors); ++cases;
}
static void interruption_and_speaker_gates(void) {
  reset(); report_dialogue(LANTERN_REPORT_INTERRUPTED);
  assert(interruption_attempts==1 && captures==0 && resets==0 && settles==0 && reviews==0);
  idle_without_post();

  reset(); interrupted_speech=true; answer("report_stop",ESP_OK);
  report_dialogue(LANTERN_REPORT_INTERRUPTED);
  assert(interruption_attempts==1 && captures==0 && resets==0 && posts==1 && done==1 && ready==1); ++cases;

  for(unsigned after=0;after<2;++after) {
    reset(); speaker=!after; speaker_after_settle=after; report_dialogue(ESP_OK);
    assert(errors==1 && s_recovery==RECOVERY_STATUS && captures==0 && posts==0 && resets==1);
    assert(settles==after && !ready && !done); ++cases;
  }
}
static void dialogue_turns(void) {
  reset(); answer("report_stop",ESP_OK); report_dialogue(ESP_OK);
  assert(posts==1 && captures==1 && capture_stops==1 && resets==1 && settles==1);
  assert(done==1 && ready==1 && !errors && s_state==LOCAL_READY); ++cases;

  reset(); answer("report_clarify",ESP_OK); answer("report_clarify",ESP_OK); report_dialogue(ESP_OK);
  assert(posts==2 && captures==2 && ready==1 && !done && !errors); ++cases;

  reset();
  for(unsigned i=0;i<21;++i) { answer("report_clarify",ESP_OK); answer("report_answer",ESP_OK); }
  answer("report_stop",ESP_OK); report_dialogue(ESP_OK);
  assert(posts==43 && captures==43 && capture_stops==43 && resets==43 && settles==43);
  assert(done==1 && ready==1 && !errors && s_state==LOCAL_READY); ++cases;

  reset(); for(unsigned i=0;i<24;++i) answer("report_answer",ESP_OK);
  answer("report_stop",ESP_OK); report_dialogue(ESP_OK);
  assert(posts==25 && captures==25 && ready==1 && done==1 && !errors); ++cases;
}
static void error_and_power_gates(void) {
  reset(); report_dialogue(ESP_FAIL);
  assert(errors==1 && captures==0 && posts==0 && !ready); ++cases;
  reset(); answer("",ESP_FAIL); report_dialogue(ESP_OK);
  assert(errors==1 && captures==1 && posts==1 && !ready && !done && !recording); ++cases;
  reset(); report_dialogue(ESP_ERR_NOT_FOUND); idle_without_post();
  reset(); answer("",ESP_ERR_NOT_FOUND); report_dialogue(ESP_OK);
  assert(captures==1 && posts==1 && ready==1 && !errors && !done); ++cases;

  reset(); s_power_off_requested=true; report_dialogue(ESP_OK);
  assert(captures==0 && resets==0 && posts==0 && reviews==0 && !ready && !errors); ++cases;
  reset(); power_after_settle=true; report_dialogue(ESP_OK);
  assert(captures==0 && resets==1 && settles==1 && posts==0 && !ready && !errors); ++cases;
  reset(); power_during_capture=true; report_dialogue(ESP_OK);
  assert(captures==1 && capture_stops==1 && posts==0 && s_power_off_requested && !recording);
  assert(!ready && !errors && !done); ++cases;
  reset(); review_power=true; report_dialogue(ESP_OK);
  assert(captures==0 && posts==0 && resets==0 && !ready && !errors); ++cases;
  reset(); review_error=true; report_dialogue(ESP_OK);
  assert(captures==0 && posts==0 && resets==0 && !ready && s_state==LOCAL_ERROR); ++cases;
}
static void action_review_gates(void) {
  reset(); action_pending=true; speech=false; review_spoken_actions();
  assert(captures==2 && capture_stops==2 && chimes==2 && resets==2 && settles==2);
  assert(last_capture_duration==4000 && action_posts==0 && cancelled_reviews==1 && !action_pending && !errors); ++cases;

  reset(); action_answer("unknown",ESP_OK); action_answer("unknown",ESP_OK); review_spoken_actions();
  assert(action_posts==2 && captures==2 && !action_pending && cancelled_reviews==1 && !errors); ++cases;

  reset(); for(unsigned i=0;i<22;++i) { action_answer("unknown",ESP_OK); action_answer("action_reply",ESP_OK); }
  review_spoken_actions();
  assert(action_posts==44 && captures==44 && chimes==44 && resets==44 && settles==44);
  assert(!action_pending && cancelled_reviews==1 && !errors && !posts); ++cases;

  for(unsigned after=0;after<2;++after) {
    reset(); action_pending=true; speaker=!after; speaker_after_settle=after;
    review_spoken_actions();
    assert(captures==0 && action_posts==0 && chimes==after && errors==1);
    assert(cancelled_reviews==1 && !action_pending); ++cases;
  }
  for(unsigned power=0;power<4;++power) {
    reset(); action_pending=true;
    if(power==0) s_power_off_requested=true;
    if(power==1) power_after_settle=true;
    if(power==2) power_during_capture=true;
    if(power==3) power_before_action_post=true;
    review_spoken_actions();
    assert(s_power_off_requested && action_posts==0 && cancelled_reviews==1 && !action_pending && !errors);
    assert(captures==(power>=2) && capture_stops==captures && !recording); ++cases;
  }
  reset(); action_answer("",ESP_FAIL); error_returns_ready=true; report_dialogue(ESP_OK);
  assert(action_posts==1 && captures==1 && errors==1 && s_state==LOCAL_READY);
  assert(posts==0 && ready==0 && !action_pending && !recording); ++cases;
}
int main(void) {
  silence_and_fresh_window(); interruption_and_speaker_gates(); dialogue_turns(); error_and_power_gates();
  action_review_gates();
  printf("Actual report dialogue + fresh capture: %u cases passed\n",cases);
  return 0;
}
