/* Wave deliberately supplies NO AEC/VAD/barge symbols, declarations or state. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
typedef int esp_err_t;
typedef unsigned TickType_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NOT_SUPPORTED -2
#define RETRY_BUFFER_SAMPLES 16
#define portTICK_PERIOD_MS 1
#define pdMS_TO_TICKS(ms) (ms)
static int16_t buffer[RETRY_BUFFER_SAMPLES];
static size_t s_sample_count,s_write_index;
#if !CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
static int16_t *s_retry_buffer=buffer;
static bool s_recording;
static unsigned clock_ms,init_calls,enable_calls,reset_calls,feed_calls,reference_calls,warnings;
static unsigned ready_after;
static bool enabled,event,pending,ready;
static esp_err_t init_result;
static size_t captured;
static const int16_t *expected_samples;
static const char *TAG="admission-host";
static const char *esp_err_to_name(esp_err_t error) { assert(error==ESP_FAIL); return "fixture"; }
static void log_warning(const char *tag,const char *format,const char *detail) {
  assert(tag==TAG && format && detail); ++warnings;
}
#define ESP_LOGW(...) log_warning(__VA_ARGS__)
static esp_err_t quipus_barge_in_init(void) { ++init_calls; return init_result; }
static void quipus_barge_in_enable(bool value) { enabled=value; ++enable_calls; }
static void quipus_barge_in_reset(void) { enabled=event=pending=ready=false; ++reset_calls; }
static void quipus_barge_in_feed(const int16_t *samples,size_t count) {
  assert(samples==expected_samples && count==8); ++feed_calls;
}
static void quipus_barge_in_reference(const int16_t *samples,size_t count) {
  assert(samples==expected_samples && count==8); ++reference_calls;
}
static bool quipus_barge_in_take_event(void) { bool result=event; event=false; return result; }
static bool quipus_barge_in_capture_pending(void) { return pending; }
static bool quipus_barge_in_capture_ready(void) { return ready; }
static size_t quipus_barge_in_take_audio(int16_t *out,size_t capacity) {
  assert(out==buffer && capacity==RETRY_BUFFER_SAMPLES);
  for(size_t i=0;i<captured;++i) out[i]=(int16_t)(700+i);
  return captured;
}
static TickType_t xTaskGetTickCount(void) { return clock_ms; }
static void vTaskDelay(unsigned ms) {
  assert(ms==20); clock_ms+=ms; if(ready_after && clock_ms>=ready_after) ready=true;
}
#endif
#include "audio_admission_under_test.c"

int main(void) {
  int16_t loud_speaker_echo[8]={30000,-30000,30000,-30000,30000,-30000,30000,-30000};
  for(size_t i=0;i<RETRY_BUFFER_SAMPLES;++i) buffer[i]=(int16_t)(1000+i);
  s_sample_count=13; s_write_index=9;
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  report_listener_init();
  for(unsigned turn=0;turn<20;++turn) {
    lantern_audio_set_report_listening(true);
    report_listener_reference(loud_speaker_echo,8);
    report_listener_feed(loud_speaker_echo,8);
    assert(!lantern_audio_take_speech_interrupt());
    assert(!lantern_audio_capture_interruption(7500));
    lantern_audio_set_report_listening(false);
    lantern_audio_reset_report_listening();
  }
  assert(!lantern_audio_capture_interruption(0));
  assert(s_sample_count==13 && s_write_index==9);
  for(size_t i=0;i<RETRY_BUFFER_SAMPLES;++i) assert(buffer[i]==(int16_t)(1000+i));
  puts("PASS: actual Wave audio paths admit no speaker echo, allocate/init no DSP, cannot enable/capture barge, and preserve private audio; no DSP symbols linked");
#else
  expected_samples=loud_speaker_echo;
  init_result=ESP_OK; report_listener_init(); assert(init_calls==1 && warnings==0);
  init_result=ESP_ERR_NOT_SUPPORTED; report_listener_init(); assert(init_calls==2 && warnings==0);
  init_result=ESP_FAIL; report_listener_init(); assert(init_calls==3 && warnings==1);
  lantern_audio_set_report_listening(true); assert(enabled && enable_calls==1);
  report_listener_reference(loud_speaker_echo,8); report_listener_feed(loud_speaker_echo,8);
  assert(reference_calls==1 && feed_calls==1);
  event=true; assert(lantern_audio_take_speech_interrupt()); assert(!lantern_audio_take_speech_interrupt());
  assert(!lantern_audio_capture_interruption(100) && s_sample_count==13);
  pending=true; ready=true; captured=4;
  assert(lantern_audio_capture_interruption(100) && s_sample_count==4 && s_write_index==4);
  for(unsigned i=0;i<4;++i) assert(buffer[i]==(int16_t)(700+i));
  s_recording=true; assert(!lantern_audio_capture_interruption(100)); s_recording=false;
  ready=false; ready_after=40; clock_ms=0;
  assert(lantern_audio_capture_interruption(100) && clock_ms==40);
  ready=false; ready_after=0; clock_ms=0; pending=true;
  assert(!lantern_audio_capture_interruption(60) && clock_ms==60 && reset_calls==1);
  lantern_audio_set_report_listening(false); assert(!enabled && enable_calls==2);
  lantern_audio_reset_report_listening(); assert(reset_calls==2);
  puts("PASS: legacy audio forwarding, unsupported/init failure, event/capture, recording guard and bounded capture timeout remain unchanged");
#endif
  return 0;
}
