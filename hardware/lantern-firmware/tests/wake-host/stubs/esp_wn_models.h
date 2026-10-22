#pragma once
#include "esp_wn_iface.h"
#define ESP_WN_PREFIX "wn"
const esp_wn_iface_t *esp_wn_handle_from_name(const char *name);
