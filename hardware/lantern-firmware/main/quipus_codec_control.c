#include "quipus_codec_control.h"

#include <stdlib.h>
#include <string.h>

#include "driver/i2c.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define CODEC_I2C_ATTEMPTS 3
#define CODEC_I2C_TIMEOUT_MS 100
#define CODEC_I2C_BACKOFF_MS 2
#define CODEC_MAX_REGISTER_BYTES 2
#define CODEC_MAX_DATA_BYTES 4

static const char *TAG = "quipus_codec_i2c";

typedef struct {
  audio_codec_ctrl_if_t base;
  i2c_port_t port;
  uint8_t address;
  bool opened;
  int terminal_error;
} quipus_codec_control_t;

static int control_open(const audio_codec_ctrl_if_t *base, void *config, int config_size) {
  if (!base || !config || config_size != sizeof(audio_codec_i2c_cfg_t)) {
    return ESP_CODEC_DEV_INVALID_ARG;
  }
  const audio_codec_i2c_cfg_t *settings = config;
  // This adapter deliberately uses the pre-installed legacy driver, not a new bus.
  if (settings->port >= I2C_NUM_MAX || !settings->addr || (settings->addr & 1) ||
      settings->bus_handle) {
    return ESP_CODEC_DEV_INVALID_ARG;
  }
  quipus_codec_control_t *control = (quipus_codec_control_t *)base;
  control->port = settings->port;
  control->address = settings->addr >> 1;
  control->opened = true;
  return ESP_CODEC_DEV_OK;
}

static bool control_is_open(const audio_codec_ctrl_if_t *base) {
  return base && ((const quipus_codec_control_t *)base)->opened;
}

static int control_close(const audio_codec_ctrl_if_t *base) {
  if (!base) return ESP_CODEC_DEV_INVALID_ARG;
  ((quipus_codec_control_t *)base)->opened = false;
  return ESP_CODEC_DEV_OK;
}

static int transfer(const audio_codec_ctrl_if_t *base, int reg, int register_bytes,
                    void *data, int data_bytes, bool read) {
  if (!base || !data || register_bytes < 1 || register_bytes > CODEC_MAX_REGISTER_BYTES ||
      data_bytes < 1 || data_bytes > CODEC_MAX_DATA_BYTES || reg < 0 ||
      reg > (register_bytes == 1 ? 0xff : 0xffff)) {
    return ESP_CODEC_DEV_INVALID_ARG;
  }
  quipus_codec_control_t *control = (quipus_codec_control_t *)base;
  if (!control->opened) return ESP_CODEC_DEV_WRONG_STATE;

  uint8_t packet[CODEC_MAX_REGISTER_BYTES + CODEC_MAX_DATA_BYTES];
  if (register_bytes == 2) packet[0] = (uint8_t)(reg >> 8);
  packet[register_bytes - 1] = (uint8_t)reg;
  if (!read) memcpy(packet + register_bytes, data, data_bytes);
  uint8_t received[CODEC_MAX_DATA_BYTES];
  const TickType_t timeout = pdMS_TO_TICKS(CODEC_I2C_TIMEOUT_MS);
  const TickType_t backoff = pdMS_TO_TICKS(CODEC_I2C_BACKOFF_MS);
  esp_err_t result = ESP_FAIL;

  for (unsigned attempt = 0; attempt < CODEC_I2C_ATTEMPTS; ++attempt) {
    if (read) {
      // One transaction keeps the register-select and repeated START atomic.
      // Stage reads so a failed/partial transaction cannot change caller data.
      result = i2c_master_write_read_device(control->port, control->address,
        packet, register_bytes, received, data_bytes, timeout ? timeout : 1);
    } else {
      result = i2c_master_write_to_device(control->port, control->address,
        packet, register_bytes + data_bytes, timeout ? timeout : 1);
    }
    if (result == ESP_OK) {
      if (read) memcpy(data, received, data_bytes);
      if (attempt) {
        ESP_LOGW(TAG, "%s recovered addr=0x%02x reg=0x%04x attempt=%u/%u",
          read ? "read" : "write", control->address, reg, attempt + 1, CODEC_I2C_ATTEMPTS);
      }
      return ESP_CODEC_DEV_OK;
    }
    if (result == ESP_ERR_INVALID_ARG || result == ESP_ERR_INVALID_STATE) break;
    if (attempt + 1 < CODEC_I2C_ATTEMPTS) vTaskDelay(backoff ? backoff : 1);
  }
  ESP_LOGE(TAG, "%s failed addr=0x%02x reg=0x%04x: %s",
    read ? "read" : "write", control->address, reg, esp_err_to_name(result));
  int error = read ? ESP_CODEC_DEV_READ_FAIL : ESP_CODEC_DEV_WRITE_FAIL;
  if (control->terminal_error == ESP_CODEC_DEV_OK) control->terminal_error = error;
  return error;
}

static int control_read(const audio_codec_ctrl_if_t *base, int reg, int register_bytes,
                        void *data, int data_bytes) {
  return transfer(base, reg, register_bytes, data, data_bytes, true);
}

static int control_write(const audio_codec_ctrl_if_t *base, int reg, int register_bytes,
                         void *data, int data_bytes) {
  return transfer(base, reg, register_bytes, data, data_bytes, false);
}

int quipus_codec_control_error(const audio_codec_ctrl_if_t *base) {
  if (!base || base->read_reg != control_read || base->write_reg != control_write) {
    return ESP_CODEC_DEV_INVALID_ARG;
  }
  return ((const quipus_codec_control_t *)base)->terminal_error;
}

const audio_codec_ctrl_if_t *quipus_codec_new_i2c_ctrl(const audio_codec_i2c_cfg_t *config) {
  if (!config) return NULL;
  quipus_codec_control_t *control = calloc(1, sizeof(*control));
  if (!control) return NULL;
  control->base = (audio_codec_ctrl_if_t) {
    .open = control_open,
    .is_open = control_is_open,
    .read_reg = control_read,
    .write_reg = control_write,
    .close = control_close,
  };
  audio_codec_i2c_cfg_t settings = *config;
  if (control_open(&control->base, &settings, sizeof(settings)) != ESP_CODEC_DEV_OK) {
    free(control);
    return NULL;
  }
  return &control->base;
}
