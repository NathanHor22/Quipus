#pragma once
#include <stdint.h>
#ifndef TEST_TICK_HZ
#define TEST_TICK_HZ 1000
#endif
typedef uint32_t TickType_t;
#define pdMS_TO_TICKS(ms) ((TickType_t)((ms) * TEST_TICK_HZ / 1000))
