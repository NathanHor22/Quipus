#pragma once
#include <stddef.h>
#include <stdint.h>

#define QUIPUS_ADPCM_MAX_CHUNK 512u
typedef struct { int predictor; int index; } quipus_adpcm_state_t;

void quipus_adpcm_init(quipus_adpcm_state_t *state);
// Standard IMA ADPCM, high nibble first (Python audioop-compatible), two signed
// 16-bit samples per byte. State starts at {0,0} for each independent clip.
// Invalid arguments/state, >512 bytes or insufficient output capacity return
// zero without changing state or output. No allocation or whole-clip buffering.
size_t quipus_adpcm_decode(const uint8_t *data, size_t length_bytes,
                            int16_t *output, size_t capacity_samples,
                            quipus_adpcm_state_t *state);
