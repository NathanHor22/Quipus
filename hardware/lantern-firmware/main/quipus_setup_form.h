#pragma once

#include <stdbool.h>
#include <stddef.h>

typedef struct {
  char ssid[33];
  char password[65];
  char pairing_code[21];
} quipus_setup_form_t;

// Rejects incomplete encodings, embedded NULs, duplicate known fields and
// overlong values. An invalid form is never partially saved.
bool quipus_setup_parse_form(const char *body, size_t length,
                            quipus_setup_form_t *form);
bool quipus_setup_normalize_pairing_code(char code[21]);
