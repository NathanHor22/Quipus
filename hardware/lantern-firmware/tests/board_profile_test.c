#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "lantern_board.h"

int main(void) {
  const lantern_board_profile_t *board = lantern_board_profile();
  assert(board->has_sd_card == LANTERN_HAS_SD_CARD);
  assert(board->has_touchscreen == LANTERN_HAS_TOUCHSCREEN);
  assert(board->has_physical_buttons == LANTERN_HAS_PHYSICAL_BUTTONS);
  assert(LANTERN_MIC_SAMPLE_RATE == 16000);
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  assert(!strcmp(board->id, "quipus-waveshare-lcd-154"));
  assert(LANTERN_AUDIO_ADC_ES7210 && LANTERN_AUDIO_SHARED_BUS);
  assert(LANTERN_DISPLAY_WIDTH == 240 && LANTERN_DISPLAY_HEIGHT == 240);
  assert(LANTERN_BUTTON_MAIN_GPIO == 4 && LANTERN_BUTTON_UP_GPIO == 0);
  assert(LANTERN_BUTTON_DOWN_GPIO == GPIO_NUM_NC);
  assert(LANTERN_RESET_USES_MAIN_AND_UP);
  assert(LANTERN_HAS_POWER_BUTTON && LANTERN_POWER_BUTTON_GPIO == 5);
  assert(LANTERN_POWER_HOLD_GPIO == 2 && LANTERN_CHARGING_GPIO == 3);
  assert(LANTERN_BATTERY_ADC_CHANNEL == 0 && LANTERN_BATTERY_ADC_DIVIDER == 3);
  assert(LANTERN_MIC_MCLK_GPIO == 8 && LANTERN_MIC_SCK_GPIO == 9);
  assert(LANTERN_MIC_WS_GPIO == 10 && LANTERN_MIC_DATA_GPIO == 11);
  assert(LANTERN_SPK_DATA_GPIO == 12 && LANTERN_AUDIO_AMP_ENABLE_GPIO == 7);
  assert(LANTERN_I2C_SDA_GPIO == 42 && LANTERN_I2C_SCL_GPIO == 41);
  assert(LANTERN_DISPLAY_MOSI_GPIO == 39 && LANTERN_DISPLAY_SCLK_GPIO == 38);
  assert(LANTERN_DISPLAY_CS_GPIO == 21 && LANTERN_DISPLAY_DC_GPIO == 45);
  assert(LANTERN_DISPLAY_RESET_GPIO == 40 && LANTERN_DISPLAY_BACKLIGHT_GPIO == 46);
  assert(LANTERN_SD_CLK_GPIO == 16 && LANTERN_SD_CMD_GPIO == 15 && LANTERN_SD_D0_GPIO == 17);
#ifdef CONFIG_LANTERN_WAVESHARE_BATTERY_INSTALLED
  assert(LANTERN_BATTERY_INSTALLED);
#else
  assert(!LANTERN_BATTERY_INSTALLED);
#endif
#elif CONFIG_LANTERN_BOARD_ES3C28P
  assert(!strcmp(board->id, "lantern-v2"));
  assert(!LANTERN_AUDIO_ADC_ES7210 && LANTERN_AUDIO_SHARED_BUS);
  assert(board->has_touchscreen && LANTERN_DISPLAY_HEIGHT == 320);
#else
  assert(!strcmp(board->id, "lantern-original"));
  assert(!LANTERN_AUDIO_ADC_ES7210 && !LANTERN_AUDIO_SHARED_BUS);
  assert(!board->has_sd_card && board->has_physical_buttons);
#endif
  printf("Board profile valid: %s (battery installed=%d).\n", board->model,
         LANTERN_BATTERY_INSTALLED);
  return 0;
}
