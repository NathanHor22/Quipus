#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "lantern_network.h"
#include "quipus_archive.h"

typedef struct {
  bool present;
  bool mounted;
  uint64_t capacity_bytes;
  uint64_t free_bytes;
  uint32_t sector_size;
  char name[8];
} lantern_sd_status_t;

// Mounts a FAT16/FAT32 card without formatting it. Calling this again is safe;
// recording_begin also retries the mount so a card inserted after boot is used.
esp_err_t lantern_sd_init(lantern_sd_status_t *status);
void lantern_sd_get_status(lantern_sd_status_t *status);

// Streams canonical 16 kHz mono, signed 16-bit PCM into a temporary file. The
// finished file is made visible only after its WAV header and data are synced.
esp_err_t lantern_sd_recording_begin(const char *session_id);
void lantern_sd_recording_write(const int16_t *samples, size_t count);
esp_err_t lantern_sd_recording_finish(void);
void lantern_sd_recording_abort(void);

// True while either writer still owns an unsealed local archive.
bool lantern_sd_capture_active(void);
bool lantern_sd_recording_ready(void);
const char *lantern_sd_recording_path(void);
size_t lantern_sd_recording_size(void);
bool lantern_sd_recording_matches_session(const char *session_id);

// Removes the finalized local file only after the backend verified the complete
// recording checksum.
esp_err_t lantern_sd_recording_confirm_uploaded(void);

// Identity is bound to the paired cloud owner and a server-backed device key.
esp_err_t lantern_sd_configure_identity(const char *owner_id,
                                        const char *device_id,
                                        const uint8_t key[32]);
bool lantern_sd_secure_ready(void);
void lantern_sd_set_session(const lantern_cloud_session_t *session);
esp_err_t lantern_sd_checkpoint(const lantern_cloud_session_t *session,
                                bool cloud_stopped, bool audio_uploaded,
                                bool phone_uploaded);
// Selects one oldest pending manifest for the current owner. Never reassigns
// files.
esp_err_t lantern_sd_next_pending(const char *owner_id, const char *device_id,
                                  lantern_cloud_session_t *session,
                                  bool *cloud_stopped, bool *audio_uploaded,
                                  bool *phone_uploaded);
size_t lantern_sd_pending_count(void);
const char *lantern_sd_captured_at(void);
bool lantern_sd_time_uncertain(void);
esp_err_t lantern_sd_set_phone_timing(const char *json);
const char *lantern_sd_phone_timing(void);

// Called only by the USB transport writer task, never the USB interrupt
// handler.
esp_err_t lantern_sd_phone_begin(const char *session_id);
esp_err_t lantern_sd_phone_write(const int16_t *samples, size_t count);
esp_err_t lantern_sd_phone_finish(void);
size_t lantern_sd_phone_size(void);

typedef quipus_archive_reader_t lantern_sd_reader_t;
lantern_sd_reader_t *lantern_sd_reader_open(bool phone);
size_t lantern_sd_reader_read(lantern_sd_reader_t *reader, void *out,
                              size_t length);
int lantern_sd_reader_seek(lantern_sd_reader_t *reader, size_t offset);
void lantern_sd_reader_close(lantern_sd_reader_t *reader);
size_t lantern_sd_phone_read(size_t offset, void *out, size_t length);

bool lantern_sd_has_private_material(void);
void lantern_sd_clear_identity(void);
