/* Production startup helpers; I2S and codec interfaces are fault-injected. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_ARG -2
#define ESP_ERR_INVALID_SIZE -3
#define ESP_ERR_NOT_FOUND -4
#define ESP_ERR_TIMEOUT -5
#define ESP_CODEC_DEV_OK 0
#define pdMS_TO_TICKS(ms) ((ms)*TEST_TICK_HZ/1000)
#define ESP_LOGI(...) ((void)0)
#define ESP_LOGW(...) ((void)0)
#define ESP_LOGE(...) ((void)0)
typedef void *i2s_chan_handle_t;
typedef struct {int unused;} audio_codec_ctrl_if_t;
typedef struct {int bits_per_sample,channel,sample_rate,mclk_multiple;} esp_codec_dev_sample_info_t;
static int adc,rx;
static void *s_input_codec=&adc;
static audio_codec_ctrl_if_t control;
static unsigned reads,register_reads,closes,opens,gains,delays,elapsed_ms,cases;
static unsigned zero_blocks,before_reopen_reads,read_error_at,short_read_at,bad_register_at;
static bool always_zero,mic2_only,reopened,recovered_quiet,ignored_close_error,ignored_open_error;
static bool first_junk,alternating;
static int close_result,open_result,gain_result,terminal_error;
static int16_t nonzero_value;
static int64_t esp_timer_get_time(void) {return (int64_t)elapsed_ms*1000;}
static void vTaskDelay(unsigned ticks) {assert(ticks==pdMS_TO_TICKS(20));++delays;elapsed_ms+=20;}
static esp_err_t i2s_channel_read(i2s_chan_handle_t handle,void *pcm,size_t capacity,size_t *bytes,unsigned timeout) {
  assert(handle==&rx&&pcm&&capacity==320*2*sizeof(int16_t));
  // i2s_channel_read timeout is milliseconds even when FreeRTOS ticks are10ms.
  assert(timeout==40);++reads;elapsed_ms+=20;
  memset(pcm,0,capacity);*bytes=capacity;
  if(read_error_at==reads){*bytes=0;return ESP_ERR_TIMEOUT;}
  if(short_read_at==reads){*bytes=capacity-4;return ESP_OK;}
  bool zero=always_zero||(!reopened&&reads<=zero_blocks);
  if(reopened&&recovered_quiet)zero=false;
  if(first_junk&&reads==1)zero=false;
  if(alternating)zero=reads%2==0;
  if(!zero)((int16_t *)pcm)[mic2_only?1:0]=nonzero_value;
  return ESP_OK;
}
static int esp_codec_dev_read_reg(void *codec,int reg,int *value) {
  const int expected[]={0x00,0x01,0x02,0x06,0x11,0x12,0x43,0x4b};
  assert(codec==&adc&&register_reads<8&&reg==expected[register_reads]);++register_reads;
  if(bad_register_at==register_reads){terminal_error=ESP_FAIL;return ESP_FAIL;}
  *value=0x41;return ESP_CODEC_DEV_OK;
}
static int quipus_codec_control_error(const audio_codec_ctrl_if_t *codec) {assert(codec==&control);return terminal_error;}
static int esp_codec_dev_close(void *codec) {
  assert(codec==&adc&&!reopened);++closes;before_reopen_reads=reads;
  if(ignored_close_error)terminal_error=ESP_FAIL;
  return close_result;
}
static int esp_codec_dev_open(void *codec,esp_codec_dev_sample_info_t *format) {
  assert(codec==&adc&&closes==1&&delays==1);
  assert(format&&format->sample_rate==16000&&format->channel==2&&format->bits_per_sample==16&&format->mclk_multiple==256);
  ++opens;if(ignored_open_error)terminal_error=ESP_FAIL;
  reopened=open_result==ESP_CODEC_DEV_OK;return open_result;
}
static int esp_codec_dev_set_in_gain(void *codec,float gain) {assert(codec==&adc&&reopened&&gain==30.0f);++gains;return gain_result;}
#include "mic_startup_under_test.c"
static esp_codec_dev_sample_info_t format={.bits_per_sample=16,.channel=2,.sample_rate=16000,.mclk_multiple=256};
static void reset(void) {
  reads=register_reads=closes=opens=gains=delays=elapsed_ms=0;
  zero_blocks=before_reopen_reads=read_error_at=short_read_at=bad_register_at=0;
  always_zero=mic2_only=reopened=recovered_quiet=ignored_close_error=ignored_open_error=false;
  first_junk=alternating=false;
  close_result=open_result=gain_result=terminal_error=ESP_CODEC_DEV_OK;
  nonzero_value=1;s_input_codec=&adc;
}
static esp_err_t validate(void) {++cases;return validate_microphone_startup(&rx,&control,&format);}
static void no_recovery(void) {assert(closes==0&&opens==0&&gains==0&&register_reads==0);}
int main(void) {
  /* Even +/-1 counts as healthy: no loudness threshold, no quiet-room reset. */
  reset();assert(validate()==ESP_OK&&reads==3&&elapsed_ms==60);no_recovery();
  reset();nonzero_value=-1;assert(validate()==ESP_OK&&reads==3);no_recovery();
  reset();nonzero_value=INT16_MAX;assert(validate()==ESP_OK&&reads==3);no_recovery();
  /* Warm-up zeros are tolerated across complete frames before any recovery. */
  reset();zero_blocks=5;assert(validate()==ESP_OK&&reads==8);no_recovery();
  reset();zero_blocks=11;assert(validate()==ESP_OK&&reads==14);no_recovery();
  reset();zero_blocks=16;recovered_quiet=true;
  assert(validate()==ESP_OK&&reads==19&&before_reopen_reads==16);
  assert(closes==1&&opens==1&&gains==1&&register_reads==8&&delays==1);
  reset();always_zero=true;
  assert(validate()==ESP_FAIL&&reads==32&&closes==1&&opens==1&&gains==1);
  assert(elapsed_ms==660); /* Exactly one reopen, never a retry loop. */
  reset();mic2_only=true;
  assert(validate()==ESP_FAIL&&reads==32&&closes==1); /* Runtime records MIC1. */
  // A stale DMA/transient frame or intermittent junk must not declare readiness.
  reset();always_zero=true;first_junk=true;
  assert(validate()==ESP_FAIL&&reads==32&&closes==1);
  reset();alternating=true;
  assert(validate()==ESP_FAIL&&reads==32&&closes==1);
  reset();read_error_at=1;assert(validate()==ESP_ERR_TIMEOUT&&reads==1);no_recovery();
  reset();short_read_at=1;assert(validate()==ESP_ERR_INVALID_SIZE&&reads==1);no_recovery();
  reset();zero_blocks=16;read_error_at=17;
  assert(validate()==ESP_ERR_TIMEOUT&&reads==17&&closes==1&&opens==1);
  reset();zero_blocks=16;short_read_at=17;
  assert(validate()==ESP_ERR_INVALID_SIZE&&reads==17&&closes==1);
  for(unsigned reg=1;reg<=8;++reg) {
    reset();always_zero=true;bad_register_at=reg;
    assert(validate()==ESP_FAIL&&reads==16&&register_reads==reg&&closes==0);
  }
  reset();always_zero=true;close_result=ESP_FAIL;
  assert(validate()==ESP_FAIL&&closes==1&&opens==0&&gains==0);
  reset();always_zero=true;ignored_close_error=true;
  assert(validate()==ESP_FAIL&&closes==1&&opens==0);
  reset();always_zero=true;open_result=ESP_FAIL;
  assert(validate()==ESP_FAIL&&closes==1&&opens==1&&gains==0&&reads==16);
  reset();always_zero=true;gain_result=ESP_FAIL;
  assert(validate()==ESP_FAIL&&closes==1&&opens==1&&gains==1&&reads==16);
  reset();zero_blocks=16;recovered_quiet=true;ignored_open_error=true;
  assert(validate()==ESP_FAIL&&reads==16&&terminal_error==ESP_FAIL); /* Never clear ignored driver failure. */
  reset();assert(validate_microphone_startup(NULL,&control,&format)==ESP_ERR_INVALID_ARG);no_recovery();++cases;
  reset();assert(validate_microphone_startup(&rx,NULL,&format)==ESP_ERR_INVALID_ARG);no_recovery();++cases;
  reset();assert(validate_microphone_startup(&rx,&control,NULL)==ESP_ERR_INVALID_ARG);no_recovery();++cases;
  reset();s_input_codec=NULL;assert(validate()==ESP_ERR_INVALID_ARG);no_recovery();
  printf("Startup-only actual ADC validation: %u cases passed at %d Hz; one reopen maximum, quiet PCM preserved\n",cases,TEST_TICK_HZ);
  return 0;
}
