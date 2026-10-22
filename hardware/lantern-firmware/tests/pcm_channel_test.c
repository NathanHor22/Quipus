#include <assert.h>
#include <stdint.h>
#include <stdio.h>

#include "quipus_pcm.h"

int main(void) {
  // Twenty milliseconds of distinct microphone and reference signals must
  // remain 320 mono samples; interleaving them would corrupt timing and VAD.
  int16_t stereo[640], output[322];
  for (int frame = 0; frame < 320; ++frame) {
    stereo[frame * 2] = (int16_t)(frame * 101 - 16000);
    stereo[frame * 2 + 1] = (int16_t)(16000 - frame * 79);
  }
  output[320] = 1234;
  output[321] = 5678;
  assert(quipus_pcm_select_channel(stereo, 640, 2, 0, output, 320) == 320);
  for (int frame = 0; frame < 320; ++frame)
    assert(output[frame] == stereo[frame * 2]);
  assert(output[320] == 1234 && output[321] == 5678);
  assert(quipus_pcm_select_channel(stereo, 640, 2, 1, output, 320) == 320);
  for (int frame = 0; frame < 320; ++frame)
    assert(output[frame] == stereo[frame * 2 + 1]);

  const int16_t edges[] = {INT16_MIN, INT16_MAX, 0, -1};
  assert(quipus_pcm_select_channel(edges, 4, 1, 0, output, 320) == 4);
  for (int frame = 0; frame < 4; ++frame) assert(output[frame] == edges[frame]);
  assert(quipus_pcm_select_channel(stereo, 639, 2, 0, output, 320) == 319);
  assert(quipus_pcm_select_channel(stereo, 640, 2, 0, output, 1) == 1);
  assert(quipus_pcm_select_channel(NULL, 640, 2, 0, output, 320) == 0);
  assert(quipus_pcm_select_channel(stereo, 640, 0, 0, output, 320) == 0);
  assert(quipus_pcm_select_channel(stereo, 640, 2, 2, output, 320) == 0);
  assert(quipus_pcm_select_channel(stereo, 640, 2, 0, NULL, 320) == 0);
  puts("PCM channel selection preserves waveform, sample count and bounds.");
  return 0;
}
