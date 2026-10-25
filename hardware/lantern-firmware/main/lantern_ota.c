#include "lantern_ota.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mbedtls/sha256.h"
#include "nvs.h"
#include "sdkconfig.h"

#include "lantern_board.h"
#include "lantern_display.h"
#include "quipus_ota_policy.h"

// Unsigned images are never installed over the network.
#if CONFIG_SECURE_SIGNED_ON_UPDATE_NO_SECURE_BOOT || CONFIG_SECURE_BOOT
#define OTA_SIGNED 1
#else
#define OTA_SIGNED 0
#endif

#define NVS_NAMESPACE "quipus_ota"
#define NVS_TARGET "target"
#define CHUNK_BYTES 4096
#define MAX_ATTEMPTS 3
#define RETRY_DELAY_US (60LL * 60LL * 1000000LL)

typedef enum {
  REPORT_NONE = 0,
  REPORT_INSTALLED,
  REPORT_FAILED,
  REPORT_ROLLED_BACK,
} report_t;

static const char *TAG = "lantern_ota";
static portMUX_TYPE s_lock = portMUX_INITIALIZER_UNLOCKED;
static quipus_ota_offer_t s_offer;
static bool s_has_offer;
static bool s_pending_verify;
static report_t s_report;
static char s_report_version[QUIPUS_OTA_VERSION_CAPACITY];
static char s_report_error[QUIPUS_OTA_ERROR_CAPACITY];
static char s_failed_version[QUIPUS_OTA_VERSION_CAPACITY];
static unsigned s_failures;
static int64_t s_retry_after_us;

static void read_target(char output[QUIPUS_OTA_VERSION_CAPACITY]) {
  output[0] = '\0';
  nvs_handle_t handle;
  if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle) != ESP_OK) return;
  size_t length = QUIPUS_OTA_VERSION_CAPACITY;
  if (nvs_get_str(handle, NVS_TARGET, output, &length) != ESP_OK) output[0] = '\0';
  nvs_close(handle);
}

static esp_err_t write_target(const char *version) {
  nvs_handle_t handle;
  esp_err_t result = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
  if (result != ESP_OK) return result;
  result = version ? nvs_set_str(handle, NVS_TARGET, version) : nvs_erase_key(handle, NVS_TARGET);
  if (result == ESP_ERR_NVS_NOT_FOUND) result = ESP_OK;
  if (result == ESP_OK) result = nvs_commit(handle);
  nvs_close(handle);
  return result;
}

static void set_report(report_t report, const char *version, const char *error) {
  portENTER_CRITICAL(&s_lock);
  s_report = report;
  snprintf(s_report_version, sizeof(s_report_version), "%s", version ? version : "");
  snprintf(s_report_error, sizeof(s_report_error), "%s", error ? error : "");
  portEXIT_CRITICAL(&s_lock);
}

void lantern_ota_boot(void) {
  const esp_partition_t *running = esp_ota_get_running_partition();
  esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;
  if (running && esp_ota_get_state_partition(running, &state) == ESP_OK &&
      state == ESP_OTA_IMG_PENDING_VERIFY) {
    s_pending_verify = true;
    ESP_LOGI(TAG, "new firmware %s is on trial until it reaches Quipus", LANTERN_FIRMWARE_VERSION);
#if CONFIG_QUIPUS_OTA_BENCH_FAIL_NEW_IMAGE
    // Bench image for proving rollback: restarting while still on trial makes
    // the bootloader return to the previous firmware.
    ESP_LOGE(TAG, "bench image: failing first-boot check on purpose");
    vTaskDelay(pdMS_TO_TICKS(3000));
    esp_restart();
#endif
  }
  char target[QUIPUS_OTA_VERSION_CAPACITY];
  read_target(target);
  if (!target[0]) return;
  if (!strcmp(target, LANTERN_FIRMWARE_VERSION)) {
    set_report(REPORT_INSTALLED, target, NULL);
  } else if (!esp_ota_get_last_invalid_partition()) {
    // Replaced over USB rather than rolled back; nothing to report.
    write_target(NULL);
  } else {
    // The attempted image never confirmed itself; the bootloader returned here.
    ESP_LOGW(TAG, "firmware %s was rolled back; staying on %s", target, LANTERN_FIRMWARE_VERSION);
    set_report(REPORT_ROLLED_BACK, target, "New firmware failed its first-boot check");
    snprintf(s_failed_version, sizeof(s_failed_version), "%s", target);
    s_failures = MAX_ATTEMPTS;
  }
}

void lantern_ota_append_report(char *body, size_t capacity) {
  size_t used = strnlen(body, capacity);
  if (used < 2 || used >= capacity || body[used - 1] != '}') return;
  portENTER_CRITICAL(&s_lock);
  report_t report = s_report;
  char version[QUIPUS_OTA_VERSION_CAPACITY], error[QUIPUS_OTA_ERROR_CAPACITY];
  memcpy(version, s_report_version, sizeof(version));
  memcpy(error, s_report_error, sizeof(error));
  portEXIT_CRITICAL(&s_lock);
  if (report == REPORT_NONE) return;
  const char *state = report == REPORT_INSTALLED ? "installed"
                      : report == REPORT_FAILED  ? "failed"
                                                 : "rolled_back";
  char fragment[256];
  int written = error[0]
      ? snprintf(fragment, sizeof(fragment),
                 ",\"update\":{\"state\":\"%s\",\"targetVersion\":\"%s\",\"error\":\"%s\"}}",
                 state, version, error)
      : snprintf(fragment, sizeof(fragment),
                 ",\"update\":{\"state\":\"%s\",\"targetVersion\":\"%s\",\"error\":null}}",
                 state, version);
  if (written <= 0 || (size_t)written >= sizeof(fragment) || used - 1 + (size_t)written >= capacity) return;
  memcpy(body + used - 1, fragment, (size_t)written + 1);
}

static bool copy_string(cJSON *object, const char *name, char *output, size_t capacity) {
  cJSON *item = cJSON_GetObjectItemCaseSensitive(object, name);
  if (!cJSON_IsString(item) || strlen(item->valuestring) >= capacity) return false;
  snprintf(output, capacity, "%s", item->valuestring);
  return true;
}

void lantern_ota_heartbeat_acknowledged(const char *response_body) {
  if (s_pending_verify) {
    esp_err_t valid = esp_ota_mark_app_valid_cancel_rollback();
    if (valid == ESP_OK) {
      s_pending_verify = false;
      ESP_LOGI(TAG, "firmware %s confirmed after reaching Quipus", LANTERN_FIRMWARE_VERSION);
    } else {
      ESP_LOGW(TAG, "could not confirm firmware: %s", esp_err_to_name(valid));
    }
  }
  // The heartbeat that carried the report was accepted; it need not repeat.
  portENTER_CRITICAL(&s_lock);
  bool reported = s_report != REPORT_NONE;
  s_report = REPORT_NONE;
  portEXIT_CRITICAL(&s_lock);
  if (reported && !s_pending_verify) write_target(NULL);

  cJSON *json = response_body ? cJSON_Parse(response_body) : NULL;
  cJSON *update = json ? cJSON_GetObjectItemCaseSensitive(json, "update") : NULL;
  quipus_ota_offer_t offer = {0};
  bool valid = false;
  if (cJSON_IsObject(update)) {
    cJSON *size = cJSON_GetObjectItemCaseSensitive(update, "size");
    valid = copy_string(update, "version", offer.version, sizeof(offer.version)) &&
            copy_string(update, "url", offer.url, sizeof(offer.url)) &&
            copy_string(update, "sha256", offer.sha256, sizeof(offer.sha256)) &&
            cJSON_IsNumber(size) && size->valuedouble > 0 && size->valuedouble < 16777216.0;
    if (valid) offer.size = (uint32_t)size->valuedouble;
  }
  cJSON_Delete(json);
  const esp_partition_t *slot = esp_ota_get_next_update_partition(NULL);
  if (valid) {
    quipus_ota_offer_result_t check = quipus_ota_validate_offer(
        &offer, LANTERN_FIRMWARE_VERSION, slot ? (uint32_t)slot->size : 0,
        CONFIG_QUIPUS_OTA_DOWNLOAD_PREFIX);
    if (check != QUIPUS_OTA_OFFER_OK) {
      ESP_LOGW(TAG, "ignored update offer (reason %d)", (int)check);
      valid = false;
    } else if (!strcmp(offer.version, s_failed_version) && s_failures >= MAX_ATTEMPTS) {
      valid = false;
    }
  }
  portENTER_CRITICAL(&s_lock);
  bool announce = valid && (!s_has_offer || strcmp(s_offer.version, offer.version));
  s_has_offer = valid;
  if (valid) s_offer = offer;
  portEXIT_CRITICAL(&s_lock);
  if (announce) ESP_LOGI(TAG, "update %s offered (%u bytes)", offer.version, (unsigned)offer.size);
  memset(&offer, 0, sizeof(offer));
}

bool lantern_ota_offer_ready(void) {
  if (!OTA_SIGNED || s_pending_verify) return false;
  if (esp_timer_get_time() < s_retry_after_us) return false;
  portENTER_CRITICAL(&s_lock);
  bool ready = s_has_offer;
  portEXIT_CRITICAL(&s_lock);
  return ready;
}

static esp_err_t fail(const char *version, const char *error, esp_err_t result) {
  ESP_LOGW(TAG, "update %s not installed: %s (%s)", version, error, esp_err_to_name(result));
  if (strcmp(s_failed_version, version)) {
    snprintf(s_failed_version, sizeof(s_failed_version), "%s", version);
    s_failures = 0;
  }
  s_failures++;
  s_retry_after_us = esp_timer_get_time() + RETRY_DELAY_US;
  set_report(REPORT_FAILED, version, error);
  portENTER_CRITICAL(&s_lock);
  s_has_offer = false;
  portEXIT_CRITICAL(&s_lock);
  return result == ESP_OK ? ESP_FAIL : result;
}

static void show_progress(unsigned percent) {
  char text[40];
  snprintf(text, sizeof(text), "UPDATING %u%% - KEEP POWERED", percent);
  lantern_display_show(LANTERN_SCREEN_BOOTING, text);
}

esp_err_t lantern_ota_install(void) {
  if (!lantern_ota_offer_ready()) return ESP_ERR_INVALID_STATE;
  quipus_ota_offer_t offer;
  portENTER_CRITICAL(&s_lock);
  offer = s_offer;
  portEXIT_CRITICAL(&s_lock);
  const esp_partition_t *partition = esp_ota_get_next_update_partition(NULL);
  if (!partition) return fail(offer.version, "No update slot", ESP_ERR_NOT_FOUND);
  if (quipus_ota_validate_offer(&offer, LANTERN_FIRMWARE_VERSION, (uint32_t)partition->size,
                                CONFIG_QUIPUS_OTA_DOWNLOAD_PREFIX) != QUIPUS_OTA_OFFER_OK)
    return fail(offer.version, "Offer rejected", ESP_ERR_INVALID_ARG);
  uint8_t *buffer = heap_caps_malloc(CHUNK_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!buffer) buffer = malloc(CHUNK_BYTES);
  if (!buffer) return fail(offer.version, "Out of memory", ESP_ERR_NO_MEM);

  ESP_LOGI(TAG, "installing %s into %s", offer.version, partition->label);
  show_progress(0);
  esp_http_client_config_t config = {
      .url = offer.url,
      .crt_bundle_attach = esp_crt_bundle_attach,
      .timeout_ms = 30000,
      .disable_auto_redirect = true,
      .buffer_size = 4096,
  };
  esp_http_client_handle_t client = esp_http_client_init(&config);
  memset(offer.url, 0, sizeof(offer.url));
  esp_ota_handle_t handle = 0;
  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  const char *error = NULL;
  esp_err_t result = client ? esp_http_client_open(client, 0) : ESP_ERR_NO_MEM;
  if (result != ESP_OK) error = "Download could not start";
  if (!error) {
    int64_t length = esp_http_client_fetch_headers(client);
    int status = esp_http_client_get_status_code(client);
    if (status != 200) error = "Download was refused";
    else if (length != (int64_t)offer.size) error = "Download size did not match";
  }
  if (!error) {
    result = esp_ota_begin(partition, OTA_WITH_SEQUENTIAL_WRITES, &handle);
    if (result != ESP_OK) error = "Update slot could not be prepared";
  }
  uint32_t total = 0;
  unsigned shown = 0;
  if (!error) {
    mbedtls_sha256_starts(&sha, 0);
    while (total < offer.size) {
      size_t want = offer.size - total < CHUNK_BYTES ? offer.size - total : CHUNK_BYTES;
      int received = esp_http_client_read(client, (char *)buffer, (int)want);
      if (received <= 0) { error = "Download was interrupted"; result = ESP_FAIL; break; }
      mbedtls_sha256_update(&sha, buffer, (size_t)received);
      result = esp_ota_write(handle, buffer, (size_t)received);
      if (result != ESP_OK) { error = "Update could not be written"; break; }
      total += (uint32_t)received;
      unsigned percent = (unsigned)((uint64_t)total * 100u / offer.size);
      if (percent >= shown + 10) { shown = percent - percent % 10; show_progress(shown); }
    }
  }
  if (client) {
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
  }
  free(buffer);
  if (!error) {
    uint8_t digest[32];
    char hex[QUIPUS_OTA_SHA256_HEX + 1];
    mbedtls_sha256_finish(&sha, digest);
    quipus_ota_hex(digest, hex);
    if (strcmp(hex, offer.sha256)) { error = "Checksum did not match"; result = ESP_ERR_INVALID_CRC; }
  }
  mbedtls_sha256_free(&sha);
  if (error) {
    if (handle) esp_ota_abort(handle);
    lantern_display_show(LANTERN_SCREEN_BOOTING, "UPDATE PAUSED");
    return fail(offer.version, error, result);
  }
  // esp_ota_end validates the image, including its signature against the key
  // that signed the running firmware.
  result = esp_ota_end(handle);
  if (result != ESP_OK) {
    lantern_display_show(LANTERN_SCREEN_BOOTING, "UPDATE REJECTED");
    return fail(offer.version, "Signature or image check failed", result);
  }
  result = write_target(offer.version);
  if (result == ESP_OK) result = esp_ota_set_boot_partition(partition);
  if (result != ESP_OK) {
    write_target(NULL);
    return fail(offer.version, "Update could not be activated", result);
  }
  ESP_LOGI(TAG, "update %s verified; restarting", offer.version);
  lantern_display_show(LANTERN_SCREEN_BOOTING, "RESTARTING TO FINISH UPDATE");
  vTaskDelay(pdMS_TO_TICKS(800));
  esp_restart();
  return ESP_OK;
}
