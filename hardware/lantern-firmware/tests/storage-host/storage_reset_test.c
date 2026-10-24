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
// Only the settings, archive and device namespaces exist in this fake. Any
// unexpected namespace or archive/device erase is a test failure, not a reset.
typedef struct {
  char key[16];
  unsigned char value[128];
  size_t length;
} entry_t;
static entry_t entries[3][24];
static bool exists[3], fail_device_write;
static unsigned erases[3], forget_calls;
static esp_err_t forget_result;
static const char *OWNER = "11111111-1111-4111-8111-111111111111";
static const char *DEVICE = "22222222-2222-4222-8222-222222222222";
static uint8_t archive_key[32];

static entry_t *entry(nvs_handle_t handle, const char *key, bool create) {
  assert(handle >= 1 && handle <= 3);
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
  assert(!strcmp(name, "roxanne") || !strcmp(name, "quipus_keys") || !strcmp(name, "quipus_device"));
  *handle = !strcmp(name, "roxanne") ? 1 : !strcmp(name, "quipus_keys") ? 2 : 3;
  if (!exists[*handle - 1] && mode == NVS_READONLY) return ESP_ERR_NVS_NOT_FOUND;
  exists[*handle - 1] = true;
  return ESP_OK;
}
void nvs_close(nvs_handle_t handle) { assert(handle >= 1 && handle <= 3); }
esp_err_t nvs_set_blob(nvs_handle_t handle, const char *key, const void *value, size_t size) {
  if (handle == 3 && fail_device_write) return ESP_FAIL;
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
  assert(handle >= 1 && handle <= 3); return ESP_OK;
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
static void test_setup_password(void) {
  // Pure mapping: low five bits select from the 32-symbol alphabet.
  uint8_t entropy[QUIPUS_SETUP_PASSWORD_ENTROPY_BYTES];
  char password[QUIPUS_SETUP_PASSWORD_BUFFER];
  for (unsigned i = 0; i < sizeof(entropy); ++i) entropy[i] = (uint8_t)(i | 0xe0);
  quipus_setup_password_from_entropy(entropy, password);
  assert(!strcmp(password, "23456789AB") && quipus_setup_password_valid(password));
  const char *invalid[] = { "23456789A", "23456789ABC", "23456789aB", "2345678OAB",
      "23456780AB", "2345678IAB", "23456781AB", "" };
  for (unsigned i = 0; i < sizeof(invalid) / sizeof(invalid[0]); ++i)
    assert(!quipus_setup_password_valid(invalid[i]));
  assert(!quipus_setup_password_valid(NULL));

  // First boot creates and stores the password; later boots keep it.
  lantern_config_t config = fixture();
  char first[QUIPUS_SETUP_PASSWORD_BUFFER], again[QUIPUS_SETUP_PASSWORD_BUFFER];
  for (unsigned i = 0; i < sizeof(entropy); ++i) entropy[i] = (uint8_t)(i * 37 + 11);
  assert(lantern_storage_ensure_setup_password(entropy, first) == ESP_OK);
  assert(quipus_setup_password_valid(first));
  memset(entropy, 0x55, sizeof(entropy));
  assert(lantern_storage_ensure_setup_password(entropy, again) == ESP_OK);
  assert(!strcmp(first, again));

  // Pairing and full settings resets never change it (its namespace is never erased).
  assert(lantern_storage_clear_device(&config) == ESP_OK);
  assert(lantern_storage_clear() == ESP_OK);
  assert(lantern_storage_ensure_setup_password(entropy, again) == ESP_OK);
  assert(!strcmp(first, again) && erases[2] == 0);

  // An unreadable stored value is replaced from fresh entropy.
  assert(nvs_set_str(3, "setup_pass", "bad") == ESP_OK);
  assert(lantern_storage_ensure_setup_password(entropy, again) == ESP_OK);
  assert(!strcmp(again, "PPPPPPPPPP"));

  // A failed write leaves no password, so the caller uses the board fallback.
  fixture();
  fail_device_write = true;
  assert(lantern_storage_ensure_setup_password(entropy, again) == ESP_FAIL);
  assert(again[0] == '\0');
  fail_device_write = false;
  char missing[QUIPUS_SETUP_PASSWORD_BUFFER + 1] = {0};
  size_t size = sizeof(missing);
  assert(nvs_get_str(3, "setup_pass", missing, &size) == ESP_ERR_NVS_NOT_FOUND);
  assert(lantern_storage_ensure_setup_password(NULL, again) == ESP_ERR_INVALID_ARG);
  puts("PASS: setup password is created once, survives resets, and fails safe");
}

int main(void) {
  test_setup_password();
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
