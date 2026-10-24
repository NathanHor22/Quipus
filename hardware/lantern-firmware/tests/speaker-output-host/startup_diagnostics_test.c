#ifdef NDEBUG
#undef NDEBUG
#endif
#include <assert.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include "lantern_board_io.h"
#define TAG "lantern_board_io"
#define ESP_CODEC_DEV_OK ESP_OK
#define ESP_LOGI(...) test_log(__VA_ARGS__)
#define TEST_FAILURE -701
#define TEST_CONTROL_FAILURE -702
static unsigned checks;
#define CHECK(condition) do {assert(condition);++checks;} while(0)
#if LANTERN_AUDIO_CODEC_ES8311 && LANTERN_AUDIO_ADC_ES7210 && CONFIG_IDF_TARGET_ESP32S3
/* Real pinned target definitions; only the MMIO read operation is replaced. */
#include "soc/gpio_reg.h"
#include "soc/gpio_sig_map.h"
#include "soc/io_mux_reg.h"
#include "soc/i2s_reg.h"
#undef REG_READ
#define REG_READ(address) test_mmio_read((uint32_t)(address))
static const unsigned fake_identity=1;
static void *s_codec;
static const void *s_output_control;
static unsigned reads,mmio_reads,control_reads,logs,fail_at,invalid_values;
static int control_failure;
static uint8_t bus_order[16];
static const uint8_t expected_bus[]={0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,
  0x08,0x09,0x0a,0x13,0x14,0x37,0x44,0x45};
static const uint32_t expected_mmio[]={GPIO_OUT_REG,GPIO_ENABLE_REG,
 GPIO_FUNC7_OUT_SEL_CFG_REG,IO_MUX_GPIO7_REG,
 GPIO_FUNC8_OUT_SEL_CFG_REG,IO_MUX_GPIO8_REG,
 GPIO_FUNC9_OUT_SEL_CFG_REG,IO_MUX_GPIO9_REG,
 GPIO_FUNC10_OUT_SEL_CFG_REG,IO_MUX_GPIO10_REG,
 GPIO_FUNC12_OUT_SEL_CFG_REG,IO_MUX_GPIO12_REG,
 I2S_TX_CONF_REG(0),I2S_TX_CONF1_REG(0),I2S_TX_CLKM_CONF_REG(0),
 I2S_TX_CLKM_DIV_CONF_REG(0),I2S_RX_CLKM_CONF_REG(0),I2S_TX_TDM_CTRL_REG(0)};
static uint32_t test_mmio_read(uint32_t address) {
  assert(mmio_reads<sizeof(expected_mmio)/sizeof(expected_mmio[0]));
  assert(address==expected_mmio[mmio_reads++]);
  return 0x11223344;
}
int esp_codec_dev_read_reg(void *codec,int reg,int *value) {
 assert(codec==s_codec && codec && reads<16 && value);
 assert(reg==expected_bus[reads]);bus_order[reads++]=(uint8_t)reg;
 *value=0xaa; /* Failed transport must not become valid logged configuration. */
 if(fail_at==reads)return TEST_FAILURE;
 *value=reg^0x5a;return ESP_OK;
}
int quipus_codec_control_error(const void *control) {
 assert(control==s_output_control && control);++control_reads;return control_failure;
}
void test_log(const char *tag,const char *format,...) {
 assert(!strcmp(tag,TAG));char message[240];
 va_list args;va_start(args,format);int size=vsnprintf(message,sizeof(message),format,args);va_end(args);
 assert(size>=0 && (size_t)size<sizeof(message));++logs;
 if(strstr(message,"valid=0")) {++invalid_values;assert(strstr(message,"value=ff"));}
}
static void reset(void) {
 s_codec=(void *)&fake_identity;s_output_control=&fake_identity;
 reads=mmio_reads=control_reads=logs=fail_at=invalid_values=0;control_failure=0;
 memset(bus_order,0,sizeof(bus_order));
}
#endif
#include "startup_diagnostics_under_test.c"
int main(void) {
#if LANTERN_AUDIO_CODEC_ES8311 && LANTERN_AUDIO_ADC_ES7210 && CONFIG_IDF_TARGET_ESP32S3
 reset();s_codec=NULL;CHECK(lantern_board_speaker_startup_diagnostics()==ESP_ERR_INVALID_STATE);
 CHECK(!reads&&!mmio_reads&&!logs&&!control_reads);
 reset();s_output_control=NULL;CHECK(lantern_board_speaker_startup_diagnostics()==ESP_ERR_INVALID_STATE);
 CHECK(!reads&&!mmio_reads&&!logs&&!control_reads);
 reset();CHECK(lantern_board_speaker_startup_diagnostics()==ESP_OK);
 CHECK(reads==16&&mmio_reads==18&&control_reads==1&&logs==27&&!invalid_values);
 CHECK(!memcmp(bus_order,expected_bus,sizeof(bus_order)));
 for(unsigned fail=1;fail<=16;++fail) {
  reset();fail_at=fail;
  CHECK(lantern_board_speaker_startup_diagnostics()==TEST_FAILURE);
  CHECK(reads==16&&mmio_reads==18&&control_reads==1&&logs==27&&invalid_values==1);
 }
 reset();control_failure=TEST_CONTROL_FAILURE;
 CHECK(lantern_board_speaker_startup_diagnostics()==TEST_CONTROL_FAILURE);
 CHECK(reads==16&&mmio_reads==18&&control_reads==1&&logs==27);
 reset();fail_at=2;control_failure=TEST_CONTROL_FAILURE;
 CHECK(lantern_board_speaker_startup_diagnostics()==TEST_FAILURE);
 CHECK(control_failure==TEST_CONTROL_FAILURE); /* Never clear a terminal latch. */
 CHECK(SIG_GPIO_OUT_IDX==256&&I2S0_MCLK_OUT_IDX==23&&I2S0O_BCK_OUT_IDX==22);
 CHECK(I2S0O_WS_OUT_IDX==24&&I2S0O_SD_OUT_IDX==25&&PIN_FUNC_GPIO==1);
#else
 CHECK(lantern_board_speaker_startup_diagnostics()==ESP_ERR_NOT_SUPPORTED);
#endif
 printf("PASS: actual read-only startup diagnostics codec=%d adc=%d (%u assertions), no audibility claim\n",
     LANTERN_AUDIO_CODEC_ES8311,LANTERN_AUDIO_ADC_ES7210,checks);
 return 0;
}
