#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "quipus_local_recognizer.c"
#include "target_tail_noise_fixture.h"

static int16_t pcm[QUIPUS_LOCAL_MAX_SAMPLES];
static unsigned frames,windows,resets,inits,self_tests;
static esp_err_t self_test_result=ESP_OK;
static esp_err_t init_result=ESP_OK;
static int mode,fail_at;
static bool nested;
static int vad_mode=4;
static unsigned vad_calls;
static const uint8_t unknown[4]={0,240,8,8},yes[4]={0,5,245,6},no[4]={0,5,6,245},silence[4]={250,2,2,2};

esp_err_t quipus_local_inference_init(void) { ++inits;return init_result; }
esp_err_t quipus_local_inference_self_test(quipus_local_classify_fn classify) {
  ++self_tests;assert(classify && !quipus_local_recognizer_available());
  quipus_local_result_t result;
  assert(quipus_local_recognizer_classify(pcm,80000,&result)==ESP_ERR_NOT_SUPPORTED);
  return self_test_result;
}
void quipus_local_inference_reset(void) { ++resets; }
esp_err_t quipus_local_inference_vad_frame(const int16_t *frame,bool *speech) {
  assert(frame);
  unsigned index=vad_calls++;
  *speech=false;
  if(!vad_mode || (vad_mode==3 && index==10))return ESP_ERR_NOT_SUPPORTED;
  if(vad_mode==1)*speech=(index>=50 && index<60)||(index>=240 && index<245);
  if(vad_mode==4)*speech=index>=50 && index<70;
  if(vad_mode==5)*speech=index>=50 && index<70;
  if(vad_mode==6)*speech=(index>=50 && index<70)||index==249;
  if(vad_mode==7)*speech=(index>=50 && index<70)||(index>=150 && index<155);
  if(vad_mode==8)*speech=(index>=50 && index<70)||(index>=90 && index<95);
  if(vad_mode==9)*speech=index>=50 && index<130;
  if(vad_mode==10)*speech=index>=30 && index<=190 && (index-30)%20==0;
  if(vad_mode==11)*speech=index>=20 && index<40;
  if(vad_mode==12)*speech=index>=20 && index<66;
  if(vad_mode==13)*speech=index>=2 && index<22;
  if(vad_mode==14)*speech=(index>=20 && index<31)||(index>=39 && index<46);
  if(vad_mode==15)*speech=index>=20 && index<31;
  return ESP_OK;
}
esp_err_t quipus_local_inference_frame(const int16_t *frame,bool classify,uint8_t scores[4]) {
  assert(frame>=pcm && frame+QUIPUS_LOCAL_FRAME_SAMPLES<=pcm+QUIPUS_LOCAL_MAX_SAMPLES);
  ++frames;
  if(nested) {
    nested=false;quipus_local_result_t result={.intent=QUIPUS_LOCAL_YES};
    assert(quipus_local_recognizer_classify(pcm,16000,&result)==ESP_ERR_INVALID_STATE);
    assert(result.intent==QUIPUS_LOCAL_UNKNOWN);
    assert(quipus_local_recognizer_classify_navigation(pcm,16000,&result)==ESP_ERR_INVALID_STATE);
    assert(result.intent==QUIPUS_LOCAL_UNKNOWN);
  }
  if(!classify)return ESP_OK;
  ++windows;
  if(fail_at && windows==(unsigned)fail_at)return ESP_FAIL;
  const uint8_t *value=unknown;
  if(mode==1)value=silence;
  if(mode==2)value=yes;
  if(mode==3)value=windows==1?yes:unknown;
  if(mode==4)value=windows>=40?no:yes;
  if(mode==5)value=windows==41?no:yes;
  if(mode==8)value=windows<=10?yes:unknown;
  if(mode==9)value=no;
  memcpy(scores,value,4);
  if(mode==6){memcpy(scores,yes,4);if(windows==41){scores[1]=80;scores[2]=20;scores[3]=150;}}
  return ESP_OK;
}
static quipus_local_result_t run_for(int selected,unsigned samples,bool navigation) {
  frames=windows=resets=vad_calls=0;mode=selected;fail_at=0;
  quipus_local_result_t result={.intent=QUIPUS_LOCAL_YES};
  assert((navigation ? quipus_local_recognizer_classify_navigation(pcm,samples,&result)
                     : quipus_local_recognizer_classify(pcm,samples,&result))==ESP_OK);
  assert(frames==(samples-480)/320+1 && result.windows==windows && resets==2);
  return result;
}
static quipus_local_result_t run(int selected,unsigned samples) { return run_for(selected,samples,false); }
static quipus_local_result_t navigate(int selected,unsigned samples) { return run_for(selected,samples,true); }
int main(void) {
  for(size_t i=0;i<QUIPUS_LOCAL_MAX_SAMPLES;++i)pcm[i]=(int16_t)((i%2)?1:-1);
  quipus_local_result_t result={.intent=QUIPUS_LOCAL_YES};
  assert(!quipus_local_recognizer_available());
  assert(quipus_local_recognizer_classify(pcm,16000,&result)==ESP_ERR_NOT_SUPPORTED && result.intent==QUIPUS_LOCAL_UNKNOWN);
  assert(quipus_local_recognizer_classify_navigation(pcm,16000,&result)==ESP_ERR_NOT_SUPPORTED && result.intent==QUIPUS_LOCAL_UNKNOWN);
  init_result=ESP_ERR_NO_MEM;assert(quipus_local_recognizer_init()==ESP_ERR_NO_MEM && !quipus_local_recognizer_available());
  init_result=ESP_OK;self_test_result=ESP_FAIL;
  assert(quipus_local_recognizer_init()==ESP_FAIL && !quipus_local_recognizer_available() && inits==2 && self_tests==1);
  assert(quipus_local_recognizer_classify(pcm,80000,&result)==ESP_ERR_NOT_SUPPORTED);
  self_test_result=ESP_OK;
  assert(quipus_local_recognizer_init()==ESP_OK && inits==3 && self_tests==2);
  assert(quipus_local_recognizer_init()==ESP_OK && inits==3 && self_tests==2);
  assert(quipus_local_recognizer_classify(NULL,16000,&result)==ESP_ERR_INVALID_ARG && result.intent==QUIPUS_LOCAL_UNKNOWN);
  assert(quipus_local_recognizer_classify(pcm,QUIPUS_LOCAL_MAX_SAMPLES+1,&result)==ESP_ERR_INVALID_ARG && result.intent==QUIPUS_LOCAL_UNKNOWN);
  assert(quipus_local_recognizer_classify(pcm,15999,&result)==ESP_ERR_INVALID_SIZE && result.intent==QUIPUS_LOCAL_UNKNOWN);
  assert(quipus_local_recognizer_classify(pcm,16000,NULL)==ESP_ERR_INVALID_ARG);
  assert(quipus_local_recognizer_classify_navigation(NULL,16000,&result)==ESP_ERR_INVALID_ARG && result.intent==QUIPUS_LOCAL_UNKNOWN);
  assert(quipus_local_recognizer_classify_navigation(pcm,15999,&result)==ESP_ERR_INVALID_SIZE && result.intent==QUIPUS_LOCAL_UNKNOWN);
  assert(quipus_local_recognizer_classify_navigation(pcm,QUIPUS_LOCAL_MAX_SAMPLES+1,&result)==ESP_ERR_INVALID_ARG && result.intent==QUIPUS_LOCAL_UNKNOWN);
  assert(run(0,80000).intent==QUIPUS_LOCAL_UNKNOWN);
  assert(run(1,80000).intent==QUIPUS_LOCAL_UNKNOWN);
  result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_YES && windows==41);
  assert(result.diagnostics.yes_windows>=2 && result.diagnostics.no_windows==0);
  assert(result.diagnostics.peak_yes_end_ms==1090 && result.diagnostics.peak_yes_rms==1);
  assert(result.diagnostics.rms==1 && result.diagnostics.dc_mean==0 && result.diagnostics.peak_abs==1);
  assert(result.diagnostics.clipped_samples==0);
  assert(run(3,80000).intent==QUIPUS_LOCAL_UNKNOWN);
  // Strong NO over an unvoiced stationary tail is not a spoken word.
  assert(run(4,80000).intent==QUIPUS_LOCAL_YES && windows==41);
  assert(run(5,80000).intent==QUIPUS_LOCAL_YES && windows==41);
  vad_mode=1;
  result=run(5,80000);
  assert(result.intent==QUIPUS_LOCAL_NO && windows==41);
  assert(result.diagnostics.no_windows==1 && result.diagnostics.yes_windows>=2);
  assert(result.diagnostics.first_no_end_ms==4990 && result.diagnostics.last_no_end_ms==4990);
  assert(result.diagnostics.peak_no_end_ms==4990 && result.diagnostics.first_no_rms==1);
  assert(result.diagnostics.possible_no_windows==1);
  assert(run(6,80000).intent==QUIPUS_LOCAL_UNKNOWN);
  vad_mode=4;
  assert(run(2,16000).intent==QUIPUS_LOCAL_UNKNOWN);
  vad_mode=1;result=run(5,80000);
  assert(result.intent==QUIPUS_LOCAL_NO && result.diagnostics.vad_available && vad_calls==250);
  assert(result.diagnostics.vad_speech_frames==15 && result.diagnostics.vad_last_speech_end_ms==4900);
  assert(result.diagnostics.last_no_voiced_ms==100 && result.diagnostics.peak_yes_voiced_ms==90);
  vad_mode=2;result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.vad_available && !result.diagnostics.vad_speech_frames);
  vad_mode=3;result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && !result.diagnostics.vad_available && !result.diagnostics.vad_frames);
  vad_mode=4;
  nested=true;assert(run(2,80000).intent==QUIPUS_LOCAL_YES && !nested);
  frames=windows=resets=0;mode=2;fail_at=41;result.intent=QUIPUS_LOCAL_YES;
  assert(quipus_local_recognizer_classify(pcm,80000,&result)==ESP_FAIL);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && resets==2 && windows==41);
  memset(pcm,0,sizeof(pcm));frames=0;assert(quipus_local_recognizer_classify(pcm,80000,&result)==ESP_OK);
  assert(result.intent==QUIPUS_LOCAL_SILENCE && frames==0);
  for(size_t i=0;i<80000;++i)pcm[i]=22;
  assert(quipus_local_recognizer_classify(pcm,80000,&result)==ESP_OK && result.intent==QUIPUS_LOCAL_UNKNOWN && frames==0);
  for(size_t i=0;i<80000;++i)pcm[i]=(i%2)?INT16_MAX:INT16_MIN;
  result=run(0,80000);
  assert(result.diagnostics.peak_abs==32768 && result.diagnostics.rms==32767);
  assert(result.diagnostics.clipped_samples==80000 && result.intent==QUIPUS_LOCAL_UNKNOWN);
  // Exact target telemetry, intentionally not assigned a human spoken label.
  decision_t replay={0};result=(quipus_local_result_t){.intent=QUIPUS_LOCAL_UNKNOWN};
  result.diagnostics.vad_available=true;result.diagnostics.background_verified=true;
  for(size_t i=0;i<TARGET_TAIL_WINDOWS;++i) {
    const target_window_t *w=&target_tail_windows[i];
    observe(&replay,&result.diagnostics,w->scores,w->end_ms,w->rms,w->voiced_ms);
  }
  finish_decision(&replay,&result,QUIPUS_LOCAL_PURPOSE_CONSENT);
  assert(result.intent==QUIPUS_LOCAL_YES && result.windows==41);
  assert(result.diagnostics.yes_windows==10 && result.diagnostics.no_windows==0);
  uint8_t actual_no[4]={0,4,5,247};
  observe(&replay,&result.diagnostics,actual_no,4990,35,100);
  finish_decision(&replay,&result,QUIPUS_LOCAL_PURPOSE_CONSENT);assert(result.intent==QUIPUS_LOCAL_NO);
  // Live board-2 tail: a weak NO (135) over only the last40ms of an explained
  // YES does not veto it; the same weak NO over100ms of speech still does.
  uint8_t strong_yes[4]={0,8,255,4},weak_no[4]={20,60,40,135};
  for(unsigned voiced=40;voiced<=100;voiced+=60) {
    decision_t tail={0};result=(quipus_local_result_t){.intent=QUIPUS_LOCAL_UNKNOWN};
    result.diagnostics.vad_available=true;result.diagnostics.background_verified=true;
    observe(&tail,&result.diagnostics,strong_yes,990,380,600);
    observe(&tail,&result.diagnostics,strong_yes,1090,380,600);
    observe(&tail,&result.diagnostics,weak_no,2390,20,(uint16_t)voiced);
    finish_decision(&tail,&result,QUIPUS_LOCAL_PURPOSE_CONSENT);
    assert(result.intent==(voiced<100?QUIPUS_LOCAL_YES:QUIPUS_LOCAL_UNKNOWN));
    assert(result.diagnostics.possible_no_windows==(voiced<100?0U:1U));
  }

  // VAD onset lag is associated only when adjacent and within100ms.
  for(size_t i=0;i<80000;++i)pcm[i]=(i%2)?19:-19;
  for(size_t i=18*320;i<40*320;++i)pcm[i]=(i%2)?300:-300;
  vad_mode=11;result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_YES && result.diagnostics.background_verified);
  assert(result.diagnostics.onset_attached_frames==2 && !result.diagnostics.ambiguous_frames);
  //120ms before VAD is outside the allowed onset expansion, never hidden.
  for(size_t i=14*320;i<18*320;++i)pcm[i]=(i%2)?300:-300;
  result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.onset_attached_frames==5);
  assert(result.diagnostics.first_ambiguous_end_ms==300 && result.diagnostics.first_ambiguous_rms==300);
  // A quiet gap prevents attachment of an earlier click/burst to the word.
  for(size_t i=0;i<80000;++i)pcm[i]=(i%2)?19:-19;
  for(size_t i=16*320;i<18*320;++i)pcm[i]=(i%2)?300:-300;
  for(size_t i=19*320;i<40*320;++i)pcm[i]=(i%2)?300:-300;
  result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.onset_attached_frames==1);
  assert(result.diagnostics.first_ambiguous_end_ms==340 && result.diagnostics.last_ambiguous_end_ms==360);
  // Every attached frame must fit the same isolated trusted-YES context.
  for(size_t i=0;i<80000;++i)pcm[i]=(i%2)?19:-19;
  for(size_t i=15*320;i<66*320;++i)pcm[i]=(i%2)?300:-300;
  vad_mode=12;result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.onset_attached_frames==5);
  assert(result.diagnostics.unexplained_speech_frames==51);

  // A quiet late refusal missed by VAD must not disappear into the noise floor.
  for(size_t i=0;i<80000;++i)pcm[i]=(i%2)?19:-19;
  for(size_t i=16000;i<22400;++i)pcm[i]=(i%2)?300:-300;
  vad_mode=5;result=run(2,80000);assert(result.intent==QUIPUS_LOCAL_YES);
  for(size_t i=76800;i<78400;++i)pcm[i]=(i%2)?35:-35;
  result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.ambiguous_frames==5);
  assert(result.diagnostics.background_rms==19);
  // Navigation never authorizes recording: identical ambient ambiguity may
  // select the next question, while the default API still refuses consent.
  result=navigate(2,80000);
  assert(result.intent==QUIPUS_LOCAL_YES && result.diagnostics.ambiguous_frames==5);
  assert(windows==41 && vad_calls==250);
  // Room fluctuations shorter than100ms (live consent failures at 1.8-2.3x
  // floor) are not speech; a sustained100ms run at that level, or a strong
  // blip, is.
  for(size_t i=76800;i<78400;++i)pcm[i]=(i%2)?19:-19;
  for(size_t i=67200;i<67520;++i)pcm[i]=(i%2)?44:-44;
  result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_YES && !result.diagnostics.ambiguous_frames);
  assert(navigate(2,80000).intent==QUIPUS_LOCAL_YES);
  for(size_t i=67200;i<68480;++i)pcm[i]=(i%2)?44:-44;
  result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_YES && result.diagnostics.longest_above_floor_frames==4);
  for(size_t i=67200;i<68800;++i)pcm[i]=(i%2)?44:-44;
  result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.ambiguous_frames==5);
  for(size_t i=67200;i<68800;++i)pcm[i]=(i%2)?19:-19;
  for(size_t i=67200;i<67520;++i)pcm[i]=(i%2)?66:-66;
  result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.ambiguous_frames==1);
  // Two separated brief fluctuations do not join into a run.
  for(size_t i=67200;i<67520;++i)pcm[i]=(i%2)?44:-44;
  for(size_t i=67840;i<68160;++i)pcm[i]=(i%2)?44:-44;
  assert(run(2,80000).intent==QUIPUS_LOCAL_YES);
  for(size_t i=67200;i<68160;++i)pcm[i]=(i%2)?19:-19;
  vad_mode=1;
  assert(navigate(5,80000).intent==QUIPUS_LOCAL_NO);
  assert(navigate(9,80000).intent==QUIPUS_LOCAL_NO);
  assert(navigate(3,80000).intent==QUIPUS_LOCAL_UNKNOWN);
  assert(navigate(6,80000).intent==QUIPUS_LOCAL_UNKNOWN);
  vad_mode=2;assert(navigate(2,80000).intent==QUIPUS_LOCAL_UNKNOWN);
  vad_mode=3;assert(navigate(2,80000).intent==QUIPUS_LOCAL_UNKNOWN);
  vad_mode=5;
  frames=windows=resets=vad_calls=0;mode=2;fail_at=41;
  assert(quipus_local_recognizer_classify_navigation(pcm,80000,&result)==ESP_FAIL);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN&&windows==41&&resets==2);
  // Clicks, even without a keyword prediction, are ambiguous rather than consent.
  for(size_t i=76800;i<78400;++i)pcm[i]=(i%2)?19:-19;
  pcm[50000]=5000;result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.ambiguous_frames);
  pcm[50000]=19;
  // Late voiced/truncated speech and uncovered voiced regions prevent approval.
  vad_mode=6;result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.response_truncated);
  vad_mode=7;result=run(8,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.unexplained_speech_frames);
  vad_mode=8;result=run(8,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.unexplained_speech_frames==5);
  vad_mode=9;result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.unexplained_speech_frames==80);
  vad_mode=10;result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.unexplained_speech_frames);
  vad_mode=0;assert(run(2,80000).intent==QUIPUS_LOCAL_UNKNOWN);
  assert(run(5,80000).intent==QUIPUS_LOCAL_UNKNOWN);
  // The final partial block is inspected even outside the final full model context.
  vad_mode=5;pcm[79998]=5000;
  result=run(2,79999);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.ambiguous_frames);
  pcm[79998]=19;
  // A prompt answer has no quiet prefix; the quiet after the word calibrates.
  for(size_t i=0;i<80000;++i)pcm[i]=(i%2)?19:-19;
  for(size_t i=2*320;i<22*320;++i)pcm[i]=(i%2)?300:-300;
  vad_mode=13;result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_YES && result.diagnostics.background_verified);
  assert(result.diagnostics.background_rms==19 && !result.diagnostics.ambiguous_frames);
  // ...and a later quiet refusal missed by VAD still blocks approval.
  for(size_t i=76800;i<78400;++i)pcm[i]=(i%2)?35:-35;
  result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.ambiguous_frames==5);
  // Noise inside the post-answer calibration window is never accepted.
  for(size_t i=76800;i<78400;++i)pcm[i]=(i%2)?19:-19;
  for(size_t i=32*320;i<38*320;++i)pcm[i]=(i%2)?60:-60;
  result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && !result.diagnostics.background_verified);
  // Speech continuing to the end leaves nothing to calibrate from.
  for(size_t i=0;i<80000;++i)pcm[i]=(i%2)?300:-300;
  result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && !result.diagnostics.background_verified);
  // The live /s/ of "yes": VAD drops out mid-word while energy continues.
  for(size_t i=0;i<80000;++i)pcm[i]=(i%2)?13:-13;
  for(size_t i=20*320;i<46*320;++i)pcm[i]=(i%2)?300:-300;
  vad_mode=14;result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_YES && !result.diagnostics.ambiguous_frames);
  assert(!result.diagnostics.unexplained_speech_frames && result.diagnostics.background_verified);
  // An unvoiced ending is attached for at most200ms; anything longer is ambiguous.
  for(size_t i=0;i<80000;++i)pcm[i]=(i%2)?13:-13;
  for(size_t i=20*320;i<43*320;++i)pcm[i]=(i%2)?300:-300;
  vad_mode=15;result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.ambiguous_frames==2);
  // A quiet gap ends the word; a later burst is never attached to it.
  for(size_t i=0;i<80000;++i)pcm[i]=(i%2)?13:-13;
  for(size_t i=20*320;i<31*320;++i)pcm[i]=(i%2)?300:-300;
  for(size_t i=33*320;i<37*320;++i)pcm[i]=(i%2)?300:-300;
  result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.ambiguous_frames==4);
  // A single 20ms DC bump (board 2: three isolated blocks) is not speech;
  // a DC shift lasting100ms still blocks approval.
  for(size_t i=0;i<80000;++i)pcm[i]=(i%2)?19:-19;
  for(size_t i=16000;i<22400;++i)pcm[i]=(i%2)?300:-300;
  vad_mode=5;
  for(size_t i=188*320;i<189*320;++i)pcm[i]+=40;
  result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_YES && !result.diagnostics.ambiguous_frames);
  for(size_t i=189*320;i<193*320;++i)pcm[i]+=40;
  result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && result.diagnostics.ambiguous_frames==5);
  // Decaying startup DC cannot calibrate itself as harmless background.
  for(size_t i=0;i<80000;++i)pcm[i]=(int16_t)(2000-i/40);
  vad_mode=5;result=run(2,80000);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN && !result.diagnostics.background_verified);
  puts("PASS: local recognizer production orchestration; lateNO, unknown, failure, bounds, load-once and ownership guards");
}
