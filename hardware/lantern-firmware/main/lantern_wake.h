#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

// The prototype uses Espressif's bundled "Computer" WakeNet9 model. A future
// trained Quipus model can replace these two values without changing the
// command or consent state machine.
#define LANTERN_WAKE_MODEL_MATCH "computer"
#define LANTERN_WAKE_PHRASE "COMPUTER"

esp_err_t lantern_wake_init(void);
void lantern_wake_set_enabled(bool enabled);
bool lantern_wake_is_available(void);
bool lantern_wake_is_enabled(void);
bool lantern_wake_take_detection(void);
void lantern_wake_feed(const int16_t *samples, size_t count);

// Counters only: no microphone audio or transcript is retained in diagnostics.
typedef struct {
  uint32_t frames;
  uint32_t activations;
  uint32_t consumed;
  bool listening;
} lantern_wake_diagnostics_t;
void lantern_wake_get_diagnostics(lantern_wake_diagnostics_t *diagnostics);
