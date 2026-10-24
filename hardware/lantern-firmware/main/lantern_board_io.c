#include "lantern_board_io.h"

#include <stdatomic.h>
#include <string.h>

#include "driver/gpio.h"
#include "driver/i2c.h"
#include "driver/i2s_std.h"
#include "esp_check.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_log.h"
#include "esp_timer.h"
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
#include "soc/gpio_reg.h"
#include "soc/soc.h"
#if CONFIG_IDF_TARGET_ESP32S3
#include "soc/gpio_sig_map.h"
#include "soc/io_mux_reg.h"
#include "soc/i2s_reg.h"
#endif
static esp_codec_dev_handle_t s_input_codec;
static const audio_codec_ctrl_if_t *s_output_control;
static atomic_bool s_speaker_requested;
static atomic_int s_speaker_write_status = ESP_ERR_INVALID_STATE;
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

#if LANTERN_AUDIO_ADC_ES7210
// Startup only, before the microphone task owns RX. Quiet-but-nonzero ADC
// noise is healthy; repeated digital zeros are not evidence of a working mic.
static esp_err_t microphone_startup_pcm(void *rx_handle) {
  if (!rx_handle) return ESP_ERR_INVALID_ARG;
  int64_t started = esp_timer_get_time();
  (void)started; // Host fixtures can compile logging out.
  int16_t samples[320 * 2];
  unsigned active_blocks = 0;
  for (unsigned block = 0; block < 16; ++block) {
    size_t bytes = 0;
    esp_err_t result = i2s_channel_read((i2s_chan_handle_t)rx_handle, samples,
        sizeof(samples), &bytes, 40); // ESP-IDF I2S API takes milliseconds, not ticks.
    bool active = false;
    if (result == ESP_OK && bytes == sizeof(samples)) {
      for (size_t i = 0; i < sizeof(samples) / sizeof(samples[0]); i += 2)
        if (samples[i] != 0) { active = true; break; } // MIC1, matching runtime mono.
    }
    volatile int16_t *private_pcm = samples;
    for (size_t i = 0; i < sizeof(samples) / sizeof(samples[0]); ++i)
      private_pcm[i] = 0;
    if (result != ESP_OK) return result;
    if (bytes != sizeof(samples)) return ESP_ERR_INVALID_SIZE;
    active_blocks = active ? active_blocks + 1 : 0;
    if (active_blocks >= 3) {
      ESP_LOGI(TAG, "MIC1 startup active blocks=%u streak=%u elapsed_ms=%lld", block + 1, active_blocks,
          (long long)((esp_timer_get_time() - started) / 1000));
      return ESP_OK;
    }
  }
  ESP_LOGW(TAG, "MIC1 startup inactive blocks=16 elapsed_ms=%lld",
      (long long)((esp_timer_get_time() - started) / 1000));
  return ESP_ERR_NOT_FOUND; // No sustained MIC1 signal in a 320 ms clocked window.
}

static esp_err_t validate_microphone_startup(void *rx_handle,
    const audio_codec_ctrl_if_t *input_control,
    esp_codec_dev_sample_info_t *format) {
  if (!rx_handle || !input_control || !format || !s_input_codec)
    return ESP_ERR_INVALID_ARG;
  esp_err_t result = microphone_startup_pcm(rx_handle);
  if (result != ESP_ERR_NOT_FOUND) return result;

  // Read only nonprivate ADC configuration. A bad read remains latched, so a
  // real control failure cannot be erased by the recovery or declared healthy.
  const uint8_t registers[] = {0x00, 0x01, 0x02, 0x06, 0x11, 0x12, 0x43, 0x4b};
  for (size_t i = 0; i < sizeof(registers); ++i) {
    int value = 0;
    int read = esp_codec_dev_read_reg(s_input_codec, registers[i], &value);
    ESP_LOGW(TAG, "zero-input ADC reg=0x%02x value=0x%02x read=%d",
        registers[i], value & 0xff, read);
    if (read != ESP_CODEC_DEV_OK) return ESP_FAIL;
  }
  if (quipus_codec_control_error(input_control) != ESP_CODEC_DEV_OK)
    return ESP_FAIL;
  ESP_LOGW(TAG, "ES7210 MIC1 lacked sustained input; reopening ADC once before capture starts");
  // Reuse the existing device/data interface. Shared TX remains open, so there
  // is no second I2S owner and no runtime clock reset during a recording.
  if (esp_codec_dev_close(s_input_codec) != ESP_CODEC_DEV_OK ||
      quipus_codec_control_error(input_control) != ESP_CODEC_DEV_OK)
    return ESP_FAIL;
  vTaskDelay(pdMS_TO_TICKS(20));
  if (esp_codec_dev_open(s_input_codec, format) != ESP_CODEC_DEV_OK ||
      esp_codec_dev_set_in_gain(s_input_codec, 30.0f) != ESP_CODEC_DEV_OK ||
      quipus_codec_control_error(input_control) != ESP_CODEC_DEV_OK)
    return ESP_FAIL;
  result = microphone_startup_pcm(rx_handle);
  if (result == ESP_ERR_NOT_FOUND) {
    ESP_LOGE(TAG, "ES7210 MIC1 lacked sustained input after bounded startup recovery");
    return ESP_FAIL;
  }
  return result;
}
#endif

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
    // A failed constructor freed its object. Begin a fresh full attempt without
    // carrying that abandoned attempt's terminal error into a successful one.
    // Never clear after construction: swallowed errors in that attempt must
    // still be caught by the final initialization checks below.
    if (attempt && quipus_codec_control_reset_error(control) != ESP_CODEC_DEV_OK) {
      ESP_LOGE(TAG, "ES8311 control retry reset failed");
      break;
    }
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
  ESP_RETURN_ON_ERROR(validate_microphone_startup(rx_handle, input_control, &format), TAG,
                      "ES7210 microphone startup validation failed");
#endif
#if LANTERN_AUDIO_ADC_ES7210
  // Publish only after complete startup validation; no abandoned wrapper is kept.
  s_output_control = control;
#endif
  ESP_LOGI(TAG, "ES8311 capture/playback device open at 16 kHz (reset=0x%02x)", reset);
  return ESP_OK;
}

#if LANTERN_AUDIO_ADC_ES7210
static int speaker_output_latch(void) {
  // GPIO7 is output-only: gpio_get_level would always read0. Query OUT itself.
  _Static_assert(LANTERN_AUDIO_AMP_ENABLE_GPIO < 32, "speaker latch uses GPIO_OUT_REG");
  return (int)((REG_READ(GPIO_OUT_REG) >> LANTERN_AUDIO_AMP_ENABLE_GPIO) & 1U);
}

static bool speaker_output_enabled(void) {
  return ((REG_READ(GPIO_ENABLE_REG) >> LANTERN_AUDIO_AMP_ENABLE_GPIO) & 1U) != 0;
}
#endif

void lantern_board_speaker_enable(bool enabled) {
  // Waveshare NS4150B CTRL is active high; ES3C28P's amplifier is active low.
  esp_err_t result = gpio_set_level(LANTERN_AUDIO_AMP_ENABLE_GPIO,
                                    LANTERN_AUDIO_ADC_ES7210 ? enabled : !enabled);
#if LANTERN_AUDIO_ADC_ES7210
  atomic_store_explicit(&s_speaker_requested, enabled, memory_order_relaxed);
  atomic_store_explicit(&s_speaker_write_status, result, memory_order_relaxed);
  ESP_LOGI(TAG, "speaker gate requested=%u write=%d output_latch=%d output_enabled=%u",
      (unsigned)enabled, result, speaker_output_latch(), (unsigned)speaker_output_enabled());
#else
  if (result != ESP_OK) ESP_LOGE(TAG, "speaker gate write failed: %d", result);
#endif
}

esp_err_t lantern_board_speaker_probe(lantern_board_speaker_state_t *state) {
  if (!state) return ESP_ERR_INVALID_ARG;
  memset(state, 0, sizeof(*state));
  state->amp_output_level = -1;
  state->amp_write_status = ESP_ERR_NOT_SUPPORTED;
  state->control_error = ESP_ERR_NOT_SUPPORTED;
  state->repair_write_status = state->verify_read_status = ESP_ERR_NOT_SUPPORTED;
  for (unsigned i = 0; i < LANTERN_SPEAKER_PROBE_COUNT; ++i) {
    state->values[i] = 0xff;
    state->read_status[i] = ESP_ERR_NOT_SUPPORTED;
  }
#if LANTERN_AUDIO_ADC_ES7210
  state->amp_requested = atomic_load_explicit(&s_speaker_requested, memory_order_relaxed);
  state->amp_write_status = atomic_load_explicit(&s_speaker_write_status, memory_order_relaxed);
  state->amp_output_level = speaker_output_latch();
  state->amp_output_enabled = speaker_output_enabled();
  if (!s_codec || !s_output_control) {
    state->control_error = ESP_ERR_INVALID_STATE;
    return ESP_ERR_INVALID_STATE;
  }
  // Pinned es8311 driver:0x31 mute,0x32 volume,0x0D system,0x12 DAC power.
  const uint8_t registers[LANTERN_SPEAKER_PROBE_COUNT] = {0x31, 0x32, 0x0d, 0x12};
  esp_err_t status = ESP_OK;
  for (unsigned i = 0; i < LANTERN_SPEAKER_PROBE_COUNT; ++i) {
    int value = 0;
    state->read_status[i] = esp_codec_dev_read_reg(s_codec, registers[i], &value);
    if (state->read_status[i] == ESP_CODEC_DEV_OK) {
      state->values[i] = (uint8_t)value;
      state->valid_mask |= (uint8_t)(1U << i);
    } else if (status == ESP_OK) status = state->read_status[i];
  }
  state->control_error = quipus_codec_control_error(s_output_control);
  if (status == ESP_OK && state->control_error != ESP_CODEC_DEV_OK)
    status = state->control_error;
  return status;
#else
  return ESP_ERR_NOT_SUPPORTED;
#endif
}

esp_err_t lantern_board_speaker_startup_diagnostics(void) {
#if LANTERN_AUDIO_ADC_ES7210 && CONFIG_IDF_TARGET_ESP32S3
  if (!s_codec || !s_output_control) return ESP_ERR_INVALID_STATE;
  static const uint8_t registers[] = {
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
    0x08, 0x09, 0x0a, 0x13, 0x14, 0x37, 0x44, 0x45
  };
  esp_err_t first_error = ESP_OK;
  for (unsigned i = 0; i < sizeof(registers); ++i) {
    int value = 0;
    int result = esp_codec_dev_read_reg(s_codec, registers[i], &value);
    ESP_LOGI(TAG, "speaker startup codec reg=%02x status=%d value=%02x valid=%u",
        registers[i], result, result == ESP_CODEC_DEV_OK ? value & 0xff : 0xff,
        (unsigned)(result == ESP_CODEC_DEV_OK));
    if (first_error == ESP_OK && result != ESP_CODEC_DEV_OK) first_error = result;
  }
  int control_error = quipus_codec_control_error(s_output_control);
  ESP_LOGI(TAG, "speaker startup control=%d", control_error);
  if (first_error == ESP_OK && control_error != ESP_CODEC_DEV_OK) first_error = control_error;

  static const struct { uint8_t pin; uint32_t matrix, mux; } pins[] = {
    {7, GPIO_FUNC7_OUT_SEL_CFG_REG, IO_MUX_GPIO7_REG},
    {8, GPIO_FUNC8_OUT_SEL_CFG_REG, IO_MUX_GPIO8_REG},
    {9, GPIO_FUNC9_OUT_SEL_CFG_REG, IO_MUX_GPIO9_REG},
    {10, GPIO_FUNC10_OUT_SEL_CFG_REG, IO_MUX_GPIO10_REG},
    {12, GPIO_FUNC12_OUT_SEL_CFG_REG, IO_MUX_GPIO12_REG}
  };
  uint32_t output = REG_READ(GPIO_OUT_REG), enabled = REG_READ(GPIO_ENABLE_REG);
  for (unsigned i = 0; i < sizeof(pins) / sizeof(pins[0]); ++i) {
    uint32_t matrix = REG_READ(pins[i].matrix), mux = REG_READ(pins[i].mux);
    ESP_LOGI(TAG, "speaker startup gpio=%u matrix=%08lx mux=%08lx outsel=%u func=%u latch=%u enable=%u",
        (unsigned)pins[i].pin, (unsigned long)matrix, (unsigned long)mux,
        (unsigned)((matrix & GPIO_FUNC7_OUT_SEL_M) >> GPIO_FUNC7_OUT_SEL_S),
        (unsigned)((mux & MCU_SEL_M) >> MCU_SEL_S),
        (unsigned)((output >> pins[i].pin) & 1U), (unsigned)((enabled >> pins[i].pin) & 1U));
  }
  // Read only configuration registers: no interrupt read/clear or DMA data.
  uint32_t conf = REG_READ(I2S_TX_CONF_REG(0));
  uint32_t conf1 = REG_READ(I2S_TX_CONF1_REG(0));
  uint32_t clock = REG_READ(I2S_TX_CLKM_CONF_REG(0));
  uint32_t fraction = REG_READ(I2S_TX_CLKM_DIV_CONF_REG(0));
  uint32_t rx_clock = REG_READ(I2S_RX_CLKM_CONF_REG(0));
  ESP_LOGI(TAG, "speaker startup i2s0 tx_conf=%08lx start=%u slave=%u left=%u big_endian=%u",
      (unsigned long)conf, (unsigned)((conf & I2S_TX_START) != 0),
      (unsigned)((conf & I2S_TX_SLAVE_MOD) != 0),
      (unsigned)((conf & I2S_TX_LEFT_ALIGN) != 0), (unsigned)((conf & I2S_TX_BIG_ENDIAN) != 0));
  ESP_LOGI(TAG, "speaker startup i2s0 tx_conf1=%08lx bits=%u bclk_div=%u philips_shift=%u",
      (unsigned long)conf1,
      (unsigned)(((conf1 & I2S_TX_BITS_MOD_M) >> I2S_TX_BITS_MOD_S) + 1U),
      (unsigned)(((conf1 & I2S_TX_BCK_DIV_NUM_M) >> I2S_TX_BCK_DIV_NUM_S) + 1U),
      (unsigned)((conf1 & I2S_TX_MSB_SHIFT) != 0));
  ESP_LOGI(TAG, "speaker startup i2s0 tx_clock=%08lx active=%u source=%u integer_div=%u",
      (unsigned long)clock, (unsigned)((clock & I2S_TX_CLK_ACTIVE) != 0),
      (unsigned)((clock & I2S_TX_CLK_SEL_M) >> I2S_TX_CLK_SEL_S),
      (unsigned)((clock & I2S_TX_CLKM_DIV_NUM_M) >> I2S_TX_CLKM_DIV_NUM_S));
  ESP_LOGI(TAG, "speaker startup i2s0 fraction=%08lx rx_clock=%08lx mclk_from_rx=%u slots=%08lx",
      (unsigned long)fraction, (unsigned long)rx_clock,
      (unsigned)((rx_clock & I2S_MCLK_SEL) != 0), (unsigned long)REG_READ(I2S_TX_TDM_CTRL_REG(0)));
  ESP_LOGI(TAG, "speaker startup expected_routes amp=%u mclk=%u bclk=%u ws=%u data=%u gpio_func=%u",
      (unsigned)SIG_GPIO_OUT_IDX, (unsigned)I2S0_MCLK_OUT_IDX, (unsigned)I2S0O_BCK_OUT_IDX,
      (unsigned)I2S0O_WS_OUT_IDX, (unsigned)I2S0O_SD_OUT_IDX, (unsigned)PIN_FUNC_GPIO);
  return first_error;
#else
  return ESP_ERR_NOT_SUPPORTED;
#endif
}

esp_err_t lantern_board_speaker_prepare_output(unsigned software_volume,
    lantern_board_speaker_state_t *state) {
  esp_err_t status = lantern_board_speaker_probe(state);
  if (status != ESP_OK) return status;
#if LANTERN_AUDIO_ADC_ES7210
  // Literal powered-on values written by installed es8311_start. An unexpected
  // state needs diagnosis; never reconstruct clocks/power during a capture.
  if (state->values[LANTERN_SPEAKER_PROBE_SYSTEM_POWER] != 0x01 ||
      state->values[LANTERN_SPEAKER_PROBE_DAC_POWER] != 0x00) return ESP_ERR_INVALID_STATE;
  uint8_t before = state->values[LANTERN_SPEAKER_PROBE_MUTE];
  if (!software_volume || !(before & 0x60)) return ESP_OK;
  state->repair_attempted = true;
  state->mute_before = before;
  uint8_t expected = before & 0x9f;
  // Exact es8311_set_mute(false) mask, with a verified prior read and checked
  // write/readback. The vendor convenience setter discards write failures.
  state->repair_write_status = esp_codec_dev_write_reg(s_codec, 0x31, expected);
  state->control_error = quipus_codec_control_error(s_output_control);
  if (state->repair_write_status != ESP_CODEC_DEV_OK || state->control_error != ESP_CODEC_DEV_OK) {
    ESP_LOGE(TAG, "speaker unmute failed before=0x%02x write=%d control=%d",
        before, state->repair_write_status, state->control_error);
    return state->repair_write_status != ESP_CODEC_DEV_OK
        ? state->repair_write_status : state->control_error;
  }
  int verified = 0;
  state->verify_read_status = esp_codec_dev_read_reg(s_codec, 0x31, &verified);
  state->control_error = quipus_codec_control_error(s_output_control);
  if (state->verify_read_status == ESP_CODEC_DEV_OK)
    state->values[LANTERN_SPEAKER_PROBE_MUTE] = (uint8_t)verified;
  else state->valid_mask &= (uint8_t)~(1U << LANTERN_SPEAKER_PROBE_MUTE);
  state->repair_verified = state->verify_read_status == ESP_CODEC_DEV_OK &&
      state->control_error == ESP_CODEC_DEV_OK && (uint8_t)verified == expected;
  ESP_LOGI(TAG, "speaker unmute before=0x%02x expected=0x%02x after=0x%02x write=%d read=%d control=%d verified=%u",
      before, expected, verified & 0xff, state->repair_write_status,
      state->verify_read_status, state->control_error, (unsigned)state->repair_verified);
  if (state->verify_read_status != ESP_CODEC_DEV_OK) return state->verify_read_status;
  if (state->control_error != ESP_CODEC_DEV_OK) return state->control_error;
  return state->repair_verified ? ESP_OK : ESP_FAIL;
#else
  (void)software_volume;
  return ESP_ERR_NOT_SUPPORTED;
#endif
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
esp_err_t lantern_board_speaker_startup_diagnostics(void) { return ESP_ERR_NOT_SUPPORTED; }
esp_err_t lantern_board_speaker_probe(lantern_board_speaker_state_t *state) {
  if (!state) return ESP_ERR_INVALID_ARG;
  memset(state, 0, sizeof(*state));
  state->amp_output_level = -1;
  state->amp_write_status = state->control_error = ESP_ERR_NOT_SUPPORTED;
  state->repair_write_status = state->verify_read_status = ESP_ERR_NOT_SUPPORTED;
  for (unsigned i = 0; i < LANTERN_SPEAKER_PROBE_COUNT; ++i) {
    state->values[i] = 0xff;
    state->read_status[i] = ESP_ERR_NOT_SUPPORTED;
  }
  return ESP_ERR_NOT_SUPPORTED;
}
esp_err_t lantern_board_speaker_prepare_output(unsigned software_volume,
    lantern_board_speaker_state_t *state) {
  (void)software_volume;
  return lantern_board_speaker_probe(state);
}
esp_err_t lantern_board_touch_init(void) { return ESP_ERR_NOT_SUPPORTED; }
bool lantern_board_touch_read(uint16_t *x, uint16_t *y) {
  (void)x;
  (void)y;
  return false;
}

#endif
