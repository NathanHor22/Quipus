#pragma once
#include <stdint.h>
#include <stddef.h>
typedef enum {VAD_MODE_0=0} vad_mode_t;
typedef enum {VAD_SILENCE=0,VAD_SPEECH=1} vad_state_t;
typedef void *vad_handle_t;
#ifdef __cplusplus
extern "C" {
#endif
extern int quipus_test_fail_vad;
extern int quipus_test_silent_vad;
#ifdef __cplusplus
}
#endif
// Deterministic synthetic host activity; not the ESP-SR classifier or a VAD benchmark.
static inline vad_handle_t vad_create(vad_mode_t mode){static int marker;(void)mode;return quipus_test_fail_vad?NULL:&marker;}
static inline void vad_reset_trigger(vad_handle_t handle){(void)handle;}
static inline vad_state_t vad_process(vad_handle_t handle,int16_t *data,int rate,int ms){
 (void)handle;(void)rate;(void)ms;
 if(quipus_test_silent_vad)return VAD_SILENCE;
 uint64_t energy=0;for(unsigned i=0;i<320;++i)energy+=(int64_t)data[i]*data[i];
 return energy/320>40U*40U?VAD_SPEECH:VAD_SILENCE;
}
