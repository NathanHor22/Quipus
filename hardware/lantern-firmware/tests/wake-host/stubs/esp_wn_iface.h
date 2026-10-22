#pragma once
#include <stdint.h>
typedef struct { int unused; } model_iface_data_t;
typedef enum { WAKENET_NO_DETECT = 0, WAKENET_DETECTED = 1 } wakenet_state_t;
#define DET_MODE_90 90
typedef struct {
  model_iface_data_t *(*create)(const char *name, int mode);
  void (*destroy)(model_iface_data_t *model);
  int (*get_samp_chunksize)(model_iface_data_t *model);
  int (*get_samp_rate)(model_iface_data_t *model);
  int (*get_channel_num)(model_iface_data_t *model);
  wakenet_state_t (*detect)(model_iface_data_t *model, int16_t *samples);
} esp_wn_iface_t;
