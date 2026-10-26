#include "quipus_setup_password.h"

#include <string.h>

// Same alphabet as dashboard pairing codes, so users type one familiar set.
static const char ALPHABET[] = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

void quipus_setup_password_from_entropy(
    const uint8_t entropy[QUIPUS_SETUP_PASSWORD_ENTROPY_BYTES],
    char out[QUIPUS_SETUP_PASSWORD_BUFFER]) {
  for (int index = 0; index < QUIPUS_SETUP_PASSWORD_LENGTH; ++index)
    out[index] = ALPHABET[entropy[index] & 0x1f];
  out[QUIPUS_SETUP_PASSWORD_LENGTH] = '\0';
}

bool quipus_setup_password_valid(const char *password) {
  if (!password || strlen(password) != QUIPUS_SETUP_PASSWORD_LENGTH)
    return false;
  for (int index = 0; index < QUIPUS_SETUP_PASSWORD_LENGTH; ++index)
    if (!strchr(ALPHABET, password[index]))
      return false;
  return true;
}
