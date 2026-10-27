#ifdef NDEBUG
#undef NDEBUG
#endif
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "esp_partition.h"
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
  unsigned char value[256];
  size_t length;
} entry_t;
static entry_t entries[4][24];
static bool exists[4], fail_device_write, fail_reset_write;
static unsigned erases[4], forget_calls;
static esp_err_t forget_result;
static const char *OWNER = "11111111-1111-4111-8111-111111111111";
static const char *DEVICE = "22222222-2222-4222-8222-222222222222";
static uint8_t archive_key[32];

static entry_t *entry(nvs_handle_t handle, const char *key, bool create) {
  assert(handle >= 1 && handle <= 4);
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
// Settings partition fake: queued init results, raw bytes and erase count.
static esp_err_t init_results[4];
static unsigned init_count, init_calls, partition_erases;
static uint8_t raw_partition[16384];
static esp_partition_t nvs_partition = {.size = sizeof(raw_partition)};
static bool partition_present = true, read_fails;
esp_err_t nvs_flash_init(void) {
  ++init_calls;
  return init_calls <= init_count ? init_results[init_calls - 1] : ESP_OK;
}
esp_err_t nvs_flash_erase(void) { ++partition_erases; memset(raw_partition, 0xff, sizeof(raw_partition)); return ESP_OK; }
void *heap_caps_malloc(size_t size, unsigned caps) { (void)caps; return malloc(size); }
const esp_partition_t *esp_partition_find_first(esp_partition_type_t type,
    esp_partition_subtype_t subtype, const char *label) {
  assert(type == ESP_PARTITION_TYPE_DATA && subtype == ESP_PARTITION_SUBTYPE_DATA_NVS && !label);
  return partition_present ? &nvs_partition : NULL;
}
esp_err_t esp_partition_read(const esp_partition_t *partition, size_t offset, void *destination, size_t size) {
  assert(partition == &nvs_partition && offset == 0 && size == sizeof(raw_partition));
  if (read_fails) return ESP_FAIL;
  memcpy(destination, raw_partition, size);
  return ESP_OK;
}
static void settings(const char *text, esp_err_t first, esp_err_t second) {
  memset(raw_partition, 0xff, sizeof(raw_partition));
  if (text) memcpy(raw_partition + 9000, text, strlen(text) + 1);
  init_results[0] = first; init_results[1] = second;
  init_count = 2; init_calls = partition_erases = 0; partition_present = true; read_fails = false;
}
static void storage_init_suite(void) {
  // Healthy settings are never inspected or erased.
  settings(NULL, ESP_OK, ESP_OK);
  assert(lantern_storage_init() == ESP_OK && init_calls == 1 && partition_erases == 0);
  // A factory demo's full or foreign-format settings start fresh once.
  settings("lvgl_demo", ESP_ERR_NVS_NO_FREE_PAGES, ESP_OK);
  assert(lantern_storage_init() == ESP_OK && partition_erases == 1 && init_calls == 2);
  settings("phy", ESP_ERR_NVS_NEW_VERSION_FOUND, ESP_OK);
  assert(lantern_storage_init() == ESP_OK && partition_erases == 1);
  // Any Quipus namespace (pairing, SD archive keys, updates, setup password) is kept.
  const char *quipus[] = {"roxanne", "quipus_keys", "quipus_ota", "quipus_device", "quipus_reset"};
  for (unsigned i = 0; i < 5; ++i) {
    settings(quipus[i], ESP_ERR_NVS_NO_FREE_PAGES, ESP_OK);
    assert(lantern_storage_init() == ESP_ERR_NVS_NO_FREE_PAGES && partition_erases == 0 && init_calls == 1);
  }
  // A name that only begins like a namespace is not one.
  settings("roxanneX", ESP_ERR_NVS_NO_FREE_PAGES, ESP_OK);
  assert(lantern_storage_init() == ESP_OK && partition_erases == 1);
  // Unreadable or missing partitions, and other errors, are never erased.
  settings(NULL, ESP_ERR_NVS_NO_FREE_PAGES, ESP_OK); read_fails = true;
  assert(lantern_storage_init() == ESP_ERR_NVS_NO_FREE_PAGES && partition_erases == 0);
  settings(NULL, ESP_ERR_NVS_NO_FREE_PAGES, ESP_OK); partition_present = false;
  assert(lantern_storage_init() == ESP_ERR_NVS_NO_FREE_PAGES && partition_erases == 0);
  settings(NULL, ESP_FAIL, ESP_OK);
  assert(lantern_storage_init() == ESP_FAIL && partition_erases == 0 && init_calls == 1);
  init_count = 0; init_calls = 0;
}
esp_err_t nvs_open(const char *name, int mode, nvs_handle_t *handle) {
  assert(!strcmp(name, "roxanne") || !strcmp(name, "quipus_keys") || !strcmp(name, "quipus_device") || !strcmp(name, "quipus_reset"));
  *handle = !strcmp(name, "roxanne") ? 1 : !strcmp(name, "quipus_keys") ? 2 : !strcmp(name, "quipus_device") ? 3 : 4;
  if (!exists[*handle - 1] && mode == NVS_READONLY) return ESP_ERR_NVS_NOT_FOUND;
  exists[*handle - 1] = true;
  return ESP_OK;
}
void nvs_close(nvs_handle_t handle) { assert(handle >= 1 && handle <= 4); }
esp_err_t nvs_set_blob(nvs_handle_t handle, const char *key, const void *value, size_t size) {
  if ((handle == 3 && fail_device_write) || (handle == 4 && fail_reset_write)) return ESP_FAIL;
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
  assert(handle == 1 || handle == 2); // Only explicit owner reset may erase archive keys.
  ++erases[handle - 1]; memset(entries[handle - 1], 0, sizeof(entries[0]));
  return ESP_OK;
}
esp_err_t nvs_commit(nvs_handle_t handle) {
  assert(handle >= 1 && handle <= 4); return ESP_OK;
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

static void factory_reset_suite(void) {
  lantern_config_t config = fixture();
  lantern_factory_reset_t reset = {.stage = LANTERN_RESET_REQUESTED};
  strcpy(reset.request_id, "33333333-3333-4333-8333-333333333333");
  strcpy(reset.device_id, DEVICE);
  memset(reset.device_secret, 'K', 43);
  reset.device_secret[43] = 0;
  lantern_factory_reset_t loaded;
  assert(lantern_storage_load_factory_reset(&loaded) == ESP_ERR_NVS_NOT_FOUND);
  assert(lantern_storage_save_factory_reset(&reset) == ESP_OK);
  assert(lantern_storage_load_factory_reset(&loaded) == ESP_OK);
  assert(!memcmp(&loaded, &reset, sizeof(reset)));
  // Missing or corrupt reset intent cannot authorize a private-data erase.
  reset.stage = 0;
  assert(lantern_storage_save_factory_reset(&reset) == ESP_ERR_INVALID_ARG);
  reset.stage = LANTERN_RESET_REQUESTED;
  reset.request_id[0] = 'Z';
  assert(lantern_storage_save_factory_reset(&reset) == ESP_ERR_INVALID_ARG);
  reset.request_id[0] = '3';
  reset.device_secret[4] = ' ';
  assert(lantern_storage_save_factory_reset(&reset) == ESP_ERR_INVALID_ARG);
  reset.device_secret[4] = 'K';
  assert(lantern_storage_load_factory_reset(&loaded) == ESP_OK);
  assert(loaded.stage == LANTERN_RESET_REQUESTED);
  // BLE failure must preserve credentials until cleanup can safely continue.
  forget_result = ESP_ERR_INVALID_STATE;
  assert(lantern_storage_clear_account(&config) == ESP_ERR_INVALID_STATE);
  assert(config.owner_id[0] && config.device_secret[0]);
  forget_result = ESP_OK;
  assert(lantern_storage_clear_account(&config) == ESP_OK);
  assert(!config.owner_id[0] && !config.device_secret[0] && !config.device_id[0]);
  assert(!strcmp(config.wifi_ssid, "office"));
  assert(lantern_storage_load(&config) == ESP_OK);
  assert(!config.owner_id[0] && !config.device_secret[0] && !config.device_id[0]);
  assert(!strcmp(config.wifi_ssid, "office"));
  assert_archive();
  assert(lantern_storage_clear_archive_identity() == ESP_OK);
  assert(lantern_storage_clear() == ESP_OK);
  // Normal settings and archive erasure must not lose the reset-only verifier.
  assert(lantern_storage_load_factory_reset(&loaded) == ESP_OK);
  assert(!memcmp(&loaded, &reset, sizeof(reset)));
  reset.stage = LANTERN_RESET_ERASED;
  fail_reset_write = true;
  assert(lantern_storage_save_factory_reset(&reset) == ESP_FAIL);
  assert(lantern_storage_load_factory_reset(&loaded) == ESP_OK);
  assert(loaded.stage == LANTERN_RESET_REQUESTED);
  fail_reset_write = false;
  assert(lantern_storage_save_factory_reset(&reset) == ESP_OK);
  assert(lantern_storage_load_factory_reset(&loaded) == ESP_OK);
  assert(loaded.stage == LANTERN_RESET_ERASED);
  reset.stage = LANTERN_RESET_ACKNOWLEDGED;
  assert(lantern_storage_save_factory_reset(&reset) == ESP_OK);
  assert(lantern_storage_load_factory_reset(&loaded) == ESP_OK);
  assert(loaded.stage == LANTERN_RESET_ACKNOWLEDGED);
  // Retrying final journal deletion after power loss is idempotent.
  assert(lantern_storage_clear_factory_reset() == ESP_OK);
  assert(lantern_storage_clear_factory_reset() == ESP_OK);
  assert(lantern_storage_load_factory_reset(&loaded) == ESP_ERR_NVS_NOT_FOUND);
  assert(lantern_storage_save_factory_reset(NULL) == ESP_ERR_INVALID_ARG);
  assert(lantern_storage_load_factory_reset(NULL) == ESP_ERR_INVALID_ARG);
  assert(lantern_storage_clear_account(NULL) == ESP_ERR_INVALID_ARG);
  puts("PASS: explicit account reset journal survives erasure/reboot stages, isolates credentials and fails closed");
}

int main(void) {
  storage_init_suite();
  factory_reset_suite();
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
  puts("PASS: device/settings reset gates on BLE cleanup and preserves archive keys; only foreign settings storage is wiped");
  return 0;
}
#endif
