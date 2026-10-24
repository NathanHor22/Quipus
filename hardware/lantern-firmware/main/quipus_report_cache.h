#pragma once
#include "esp_err.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define QUIPUS_REPORT_CACHE_MAX_PCM (8u * 1024u * 1024u)
#define QUIPUS_REPORT_CACHE_RATE 24000u

typedef struct quipus_report_cache_reader quipus_report_cache_reader_t;

// Serialized by the existing app/network lane: never use while recording or
// uploading. Cache failure is optional and must not fail an online report.
// Only SD passes identity/key; no key or private path is exposed to playback.
esp_err_t quipus_report_cache_configure(const char *directory,
                                        const uint8_t key[32],
                                        const char *owner_id,
                                        const char *device_id);
esp_err_t quipus_report_cache_begin(const char *report_id,
                                    const char *voice_profile);
// Arbitrary HTTP chunk boundaries are accepted, including odd chunk lengths.
// commit rejects an empty or odd total, or any failed/incomplete download.
esp_err_t quipus_report_cache_append(const void *pcm, size_t bytes);
esp_err_t quipus_report_cache_commit(void);
void quipus_report_cache_abort(void);
bool quipus_report_cache_busy(void);

// Newest fully authenticated matching report, with previous-slot fallback.
// A complete archive scan happens before any PCM can be returned to a speaker.
bool quipus_report_cache_available(const char *voice_profile);
esp_err_t quipus_report_cache_open(const char *voice_profile,
                                   quipus_report_cache_reader_t **reader);
size_t quipus_report_cache_size(const quipus_report_cache_reader_t *reader);
// Raw mono signed-16 little-endian 24 kHz PCM; no WAV header or resampling.
// Zero means EOF/error; callers compare delivered bytes with size().
size_t quipus_report_cache_read(quipus_report_cache_reader_t *reader,
                                void *pcm, size_t bytes);
void quipus_report_cache_close(quipus_report_cache_reader_t *reader);

// Card removal/reboot: abort temporary writes and wipe RAM identity/key while
// preserving committed slots. Account reset: also remove only cache-slot files.
void quipus_report_cache_detach(void);
void quipus_report_cache_clear_identity(void);
