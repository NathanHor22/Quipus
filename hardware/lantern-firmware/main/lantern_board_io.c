#include "lantern_board_io.h"

#include "driver/gpio.h"
#include "driver/i2c.h"
#include "driver/i2s_std.h"
#include "esp_check.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_log.h"
#include "es8311_codec.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "lantern_board.h"
#include "quipus_codec_control.h"

#if LANTERN_AUDIO_CODEC_ES8311

static const char *TAG = "lantern_board_io";

#define BOARD_I2C_PORT I2C_NUM_0

static bool s_i2c_ready;
#if LANTERN_HAS_TOUCHSCREEN
static bool s_touch_ready;
#endif
static esp_codec_dev_handle_t s_codec;
#if LANTERN_AUDIO_ADC_ES7210
static esp_codec_dev_handle_t s_input_codec;
#endif

#if LANTERN_HAS_TOUCHSCREEN
static esp_err_t read_registers(uint8_t address, uint8_t reg, void *data, size_t length) {
  return i2c_master_write_read_device(
    BOARD_I2C_PORT, address, &reg, 1, data, length, pdMS_TO_TICKS(100));
}
#endif

esp_err_t lantern_board_i2c_init(void) {
  if (s_i2c_ready) return ESP_OK;
  i2c_config_t config = {
    .mode = I2C_MODE_MASTER,
    .sda_io_num = LANTERN_I2C_SDA_GPIO,
    .scl_io_num = LANTERN_I2C_SCL_GPIO,
    .sda_pullup_en = GPIO_PULLUP_ENABLE,
    .scl_pullup_en = GPIO_PULLUP_ENABLE,
    // This only clocks codec register control; PCM stays on the separate I2S bus.
    // Use conservative register timing for the Waveshare ES8311/ES7210 pair.
    .master.clk_speed = LANTERN_AUDIO_ADC_ES7210 ? 100000 : 400000,
    .clk_flags = 0,
  };
  ESP_RETURN_ON_ERROR(i2c_param_config(BOARD_I2C_PORT, &config), TAG, "I2C config failed");
  esp_err_t result = i2c_driver_install(BOARD_I2C_PORT, config.mode, 0, 0, 0);
  if (result != ESP_OK && result != ESP_ERR_INVALID_STATE) return result;
  s_i2c_ready = true;
  ESP_LOGI(TAG, "shared touch/audio I2C ready on SDA=%d SCL=%d",
    LANTERN_I2C_SDA_GPIO, LANTERN_I2C_SCL_GPIO);
  return ESP_OK;
}

esp_err_t lantern_board_audio_codec_init(void *tx_handle, void *rx_handle) {
  ESP_RETURN_ON_FALSE(tx_handle && rx_handle, ESP_ERR_INVALID_ARG, TAG, "I2S handles missing");
  ESP_RETURN_ON_ERROR(lantern_board_i2c_init(), TAG, "I2C unavailable");
  gpio_config_t amplifier = {
    .pin_bit_mask = 1ULL << LANTERN_AUDIO_AMP_ENABLE_GPIO,
    .mode = GPIO_MODE_OUTPUT,
  };
  ESP_RETURN_ON_ERROR(gpio_config(&amplifier), TAG, "amplifier GPIO failed");
  lantern_board_speaker_enable(false);

  audio_codec_i2c_cfg_t control_config = {
    .port = BOARD_I2C_PORT,
    // esp_codec_dev uses the ES8311's 8-bit wire address (0x18 << 1).
    .addr = ES8311_CODEC_DEFAULT_ADDR,
    .bus_handle = NULL,
  };
  const audio_codec_ctrl_if_t *control = LANTERN_AUDIO_ADC_ES7210
    ? quipus_codec_new_i2c_ctrl(&control_config)
    : audio_codec_new_i2c_ctrl(&control_config);
  const audio_codec_gpio_if_t *gpio = audio_codec_new_gpio();
  audio_codec_i2s_cfg_t data_config = {
    .port = I2S_NUM_0,
    .rx_handle = rx_handle,
    .tx_handle = tx_handle,
    .clk_src = 0,
  };
  const audio_codec_data_if_t *data = audio_codec_new_i2s_data(&data_config);
  ESP_RETURN_ON_FALSE(control && gpio && data, ESP_ERR_NO_MEM, TAG, "codec interfaces unavailable");

  es8311_codec_cfg_t codec_config = {
    .ctrl_if = control,
    .gpio_if = gpio,
    .codec_mode = LANTERN_AUDIO_ADC_ES7210 ? ESP_CODEC_DEV_WORK_MODE_DAC
                                         : ESP_CODEC_DEV_WORK_MODE_BOTH,
    .pa_pin = LANTERN_AUDIO_AMP_ENABLE_GPIO,
    .pa_reverted = !LANTERN_AUDIO_ADC_ES7210,
    .master_mode = false,
    .use_mclk = true,
    .digital_mic = false,
    .invert_mclk = false,
    .invert_sclk = false,
    .hw_gain = {
      .pa_voltage = 5.0f,
      .codec_dac_voltage = 3.3f,
    },
    .no_dac_ref = false,
    .mclk_div = 256,
  };
#if LANTERN_AUDIO_ADC_ES7210
  // The vendor driver documents occasional first-write failures on ES8311.
  // A failed constructor frees its own object, so reuse the interfaces and
  // retry construction before any esp_codec_dev handle takes ownership.
  const audio_codec_if_t *codec = NULL;
  for (unsigned attempt = 0; attempt < 3; ++attempt) {
    codec = es8311_codec_new(&codec_config);
    if (codec || attempt == 2) break;
    ESP_LOGW(TAG, "ES8311 startup attempt %u/3 failed; retrying", attempt + 1);
    vTaskDelay(pdMS_TO_TICKS(50));
  }
#else
  const audio_codec_if_t *codec = es8311_codec_new(&codec_config);
#endif
  if (!codec) {
    // No device owns these wrappers yet; caller-owned I2S channels remain intact.
    audio_codec_delete_data_if(data);
    audio_codec_delete_gpio_if(gpio);
    audio_codec_delete_ctrl_if(control);
    ESP_LOGE(TAG, "ES8311 interface failed");
    return ESP_FAIL;
  }
  esp_codec_dev_cfg_t device_config = {
    .dev_type = LANTERN_AUDIO_ADC_ES7210 ? ESP_CODEC_DEV_TYPE_OUT
                                       : ESP_CODEC_DEV_TYPE_IN_OUT,
    .codec_if = codec,
    .data_if = data,
  };
  s_codec = esp_codec_dev_new(&device_config);
  ESP_RETURN_ON_FALSE(s_codec, ESP_ERR_NO_MEM, TAG, "ES8311 device failed");
  esp_codec_dev_sample_info_t format = {
    .bits_per_sample = 16,
    .channel = LANTERN_AUDIO_ADC_ES7210 ? 2 : 1,
    .channel_mask = 0,
    .sample_rate = LANTERN_MIC_SAMPLE_RATE,
    .mclk_multiple = 256,
  };
  int result = esp_codec_dev_open(s_codec, &format);
  ESP_RETURN_ON_FALSE(result == ESP_CODEC_DEV_OK, (esp_err_t)result, TAG, "ES8311 open failed");
  result = esp_codec_dev_set_out_vol(s_codec, 85);
  ESP_RETURN_ON_FALSE(result == ESP_CODEC_DEV_OK, (esp_err_t)result, TAG, "ES8311 volume failed");
#if LANTERN_AUDIO_ADC_ES7210
  // Use MIC1/MIC2 in ordinary stereo I2S. Enabling three or four inputs puts
  // ES7210 into TDM and would also capture the board's speaker reference.
  control_config.addr = LANTERN_ES7210_I2C_ADDRESS << 1;
  const audio_codec_ctrl_if_t *input_control = quipus_codec_new_i2c_ctrl(&control_config);
  ESP_RETURN_ON_FALSE(input_control, ESP_ERR_NO_MEM, TAG, "ES7210 control failed");
  es7210_codec_cfg_t input_config = {
    .ctrl_if = input_control,
    .mic_selected = ES7210_SEL_MIC1 | ES7210_SEL_MIC2,
    .mclk_div = 256,
  };
  const audio_codec_if_t *input_codec = es7210_codec_new(&input_config);
  ESP_RETURN_ON_FALSE(input_codec, ESP_FAIL, TAG, "ES7210 interface failed");
  esp_codec_dev_cfg_t input_device = {
    .dev_type = ESP_CODEC_DEV_TYPE_IN,
    .codec_if = input_codec,
    .data_if = data,
  };
  s_input_codec = esp_codec_dev_new(&input_device);
  ESP_RETURN_ON_FALSE(s_input_codec, ESP_ERR_NO_MEM, TAG, "ES7210 device failed");
  ESP_RETURN_ON_FALSE(esp_codec_dev_open(s_input_codec, &format) == ESP_CODEC_DEV_OK,
                      ESP_FAIL, TAG, "ES7210 open failed");
  ESP_RETURN_ON_FALSE(esp_codec_dev_set_in_gain(s_input_codec, 30.0f) == ESP_CODEC_DEV_OK,
                      ESP_FAIL, TAG, "ES7210 gain failed");
  ESP_LOGI(TAG, "ES7210 MIC1/MIC2 stereo capture; MIC1 supplies Quipus mono PCM");
#else
  result = esp_codec_dev_set_in_gain(s_codec, 42.0f);
  ESP_RETURN_ON_FALSE(result == ESP_CODEC_DEV_OK, (esp_err_t)result, TAG, "ES8311 microphone gain failed");
#endif
  int reset = 0;
  result = esp_codec_dev_read_reg(s_codec, 0x00, &reset);
  ESP_RETURN_ON_FALSE(result == ESP_CODEC_DEV_OK, (esp_err_t)result, TAG, "ES8311 probe failed");
#if LANTERN_AUDIO_ADC_ES7210
  // Vendor setup can discard individual register errors. Never announce audio
  // readiness if either codec exhausted its register-transfer retries.
  ESP_RETURN_ON_ERROR(quipus_codec_control_error(control), TAG, "ES8311 control initialization failed");
  ESP_RETURN_ON_ERROR(quipus_codec_control_error(input_control), TAG, "ES7210 control initialization failed");
#endif
  ESP_LOGI(TAG, "ES8311 capture/playback device open at 16 kHz (reset=0x%02x)", reset);
  return ESP_OK;
}

void lantern_board_speaker_enable(bool enabled) {
  // Waveshare NS4150B CTRL is active high; ES3C28P's amplifier is active low.
  gpio_set_level(LANTERN_AUDIO_AMP_ENABLE_GPIO,
                 LANTERN_AUDIO_ADC_ES7210 ? enabled : !enabled);
}

#if LANTERN_HAS_TOUCHSCREEN
esp_err_t lantern_board_touch_init(void) {
  ESP_RETURN_ON_ERROR(lantern_board_i2c_init(), TAG, "I2C unavailable");
  gpio_config_t reset = {
    .pin_bit_mask = 1ULL << LANTERN_TOUCH_RESET_GPIO,
    .mode = GPIO_MODE_OUTPUT,
  };
  gpio_config_t interrupt = {
    .pin_bit_mask = 1ULL << LANTERN_TOUCH_INTERRUPT_GPIO,
    .mode = GPIO_MODE_INPUT,
    .pull_up_en = GPIO_PULLUP_ENABLE,
  };
  ESP_RETURN_ON_ERROR(gpio_config(&reset), TAG, "touch reset GPIO failed");
  ESP_RETURN_ON_ERROR(gpio_config(&interrupt), TAG, "touch interrupt GPIO failed");
  gpio_set_level(LANTERN_TOUCH_RESET_GPIO, 0);
  vTaskDelay(pdMS_TO_TICKS(10));
  gpio_set_level(LANTERN_TOUCH_RESET_GPIO, 1);
  vTaskDelay(pdMS_TO_TICKS(300));
  uint8_t touches = 0;
  ESP_RETURN_ON_ERROR(
    read_registers(LANTERN_TOUCH_I2C_ADDRESS, 0x02, &touches, 1), TAG, "FT6336G probe failed");
  s_touch_ready = true;
  ESP_LOGI(TAG, "FT6336G touch ready");
  return ESP_OK;
}

bool lantern_board_touch_read(uint16_t *x, uint16_t *y) {
  if (!s_touch_ready || !x || !y) return false;
  uint8_t data[5] = {0};
  if (read_registers(LANTERN_TOUCH_I2C_ADDRESS, 0x02, data, sizeof(data)) != ESP_OK) return false;
  if (data[0] == 0 || data[0] > 2) return false;
  *x = (uint16_t)(((data[1] & 0x0f) << 8) | data[2]);
  *y = (uint16_t)(((data[3] & 0x0f) << 8) | data[4]);
  return *x < LANTERN_DISPLAY_WIDTH && *y < LANTERN_DISPLAY_HEIGHT;
}
#else
esp_err_t lantern_board_touch_init(void) { return ESP_ERR_NOT_SUPPORTED; }
bool lantern_board_touch_read(uint16_t *x, uint16_t *y) {
  (void)x;
  (void)y;
  return false;
}
#endif

#else

esp_err_t lantern_board_i2c_init(void) { return ESP_ERR_NOT_SUPPORTED; }
esp_err_t lantern_board_audio_codec_init(void *tx_handle, void *rx_handle) {
  (void)tx_handle;
  (void)rx_handle;
  return ESP_OK;
}
void lantern_board_speaker_enable(bool enabled) { (void)enabled; }
esp_err_t lantern_board_touch_init(void) { return ESP_ERR_NOT_SUPPORTED; }
bool lantern_board_touch_read(uint16_t *x, uint16_t *y) {
  (void)x;
  (void)y;
  return false;
}

#endif
