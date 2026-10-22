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
