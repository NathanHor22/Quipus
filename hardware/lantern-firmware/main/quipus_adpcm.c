#include "quipus_adpcm.h"

// Standard IMA quantizer tables; independently implemented decoder. Format and
// golden oracle: CPython3.11 audioop.lin2adpcm/adpcm2lin, high nibble first.
static const int step[89] = {
  7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,
  73,80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,337,371,408,
  449,494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552,1707,1878,
  2066,2272,2499,2749,3024,3327,3660,4026,4428,4871,5358,5894,6484,7132,
  7845,8630,9493,10442,11487,12635,13899,15289,16818,18500,20350,22385,
  24623,27086,29794,32767
};
static const int index_delta[16] = {-1,-1,-1,-1,2,4,6,8,-1,-1,-1,-1,2,4,6,8};
void quipus_adpcm_init(quipus_adpcm_state_t *state) {
  if (state) { state->predictor = 0; state->index = 0; }
}
size_t quipus_adpcm_decode(const uint8_t *data, size_t bytes, int16_t *output,
                            size_t capacity, quipus_adpcm_state_t *state) {
  if (!data || !output || !state || !bytes || bytes > QUIPUS_ADPCM_MAX_CHUNK ||
      capacity < bytes * 2 || state->predictor < -32768 || state->predictor > 32767 ||
      state->index < 0 || state->index > 88)
    return 0;
  int predictor = state->predictor, index = state->index;
  for (size_t i = 0; i < bytes * 2; ++i) {
    unsigned code = (data[i / 2] >> (i % 2 ? 0 : 4)) & 15;
    int quantizer = step[index], difference = quantizer >> 3;
    if (code & 4) difference += quantizer;
    if (code & 2) difference += quantizer >> 1;
    if (code & 1) difference += quantizer >> 2;
    predictor += code & 8 ? -difference : difference;
    if (predictor > 32767) predictor = 32767;
    if (predictor < -32768) predictor = -32768;
    index += index_delta[code];
    if (index < 0) index = 0;
    if (index > 88) index = 88;
    output[i] = (int16_t)predictor;
  }
  state->predictor = predictor; state->index = index;
  return bytes * 2;
}
