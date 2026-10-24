#pragma once
#include <stdlib.h>
#include <stdint.h>
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
#define MALLOC_CAP_INTERNAL 4
#ifdef __cplusplus
extern "C" {
#endif
extern int quipus_test_fail_allocation;
extern unsigned quipus_test_allocations;
#ifdef __cplusplus
}
#endif
static inline void *heap_caps_aligned_alloc(size_t alignment,size_t size,unsigned caps) {
 (void)caps; ++quipus_test_allocations;
 if(quipus_test_fail_allocation)return NULL;
 void *memory=malloc(size);
 if(memory && (uintptr_t)memory%alignment){free(memory);return NULL;}
 return memory;
}

// Diagnostic test placeholders, never target memory measurements.
static inline size_t heap_caps_get_free_size(unsigned caps){(void)caps;return 0;}
static inline size_t heap_caps_get_largest_free_block(unsigned caps){(void)caps;return 0;}
