#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define QUIPUS_OTA_VERSION_CAPACITY 40
#define QUIPUS_OTA_URL_CAPACITY 768
#define QUIPUS_OTA_SHA256_HEX 64
#define QUIPUS_OTA_ERROR_CAPACITY 96

typedef struct {
  unsigned major;
  unsigned minor;
  unsigned patch;
} quipus_version_t;

typedef struct {
  char version[QUIPUS_OTA_VERSION_CAPACITY];
  char url[QUIPUS_OTA_URL_CAPACITY];
  char sha256[QUIPUS_OTA_SHA256_HEX + 1];
  uint32_t size;
} quipus_ota_offer_t;

typedef enum {
  QUIPUS_OTA_OFFER_OK = 0,
  QUIPUS_OTA_OFFER_INVALID,
  QUIPUS_OTA_OFFER_NOT_NEWER,
  QUIPUS_OTA_OFFER_TOO_LARGE,
  QUIPUS_OTA_OFFER_UNTRUSTED_URL,
} quipus_ota_offer_result_t;

typedef struct {
  bool ready;             // idle main screen, boot complete
  bool recording;         // microphone capture or an open session
  bool uploads_pending;   // retained recordings not yet delivered
  bool sync_busy;         // a delivery retry is running
  bool phone_audio_idle;  // no USB phone stream
  bool shutting_down;
  bool external_power;    // charging or USB-only board
  int battery_level;      // -1 when unknown (no battery fitted)
  uint32_t user_idle_ms;  // since the last button/voice interaction
} quipus_ota_window_t;

#define QUIPUS_OTA_IDLE_MS 120000u
#define QUIPUS_OTA_MIN_BATTERY 40

/** Parses "MAJOR.MINOR.PATCH" with an optional "-suffix". */
bool quipus_version_parse(const char *text, quipus_version_t *version);
int quipus_version_compare(const quipus_version_t *a, const quipus_version_t *b);

/**
 * Checks a server offer before any download: well-formed fields, strictly
 * newer than the running version, fits the update slot, and served over HTTPS
 * from the configured storage host and firmware path only.
 */
quipus_ota_offer_result_t quipus_ota_validate_offer(
    const quipus_ota_offer_t *offer, const char *running_version,
    uint32_t slot_bytes, const char *trusted_prefix);

/** An update may start only when nothing the owner is doing can be interrupted. */
bool quipus_ota_window_open(const quipus_ota_window_t *window);

/** Lower-case hex encoding of a 32-byte digest into a 65-byte buffer. */
void quipus_ota_hex(const uint8_t digest[32], char output[QUIPUS_OTA_SHA256_HEX + 1]);
