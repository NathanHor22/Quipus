#pragma once
#include <stdlib.h>
#include <stdint.h>
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
static inline void *heap_caps_aligned_alloc(size_t alignment,size_t size,unsigned caps) {
  (void)caps;
  void *result=malloc(size);
  if(result && (uintptr_t)result%alignment){free(result);return NULL;}
  return result;
}
