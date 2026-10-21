#pragma once

#include <stdbool.h>

#include "sdkconfig.h"

#define LANTERN_FIRMWARE_VERSION "0.9.1-quipus"
#define LANTERN_API_BASE_URL "https://quipus-sales-rep-assistant.vercel.app"

#if CONFIG_LANTERN_BOARD_ZHENGCHEN_M1307
#include "boards/lantern_original.h"
#elif CONFIG_LANTERN_BOARD_ES3C28P
#include "boards/lantern_v2_es3c28p.h"
#else
#error "Select a supported Quipus board profile in menuconfig."
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
