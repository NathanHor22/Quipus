#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

/* NVS stores namespace names as plain, NUL-terminated entry keys. A settings
 * partition that mentions any Quipus namespace may hold pairing or the only
 * local SD archive key, so it is never wiped automatically. Stale (deleted)
 * entries also match, which errs towards keeping data. */
static inline bool quipus_nvs_has_quipus_data(const uint8_t *data, size_t length) {
  static const char *const names[] = {"roxanne", "quipus_keys", "quipus_ota"};
  if (!data) return true;
  for (size_t n = 0; n < sizeof(names) / sizeof(names[0]); ++n) {
    size_t needle = strlen(names[n]) + 1; /* include the terminator */
    if (length < needle) continue;
    for (size_t i = 0; i + needle <= length; ++i)
      if (!memcmp(data + i, names[n], needle)) return true;
  }
  return false;
}
