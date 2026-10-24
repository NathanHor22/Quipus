#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

// One bounded report-only echo-cancelled listener. It never authorizes actions.
esp_err_t quipus_barge_in_init(void);
void quipus_barge_in_enable(bool enabled);
void quipus_barge_in_reset(void);
void quipus_barge_in_reference(const int16_t *samples, size_t count);
void quipus_barge_in_feed(const int16_t *samples, size_t count);
bool quipus_barge_in_take_event(void);
bool quipus_barge_in_capture_pending(void);
bool quipus_barge_in_capture_ready(void);
size_t quipus_barge_in_take_audio(int16_t *destination, size_t capacity);
