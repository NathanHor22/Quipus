#ifdef NDEBUG
#undef NDEBUG
#endif
#include <assert.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include "quipus_codec_control.h"
#include "driver/i2c.h"

static unsigned calls, delays, errors, warnings;
static unsigned failures;
static esp_err_t injected_error;
static bool expect_read;
static uint8_t expected_address, expected_packet[6], response[4];
static size_t expected_packet_size, expected_read_size;
static uint8_t *watched_output;
static uint8_t watched_initial[4];
static char last_log[256];

const char *esp_err_to_name(esp_err_t error) {
  switch (error) {
    case ESP_ERR_TIMEOUT: return "ESP_ERR_TIMEOUT";
    case ESP_ERR_INVALID_ARG: return "ESP_ERR_INVALID_ARG";
    case ESP_ERR_INVALID_STATE: return "ESP_ERR_INVALID_STATE";
    default: return "ESP_FAIL";
  }
}

void test_codec_log(bool error, const char *tag, const char *format, ...) {
  assert(strcmp(tag, "quipus_codec_i2c") == 0);
  if (error) ++errors;
  else ++warnings;
  va_list arguments;
  va_start(arguments, format);
  vsnprintf(last_log, sizeof(last_log), format, arguments);
  va_end(arguments);
}

void vTaskDelay(TickType_t ticks) {
  TickType_t expected = pdMS_TO_TICKS(2);
  assert(ticks == (expected ? expected : 1));
  ++delays;
}

static void check_request(i2c_port_t port, uint8_t address, const uint8_t *packet,
                          size_t packet_size, TickType_t timeout) {
  assert(port == I2C_NUM_0);
  assert(address == expected_address);
  assert(packet_size == expected_packet_size);
  assert(memcmp(packet, expected_packet, packet_size) == 0);
  assert(timeout == pdMS_TO_TICKS(100));
  if (watched_output) {
    assert(memcmp(watched_output, watched_initial, expected_read_size) == 0);
  }
  ++calls;
}

esp_err_t i2c_master_write_read_device(i2c_port_t port, uint8_t address,
  const uint8_t *packet, size_t packet_size, uint8_t *data,
  size_t data_size, TickType_t timeout) {
  assert(expect_read);
  assert(data_size == expected_read_size);
  check_request(port, address, packet, packet_size, timeout);
  // Simulate a driver that partially changes its destination even on failure.
  memset(data, 0xee, data_size);
  if (calls <= failures) return injected_error;
  memcpy(data, response, data_size);
  return ESP_OK;
}

esp_err_t i2c_master_write_to_device(i2c_port_t port, uint8_t address,
  const uint8_t *packet, size_t packet_size, TickType_t timeout) {
  assert(!expect_read);
  check_request(port, address, packet, packet_size, timeout);
  return calls <= failures ? injected_error : ESP_OK;
}

static void setup(bool read, uint8_t address, const uint8_t *packet, size_t packet_size,
                  size_t read_size, unsigned fail_count, esp_err_t error) {
  calls = delays = errors = warnings = 0;
  last_log[0] = 0;
  expect_read = read;
  expected_address = address;
  memcpy(expected_packet, packet, packet_size);
  expected_packet_size = packet_size;
  expected_read_size = read_size;
  failures = fail_count;
  injected_error = error;
  watched_output = NULL;
}

int main(void) {
  audio_codec_i2c_cfg_t config = {.port = I2C_NUM_0, .addr = 0x30};
  const audio_codec_ctrl_if_t *control = quipus_codec_new_i2c_ctrl(&config);
  assert(control && control->is_open(control));
  assert(quipus_codec_control_error(control) == ESP_CODEC_DEV_OK);
  uint8_t byte = 0x55;
  response[0] = 0xa5;
  const uint8_t reg[] = {0x44};
  setup(true, 0x18, reg, sizeof(reg), 1, 0, ESP_FAIL);
  assert(control->read_reg(control, 0x44, 1, &byte, 1) == ESP_CODEC_DEV_OK);
  assert(byte == 0xa5 && calls == 1 && !delays && !errors && !warnings);

  const uint8_t wide_reg[] = {0x12, 0x34};
  uint8_t values[4] = {0};
  const uint8_t four_bytes[] = {0x11, 0x22, 0x33, 0x44};
  memcpy(response, four_bytes, sizeof(response));
  setup(true, 0x18, wide_reg, sizeof(wide_reg), 4, 0, ESP_FAIL);
  assert(control->read_reg(control, 0x1234, 2, values, 4) == ESP_CODEC_DEV_OK);
  assert(memcmp(values, four_bytes, 4) == 0 && calls == 1);

  const uint8_t write[] = {0x44, 0x08};
  byte = 0x08;
  setup(false, 0x18, write, sizeof(write), 0, 0, ESP_FAIL);
  assert(control->write_reg(control, 0x44, 1, &byte, 1) == ESP_CODEC_DEV_OK);
  assert(calls == 1 && !delays && !errors);

  const uint8_t wide_write[] = {0x12, 0x34, 0x11, 0x22, 0x33, 0x44};
  setup(false, 0x18, wide_write, sizeof(wide_write), 0, 0, ESP_FAIL);
  assert(control->write_reg(control, 0x1234, 2, values, 4) == ESP_CODEC_DEV_OK);
  assert(calls == 1);

  // A failed read never changes caller data, including between retries.
  memset(values, 0x66, sizeof(values));
  setup(true, 0x18, wide_reg, sizeof(wide_reg), 4, 2, ESP_ERR_TIMEOUT);
  watched_output = values;
  memcpy(watched_initial, values, sizeof(values));
  assert(control->read_reg(control, 0x1234, 2, values, 4) == ESP_CODEC_DEV_OK);
  assert(calls == 3 && delays == 2 && warnings == 1 && !errors);
  assert(memcmp(values, four_bytes, 4) == 0);
  assert(quipus_codec_control_error(control) == ESP_CODEC_DEV_OK);

  setup(false, 0x18, write, sizeof(write), 0, 2, ESP_FAIL);
  assert(control->write_reg(control, 0x44, 1, &byte, 1) == ESP_CODEC_DEV_OK);
  assert(calls == 3 && delays == 2 && warnings == 1 && !errors && byte == 0x08);

  byte = 0x55;
  setup(true, 0x18, reg, sizeof(reg), 1, 20, ESP_FAIL);
  assert(control->read_reg(control, 0x44, 1, &byte, 1) == ESP_CODEC_DEV_READ_FAIL);
  assert(byte == 0x55 && calls == 3 && delays == 2 && errors == 1 && !warnings);
  assert(strstr(last_log, "addr=0x18 reg=0x0044: ESP_FAIL"));
  assert(quipus_codec_control_error(control) == ESP_CODEC_DEV_READ_FAIL);

  byte = 0x08;
  setup(false, 0x18, write, sizeof(write), 0, 20, ESP_ERR_TIMEOUT);
  assert(control->write_reg(control, 0x44, 1, &byte, 1) == ESP_CODEC_DEV_WRITE_FAIL);
  assert(calls == 3 && delays == 2 && errors == 1 && !warnings);
  assert(strstr(last_log, "ESP_ERR_TIMEOUT"));
  // Preserve the first terminal fault rather than overwrite it with a later one.
  assert(quipus_codec_control_error(control) == ESP_CODEC_DEV_READ_FAIL);
  setup(false, 0x18, write, sizeof(write), 0, 0, ESP_FAIL);
  assert(control->write_reg(control, 0x44, 1, &byte, 1) == ESP_CODEC_DEV_OK);
  assert(quipus_codec_control_error(control) == ESP_CODEC_DEV_READ_FAIL);

  setup(true, 0x18, reg, sizeof(reg), 1, 20, ESP_ERR_INVALID_STATE);
  assert(control->read_reg(control, 0x44, 1, &byte, 1) == ESP_CODEC_DEV_READ_FAIL);
  assert(calls == 1 && !delays && errors == 1);

  setup(true, 0x18, reg, sizeof(reg), 1, 0, ESP_FAIL);
  assert(control->read_reg(NULL, 0x44, 1, &byte, 1) == ESP_CODEC_DEV_INVALID_ARG);
  assert(control->read_reg(control, 0x44, 1, NULL, 1) == ESP_CODEC_DEV_INVALID_ARG);
  assert(control->read_reg(control, -1, 1, &byte, 1) == ESP_CODEC_DEV_INVALID_ARG);
  assert(control->read_reg(control, 0x100, 1, &byte, 1) == ESP_CODEC_DEV_INVALID_ARG);
  assert(control->read_reg(control, 0x10000, 2, &byte, 1) == ESP_CODEC_DEV_INVALID_ARG);
  assert(control->read_reg(control, 0x44, 0, &byte, 1) == ESP_CODEC_DEV_INVALID_ARG);
  assert(control->read_reg(control, 0x44, 3, &byte, 1) == ESP_CODEC_DEV_INVALID_ARG);
  assert(control->read_reg(control, 0x44, 1, &byte, 0) == ESP_CODEC_DEV_INVALID_ARG);
  assert(control->read_reg(control, 0x44, 1, &byte, 5) == ESP_CODEC_DEV_INVALID_ARG);
  assert(control->write_reg(control, 0x44, 1, NULL, 1) == ESP_CODEC_DEV_INVALID_ARG);
  assert(control->write_reg(control, 0x44, 1, &byte, -1) == ESP_CODEC_DEV_INVALID_ARG);
  assert(calls == 0);

  assert(control->close(control) == ESP_CODEC_DEV_OK && !control->is_open(control));
  assert(control->read_reg(control, 0x44, 1, &byte, 1) == ESP_CODEC_DEV_WRONG_STATE);
  assert(control->write_reg(control, 0x44, 1, &byte, 1) == ESP_CODEC_DEV_WRONG_STATE);
  assert(calls == 0);
  assert(control->open(control, &config, sizeof(config)) == ESP_CODEC_DEV_OK);
  assert(control->is_open(control));
  assert(quipus_codec_control_error(control) == ESP_CODEC_DEV_READ_FAIL);
  assert(control->open(control, &config, 0) == ESP_CODEC_DEV_INVALID_ARG);
  assert(control->close(NULL) == ESP_CODEC_DEV_INVALID_ARG);
  assert(!control->is_open(NULL));

  // Each codec keeps its own address; mutation of the config cannot retarget it.
  config.addr = 0x80;
  const audio_codec_ctrl_if_t *adc = quipus_codec_new_i2c_ctrl(&config);
  assert(adc);
  assert(quipus_codec_control_error(adc) == ESP_CODEC_DEV_OK);
  config.addr = 0x30;
  setup(true, 0x40, reg, sizeof(reg), 1, 0, ESP_FAIL);
  assert(adc->read_reg(adc, 0x44, 1, &byte, 1) == ESP_CODEC_DEV_OK && calls == 1);
  setup(true, 0x18, reg, sizeof(reg), 1, 0, ESP_FAIL);
  assert(control->read_reg(control, 0x44, 1, &byte, 1) == ESP_CODEC_DEV_OK && calls == 1);
  // Use the installed vendor deletion path, which calls our close then frees.
  assert(audio_codec_delete_ctrl_if(adc) == ESP_CODEC_DEV_OK);
  assert(audio_codec_delete_ctrl_if(control) == ESP_CODEC_DEV_OK);

  assert(quipus_codec_control_error(NULL) == ESP_CODEC_DEV_INVALID_ARG);
  const audio_codec_ctrl_if_t foreign_control = {0};
  assert(quipus_codec_control_error(&foreign_control) == ESP_CODEC_DEV_INVALID_ARG);
  assert(!quipus_codec_new_i2c_ctrl(NULL));
  config.addr = 0;
  assert(!quipus_codec_new_i2c_ctrl(&config));
  config.addr = 0x31;
  assert(!quipus_codec_new_i2c_ctrl(&config));
  config.addr = 0x30;
  config.port = I2C_NUM_MAX;
  assert(!quipus_codec_new_i2c_ctrl(&config));
  config.port = I2C_NUM_0;
  config.bus_handle = &config;
  assert(!quipus_codec_new_i2c_ctrl(&config));
  puts("Codec I2C control: transactions, bounded retries, failures, bounds and lifecycle passed.");
  return 0;
}
