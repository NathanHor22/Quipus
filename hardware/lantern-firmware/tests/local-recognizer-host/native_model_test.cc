#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>
#include "quipus_local_recognizer.h"
#include "quipus_local_inference.h"

static int16_t samples[QUIPUS_LOCAL_MAX_SAMPLES], yes[16000], no[16000];
static void background() {
  for(size_t i=0;i<QUIPUS_LOCAL_MAX_SAMPLES;++i)samples[i]=(i%2)?19:-19;
}
static void fixture(const char *path,int16_t *output) {
  FILE *file=std::fopen(path,"rb");assert(file);
  unsigned char header[44];assert(std::fread(header,1,44,file)==44);
  assert(std::memcmp(header,"RIFF",4)==0 && std::memcmp(header+8,"WAVE",4)==0);
  assert(std::fread(output,sizeof(int16_t),16000,file)==16000);
  std::fclose(file);
}
static quipus_local_result_t run(const char *label,int expected,bool navigation=false) {
  quipus_local_result_t result;
  assert((navigation ? quipus_local_recognizer_classify_navigation(samples,80000,&result)
                     : quipus_local_recognizer_classify(samples,80000,&result))==ESP_OK);
  std::printf("%s: intent=%d confidence=%u windows=%u\n",label,result.intent,result.confidence,result.windows);
  if(expected==-2 || (expected>=0 && result.intent!=expected)) {
    const auto &d=result.diagnostics;
    printf("diagnostic votes=%u/%u maybe=%u VAD=%u frames=%u last=%u bg=%u/%u ambiguous=%u unexplained=%u truncated=%u\n",
      d.yes_windows,d.no_windows,d.possible_no_windows,d.vad_available,d.vad_speech_frames,d.vad_last_speech_end_ms,
      d.background_verified,d.background_rms,d.ambiguous_frames,d.unexplained_speech_frames,d.response_truncated);
  }
  std::fflush(stdout);
  if(expected==-2) {
    // The synthetic host VAD is not ESP-SR. Require correct real numeric YES
    // evidence, but allow the conservative environmental admission to reject it.
    assert(result.intent==QUIPUS_LOCAL_YES || result.intent==QUIPUS_LOCAL_UNKNOWN);
    assert(result.diagnostics.yes_windows>=2 && result.diagnostics.no_windows==0);
  } else if(expected<0) assert(result.intent!=QUIPUS_LOCAL_YES);
  else assert(result.intent==expected);
  return result;
}
static void characterize() {
  const double scales[]={0.03,0.1,0.3};
  const int offsets[]={-1000,0,1000},leads[]={0,3200,16000,64000};
  puts("char,word,scale,dc,leading_ms,intent,confidence,yes_votes,no_votes,rms,peak_yes,peak_no");
  for(unsigned word=0;word<2;++word)for(double scale:scales)for(int offset:offsets)for(int lead:leads) {
    for(size_t i=0;i<80000;++i)samples[i]=(int16_t)offset;
    const int16_t *input=word?no:yes;
    for(int i=0;i<16000;++i)samples[lead+i]=(int16_t)(input[i]*scale+offset);
    quipus_local_result_t result;
    assert(quipus_local_recognizer_classify(samples,80000,&result)==ESP_OK);
    const auto &d=result.diagnostics;
    printf("char,%s,%.2f,%d,%d,%d,%u,%u,%u,%u,%u,%u\n",word?"no":"yes",scale,offset,lead/16,
      result.intent,result.confidence,d.yes_windows,d.no_windows,d.rms,
      d.peak_yes_scores[QUIPUS_LOCAL_YES],d.peak_no_scores[QUIPUS_LOCAL_NO]);
  }
}

static esp_err_t falsely_yes(const int16_t *,size_t,quipus_local_result_t *result) {
  *result={};result->intent=QUIPUS_LOCAL_YES;result->windows=41;return ESP_OK;
}
static esp_err_t falsely_no(const int16_t *,size_t,quipus_local_result_t *result) {
  *result={};result->intent=QUIPUS_LOCAL_NO;result->windows=41;return ESP_OK;
}
static esp_err_t failed_inference(const int16_t *,size_t,quipus_local_result_t *) {return ESP_FAIL;}
int main(int argc,char **argv) {
  assert(argc>=3);
  assert(quipus_local_recognizer_init()==ESP_OK);
  assert(quipus_local_recognizer_available());
  puts("PASS: exact public YES/NO startup numeric self-test before availability");
  assert(quipus_local_inference_self_test(falsely_yes)==ESP_FAIL);
  assert(quipus_local_inference_self_test(falsely_no)==ESP_FAIL);
  assert(quipus_local_inference_self_test(failed_inference)==ESP_FAIL);
  fixture(argv[1],yes);fixture(argv[2],no);
  background();std::memcpy(samples+16000,yes,sizeof(yes));
  assert(run("official YES numeric evidence with synthetic activity",-2).windows==41);
  assert(run("official YES navigation with synthetic activity",QUIPUS_LOCAL_YES,true).windows==41);
  background();std::memcpy(samples+16000,no,sizeof(no));
  assert(run("official NO",QUIPUS_LOCAL_NO).windows==41);
  assert(run("official NO navigation with synthetic activity",QUIPUS_LOCAL_NO,true).windows==41);
  background();std::memcpy(samples+16000,yes,sizeof(yes));
  std::memcpy(samples+64000,no,sizeof(no));run("YES then late NO",QUIPUS_LOCAL_NO);
  background();std::memcpy(samples+16000,no,sizeof(no));
  std::memcpy(samples+64000,yes,sizeof(yes));run("NO then late YES",QUIPUS_LOCAL_NO);
  std::memset(samples,0,sizeof(samples));run("zero silence",QUIPUS_LOCAL_SILENCE);
  for(size_t i=0;i<80000;++i)samples[i]=(int16_t)(5000*std::sin(2*3.141592653589793*1000*i/16000));
  run("steady 1kHz tone",-1);
  uint32_t noise=7;
  for(size_t i=0;i<80000;++i){noise=noise*1664525U+1013904223U;samples[i]=(int16_t)((noise>>16)%1001)-500;}
  run("deterministic noise",-1);
  for(int arg=3;arg<argc;++arg) {
    if(std::strcmp(argv[arg],"--characterize")==0){characterize();continue;}
    std::memset(samples,0,sizeof(samples));FILE *file=std::fopen(argv[arg],"rb");assert(file);
    assert(std::fread(samples,sizeof(int16_t),80000,file)>0);std::fclose(file);
    run("provided unknown/own-playback PCM",-1);
  }
  // Repeating YES after unrelated utterances checks frontend reset and tensor lifetime.
  background();std::memcpy(samples+16000,yes,sizeof(yes));
  run("YES numeric evidence after reset",-2);
  puts("PASS: real models/frontend/production adapter; physical acoustic acceptance remains required");
}
