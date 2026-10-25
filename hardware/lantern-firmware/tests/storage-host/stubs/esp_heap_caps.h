#pragma once
#include <stddef.h>
#include <stdlib.h>
#define MALLOC_CAP_SPIRAM 1U
#define MALLOC_CAP_8BIT 2U
void *heap_caps_malloc(size_t size, unsigned caps);
