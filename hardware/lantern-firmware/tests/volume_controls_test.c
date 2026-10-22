#include <assert.h>
#include <limits.h>
#include <stdio.h>

#include "quipus_button_tap.h"
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
  // A power-off hold, including a blocked shutdown, never changes volume.
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
  // Releasing PLUS before BOOT must not turn the reset chord into volume up.
  assert(!quipus_button_tap_update(&button, true, false, 220));
  assert(!quipus_button_tap_update(&button, false, false, 280));
  assert(!quipus_button_tap_update(&button, true, true, 400));
  assert(!quipus_button_tap_update(&button, false, true, 500));
  // A subsequent deliberate tap still works.
  assert(!quipus_button_tap_update(&button, true, false, 600));
  assert(quipus_button_tap_update(&button, false, false, 700));
}

int main(void) {
  audio_limits();
  release_and_hold();
  reset_chords();
  puts("Speaker PCM limits and volume/reset/power button gestures passed.");
}
