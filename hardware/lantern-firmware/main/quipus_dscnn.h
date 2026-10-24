#ifndef QUIPUS_DSCNN_H
#define QUIPUS_DSCNN_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
#define QUIPUS_DSCNN_FEATURES 490U
#define QUIPUS_DSCNN_CLASSES 12U
/* Native reference kernels use32KiB. ESP-NN may need extra optimized scratch;
 *64KiB is a target starting budget, not a measured sufficiency guarantee. */
#ifdef ESP_PLATFORM
#define QUIPUS_DSCNN_ARENA_BYTES (64U * 1024U)
#else
#define QUIPUS_DSCNN_ARENA_BYTES (32U * 1024U)
#endif
#define QUIPUS_DSCNN_INPUT_SCALE 0.584702908993f
#define QUIPUS_DSCNN_INPUT_ZERO_POINT 83
/* Pinned MLCommons output order; these are NOT the old four-class labels. */
typedef enum {
  QUIPUS_DSCNN_DOWN, QUIPUS_DSCNN_GO, QUIPUS_DSCNN_LEFT, QUIPUS_DSCNN_NO,
  QUIPUS_DSCNN_OFF, QUIPUS_DSCNN_ON, QUIPUS_DSCNN_RIGHT, QUIPUS_DSCNN_STOP,
  QUIPUS_DSCNN_UP, QUIPUS_DSCNN_YES, QUIPUS_DSCNN_SILENCE, QUIPUS_DSCNN_UNKNOWN
} quipus_dscnn_label_t;
typedef enum {
  QUIPUS_DSCNN_OK = 0, QUIPUS_DSCNN_INVALID_ARGUMENT,
  QUIPUS_DSCNN_INVALID_MODEL, QUIPUS_DSCNN_ALLOCATION_FAILED,
  QUIPUS_DSCNN_NOT_READY, QUIPUS_DSCNN_INVOKE_FAILED,
  QUIPUS_DSCNN_INVALID_DISTRIBUTION
} quipus_dscnn_status_t;
/* Single serialized owner. Model bytes must remain alive/immutable until close.
 * No heap allocations or feature preprocessing occur in this adapter. */
/* Caller arena must be16-byte aligned, at leastQUIPUS_DSCNN_ARENA_BYTES, and
 * remain exclusively owned by this serialized adapter until close. Only the
 * firstQUIPUS_DSCNN_ARENA_BYTES are used/cleared, even when a larger size is
 * passed. ESP_PLATFORM requires caller-owned64KiB (preferPSRAM) and has no large
 * internal .bss default arena; native reference default/caller budget is32KiB.
 * Measure AllocateTensors/arena_used and timing on the actual ESP-NN target. */
quipus_dscnn_status_t quipus_dscnn_init_with_arena(const uint8_t *model, size_t bytes,
                                                uint8_t *arena, size_t arena_bytes);
/* Convenience native-host initializer. ESP builds require init_with_arena. */
quipus_dscnn_status_t quipus_dscnn_init(const uint8_t *model, size_t bytes);
quipus_dscnn_status_t quipus_dscnn_predict(const int8_t *features, size_t count,
                                         int8_t scores[QUIPUS_DSCNN_CLASSES]);
quipus_dscnn_status_t quipus_dscnn_reset(void);
void quipus_dscnn_close(void);
size_t quipus_dscnn_arena_used(void);
const char *quipus_dscnn_label(unsigned index);
/* Scores remain EXACT INT8 model output: probability = (score + 128)/256.
 * Legacy mapping produces [silence, merged unknown, yes, no]. It never raises
 * yes/no/silence and removes only excess quantization mass from merged unknown.
 * Total raw mass outside250..262 (12classes, at most0.5LSB rounding each), or
 * known-class mass above256, fails closed with all-zero mapped scores. */
quipus_dscnn_status_t quipus_dscnn_map4(const int8_t scores[12], uint8_t mapped[4]);
#ifdef __cplusplus
}
#endif
#endif
