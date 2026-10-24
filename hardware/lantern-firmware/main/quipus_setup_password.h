#pragma once

#include <stdbool.h>
#include <stdint.h>

// Per-device WPA2 password for the setup access point. Ten characters from a
// 32-symbol alphabet without look-alikes (0/O, 1/I) give 50 bits of entropy.
#define QUIPUS_SETUP_PASSWORD_LENGTH 10
#define QUIPUS_SETUP_PASSWORD_BUFFER (QUIPUS_SETUP_PASSWORD_LENGTH + 1)
#define QUIPUS_SETUP_PASSWORD_ENTROPY_BYTES QUIPUS_SETUP_PASSWORD_LENGTH

// Maps one uniformly random byte to each character (low 5 bits: no modulo bias).
void quipus_setup_password_from_entropy(
    const uint8_t entropy[QUIPUS_SETUP_PASSWORD_ENTROPY_BYTES],
    char out[QUIPUS_SETUP_PASSWORD_BUFFER]);

bool quipus_setup_password_valid(const char *password);
