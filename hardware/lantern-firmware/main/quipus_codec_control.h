#pragma once

#include "esp_codec_dev_defaults.h"

// Legacy ESP-IDF I2C control for the Waveshare ES8311/ES7210 pair. The bus
// must already be installed. cfg->addr follows esp_codec_dev's 8-bit wire format.
const audio_codec_ctrl_if_t *quipus_codec_new_i2c_ctrl(const audio_codec_i2c_cfg_t *config);

// First terminal register-transfer error since creation or an explicit fresh retry.
// Some vendor codec setup functions swallow errors; callers must check this too.
int quipus_codec_control_error(const audio_codec_ctrl_if_t *control);

// Clear only before retrying a FULL codec constructor that returned NULL and
// freed its own object. The caller must have exclusive access; never call after
// a constructor succeeds or after device open/probe, which may ignore failures.
// Does not change the bus, address, open state or per-transfer retry policy.
int quipus_codec_control_reset_error(const audio_codec_ctrl_if_t *control);
