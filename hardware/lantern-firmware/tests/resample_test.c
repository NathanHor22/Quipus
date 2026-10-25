#include <math.h>
#include <stdio.h>
#include <string.h>

#include "quipus_resample.h"

#define CHECK(condition)                                                    \
  do {                                                                      \
    if (!(condition)) {                                                     \
      fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #condition);       \
      return 1;                                                             \
    }                                                                       \
  } while (0)

#define INPUT 24000
#define PI 3.14159265358979323846
static int16_t input[INPUT];
static int16_t whole[INPUT], chunked[INPUT];

static void tone(double hz, double amplitude) {
  for (int i = 0; i < INPUT; ++i)
    input[i] = (int16_t)lround(amplitude * sin(2.0 * PI * hz * i / 24000.0));
}

static double rms(const int16_t *samples, size_t first, size_t count) {
  double energy = 0;
  for (size_t i = first; i < first + count; ++i) energy += (double)samples[i] * samples[i];
  return sqrt(energy / (double)count);
}

static size_t convert_whole(void) {
  quipus_resample_3_2_t state;
  quipus_resample_3_2_reset(&state);
  return quipus_resample_3_2(&state, input, INPUT, whole, INPUT);
}

int main(void) {
  // Two outputs per three inputs, exactly as the old decimator counted.
  quipus_resample_3_2_t state;
  quipus_resample_3_2_reset(&state);
  CHECK(quipus_resample_3_2(&state, input, 240, whole, INPUT) == 160);
  CHECK(quipus_resample_3_2(&state, input, 120, whole, INPUT) == 80);
  CHECK(convert_whole() == 16000);

  // Production chunks (240, occasionally odd tails) leave no seam.
  tone(440, 9000);
  size_t total = convert_whole();
  quipus_resample_3_2_reset(&state);
  size_t produced = 0;
  const size_t sizes[] = {240, 240, 7, 233, 1, 239, 240};
  for (size_t offset = 0, step = 0; offset < INPUT; ++step) {
    size_t count = sizes[step % 7];
    if (offset + count > INPUT) count = INPUT - offset;
    produced += quipus_resample_3_2(&state, input + offset, count, chunked + produced, INPUT - produced);
    offset += count;
  }
  CHECK(produced == total && !memcmp(whole, chunked, total * sizeof(int16_t)));

  // Steady levels pass unchanged.
  for (int i = 0; i < INPUT; ++i) input[i] = 1000;
  convert_whole();
  for (int i = 0; i < 16000; ++i) CHECK(whole[i] == 1000);

  // Speech band keeps its level; 10 kHz, which used to fold back to 6 kHz,
  // is cut to under a fifth.
  tone(1000, 10000);
  convert_whole();
  double speech = rms(whole, 200, 15000) / rms(input, 300, 22500);
  CHECK(speech > 0.93 && speech < 1.01);
  tone(10000, 10000);
  convert_whole();
  double folded = rms(whole, 200, 15000) / rms(input, 300, 22500);
  CHECK(folded < 0.2);

  // Full-scale input cannot overflow.
  for (int i = 0; i < INPUT; ++i) input[i] = (i % 2) ? INT16_MAX : INT16_MIN;
  convert_whole();
  for (int i = 0; i < 16000; ++i) CHECK(whole[i] >= INT16_MIN && whole[i] <= INT16_MAX);
  for (int i = 0; i < INPUT; ++i) input[i] = INT16_MAX;
  convert_whole();
  for (int i = 0; i < 16000; ++i) CHECK(whole[i] == INT16_MAX);

  printf("resampler tests passed: speech %.3f, folded %.3f\n", speech, folded);
  return 0;
}
