#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef struct {
  bool pressed;
  bool suppressed;
  uint32_t started_ms;
} quipus_button_tap_t;

// One event on release, with a 40 ms debounce. Chords and long holds must
// never become a volume tap when another button is released first.
static inline bool quipus_button_tap_update(quipus_button_tap_t *tap,
                                          bool pressed, bool chord,
                                          uint32_t now_ms) {
  if (pressed && !tap->pressed) {
    tap->started_ms = now_ms;
    tap->suppressed = false;
  }
  if (pressed && chord) tap->suppressed = true;
  bool released = !pressed && tap->pressed;
  uint32_t held_ms = now_ms - tap->started_ms;
  bool clicked = released && !chord && !tap->suppressed &&
                 held_ms >= 40 && held_ms < 1200;
  tap->pressed = pressed;
  return clicked;
}
