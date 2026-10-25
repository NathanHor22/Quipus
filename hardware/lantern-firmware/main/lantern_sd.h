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

typedef enum {
  LANTERN_SD_UNCHANGED = 0,
  LANTERN_SD_INSERTED,
  LANTERN_SD_REMOVED,
} lantern_sd_change_t;

// Detects a card being removed or inserted (the slot has no detect pin). Call
// from an idle context only; it does nothing while a recording or phone
// archive is open. A new card is mounted with the same checks as at boot and
// is never formatted. Repeated failed probes are not logged.
lantern_sd_change_t lantern_sd_poll(void);
void lantern_sd_get_status(lantern_sd_status_t *status);

// Streams canonical 16 kHz mono, signed 16-bit PCM into a temporary file. The
// finished file is made visible only after its WAV header and data are synced.
esp_err_t lantern_sd_recording_begin(const char *session_id);
void lantern_sd_recording_write(const int16_t *samples, size_t count);
esp_err_t lantern_sd_recording_finish(void);
void lantern_sd_recording_abort(void);

// True while either writer still owns an unsealed local archive.
bool lantern_sd_capture_active(void);
// First capture/queue/finalization error, latched until a fresh recording or
// recovery is selected. Poll during recording to stop and report SD faults.
esp_err_t lantern_sd_recording_error(void);
// True only after both writers, finalization and the PCM queue are idle. Unlike
// has_private_material(), finalized recordings awaiting upload do not block.
// The caller must serialize session controls and stop the phone transport first.
bool lantern_sd_can_power_down(void);
bool lantern_sd_recording_ready(void);
const char *lantern_sd_recording_path(void);
size_t lantern_sd_recording_size(void);
bool lantern_sd_recording_matches_session(const char *session_id);

// Commits full backend verification, leaves the upload queue and retains the
// encrypted local copy for 24 h. A trusted Unix timestamp of 0 means unknown;
// such copies are preserved until a trusted idle pass starts a full 24 h.
// Retrying never changes an existing first-verification time/deadline.
esp_err_t lantern_sd_recording_confirm_uploaded_at(int64_t trusted_verified_at);
esp_err_t lantern_sd_recording_confirm_uploaded(void);

// Bounded retention maintenance. Call while idle under the session/control lock,
// with capture, phone transport, upload and local replay stopped. At most eight
// directory entries are examined per call (scan_limit is clamped). Invalid or
// untrusted time preserves all data; no-SD boards return NOT_SUPPORTED.
// Verified retained/recovery material continues blocking account/key reset.
esp_err_t lantern_sd_retention_cleanup(int64_t now_seconds, bool time_trusted,
                                      size_t scan_limit, size_t *removed);

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
// Conservative retained-private-material count for identity/reset protection.
size_t lantern_sd_pending_count(void);
// Upload-selection candidates: excludes verified .qpc cache and authenticated
// verified .qpm proof left by a torn rename; never touches NVS. Unreadable
// metadata stays pending. Excludes quarantined/orphan evidence; 0 if unavailable.
// Advisory count is cached for at most 60 s with immediate mutation invalidation;
// conservative identity/reset checks remain uncached.
// Never use this narrower count to decide whether identity/keys may be erased.
size_t lantern_sd_upload_pending_count(void);
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
