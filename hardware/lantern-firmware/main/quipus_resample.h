#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

/* 24 kHz speech to the 16 kHz speaker. Dropping every third sample spaced the
 * kept samples unevenly and folded 8-12 kHz into the audible band. This
 * applies a [1 2 1]/4 low-pass (-12 dB at 8 kHz, -2.5 dB at 4 kHz), then
 * interpolates linearly at exact 1.5-sample steps. State carries across
 * chunks, so chunk boundaries leave no seam; latency is one input sample. */
typedef struct {
  int32_t h1, h2, previous;
  uint32_t index;     /* index of the next smoothed sample */
  uint32_t next_half; /* next output position, in half input samples */
  bool primed;
} quipus_resample_3_2_t;

static inline void quipus_resample_3_2_reset(quipus_resample_3_2_t *state) {
  memset(state, 0, sizeof(*state));
}

/* Returns the number of 16 kHz samples written (about two per three inputs). */
static inline size_t quipus_resample_3_2(quipus_resample_3_2_t *state,
                                         const int16_t *input, size_t count,
                                         int16_t *output, size_t capacity) {
  size_t produced = 0;
  for (size_t i = 0; i < count; ++i) {
    int32_t x = input[i];
    if (!state->primed) {
      state->h1 = state->h2 = x;
      state->primed = true;
    }
    int32_t smoothed = (state->h2 + 2 * state->h1 + x) / 4;
    state->h2 = state->h1;
    state->h1 = x;
    uint32_t k = state->index++;
    while (produced < capacity && state->next_half <= 2U * k) {
      output[produced++] = (int16_t)(state->next_half == 2U * k
          ? smoothed : (state->previous + smoothed) / 2);
      state->next_half += 3U;
    }
    state->previous = smoothed;
  }
  return produced;
}
