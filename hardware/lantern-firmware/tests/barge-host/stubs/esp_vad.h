#pragma once
#include <stdint.h>
typedef void *vad_handle_t;
#define VAD_MODE_3 3
#define VAD_SPEECH 1
vad_handle_t vad_create(int);
int vad_process(vad_handle_t,const int16_t*,int,int);
void vad_reset_trigger(vad_handle_t);
void vad_destroy(vad_handle_t);
