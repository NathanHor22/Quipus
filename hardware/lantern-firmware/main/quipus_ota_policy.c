#include "quipus_ota_policy.h"

#include <string.h>

// strnlen is POSIX, not C11; host tests build with -std=c11.
static size_t bounded_length(const char *text, size_t limit) {
  size_t length = 0;
  while (length < limit && text[length]) length++;
  return length;
}

static bool parse_number(const char **cursor, unsigned *value) {
  const char *p = *cursor;
  if (*p < '0' || *p > '9') return false;
  unsigned result = 0;
  int digits = 0;
  while (*p >= '0' && *p <= '9') {
    if (++digits > 5) return false;
    result = result * 10u + (unsigned)(*p - '0');
    p++;
  }
  *cursor = p;
  *value = result;
  return true;
}

bool quipus_version_parse(const char *text, quipus_version_t *version) {
  if (!text || !version) return false;
  size_t length = bounded_length(text, QUIPUS_OTA_VERSION_CAPACITY);
  if (!length || length >= QUIPUS_OTA_VERSION_CAPACITY) return false;
  const char *p = text;
  quipus_version_t parsed;
  if (!parse_number(&p, &parsed.major) || *p++ != '.') return false;
  if (!parse_number(&p, &parsed.minor) || *p++ != '.') return false;
  if (!parse_number(&p, &parsed.patch)) return false;
  if (*p == '-') {
    for (p++; *p; p++) {
      bool allowed = (*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9') || *p == '-';
      if (!allowed) return false;
    }
  } else if (*p) {
    return false;
  }
  *version = parsed;
  return true;
}

int quipus_version_compare(const quipus_version_t *a, const quipus_version_t *b) {
  if (a->major != b->major) return a->major < b->major ? -1 : 1;
  if (a->minor != b->minor) return a->minor < b->minor ? -1 : 1;
  if (a->patch != b->patch) return a->patch < b->patch ? -1 : 1;
  return 0;
}

static bool lower_hex(const char *text, size_t length) {
  if (bounded_length(text, length + 1) != length) return false;
  for (size_t i = 0; i < length; i++) {
    char c = text[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  return true;
}

static bool url_safe(const char *url) {
  for (const char *p = url; *p; p++) {
    unsigned char c = (unsigned char)*p;
    if (c <= 0x20 || c >= 0x7f || c == '\\' || c == '"' || c == '#') return false;
  }
  // No path traversal out of the firmware prefix.
  return !strstr(url, "/../") && !strstr(url, "/./") && !strstr(url, "%2e") && !strstr(url, "%2E");
}

quipus_ota_offer_result_t quipus_ota_validate_offer(
    const quipus_ota_offer_t *offer, const char *running_version,
    uint32_t slot_bytes, const char *trusted_prefix) {
  if (!offer || !running_version || !trusted_prefix) return QUIPUS_OTA_OFFER_INVALID;
  quipus_version_t offered, running;
  if (!quipus_version_parse(offer->version, &offered) ||
      !lower_hex(offer->sha256, QUIPUS_OTA_SHA256_HEX) || offer->size == 0)
    return QUIPUS_OTA_OFFER_INVALID;
  if (!quipus_version_parse(running_version, &running) ||
      quipus_version_compare(&offered, &running) <= 0)
    return QUIPUS_OTA_OFFER_NOT_NEWER;
  if (offer->size > slot_bytes) return QUIPUS_OTA_OFFER_TOO_LARGE;
  size_t prefix = strlen(trusted_prefix);
  size_t url = bounded_length(offer->url, QUIPUS_OTA_URL_CAPACITY);
  if (prefix < 9 || strncmp(trusted_prefix, "https://", 8) || trusted_prefix[prefix - 1] != '/' ||
      url >= QUIPUS_OTA_URL_CAPACITY || url <= prefix ||
      strncmp(offer->url, trusted_prefix, prefix) || !url_safe(offer->url))
    return QUIPUS_OTA_OFFER_UNTRUSTED_URL;
  return QUIPUS_OTA_OFFER_OK;
}

bool quipus_ota_window_open(const quipus_ota_window_t *window) {
  if (!window || !window->ready || window->recording || window->uploads_pending ||
      window->sync_busy || !window->phone_audio_idle || window->shutting_down)
    return false;
  if (window->user_idle_ms < QUIPUS_OTA_IDLE_MS) return false;
  // A board without a battery runs from USB; otherwise require charge or reserve.
  return window->external_power || window->battery_level < 0 ||
         window->battery_level >= QUIPUS_OTA_MIN_BATTERY;
}

void quipus_ota_hex(const uint8_t digest[32], char output[QUIPUS_OTA_SHA256_HEX + 1]) {
  static const char digits[] = "0123456789abcdef";
  for (int i = 0; i < 32; i++) {
    output[i * 2] = digits[digest[i] >> 4];
    output[i * 2 + 1] = digits[digest[i] & 15];
  }
  output[QUIPUS_OTA_SHA256_HEX] = '\0';
}
