#pragma once

#include <stdbool.h>

#include "sdkconfig.h"

#if CONFIG_QUIPUS_EXPERIMENTAL_OFFLINE_DSCNN
#define LANTERN_FIRMWARE_VERSION "0.12.9-quipus-experimental"
#else
#define LANTERN_FIRMWARE_VERSION "0.14.1-quipus"
#endif
// Release and bench builds may name their own version for wireless updates.
#if CONFIG_QUIPUS_FIRMWARE_VERSION_CUSTOM
#undef LANTERN_FIRMWARE_VERSION
#define LANTERN_FIRMWARE_VERSION CONFIG_QUIPUS_FIRMWARE_VERSION
#endif
#ifdef CONFIG_LANTERN_API_BASE_URL
#define LANTERN_API_BASE_URL CONFIG_LANTERN_API_BASE_URL
#else
// Native board tests do not load ESP-IDF's generated sdkconfig.
#define LANTERN_API_BASE_URL "https://quipus-sales-rep-assistant.vercel.app"
#endif

#if CONFIG_LANTERN_BOARD_ZHENGCHEN_M1307
#include "boards/lantern_original.h"
#elif CONFIG_LANTERN_BOARD_ES3C28P
#include "boards/lantern_v2_es3c28p.h"
#elif CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
#include "boards/lantern_waveshare_lcd_154.h"
#else
#error "Select a supported Quipus board profile in menuconfig."
#endif

// Existing profiles retain their original single-channel codec path.
#ifndef LANTERN_AUDIO_ADC_ES7210
#define LANTERN_AUDIO_ADC_ES7210 0
#endif
#ifndef LANTERN_RESET_USES_MAIN_AND_UP
#define LANTERN_RESET_USES_MAIN_AND_UP 0
#endif
#ifndef LANTERN_PRIMARY_BUTTON_LABEL
#define LANTERN_PRIMARY_BUTTON_LABEL "CENTRE"
#endif
#ifndef LANTERN_HAS_POWER_BUTTON
#define LANTERN_HAS_POWER_BUTTON 0
#endif

typedef struct {
  const char *id;
  const char *model;
  const char *storage_kind;
  bool has_sd_card;
  bool has_touchscreen;
  bool has_physical_buttons;
  bool has_battery_monitor;
} lantern_board_profile_t;

const lantern_board_profile_t *lantern_board_profile(void);
