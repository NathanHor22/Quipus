#pragma once
#include <stdint.h>
typedef struct { int chunk; } aec_handle_t;
#define AEC_MODE_SR_LOW_COST 1
aec_handle_t *aec_create(int,int,int,int);
int aec_get_chunksize(aec_handle_t*);
void aec_process(aec_handle_t*,const int16_t*,const int16_t*,int16_t*);
void aec_destroy(aec_handle_t*);
