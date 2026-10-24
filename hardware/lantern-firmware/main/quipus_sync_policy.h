#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef struct {
  bool pending;
  bool busy;
  bool ready;
  bool shutdown;
  uint32_t user_idle_ticks;
  uint32_t retry_idle_ticks;
  uint32_t retry_delay_ticks;
} quipus_sync_input_t;

// Network redraws are not user input. Both intervals use elapsed RTOS ticks,
// with subtraction performed by the caller before any unit conversion.
static inline bool quipus_sync_due(const quipus_sync_input_t *input,
                                   uint32_t minimum_idle_ticks) {
  return input && input->pending && !input->busy && input->ready &&
         !input->shutdown && input->user_idle_ticks >= minimum_idle_ticks &&
         input->retry_idle_ticks >= (input->retry_delay_ticks
             ? input->retry_delay_ticks : minimum_idle_ticks);
}

typedef enum {
  QUIPUS_SYNC_FAILED,
  QUIPUS_SYNC_VERIFICATION_PENDING,
  QUIPUS_SYNC_NEXT_ARCHIVE,
} quipus_sync_outcome_t;

// Delays start after the attempt finishes; user quiet time is independent.
static inline uint32_t quipus_sync_retry_delay_ms(quipus_sync_outcome_t outcome) {
  switch (outcome) {
  case QUIPUS_SYNC_VERIFICATION_PENDING: return 5000;
  case QUIPUS_SYNC_NEXT_ARCHIVE: return 2000;
  default: return 30000;
  }
}
