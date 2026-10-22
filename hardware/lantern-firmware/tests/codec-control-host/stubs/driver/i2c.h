#pragma once
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
typedef enum { I2C_NUM_0, I2C_NUM_1, I2C_NUM_MAX } i2c_port_t;
esp_err_t i2c_master_write_read_device(i2c_port_t port, uint8_t address,
  const uint8_t *write_buffer, size_t write_size, uint8_t *read_buffer,
  size_t read_size, TickType_t timeout);
esp_err_t i2c_master_write_to_device(i2c_port_t port, uint8_t address,
  const uint8_t *write_buffer, size_t write_size, TickType_t timeout);
