#ifdef NDEBUG
#undef NDEBUG
#endif
#include <assert.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>
#include "lantern_board_io.h"
#define ESP_CODEC_DEV_OK ESP_OK
#define LANTERN_AUDIO_AMP_ENABLE_GPIO 7
#define GPIO_OUT_REG 1
#define GPIO_ENABLE_REG 2
#define REG_READ(address) test_register_read(address)
#define ESP_LOGI(...) test_log(__VA_ARGS__)
#define ESP_LOGE(...) test_log(__VA_ARGS__)
#define ESP_LOGW(...) test_log(__VA_ARGS__)
#define TAG "lantern_board_io"
void test_log(const char *tag,const char *format,...) {(void)tag;(void)format;}
static unsigned checks;
#define CHECK(condition) do {assert(condition);++checks;} while(0)

#if LANTERN_AUDIO_CODEC_ES8311
static int gpio_result;
static uint32_t gpio_out;
static unsigned gpio_writes;
esp_err_t gpio_set_level(int pin,int level) {
  assert(pin==7 && (level==0 || level==1));++gpio_writes;
  if(gpio_result==ESP_OK) {
    if(level)gpio_out|=1U<<7;else gpio_out&=~(1U<<7);
  }
  return gpio_result;
}
#if LANTERN_AUDIO_ADC_ES7210
static uint32_t gpio_enabled;
static void *s_codec;
typedef struct {int tag;} audio_codec_ctrl_if_t;
static const audio_codec_ctrl_if_t output_control={1};
static const audio_codec_ctrl_if_t *s_output_control;
static atomic_bool s_speaker_requested;
static atomic_int s_speaker_write_status;
static uint8_t registers[256],read_order[8];
static unsigned reads,writes,read_fail_at,latch_at_read;
static int sticky_error,write_error;
static bool latch_on_write,ignore_write,wrong_readback;
static int last_write_reg,last_write_value;
#define READ_FAILURE -601
#define WRITE_FAILURE -602
#define CONTROL_FAILURE -603
uint32_t test_register_read(unsigned address) {
  assert(address==GPIO_OUT_REG || address==GPIO_ENABLE_REG);
  return address==GPIO_OUT_REG?gpio_out:gpio_enabled;
}
int esp_codec_dev_read_reg(void *codec,int reg,int *value) {
  assert(codec==s_codec && codec && reg>=0 && reg<=255 && value);
  assert(reads<sizeof(read_order));read_order[reads++]=(uint8_t)reg;
  *value=0xa5; /* A failed transport may modify its output. */
  if(latch_at_read==reads)sticky_error=CONTROL_FAILURE;
  if(read_fail_at==reads)return READ_FAILURE;
  *value=registers[reg];
  if(wrong_readback && reads==5)*value^=1;
  return ESP_OK;
}
int esp_codec_dev_write_reg(void *codec,int reg,int value) {
  assert(codec==s_codec && codec);
  assert(reg==0x31 && value>=0 && value<=255); /* Gain/power/reset writes forbidden. */
  ++writes;assert(writes==1);last_write_reg=reg;last_write_value=value;
  if(latch_on_write)sticky_error=CONTROL_FAILURE;
  if(write_error)return write_error;
  if(!ignore_write)registers[reg]=(uint8_t)value;
  return ESP_OK;
}
int quipus_codec_control_error(const audio_codec_ctrl_if_t *control) {
  assert(control==&output_control);return sticky_error;
}
static void reset(void) {
  memset(registers,0,sizeof(registers));memset(read_order,0,sizeof(read_order));
  registers[0x31]=0x85;registers[0x32]=0xb7;
  registers[0x0d]=0x01;registers[0x12]=0x00;
  s_codec=(void *)&output_control;s_output_control=&output_control;
  atomic_store(&s_speaker_requested,false);atomic_store(&s_speaker_write_status,ESP_OK);
  gpio_out=0;gpio_enabled=1U<<7;gpio_result=ESP_OK;gpio_writes=0;
  reads=writes=read_fail_at=latch_at_read=0;
  sticky_error=write_error=0;latch_on_write=ignore_write=wrong_readback=false;
  last_write_reg=last_write_value=-1;
}
#endif
#endif

#include "output_probe_under_test.c"

int main(void) {
  lantern_board_speaker_state_t state;
  CHECK(lantern_board_speaker_probe(NULL)==ESP_ERR_INVALID_ARG);
  CHECK(lantern_board_speaker_prepare_output(80,NULL)==ESP_ERR_INVALID_ARG);
#if LANTERN_AUDIO_CODEC_ES8311 && LANTERN_AUDIO_ADC_ES7210
  reset();memset(&state,0xa5,sizeof(state));
  CHECK(lantern_board_speaker_probe(&state)==ESP_OK);
  CHECK(reads==4 && !writes && state.valid_mask==15);
  CHECK(!memcmp(read_order,(uint8_t[]){0x31,0x32,0x0d,0x12},4));
  CHECK(state.values[LANTERN_SPEAKER_PROBE_VOLUME]==0xb7);
  for(unsigned i=0;i<4;++i)CHECK(state.read_status[i]==ESP_OK);
  CHECK(!state.repair_attempted && !state.repair_verified);
  CHECK(state.amp_output_level==0 && state.amp_output_enabled);
  reset();s_codec=NULL;CHECK(lantern_board_speaker_probe(&state)==ESP_ERR_INVALID_STATE);
  CHECK(!reads && !writes && !state.valid_mask);
  reset();s_output_control=NULL;CHECK(lantern_board_speaker_prepare_output(80,&state)==ESP_ERR_INVALID_STATE);
  CHECK(!reads && !writes);
  /* Every failed read invalidates that byte and forbids a read-modify-write. */
  for(unsigned fail=1;fail<=4;++fail) {
    reset();registers[0x31]=0xe5;read_fail_at=fail;
    CHECK(lantern_board_speaker_prepare_output(80,&state)==READ_FAILURE);
    CHECK(reads==4 && !writes && !state.repair_attempted);
    CHECK(state.valid_mask==(uint8_t)(15U&~(1U<<(fail-1))));
    CHECK(state.read_status[fail-1]==READ_FAILURE && state.values[fail-1]==0xff);
  }
  /* A swallowed transport error is still terminal even when all reads report OK. */
  for(unsigned point=0;point<=4;++point) {
    reset();registers[0x31]=0xe5;
    if(point)latch_at_read=point;else sticky_error=CONTROL_FAILURE;
    CHECK(lantern_board_speaker_prepare_output(80,&state)==CONTROL_FAILURE);
    CHECK(!writes && !state.repair_attempted && state.control_error==CONTROL_FAILURE);
    CHECK(sticky_error==CONTROL_FAILURE);
  }
  reset();registers[0x31]=0xe5;
  CHECK(lantern_board_speaker_prepare_output(0,&state)==ESP_OK);
  CHECK(!writes && registers[0x31]==0xe5 && !state.repair_attempted);
  reset();CHECK(lantern_board_speaker_prepare_output(80,&state)==ESP_OK);
  CHECK(!writes && reads==4 && !state.repair_attempted);
  /* Exact vendor mute mask; all unrelated bits and hardware gain remain intact. */
  for(unsigned bits=0;bits<256;++bits) {
    if(!(bits&0x60))continue;
    reset();registers[0x31]=(uint8_t)bits;
    CHECK(lantern_board_speaker_prepare_output(80,&state)==ESP_OK);
    CHECK(writes==1 && reads==5 && last_write_reg==0x31);
    CHECK(last_write_value==(int)(bits&0x9f) && registers[0x31]==(bits&0x9f));
    CHECK(state.mute_before==bits && state.repair_attempted && state.repair_verified);
    CHECK(state.values[LANTERN_SPEAKER_PROBE_MUTE]==(bits&0x9f));
    CHECK(registers[0x32]==0xb7 && registers[0x0d]==1 && registers[0x12]==0);
  }
  /* Unknown power states get diagnosis only: never power/gain/reset writes. */
  for(unsigned index=0;index<2;++index) for(unsigned value=0;value<256;++value) {
    if(value==(index?0U:1U))continue;
    reset();registers[0x31]=0xe5;registers[index?0x12:0x0d]=(uint8_t)value;
    CHECK(lantern_board_speaker_prepare_output(80,&state)==ESP_ERR_INVALID_STATE);
    CHECK(!writes && !state.repair_attempted && registers[0x31]==0xe5);
    CHECK(registers[0x32]==0xb7 && !sticky_error);
  }
  reset();registers[0x31]=0xe5;write_error=WRITE_FAILURE;
  CHECK(lantern_board_speaker_prepare_output(80,&state)==WRITE_FAILURE);
  CHECK(writes==1 && reads==4 && state.repair_attempted && !state.repair_verified);
  CHECK(state.repair_write_status==WRITE_FAILURE);
  reset();registers[0x31]=0xe5;latch_on_write=true;
  CHECK(lantern_board_speaker_prepare_output(80,&state)==CONTROL_FAILURE);
  CHECK(writes==1 && reads==4 && !state.repair_verified && sticky_error==CONTROL_FAILURE);
  reset();registers[0x31]=0xe5;read_fail_at=5;
  CHECK(lantern_board_speaker_prepare_output(80,&state)==READ_FAILURE);
  CHECK(writes==1 && reads==5 && !state.repair_verified);
  CHECK(state.verify_read_status==READ_FAILURE && !(state.valid_mask&1));
  reset();registers[0x31]=0xe5;latch_at_read=5;
  CHECK(lantern_board_speaker_prepare_output(80,&state)==CONTROL_FAILURE);
  CHECK(!state.repair_verified && state.control_error==CONTROL_FAILURE && sticky_error==CONTROL_FAILURE);
  reset();registers[0x31]=0xe5;ignore_write=true;
  CHECK(lantern_board_speaker_prepare_output(80,&state)==ESP_FAIL);
  CHECK(!state.repair_verified && state.values[LANTERN_SPEAKER_PROBE_MUTE]==0xe5);
  reset();registers[0x31]=0xe5;wrong_readback=true;
  CHECK(lantern_board_speaker_prepare_output(80,&state)==ESP_FAIL);
  CHECK(!state.repair_verified); /* Even unrelated-bit readback mismatch cannot claim repair. */
  /* Request intent, output latch, output direction and write result are distinct. */
  for(unsigned enabled=0;enabled<2;++enabled) for(unsigned level=0;level<2;++level) {
    reset();gpio_out=level?1U<<7:0;gpio_enabled=enabled?1U<<7:0;
    atomic_store(&s_speaker_requested,true);
    CHECK(lantern_board_speaker_probe(&state)==ESP_OK);
    CHECK(state.amp_requested && state.amp_output_level==(int)level);
    CHECK(state.amp_output_enabled==(enabled!=0));
  }
  reset();lantern_board_speaker_enable(true);
  CHECK(gpio_writes==1 && (gpio_out&(1U<<7)));
  CHECK(lantern_board_speaker_probe(&state)==ESP_OK && state.amp_requested && state.amp_write_status==ESP_OK);
  lantern_board_speaker_enable(false);
  CHECK(!(gpio_out&(1U<<7)) && !atomic_load(&s_speaker_requested));
  reset();gpio_result=ESP_FAIL;lantern_board_speaker_enable(true);
  CHECK(lantern_board_speaker_probe(&state)==ESP_OK);
  CHECK(state.amp_requested && state.amp_write_status==ESP_FAIL && state.amp_output_level==0);
#else
  memset(&state,0xa5,sizeof(state));
  CHECK(lantern_board_speaker_probe(&state)==ESP_ERR_NOT_SUPPORTED);
  CHECK(!state.valid_mask && state.amp_output_level==-1);
  CHECK(state.control_error==ESP_ERR_NOT_SUPPORTED && !state.repair_attempted);
  for(unsigned i=0;i<LANTERN_SPEAKER_PROBE_COUNT;++i)
    CHECK(state.read_status[i]==ESP_ERR_NOT_SUPPORTED && state.values[i]==0xff);
  CHECK(lantern_board_speaker_prepare_output(80,&state)==ESP_ERR_NOT_SUPPORTED);
#endif
  printf("PASS: actual speaker probe/prepare profile codec=%d adc=%d (%u assertions); no audibility claim\n",
      LANTERN_AUDIO_CODEC_ES8311,LANTERN_AUDIO_ADC_ES7210,checks);
  return 0;
}
