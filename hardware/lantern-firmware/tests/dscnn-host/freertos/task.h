#pragma once
#include "FreeRTOS.h"
#ifdef __cplusplus
extern "C" {
#endif
extern unsigned quipus_test_yields;
static inline void vTaskDelay(TickType_t ticks){if(ticks==1)++quipus_test_yields;}
static inline unsigned uxTaskGetStackHighWaterMark(void *task){(void)task;return 0;}
#ifdef __cplusplus
}
#endif
