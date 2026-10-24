#include <assert.h>
#include <limits.h>
#include <stdio.h>

#include "quipus_button_tap.h"
#include "quipus_controls.h"
#include "quipus_volume.h"

static void audio_limits(void) {
  assert(quipus_volume_clamp(-10) == 0);
  assert(quipus_volume_clamp(110) == 100);
  // Every signed PCM value must survive full volume, mute exactly at zero,
  // and stay within the original signal's magnitude when attenuated.
  for (int sample = INT16_MIN; sample <= INT16_MAX; ++sample) {
    assert(quipus_volume_sample((int16_t)sample, 100) == sample);
    assert(quipus_volume_sample((int16_t)sample, 0) == 0);
    int quiet = quipus_volume_sample((int16_t)sample, 80);
    assert(sample >= 0 ? quiet >= 0 && quiet <= sample
                       : quiet <= 0 && quiet >= sample);
  }
  assert(quipus_volume_sample(INT16_MIN, 50) == -16384);
  assert(quipus_volume_sample(INT16_MAX, 50) == 16383);
  assert(quipus_volume_sample(INT16_MAX, 999) == INT16_MAX);
}

static void release_and_hold(void) {
  quipus_button_tap_t button = {0};
  assert(!quipus_button_tap_update(&button, true, false, 100));
  assert(quipus_button_tap_update(&button, false, false, 200));
  assert(!quipus_button_tap_update(&button, false, false, 230));
  // Bounce never becomes an extra tap.
  assert(!quipus_button_tap_update(&button, true, false, 250));
  assert(!quipus_button_tap_update(&button, false, false, 270));
  // Long outer-button holds never become volume taps.
  assert(!quipus_button_tap_update(&button, true, false, 500));
  assert(!quipus_button_tap_update(&button, false, false, 3000));
  // Unsigned timestamps remain valid across wraparound.
  assert(!quipus_button_tap_update(&button, true, false, UINT32_MAX - 60));
  assert(quipus_button_tap_update(&button, false, false, 40));
}

static void reset_chords(void) {
  quipus_button_tap_t button = {0};
  assert(!quipus_button_tap_update(&button, true, false, 100));
  assert(!quipus_button_tap_update(&button, true, true, 160));
  // Releasing one outer button before the other must not change volume.
  assert(!quipus_button_tap_update(&button, true, false, 220));
  assert(!quipus_button_tap_update(&button, false, false, 280));
  assert(!quipus_button_tap_update(&button, true, true, 400));
  assert(!quipus_button_tap_update(&button, false, true, 500));
  // A subsequent deliberate tap still works.
  assert(!quipus_button_tap_update(&button, true, false, 600));
  assert(quipus_button_tap_update(&button, false, false, 700));
}

static void independent_outer_buttons(void) {
  quipus_button_tap_t quieter = {0}, louder = {0};
  assert(!quipus_button_tap_update(&quieter, true, false, 100));
  assert(!quipus_button_tap_update(&louder, false, true, 100));
  assert(quipus_button_tap_update(&quieter, false, false, 200));
  assert(!quipus_button_tap_update(&louder, false, false, 200));
  assert(!quipus_button_tap_update(&louder, true, false, 300));
  assert(quipus_button_tap_update(&louder, false, false, 400));
  // Holding the middle Start/Power key suppresses both outer-button taps.
  assert(!quipus_button_tap_update(&quieter, true, true, 500));
  assert(!quipus_button_tap_update(&louder, true, true, 500));
  assert(!quipus_button_tap_update(&quieter, false, false, 600));
  assert(!quipus_button_tap_update(&louder, false, false, 600));
}

static void safe_power_holds(void) {
  quipus_power_hold_t hold = {0};
  assert(!quipus_power_hold_update(&hold, false, false, 0));
  assert(!quipus_power_hold_update(&hold, true, false, 1000));
  assert(!quipus_power_hold_update(&hold, true, false, 2999));
  assert(quipus_power_hold_update(&hold, true, false, 3000));
  assert(!quipus_power_hold_update(&hold, true, false, 100000));
  assert(!quipus_power_hold_update(&hold, false, false, 100100));
  assert(!quipus_power_hold_update(&hold, true, false, 100200));
  assert(quipus_power_hold_update(&hold, true, false, 102200));

  // Startup/power-on holds are explicitly disarmed until fully released.
  hold = (quipus_power_hold_t){.pressed = true, .suppressed = true};
  assert(!quipus_power_hold_update(&hold, true, false, 10000));
  assert(!quipus_power_hold_update(&hold, false, false, 10020));
  assert(!quipus_power_hold_update(&hold, true, false, 10040));
  assert(quipus_power_hold_update(&hold, true, false, 12040));

  // A chord suppresses the whole hold, even after the other key is released.
  hold = (quipus_power_hold_t){0};
  assert(!quipus_power_hold_update(&hold, true, false, 0));
  assert(!quipus_power_hold_update(&hold, true, true, 500));
  assert(!quipus_power_hold_update(&hold, true, false, 5000));
  assert(!quipus_power_hold_update(&hold, false, false, 5020));
  assert(!quipus_power_hold_update(&hold, true, false, 5040));
  assert(quipus_power_hold_update(&hold, true, false, 7040));

  hold = (quipus_power_hold_t){0};
  assert(!quipus_power_hold_update(&hold, true, false, UINT32_MAX - 1000));
  assert(!quipus_power_hold_update(&hold, true, false, 998));
  assert(quipus_power_hold_update(&hold, true, false, 999));
}

static void bounded_volume_repeat(void) {
  quipus_volume_button_t button = {0};
  assert(!quipus_volume_button_update(&button, true, false, 100));
  assert(!quipus_volume_button_update(&button, true, false, 599));
  assert(quipus_volume_button_update(&button, true, false, 600));
  assert(!quipus_volume_button_update(&button, true, false, 799));
  assert(quipus_volume_button_update(&button, true, false, 800));
  // A long scheduler pause yields one step, never a burst of catch-up events.
  assert(quipus_volume_button_update(&button, true, false, 10000));
  assert(!quipus_volume_button_update(&button, true, false, 10000));
  assert(!quipus_volume_button_update(&button, false, false, 10020));
  assert(!quipus_volume_button_update(&button, true, false, 10100));
  assert(quipus_volume_button_update(&button, false, false, 10200));

  button = (quipus_volume_button_t){.tap = {.pressed = true, .suppressed = true}};
  assert(!quipus_volume_button_update(&button, true, false, 10000));
  assert(!quipus_volume_button_update(&button, false, false, 10020));
  assert(!quipus_volume_button_update(&button, true, false, 10100));
  assert(quipus_volume_button_update(&button, true, false, 10600));

  button = (quipus_volume_button_t){0};
  assert(!quipus_volume_button_update(&button, true, false, 0));
  assert(!quipus_volume_button_update(&button, true, true, 200));
  assert(!quipus_volume_button_update(&button, true, false, 5000));
  assert(!quipus_volume_button_update(&button, false, false, 5020));

  button = (quipus_volume_button_t){0};
  assert(!quipus_volume_button_update(&button, true, false, UINT32_MAX - 250));
  assert(!quipus_volume_button_update(&button, true, false, 248));
  assert(quipus_volume_button_update(&button, true, false, 249));
  assert(!quipus_volume_button_update(&button, false, false, 300));
}

int main(void) {
  audio_limits();
  release_and_hold();
  reset_chords();
  independent_outer_buttons();
  safe_power_holds();
  bounded_volume_repeat();
  puts("Speaker PCM limits and volume/reset/power button gestures passed.");
}
