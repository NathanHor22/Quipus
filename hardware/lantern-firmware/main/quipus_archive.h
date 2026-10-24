#pragma once
#include "esp_err.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define QUIPUS_ARCHIVE_BLOCK 4096
#define QUIPUS_ARCHIVE_HEADER 144

typedef struct quipus_archive_writer quipus_archive_writer_t;
typedef struct quipus_archive_reader quipus_archive_reader_t;

// AES-256-GCM authenticates each independent 4 KiB PCM block, session/owner
// header and block index. The key is never stored on the removable card.
esp_err_t quipus_archive_create(const char *path, const uint8_t key[32],
                                const char *session_id, const char *owner_id,
                                const char *device_id, unsigned source,
                                quipus_archive_writer_t **writer);
esp_err_t quipus_archive_append(quipus_archive_writer_t *writer,
                                const void *pcm, size_t bytes);
esp_err_t quipus_archive_finish(quipus_archive_writer_t *writer,
                                size_t *pcm_bytes);
void quipus_archive_abort(quipus_archive_writer_t *writer);

// A logical read-only canonical WAV is synthesized from the authenticated PCM.
// Earlier plaintext WAVs remain untouched for an explicit recovery/migration.
esp_err_t quipus_archive_open(const char *path, const uint8_t key[32],
                              const char *session_id, const char *owner_id,
                              const char *device_id, unsigned source,
                              quipus_archive_reader_t **reader);
size_t quipus_archive_size(const quipus_archive_reader_t *reader);
size_t quipus_archive_read(quipus_archive_reader_t *reader, void *out,
                           size_t bytes);
int quipus_archive_seek(quipus_archive_reader_t *reader, size_t position);
void quipus_archive_close(quipus_archive_reader_t *reader);

// Append-only encrypted journal records survive an interrupted metadata write.
esp_err_t quipus_archive_journal_append(const char *path, const uint8_t key[32],
                                        const char *json);
esp_err_t quipus_archive_journal_read(const char *path, const uint8_t key[32],
                                      char *json, size_t capacity);

// Dedicated report source (2), mono signed-16 PCM at 24 kHz. Recording APIs
// above remain strictly source 0/1 at 16 kHz; no resampling or format guessing.
esp_err_t quipus_archive_create_report(const char *path, const uint8_t key[32],
                                       const char *report_id, const char *owner_id,
                                       const char *device_id,
                                       quipus_archive_writer_t **writer);
esp_err_t quipus_archive_open_report(const char *path, const uint8_t key[32],
                                     const char *report_id, const char *owner_id,
                                     const char *device_id,
                                     quipus_archive_reader_t **reader);
