#include "lantern_storage.h"

#include <string.h>

#include "esp_check.h"
#include "nvs.h"
#include "nvs_flash.h"

/* Kept stable so devices already provisioned under the prototype name retain
 * their Wi-Fi and pairing credentials after the Lantern rebrand. */
#define STORAGE_NAMESPACE "roxanne"

static esp_err_t read_string(nvs_handle_t handle, const char *key,
                             char *destination, size_t size) {
  size_t required = size;
  esp_err_t result = nvs_get_str(handle, key, destination, &required);
  if (result == ESP_ERR_NVS_NOT_FOUND) {
    destination[0] = '\0';
    return ESP_OK;
  }
  return result;
}

esp_err_t lantern_storage_init(void) {
  esp_err_t result = nvs_flash_init();
  // Never erase NVS automatically: it may hold the only local archive key.
  // A damaged/full partition is a recoverable service condition, not permission
  // to destroy pending private recordings. Server recovery is separately bound.

  return result;
}

esp_err_t lantern_storage_load(lantern_config_t *config) {
  if (!config)
    return ESP_ERR_INVALID_ARG;
  memset(config, 0, sizeof(*config));
  nvs_handle_t handle;
  esp_err_t result = nvs_open(STORAGE_NAMESPACE, NVS_READONLY, &handle);
  if (result == ESP_ERR_NVS_NOT_FOUND)
    return ESP_OK;
  if (result != ESP_OK)
    return result;
  if ((result = read_string(handle, "wifi_ssid", config->wifi_ssid,
                            sizeof(config->wifi_ssid))) == ESP_OK &&
      (result = read_string(handle, "wifi_pass", config->wifi_password,
                            sizeof(config->wifi_password))) == ESP_OK &&
      (result = read_string(handle, "pair_code", config->pairing_code,
                            sizeof(config->pairing_code))) == ESP_OK &&
      (result = read_string(handle, "device_id", config->device_id,
                            sizeof(config->device_id))) == ESP_OK) {
    result = read_string(handle, "dev_secret", config->device_secret,
                         sizeof(config->device_secret));
  }
  if (result == ESP_OK)
    result = read_string(handle, "owner_id", config->owner_id,
                         sizeof(config->owner_id));
  uint8_t count = 0;
  if (result == ESP_OK) {
    esp_err_t count_result = nvs_get_u8(handle, "wifi_count", &count);
    if (count_result != ESP_OK && count_result != ESP_ERR_NVS_NOT_FOUND)
      result = count_result;
  }
  if (count > LANTERN_MAX_WIFI_PROFILES)
    count = LANTERN_MAX_WIFI_PROFILES;
  for (uint8_t index = 0; result == ESP_OK && index < count; ++index) {
    char ssid_key[12], pass_key[12];
    snprintf(ssid_key, sizeof(ssid_key), "w%us", index);
    snprintf(pass_key, sizeof(pass_key), "w%up", index);
    result = read_string(handle, ssid_key, config->wifi_profiles[index].ssid,
                         sizeof(config->wifi_profiles[index].ssid));
    if (result == ESP_OK)
      result =
          read_string(handle, pass_key, config->wifi_profiles[index].password,
                      sizeof(config->wifi_profiles[index].password));
    if (result == ESP_OK && config->wifi_profiles[index].ssid[0])
      ++config->wifi_profile_count;
  }
  nvs_close(handle);
  // Import the legacy active network once. Existing devices keep working and
  // gain multi-network roaming without a factory reset.
  if (result == ESP_OK && config->wifi_profile_count == 0 &&
      config->wifi_ssid[0]) {
    snprintf(config->wifi_profiles[0].ssid,
             sizeof(config->wifi_profiles[0].ssid), "%s", config->wifi_ssid);
    snprintf(config->wifi_profiles[0].password,
             sizeof(config->wifi_profiles[0].password), "%s",
             config->wifi_password);
    config->wifi_profile_count = 1;
  }
  return result;
}

esp_err_t lantern_storage_save_wifi(const char *ssid, const char *password,
                                    const char *pairing_code) {
  if (!ssid || !ssid[0] || strlen(ssid) > 32 || !password ||
      strlen(password) > 64)
    return ESP_ERR_INVALID_ARG;
  nvs_handle_t handle;
  ESP_RETURN_ON_ERROR(nvs_open(STORAGE_NAMESPACE, NVS_READWRITE, &handle),
                      "storage", "open");
  esp_err_t result = nvs_set_str(handle, "wifi_ssid", ssid);
  if (result == ESP_OK)
    result = nvs_set_str(handle, "wifi_pass", password);
  if (result == ESP_OK)
    result = nvs_set_str(handle, "pair_code", pairing_code ? pairing_code : "");
  lantern_config_t current;
  memset(&current, 0, sizeof(current));
  size_t selected = LANTERN_MAX_WIFI_PROFILES;
  uint8_t old_count = 0;
  if (result == ESP_OK) {
    esp_err_t count_result = nvs_get_u8(handle, "wifi_count", &old_count);
    if (count_result != ESP_OK && count_result != ESP_ERR_NVS_NOT_FOUND)
      result = count_result;
    if (old_count > LANTERN_MAX_WIFI_PROFILES)
      old_count = LANTERN_MAX_WIFI_PROFILES;
  }
  for (uint8_t index = 0; result == ESP_OK && index < old_count; ++index) {
    char ssid_key[12], pass_key[12];
    snprintf(ssid_key, sizeof(ssid_key), "w%us", index);
    snprintf(pass_key, sizeof(pass_key), "w%up", index);
    result = read_string(handle, ssid_key, current.wifi_profiles[index].ssid,
                         sizeof(current.wifi_profiles[index].ssid));
    if (result == ESP_OK)
      result =
          read_string(handle, pass_key, current.wifi_profiles[index].password,
                      sizeof(current.wifi_profiles[index].password));
    if (strcmp(current.wifi_profiles[index].ssid, ssid) == 0)
      selected = index;
  }
  lantern_wifi_profile_t ordered[LANTERN_MAX_WIFI_PROFILES] = {0};
  snprintf(ordered[0].ssid, sizeof(ordered[0].ssid), "%s", ssid);
  snprintf(ordered[0].password, sizeof(ordered[0].password), "%s", password);
  size_t write_index = 1;
  for (uint8_t index = 0; result == ESP_OK && index < old_count &&
                          write_index < LANTERN_MAX_WIFI_PROFILES;
       ++index) {
    if (index == selected || !current.wifi_profiles[index].ssid[0])
      continue;
    ordered[write_index++] = current.wifi_profiles[index];
  }
  if (result == ESP_OK)
    result = nvs_set_u8(handle, "wifi_count", (uint8_t)write_index);
  for (size_t index = 0; result == ESP_OK && index < write_index; ++index) {
    char ssid_key[12], pass_key[12];
    snprintf(ssid_key, sizeof(ssid_key), "w%us", (unsigned)index);
    snprintf(pass_key, sizeof(pass_key), "w%up", (unsigned)index);
    result = nvs_set_str(handle, ssid_key, ordered[index].ssid);
    if (result == ESP_OK)
      result = nvs_set_str(handle, pass_key, ordered[index].password);
  }
  if (result == ESP_OK)
    result = nvs_commit(handle);
  nvs_close(handle);
  return result;
}

esp_err_t lantern_storage_save_pending_secret(const char *device_secret) {
  if (!device_secret || strlen(device_secret) < 40 ||
      strlen(device_secret) > 80) {
    return ESP_ERR_INVALID_ARG;
  }
  nvs_handle_t handle;
  ESP_RETURN_ON_ERROR(nvs_open(STORAGE_NAMESPACE, NVS_READWRITE, &handle),
                      "storage", "open");
  esp_err_t result = nvs_set_str(handle, "dev_secret", device_secret);
  if (result == ESP_OK)
    result = nvs_commit(handle);
  nvs_close(handle);
  return result;
}

esp_err_t lantern_storage_save_device(const char *device_id,
                                      const char *device_secret) {
  if (!device_id || !device_secret)
    return ESP_ERR_INVALID_ARG;
  nvs_handle_t handle;
  ESP_RETURN_ON_ERROR(nvs_open(STORAGE_NAMESPACE, NVS_READWRITE, &handle),
                      "storage", "open");
  esp_err_t result = nvs_set_str(handle, "device_id", device_id);
  if (result == ESP_OK)
    result = nvs_set_str(handle, "dev_secret", device_secret);
  if (result == ESP_OK)
    result = nvs_erase_key(handle, "pair_code");
  if (result == ESP_ERR_NVS_NOT_FOUND)
    result = ESP_OK;
  if (result == ESP_OK)
    result = nvs_commit(handle);
  nvs_close(handle);
  return result;
}

esp_err_t lantern_storage_clear_pairing_code(lantern_config_t *config) {
  if (!config)
    return ESP_ERR_INVALID_ARG;
  nvs_handle_t handle;
  ESP_RETURN_ON_ERROR(nvs_open(STORAGE_NAMESPACE, NVS_READWRITE, &handle),
                      "storage", "open");
  esp_err_t result = nvs_erase_key(handle, "pair_code");
  if (result == ESP_ERR_NVS_NOT_FOUND)
    result = ESP_OK;
  if (result == ESP_OK)
    result = nvs_commit(handle);
  nvs_close(handle);
  if (result == ESP_OK)
    config->pairing_code[0] = '\0';
  return result;
}

esp_err_t lantern_storage_clear_device(lantern_config_t *config) {
  if (!config)
    return ESP_ERR_INVALID_ARG;
  nvs_handle_t handle;
  ESP_RETURN_ON_ERROR(nvs_open(STORAGE_NAMESPACE, NVS_READWRITE, &handle),
                      "storage", "open");
  esp_err_t result = nvs_erase_key(handle, "device_id");
  if (result == ESP_ERR_NVS_NOT_FOUND)
    result = ESP_OK;
  if (result == ESP_OK) {
    result = nvs_erase_key(handle, "dev_secret");
    if (result == ESP_ERR_NVS_NOT_FOUND)
      result = ESP_OK;
  }
  if (result == ESP_OK) {
    result = nvs_erase_key(handle, "pair_code");
    if (result == ESP_ERR_NVS_NOT_FOUND)
      result = ESP_OK;
  }
  if (result == ESP_OK)
    result = nvs_commit(handle);
  nvs_close(handle);
  if (result == ESP_OK) {
    config->device_id[0] = '\0';
    config->device_secret[0] = '\0';
    config->pairing_code[0] = '\0';
  }
  return result;
}

esp_err_t lantern_storage_clear(void) {
  nvs_handle_t handle;
  ESP_RETURN_ON_ERROR(nvs_open(STORAGE_NAMESPACE, NVS_READWRITE, &handle),
                      "storage", "open");
  esp_err_t result = nvs_erase_all(handle);
  if (result == ESP_OK)
    result = nvs_commit(handle);
  nvs_close(handle);
  return result;
}

bool lantern_storage_has_wifi(const lantern_config_t *config) {
  return config && config->wifi_ssid[0];
}

bool lantern_storage_is_paired(const lantern_config_t *config) {
  return config && config->device_id[0] && config->device_secret[0];
}

esp_err_t lantern_storage_save_owner(const char *owner_id) {
  if (!owner_id || strlen(owner_id) != 36)
    return ESP_ERR_INVALID_ARG;
  nvs_handle_t h;
  esp_err_t result = nvs_open(STORAGE_NAMESPACE, NVS_READWRITE, &h);
  if (result != ESP_OK)
    return result;
  result = nvs_set_str(h, "owner_id", owner_id);
  if (result == ESP_OK)
    result = nvs_commit(h);
  nvs_close(h);
  return result;
}
esp_err_t lantern_storage_save_archive_identity(const char *owner,
                                                const char *device,
                                                const uint8_t key[32]) {
  if (!owner || strlen(owner) != 36 || !device || strlen(device) != 36 || !key)
    return ESP_ERR_INVALID_ARG;
  nvs_handle_t h;
  esp_err_t result = nvs_open("quipus_keys", NVS_READWRITE, &h);
  if (result != ESP_OK)
    return result;
  result = nvs_set_str(h, "owner", owner);
  if (result == ESP_OK)
    result = nvs_set_str(h, "device", device);
  if (result == ESP_OK)
    result = nvs_set_blob(h, "archive_v1", key, 32);
  if (result == ESP_OK)
    result = nvs_commit(h);
  nvs_close(h);
  return result;
}
esp_err_t lantern_storage_load_archive_identity(char owner[37], char device[37],
                                                uint8_t key[32]) {
  if (!owner || !device || !key)
    return ESP_ERR_INVALID_ARG;
  nvs_handle_t h;
  esp_err_t result = nvs_open("quipus_keys", NVS_READONLY, &h);
  if (result != ESP_OK)
    return result;
  result = read_string(h, "owner", owner, 37);
  if (result == ESP_OK)
    result = read_string(h, "device", device, 37);
  size_t bytes = 32;
  if (result == ESP_OK)
    result = nvs_get_blob(h, "archive_v1", key, &bytes);
  nvs_close(h);
  return result == ESP_OK && bytes == 32 && strlen(owner) == 36 &&
                 strlen(device) == 36
             ? ESP_OK
             : ESP_FAIL;
}

esp_err_t lantern_storage_clear_archive_identity(void) {
  nvs_handle_t handle;
  esp_err_t result = nvs_open("quipus_keys", NVS_READWRITE, &handle);
  if (result == ESP_ERR_NVS_NOT_FOUND)
    return ESP_OK;
  if (result != ESP_OK)
    return result;
  result = nvs_erase_all(handle);
  if (result == ESP_OK)
    result = nvs_commit(handle);
  nvs_close(handle);
  return result;
}
