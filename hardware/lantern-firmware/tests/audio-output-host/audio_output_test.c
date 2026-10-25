/* The source under test is extracted from the production audio driver. */
#include <assert.h>
#include <setjmp.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "quipus_volume.h"

typedef int esp_err_t;
typedef unsigned TickType_t;
typedef void *i2s_chan_handle_t;
typedef void *SemaphoreHandle_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_TIMEOUT -2
#define ESP_ERR_INVALID_STATE -3
#define ESP_ERR_INVALID_SIZE -4
#define pdTRUE 1
#define pdFALSE 0
#define pdMS_TO_TICKS(ms) ((unsigned)(ms) * TEST_TICK_HZ / 1000U)
#define CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154 TEST_WAVE
#define LANTERN_AUDIO_SHARED_BUS TEST_SHARED
#define LANTERN_AUDIO_ADC_ES7210 TEST_WAVE
#define AUDIO_WRITE_SAMPLES 240
#define LANTERN_SPK_SAMPLE_RATE 16000U
#define LANTERN_TTS_SAMPLE_RATE 24000U
#define PCM_PREFILL_BYTES (LANTERN_TTS_SAMPLE_RATE*sizeof(int16_t)*2U/5U)
#define PCM_REBUFFER_BYTES (LANTERN_TTS_SAMPLE_RATE*sizeof(int16_t)/8U)
#define portMAX_DELAY UINT32_MAX
static void *s_pcm_stream=(void*)3;
static SemaphoreHandle_t s_pcm_finished=(void*)4;
static volatile bool s_pcm_playing,s_pcm_cancelled,s_pcm_input_finished,s_pcm_failed;
static uint8_t stream_data[4096];
static size_t stream_length,stream_offset,last_receive_start,last_receive_count;
static unsigned notify_calls,finished_gives,reference_calls,active_updates,idle_updates;
static bool pcm_testing,cancel_after_data,try_reentrant_chime,finish_after_delay;
static jmp_buf task_exit;
void lantern_audio_chime(unsigned count);

static const char *TAG="audio-output-host";
static i2s_chan_handle_t s_speaker;
static SemaphoreHandle_t s_speaker_lock;
static volatile bool s_speaker_active;
static atomic_uint s_volume;
typedef struct {
  uint8_t valid_mask,values[4];
  int read_status[4],control_error;
  bool repair_attempted,repair_verified;
} lantern_board_speaker_state_t;

enum {EV_LOCK=1,EV_PREPARE,EV_WRITE,EV_PRELOAD,EV_ENABLE,EV_AMP_ON,EV_AMP_OFF,EV_DISABLE,EV_UNLOCK};
static unsigned trace[128],trace_count,case_count;
static bool lock_allowed,lock_held,amp_enabled;
static unsigned takes,gives,prepare_calls,prepared_volume,enable_calls,disable_calls,preload_calls;
static unsigned delays,write_calls,level_calls,fail_write,short_write;
static esp_err_t prepare_result,preload_result,enable_result;
static bool short_preload;
static unsigned info_count,error_count,warning_count;
static char info[8][512],errors[8][512];
typedef struct {size_t length,written;unsigned timeout;bool allzero,amp;int64_t peak;esp_err_t result;} write_t;
static write_t writes[64];
static void event(unsigned value){assert(trace_count<128);trace[trace_count++]=value;}
static const char *esp_err_to_name(esp_err_t result){return result==ESP_OK?"ESP_OK":result==ESP_FAIL?"ESP_FAIL":result==ESP_ERR_TIMEOUT?"ESP_ERR_TIMEOUT":"ESP_ERR_INVALID_STATE";}
static void log_info(const char *tag,const char *fmt,...){assert(tag==TAG&&info_count<8);va_list args;va_start(args,fmt);vsnprintf(info[info_count++],512,fmt,args);va_end(args);}
static void log_error(const char *tag,const char *fmt,...){assert(tag==TAG&&error_count<8);va_list args;va_start(args,fmt);vsnprintf(errors[error_count++],512,fmt,args);va_end(args);}
static void log_warning(const char *tag,const char *fmt,...){assert(tag==TAG&&fmt);++warning_count;}
#define ESP_LOGI(...) log_info(__VA_ARGS__)
#define ESP_LOGE(...) log_error(__VA_ARGS__)
#define ESP_LOGW(...) log_warning(__VA_ARGS__)
#define ESP_ERROR_CHECK_WITHOUT_ABORT(expr) do{if((expr)!=ESP_OK)++error_count;}while(0)
#define ESP_RETURN_ON_ERROR(expr,tag,msg) do{esp_err_t _result=(expr);if(_result!=ESP_OK){ESP_LOGE(tag,"%s",msg);return _result;}}while(0)
static int xSemaphoreTake(SemaphoreHandle_t handle,unsigned ticks){assert(handle==s_speaker_lock&&ticks==500U*TEST_TICK_HZ/1000U);++takes;event(EV_LOCK);if(!lock_allowed||lock_held)return pdFALSE;lock_held=true;return pdTRUE;}
static int xSemaphoreGive(SemaphoreHandle_t handle){if(handle==s_pcm_finished){assert(!lock_held&&!s_pcm_playing&&!s_speaker_active);++finished_gives;return pdTRUE;}assert(handle==s_speaker_lock&&lock_held);lock_held=false;++gives;event(EV_UNLOCK);return pdTRUE;}
static void vTaskDelay(unsigned ticks){assert(ticks==20U*TEST_TICK_HZ/1000U||ticks==90U*TEST_TICK_HZ/1000U||(pcm_testing&&(ticks==5U*TEST_TICK_HZ/1000U||ticks==2U*TEST_TICK_HZ/1000U)));assert(++delays<100);if(finish_after_delay){finish_after_delay=false;s_pcm_input_finished=true;}}
static uint32_t lantern_audio_level(void){return 20U+level_calls++;}
#if TEST_WAVE
static esp_err_t lantern_board_speaker_prepare_output(unsigned volume,lantern_board_speaker_state_t *state){assert(lock_held&&s_speaker_active&&!amp_enabled&&state);++prepare_calls;prepared_volume=volume;event(EV_PREPARE);state->valid_mask=15;state->repair_verified=volume!=0;return prepare_result;}
#endif
static void lantern_board_speaker_enable(bool enabled){assert(lock_held);if(enabled){assert(!amp_enabled);event(EV_AMP_ON);}else event(EV_AMP_OFF);amp_enabled=enabled;}
static esp_err_t i2s_channel_write(i2s_chan_handle_t channel,const void *data,size_t length,size_t *written,unsigned timeout_ms){assert(channel==s_speaker&&data&&written&&lock_held&&write_calls<64);assert(timeout_ms==100U||(pcm_testing&&timeout_ms==250U));/* I2S uses milliseconds, independent of FreeRTOS tick rate. */event(EV_WRITE);write_t *w=&writes[write_calls++];*w=(write_t){.length=length,.timeout=timeout_ms,.allzero=true,.amp=amp_enabled,.result=ESP_OK};
#if TEST_SHARED
  assert(length<=(AUDIO_WRITE_SAMPLES*(TEST_WAVE?2U:1U)*sizeof(int16_t)));if(timeout_ms==100U)assert(length==AUDIO_WRITE_SAMPLES*(TEST_WAVE?2U:1U)*sizeof(int16_t));const int16_t *samples=data;size_t count=length/sizeof(*samples);
#else
  assert(length<=AUDIO_WRITE_SAMPLES*sizeof(int32_t));if(timeout_ms==100U)assert(length==AUDIO_WRITE_SAMPLES*sizeof(int32_t));const int32_t *samples=data;size_t count=length/sizeof(*samples);
#endif
  for(size_t i=0;i<count;++i){int64_t n=samples[i];if(n)w->allzero=false;if(n<0)n=-n;if(n>w->peak)w->peak=n;}
#if TEST_WAVE
  for(size_t i=0;i<count;i+=2)assert(samples[i]==samples[i+1]);
#endif
  w->result=write_calls==fail_write?ESP_ERR_TIMEOUT:ESP_OK;*written=write_calls==short_write?length/2:(w->result==ESP_OK?length:0);w->written=*written;if(timeout_ms==250U){assert(amp_enabled);if(try_reentrant_chime){try_reentrant_chime=false;unsigned before=write_calls;lantern_audio_chime(1);assert(write_calls==before&&lock_held);}if(cancel_after_data){cancel_after_data=false;s_pcm_cancelled=true;}}return w->result;}
#if !TEST_SHARED
static esp_err_t i2s_channel_preload_data(i2s_chan_handle_t channel,const void *data,size_t length,size_t *written){assert(channel==s_speaker&&lock_held&&!amp_enabled);const uint8_t *b=data;for(size_t i=0;i<length;++i)assert(b[i]==0);++preload_calls;event(EV_PRELOAD);*written=short_preload?length/2:length;return preload_result;}
static esp_err_t i2s_channel_enable(i2s_chan_handle_t channel){assert(channel==s_speaker&&lock_held);++enable_calls;event(EV_ENABLE);return enable_result;}
static esp_err_t i2s_channel_disable(i2s_chan_handle_t channel){assert(channel==s_speaker&&lock_held&&!amp_enabled);++disable_calls;event(EV_DISABLE);return ESP_OK;}
#endif

static unsigned ulTaskNotifyTake(int clear,unsigned timeout){assert(clear==pdTRUE&&timeout==portMAX_DELAY);if(notify_calls++){assert(finished_gives==1);longjmp(task_exit,1);}assert(lock_held&&s_pcm_playing);return 1;}
static size_t xStreamBufferBytesAvailable(void *handle){assert(handle==s_pcm_stream);return stream_length-stream_offset;}
static size_t xStreamBufferReceive(void *handle,void *out,size_t wanted,unsigned ticks){assert(handle==s_pcm_stream&&ticks==0&&wanted<=stream_length-stream_offset);last_receive_start=stream_offset;last_receive_count=wanted;memcpy(out,stream_data+stream_offset,wanted);stream_offset+=wanted;return wanted;}
static int16_t source_sample(size_t sample){return (int16_t)((int)(sample%5U)*1000-2000);}
static void report_listener_reference(const int16_t *samples,size_t count){assert(count==last_receive_count/sizeof(int16_t)*LANTERN_SPK_SAMPLE_RATE/LANTERN_TTS_SAMPLE_RATE);for(size_t i=0;i<count;++i){size_t source=last_receive_start/2+i*LANTERN_TTS_SAMPLE_RATE/LANTERN_SPK_SAMPLE_RATE;assert(samples[i]==quipus_volume_sample(source_sample(source),atomic_load(&s_volume)));}++reference_calls;}
static void lantern_display_set_speech_level(unsigned level,bool active){assert(level<=100);if(active)++active_updates;else{assert(level==0);++idle_updates;}}

#include "audio_output_under_test.c"

static void reset(void){memset(trace,0,sizeof(trace));memset(writes,0,sizeof(writes));memset(info,0,sizeof(info));memset(errors,0,sizeof(errors));trace_count=takes=gives=prepare_calls=prepared_volume=enable_calls=disable_calls=preload_calls=delays=write_calls=level_calls=fail_write=short_write=info_count=error_count=warning_count=0;lock_allowed=true;lock_held=amp_enabled=s_speaker_active=false;prepare_result=preload_result=enable_result=ESP_OK;short_preload=false;s_speaker=(void*)1;s_speaker_lock=(void*)2;atomic_store(&s_volume,80);stream_length=stream_offset=last_receive_start=last_receive_count=0;notify_calls=finished_gives=reference_calls=active_updates=idle_updates=0;pcm_testing=cancel_after_data=try_reentrant_chime=finish_after_delay=false;s_pcm_playing=s_pcm_cancelled=s_pcm_input_finished=s_pcm_failed=false;++case_count;}
static void cleaned(void){assert(!lock_held&&!amp_enabled&&!s_speaker_active&&gives==1&&trace[trace_count-1]==EV_UNLOCK);}
static void normal(unsigned tones,unsigned volume){reset();atomic_store(&s_volume,volume);lantern_audio_chime(tones);cleaned();assert(takes==1&&error_count==0);
#if TEST_WAVE
  assert(prepare_calls==1&&prepared_volume==volume&&trace[1]==EV_PREPARE&&trace[2]==EV_WRITE&&trace[3]==EV_AMP_ON);
#else
  assert(prepare_calls==0);
#endif
  unsigned start=TEST_SHARED?1U:0U;assert(write_calls==start+12U*tones+1U);for(unsigned i=start;i<start+12U*tones;++i){assert(writes[i].amp&&writes[i].written==writes[i].length);assert(writes[i].allzero==(volume==0));int64_t peak=5040U*volume/100U;if(!TEST_SHARED)peak*=32768;assert(writes[i].peak==peak);}assert(writes[write_calls-1].allzero);
  if(TEST_SHARED)assert(writes[0].allzero&&!writes[0].amp);else assert(preload_calls==1&&enable_calls==1&&disable_calls==1);
  assert(strstr(info[info_count-1],tones==2?"frames=5760":"frames=2880"));assert(strstr(info[info_count-1],"status=ESP_OK"));assert(atomic_load(&s_volume)==volume);
}
static void data_failure(bool partial,unsigned chunk){reset();unsigned start=TEST_SHARED?1U:0U;unsigned index=start+chunk+1U;if(partial)short_write=index;else fail_write=index;lantern_audio_chime(3);cleaned();assert(error_count==1&&strstr(errors[0],"chime I2S write failed"));assert(write_calls==index+1U);assert(writes[write_calls-1].allzero);assert(strstr(info[info_count-1],partial?"status=ESP_FAIL":"status=ESP_ERR_TIMEOUT"));char frames[40];snprintf(frames,sizeof(frames),"frames=%u",chunk*AUDIO_WRITE_SAMPLES);assert(strstr(info[info_count-1],frames));}

/* Run one actual singleton-task turn, escaping only at its next idle wait. */
static void pcm_turn(unsigned volume,size_t bytes,bool finished){pcm_testing=true;atomic_store(&s_volume,volume);stream_length=bytes;stream_offset=0;for(size_t i=0;i<bytes/2;++i){int16_t sample=source_sample(i);stream_data[i*2]=(uint8_t)sample;stream_data[i*2+1]=(uint8_t)((uint16_t)sample>>8);}lock_held=s_speaker_active=s_pcm_playing=true;s_pcm_input_finished=finished;if(!setjmp(task_exit))pcm_playback_task(NULL);cleaned();assert(finished_gives==1&&idle_updates==1);}
static void pcm_suite(void){
 reset();pcm_turn(80,720,true);assert(!s_pcm_failed&&write_calls==(TEST_SHARED?4U:3U)&&reference_calls==2&&active_updates==2);assert(strstr(info[info_count-1],"submitted_frames=240 written_frames=240"));assert(strstr(info[info_count-1],"volume=80 failed=0 cancelled=0"));for(unsigned i=TEST_SHARED?1U:0U;i<write_calls-1;++i)assert(writes[i].timeout==250&&writes[i].amp&&!writes[i].allzero);
 reset();pcm_turn(0,720,true);assert(!s_pcm_failed&&reference_calls==2);for(unsigned i=0;i<write_calls;++i)assert(writes[i].allzero);assert(strstr(info[info_count-1],"nonzero=0 peak=0 volume=0"));
 reset();fail_write=TEST_SHARED?2U:1U;pcm_turn(80,720,true);assert(s_pcm_failed&&reference_calls==0&&active_updates==0&&error_count==1);assert(write_calls==fail_write+1U);assert(strstr(info[info_count-1],"submitted_frames=160 written_frames=0"));assert(strstr(errors[0],"PCM I2S write failed"));
 reset();short_write=TEST_SHARED?2U:1U;pcm_turn(80,720,true);assert(s_pcm_failed&&reference_calls==0&&active_updates==0&&error_count==1&&write_calls==short_write+1U);
 reset();s_pcm_cancelled=true;pcm_turn(80,720,true);assert(!write_calls&&!prepare_calls&&!reference_calls&&!s_pcm_failed);assert(strstr(info[info_count-1],"cancelled=1"));
 reset();cancel_after_data=true;pcm_turn(80,720,true);assert(s_pcm_cancelled&&!s_pcm_failed&&reference_calls==1&&write_calls==(TEST_SHARED?3U:2U));assert(strstr(info[info_count-1],"submitted_frames=160 written_frames=160"));
 reset();pcm_turn(80,0,true);assert(s_pcm_failed&&!write_calls&&!reference_calls&&error_count==1);assert(strstr(errors[0],"PCM speaker start failed"));
 reset();pcm_turn(80,1,true);assert(s_pcm_failed&&reference_calls==0&&write_calls==(TEST_SHARED?2U:1U));
 reset();finish_after_delay=true;pcm_turn(80,720,false);assert(!s_pcm_failed&&delays>=1&&reference_calls==2);/* Late completion safely releases the prefill wait. */
 reset();try_reentrant_chime=true;pcm_turn(80,720,true);assert(!s_pcm_failed&&takes==1&&reference_calls==2&&write_calls==(TEST_SHARED?4U:3U));/* Mutex refusal protects singleton workspaces. */
#if TEST_WAVE
 reset();prepare_result=ESP_FAIL;pcm_turn(80,720,true);assert(s_pcm_failed&&prepare_calls==1&&!write_calls&&reference_calls==0);
#endif
}

int main(void){
 (void)log_warning;
 reset();s_speaker=NULL;lantern_audio_chime(1);assert(!takes&&!write_calls&&!prepare_calls&&!gives);
 reset();s_speaker_lock=NULL;lantern_audio_chime(1);assert(!takes&&!write_calls&&!prepare_calls&&!gives);
 reset();lock_allowed=false;lantern_audio_chime(1);assert(takes==1&&!prepare_calls&&!write_calls&&!gives&&!s_speaker_active);
#if TEST_WAVE
 reset();prepare_result=ESP_FAIL;lantern_audio_chime(1);cleaned();assert(prepare_calls==1&&!write_calls&&error_count==1&&strstr(errors[0],"speaker start failed"));assert(trace_count==3&&trace[1]==EV_PREPARE);
#endif
 normal(1,80);normal(2,80);normal(1,0);normal(1,100);
 data_failure(false,0);data_failure(false,5);data_failure(true,0);data_failure(true,7);
#if TEST_SHARED
 reset();fail_write=1;lantern_audio_chime(1);cleaned();assert(write_calls==1&&!writes[0].amp&&error_count==2&&strstr(errors[0],"silence preload failed")&&strstr(errors[1],"speaker start failed"));
 reset();short_write=1;lantern_audio_chime(1);cleaned();assert(write_calls==1&&!writes[0].amp&&error_count==2&&strstr(errors[0],"silence preload failed")&&strstr(errors[1],"speaker start failed"));
#else
 reset();preload_result=ESP_FAIL;lantern_audio_chime(1);cleaned();assert(preload_calls==1&&!enable_calls&&!write_calls&&error_count>=1);
 reset();enable_result=ESP_FAIL;lantern_audio_chime(1);cleaned();assert(preload_calls==1&&enable_calls==1&&!write_calls&&error_count==1);
#endif
 reset();unsigned final=TEST_SHARED?14U:13U;fail_write=final;lantern_audio_chime(1);cleaned();assert(write_calls==final&&writes[final-1].allzero);/* Cleanup must still mute and unlock if silence flush fails. */
 pcm_suite();
 printf("PASS: %u actual speaker output cases wave=%d shared=%d tick_hz=%d; prepare/lock admission, nonzero80%%, muted0%%, partial/error cleanup, singletonPCM turns and100/250ms I2S timeouts\n",case_count,TEST_WAVE,TEST_SHARED,TEST_TICK_HZ);return 0;
}
