#pragma once

#include "esp_err.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
  bool enabled;
  bool connected;
  bool recording;
  bool stored;
  uint64_t device_started_us;
  uint64_t first_packet_device_us;
  uint64_t last_packet_device_us;
  uint64_t first_packet_phone_us;
  uint64_t last_packet_phone_us;
  uint32_t received_samples;
  uint32_t missing_samples;
  uint32_t dropped_packets;
  uint32_t disconnects;
  esp_err_t error;
} quipus_phone_audio_status_t;

esp_err_t quipus_phone_audio_init(void);
// Call only after meeting consent and the primary archive have started.
esp_err_t quipus_phone_audio_begin(const char *session_id);
// Stops accepting audio, drains bounded buffers, and finalizes the phone archive.
esp_err_t quipus_phone_audio_stop(void);
/** True only when no session or SD drain owns the secondary source. */
bool quipus_phone_audio_idle(void);
void quipus_phone_audio_get_status(quipus_phone_audio_status_t *status);
void quipus_phone_audio_timing_json(char *out, size_t capacity);
