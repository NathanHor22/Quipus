#pragma once

#include "esp_codec_dev_defaults.h"

// Legacy ESP-IDF I2C control for the Waveshare ES8311/ES7210 pair. The bus
// must already be installed. cfg->addr follows esp_codec_dev's 8-bit wire format.
const audio_codec_ctrl_if_t *quipus_codec_new_i2c_ctrl(const audio_codec_i2c_cfg_t *config);

// First terminal register-transfer error, retained for this interface's lifetime.
// Some vendor codec setup functions swallow errors; callers must check this too.
int quipus_codec_control_error(const audio_codec_ctrl_if_t *control);
