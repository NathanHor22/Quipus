#ifdef NDEBUG
#undef NDEBUG
#endif
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "lantern_bluetooth.h"
#include "lantern_storage.h"
#include "nvs.h"

#if TEST_BLE_DISABLED
int main(void) {
  assert(lantern_bluetooth_forget_bonds() == ESP_OK);
  assert(lantern_bluetooth_prepare() == ESP_OK);
  assert(lantern_bluetooth_start() == ESP_OK);
  lantern_bluetooth_close();
  char pin[7] = "123456";
  lantern_bluetooth_passkey(pin);
  assert(pin[0] == 0);
  puts("PASS: non-BLE profiles retain no-op reset compatibility");
  return 0;
}
#else
// Only the settings and archive namespaces exist in this fake. Any unexpected
// namespace or archive erase is a test failure, not a successful reset.
typedef struct {
  char key[16];
  unsigned char value[128];
  size_t length;
} entry_t;
static entry_t entries[2][24];
static bool exists[2];
static unsigned erases[2], forget_calls;
static esp_err_t forget_result;
static const char *OWNER = "11111111-1111-4111-8111-111111111111";
static const char *DEVICE = "22222222-2222-4222-8222-222222222222";
static uint8_t archive_key[32];

static entry_t *entry(nvs_handle_t handle, const char *key, bool create) {
  assert(handle >= 1 && handle <= 2);
  entry_t *empty = NULL;
  for (unsigned i = 0; i < 24; ++i) {
    entry_t *item = &entries[handle - 1][i];
    if (!strcmp(item->key, key)) return item;
    if (!item->key[0]) empty = item;
  }
  if (!create) return NULL;
  assert(empty && strlen(key) < sizeof(empty->key));
  strcpy(empty->key, key);
  return empty;
}
esp_err_t nvs_flash_init(void) { return ESP_OK; }
esp_err_t nvs_open(const char *name, int mode, nvs_handle_t *handle) {
  assert(!strcmp(name, "roxanne") || !strcmp(name, "quipus_keys"));
  *handle = !strcmp(name, "roxanne") ? 1 : 2;
  if (!exists[*handle - 1] && mode == NVS_READONLY) return ESP_ERR_NVS_NOT_FOUND;
  exists[*handle - 1] = true;
  return ESP_OK;
}
void nvs_close(nvs_handle_t handle) { assert(handle >= 1 && handle <= 2); }
esp_err_t nvs_set_blob(nvs_handle_t handle, const char *key, const void *value, size_t size) {
  entry_t *item = entry(handle, key, true);
  assert(size <= sizeof(item->value));
  memcpy(item->value, value, size); item->length = size;
  return ESP_OK;
}
esp_err_t nvs_get_blob(nvs_handle_t handle, const char *key, void *value, size_t *size) {
  entry_t *item = entry(handle, key, false);
  if (!item) return ESP_ERR_NVS_NOT_FOUND;
  if (*size < item->length) return ESP_ERR_NVS_INVALID_LENGTH;
  memcpy(value, item->value, item->length); *size = item->length;
  return ESP_OK;
}
esp_err_t nvs_set_str(nvs_handle_t handle, const char *key, const char *value) {
  return nvs_set_blob(handle, key, value, strlen(value) + 1);
}
esp_err_t nvs_get_str(nvs_handle_t handle, const char *key, char *value, size_t *size) {
  return nvs_get_blob(handle, key, value, size);
}
esp_err_t nvs_set_u8(nvs_handle_t handle, const char *key, uint8_t value) {
  return nvs_set_blob(handle, key, &value, sizeof(value));
}
esp_err_t nvs_get_u8(nvs_handle_t handle, const char *key, uint8_t *value) {
  size_t size = sizeof(*value); return nvs_get_blob(handle, key, value, &size);
}
esp_err_t nvs_erase_key(nvs_handle_t handle, const char *key) {
  entry_t *item = entry(handle, key, false);
  if (!item) return ESP_ERR_NVS_NOT_FOUND;
  memset(item, 0, sizeof(*item)); return ESP_OK;
}
esp_err_t nvs_erase_all(nvs_handle_t handle) {
  assert(handle == 1); // Reset must never erase the archive-key namespace.
  ++erases[handle - 1]; memset(entries[handle - 1], 0, sizeof(entries[0]));
  return ESP_OK;
}
esp_err_t nvs_commit(nvs_handle_t handle) {
  assert(handle >= 1 && handle <= 2); return ESP_OK;
}
esp_err_t lantern_bluetooth_forget_bonds(void) {
  ++forget_calls; return forget_result;
}
static void assert_archive(void) {
  char owner[37], device[37]; uint8_t key[32];
  assert(lantern_storage_load_archive_identity(owner, device, key) == ESP_OK);
  assert(!strcmp(owner, OWNER) && !strcmp(device, DEVICE));
  assert(!memcmp(key, archive_key, sizeof(key)) && erases[1] == 0);
}
static lantern_config_t fixture(void) {
  memset(entries, 0, sizeof(entries)); memset(exists, 0, sizeof(exists));
  memset(erases, 0, sizeof(erases)); forget_calls = 0; forget_result = ESP_OK;
  memset(archive_key, 0xa7, sizeof(archive_key));
  assert(lantern_storage_save_archive_identity(OWNER, DEVICE, archive_key) == ESP_OK);
  assert(lantern_storage_save_device(DEVICE, "existing-device-secret") == ESP_OK);
  assert(lantern_storage_save_owner(OWNER) == ESP_OK);
  assert(lantern_storage_save_wifi("office", "password", "PAIR-CODE") == ESP_OK);
  lantern_config_t config; assert(lantern_storage_load(&config) == ESP_OK);
  return config;
}
int main(void) {
  lantern_config_t config = fixture(), saved = config;
  entry_t before[24]; memcpy(before, entries[0], sizeof(before));
  forget_result = ESP_ERR_INVALID_STATE;
  assert(lantern_storage_clear_device(&config) == ESP_ERR_INVALID_STATE);
  assert(forget_calls == 1 && !memcmp(&config, &saved, sizeof(config)));
  assert(!memcmp(before, entries[0], sizeof(before))); assert_archive();
  assert(lantern_storage_clear() == ESP_ERR_INVALID_STATE);
  assert(forget_calls == 2 && erases[0] == 0);
  assert(!memcmp(before, entries[0], sizeof(before))); assert_archive();

  forget_result = ESP_OK;
  assert(lantern_storage_clear_device(&config) == ESP_OK);
  assert(!config.device_id[0] && !config.device_secret[0] && !config.pairing_code[0]);
  assert(lantern_storage_load(&config) == ESP_OK);
  assert(!config.device_id[0] && !config.device_secret[0] && !config.pairing_code[0]);
  assert(!strcmp(config.wifi_ssid, "office") && !strcmp(config.owner_id, OWNER));
  assert_archive();
  assert(lantern_storage_clear() == ESP_OK && erases[0] == 1);
  assert(lantern_storage_load(&config) == ESP_OK);
  assert(!config.wifi_ssid[0] && !config.owner_id[0] && !config.device_id[0]);
  assert_archive();
  assert(lantern_storage_clear() == ESP_OK); assert_archive();
  unsigned calls = forget_calls;
  assert(lantern_storage_clear_device(NULL) == ESP_ERR_INVALID_ARG);
  assert(forget_calls == calls);
  puts("PASS: device/settings reset gates on BLE cleanup and preserves archive keys");
  return 0;
}
#endif
