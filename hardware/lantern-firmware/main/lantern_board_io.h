#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

esp_err_t lantern_board_i2c_init(void);
esp_err_t lantern_board_audio_codec_init(void *tx_handle, void *rx_handle);
void lantern_board_speaker_enable(bool enabled);

typedef enum {
  LANTERN_SPEAKER_PROBE_MUTE,
  LANTERN_SPEAKER_PROBE_VOLUME,
  LANTERN_SPEAKER_PROBE_SYSTEM_POWER,
  LANTERN_SPEAKER_PROBE_DAC_POWER,
  LANTERN_SPEAKER_PROBE_COUNT
} lantern_speaker_probe_register_t;

typedef struct {
  uint8_t values[LANTERN_SPEAKER_PROBE_COUNT], valid_mask;
  int read_status[LANTERN_SPEAKER_PROBE_COUNT], control_error;
  bool amp_requested, amp_output_enabled;
  int amp_output_level, amp_write_status;
  bool repair_attempted, repair_verified;
  uint8_t mute_before;
  int repair_write_status, verify_read_status;
} lantern_board_speaker_state_t;

/* Actual ES8311 register/output-latch evidence, never cached mute/volume.
 * Values are usable only when the corresponding valid_mask bit is set.
 * Probe is read-only; power readiness is checked by prepare_output.
 * Unsupported profiles leave a diagnostic snapshot and return NOT_SUPPORTED.
 */
esp_err_t lantern_board_speaker_probe(lantern_board_speaker_state_t *state);
/* Startup-only read-only diagnostic; call once after successful audio init and
 * before WakeNet. Logs bounded codec/configuration rows, never PCM or keys.
 * Invalid/unavailable codec means no bus/MMIO access; no state is repaired.
 */
esp_err_t lantern_board_speaker_startup_diagnostics(void);
/* Call only while owning the speaker, before enabling its amplifier. At most
 * one verified mute-only RMW; volume0 never unmutes. No reset/open/power/gain
 * writes or error-latch clearing. Success does not prove physical audibility.
 */
esp_err_t lantern_board_speaker_prepare_output(unsigned software_volume,
    lantern_board_speaker_state_t *state);
esp_err_t lantern_board_touch_init(void);
bool lantern_board_touch_read(uint16_t *x, uint16_t *y);
