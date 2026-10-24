#pragma once
#include <stdint.h>
#include <stddef.h>
typedef enum { VAD_MODE_0 = 0 } vad_mode_t;
typedef enum { VAD_SILENCE = 0, VAD_SPEECH = 1 } vad_state_t;
typedef void *vad_handle_t;
// Synthetic test activity only, NOT a native implementation of ESP-SR VAD.
// It supplies a public-fixture mask to test the real TensorFlow numeric path.
static inline vad_handle_t vad_create(vad_mode_t mode) {static int tag;(void)mode;return &tag;}
static inline void vad_reset_trigger(vad_handle_t handle) { (void)handle; }
static inline vad_state_t vad_process(vad_handle_t handle, int16_t *data, int rate, int ms) {
  (void)handle;(void)rate;(void)ms;
  uint64_t energy=0;
  for(int i=0;i<320;++i)energy+=(int64_t)data[i]*data[i];
  return energy/320>40U*40U?VAD_SPEECH:VAD_SILENCE;
}
