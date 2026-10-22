#pragma once

#include <stddef.h>
#include <stdint.h>

// Keep one microphone at the original sample rate. Interleaved codec slots
// must never become consecutive mono samples (which doubles pitch/duration).
static inline size_t quipus_pcm_select_channel(
    const int16_t *input, size_t input_samples, size_t channels, size_t channel,
    int16_t *output, size_t capacity) {
  if (!input || !output || !channels || channel >= channels)
    return 0;
  size_t frames = input_samples / channels;
  if (frames > capacity)
    frames = capacity;
  for (size_t frame = 0; frame < frames; ++frame)
    output[frame] = input[frame * channels + channel];
  return frames;
}
