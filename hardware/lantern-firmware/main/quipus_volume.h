#pragma once

#include <stdint.h>

#define QUIPUS_VOLUME_DEFAULT 80
#define QUIPUS_VOLUME_STEP 10

static inline unsigned quipus_volume_clamp(int percent) {
  return percent < 0 ? 0U : percent > 100 ? 100U : (unsigned)percent;
}

// Attenuate speaker output only. Never alter microphone/archive samples.
static inline int16_t quipus_volume_sample(int16_t sample, unsigned percent) {
  if (percent > 100) percent = 100;
  return (int16_t)((int32_t)sample * (int32_t)percent / 100);
}
