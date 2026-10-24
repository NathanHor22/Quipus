#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "quipus_button_tap.h"

#define QUIPUS_POWER_HOLD_MS 2000U
#define QUIPUS_VOLUME_REPEAT_DELAY_MS 500U
#define QUIPUS_VOLUME_REPEAT_MS 200U

typedef struct {
  bool pressed;
  bool suppressed;
  bool fired;
  uint32_t started_ms;
} quipus_power_hold_t;

// A power-on hold or a chord must be released before a shutdown can be requested.
// One request per hold, independently of slow network/session processing.
static inline bool quipus_power_hold_update(quipus_power_hold_t *hold,
    bool pressed, bool chord, uint32_t now_ms) {
  if (!pressed) {
    hold->pressed = hold->suppressed = hold->fired = false;
    return false;
  }
  if (!hold->pressed) {
    hold->pressed = true;
    hold->started_ms = now_ms;
    hold->fired = false;
  }
  if (chord) hold->suppressed = true;
  if (hold->suppressed || hold->fired ||
      (uint32_t)(now_ms - hold->started_ms) < QUIPUS_POWER_HOLD_MS)
    return false;
  hold->fired = true;
  return true;
}

typedef struct {
  quipus_button_tap_t tap;
  uint32_t repeated_at_ms;
  bool repeated;
} quipus_volume_button_t;

// Short taps act on release; a deliberate hold repeats at a bounded rate.
static inline bool quipus_volume_button_update(quipus_volume_button_t *button,
    bool pressed, bool chord, uint32_t now_ms) {
  if (pressed && !button->tap.pressed) {
    button->repeated = false;
    button->repeated_at_ms = now_ms;
  }
  bool tapped = quipus_button_tap_update(&button->tap, pressed, chord, now_ms);
  if (pressed && !button->tap.suppressed && !chord &&
      (uint32_t)(now_ms - button->tap.started_ms) >= QUIPUS_VOLUME_REPEAT_DELAY_MS &&
      (uint32_t)(now_ms - button->repeated_at_ms) >= QUIPUS_VOLUME_REPEAT_MS) {
    button->repeated = true;
    button->repeated_at_ms = now_ms;
    return true;
  }
  return tapped && !button->repeated;
}
