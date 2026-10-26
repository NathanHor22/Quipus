#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "quipus_setup_password.h"

#define LANTERN_MAX_WIFI_PROFILES 5

typedef struct {
  char ssid[33];
  char password[65];
} lantern_wifi_profile_t;

typedef struct {
  char wifi_ssid[33];
  char wifi_password[65];
  char pairing_code[21];
  char device_id[37];
  char owner_id[37];
  char device_secret[81];
  lantern_wifi_profile_t wifi_profiles[LANTERN_MAX_WIFI_PROFILES];
  size_t wifi_profile_count;
} lantern_config_t;

esp_err_t lantern_storage_init(void);
esp_err_t lantern_storage_load(lantern_config_t *config);
esp_err_t lantern_storage_save_wifi(const char *ssid, const char *password,
                                    const char *pairing_code);
esp_err_t lantern_storage_save_pending_secret(const char *device_secret);
esp_err_t lantern_storage_save_device(const char *device_id,
                                      const char *device_secret);
esp_err_t lantern_storage_clear_pairing_code(lantern_config_t *config);
esp_err_t lantern_storage_clear_device(lantern_config_t *config);
esp_err_t lantern_storage_clear(void);
bool lantern_storage_has_wifi(const lantern_config_t *config);
bool lantern_storage_is_paired(const lantern_config_t *config);

// Archive keys live in a separate namespace and survive Wi-Fi/pairing reset.
esp_err_t lantern_storage_save_archive_identity(const char *owner_id,
                                                const char *device_id,
                                                const uint8_t key[32]);
esp_err_t lantern_storage_load_archive_identity(char owner_id[37],
                                                char device_id[37],
                                                uint8_t key[32]);
esp_err_t lantern_storage_save_owner(const char *owner_id);

esp_err_t lantern_storage_clear_archive_identity(void);

// Loads this device's permanent setup-network password, creating it from
// `entropy` on first use. On failure `out` is empty and nothing is stored.
esp_err_t lantern_storage_ensure_setup_password(
    const uint8_t entropy[QUIPUS_SETUP_PASSWORD_ENTROPY_BYTES],
    char out[QUIPUS_SETUP_PASSWORD_BUFFER]);
