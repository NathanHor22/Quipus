#include "lantern_bluetooth.h"
#include "sdkconfig.h"

#if CONFIG_QUIPUS_BLE_SETUP
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "cJSON.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "nvs.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include "lantern_board.h"
#include "lantern_network.h"
#include "quipus_ble_transfer.h"

// Canonical UUIDs end in ...0001 (service), ...0002 (info), ...0003 (control),
// ...0004 (status). BLE_UUID128_INIT stores them least-significant byte first.
#define QUIPUS_UUID(last) BLE_UUID128_INIT(last, 0x00, 0xb0, 0x9a, 0x42, 0x21, \
    0x18, 0x9c, 0xec, 0x45, 0xc5, 0x8a, 0x60, 0x70, 0x81, 0x71)
static const ble_uuid128_t s_service = QUIPUS_UUID(1);
static const ble_uuid128_t s_info = QUIPUS_UUID(2);
static const ble_uuid128_t s_control = QUIPUS_UUID(3);
static const ble_uuid128_t s_status_uuid = QUIPUS_UUID(4);
static const char *TAG = "quipus_bluetooth";
static bool s_initialized, s_synced, s_available;
static uint8_t s_address_type;
static uint16_t s_connection = BLE_HS_CONN_HANDLE_NONE;
static char s_pin[7];
static portMUX_TYPE s_lock = portMUX_INITIALIZER_UNLOCKED;
static quipus_ble_transfer_t s_transfer;
static QueueHandle_t s_jobs;
static char s_state[16] = "ready", s_error[96];
static lantern_wifi_network_t s_networks[4];
static size_t s_network_count;
typedef struct { bool scan; char body[QUIPUS_BLE_SETUP_MAX + 1]; } setup_job_t;

void ble_store_config_init(void);
static int gap_event(struct ble_gap_event *event, void *argument);

static void log_memory(const char *stage) {
  ESP_LOGI(TAG, "%s; internal_free=%u largest_internal=%u psram_free=%u", stage,
           (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
           (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
           (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
}

static void state(const char *value, const char *error) {
  portENTER_CRITICAL(&s_lock);
  snprintf(s_state, sizeof(s_state), "%s", value);
  snprintf(s_error, sizeof(s_error), "%s", error ? error : "");
  portEXIT_CRITICAL(&s_lock);
}

static bool busy(void) {
  portENTER_CRITICAL(&s_lock);
  bool value = !strcmp(s_state, "saving") || !strcmp(s_state, "scanning") ||
               !strcmp(s_state, "saved");
  portEXIT_CRITICAL(&s_lock);
  return value;
}

void lantern_bluetooth_passkey(char output[7]) {
  portENTER_CRITICAL(&s_lock);
  memcpy(output, s_pin, sizeof(s_pin));
  portEXIT_CRITICAL(&s_lock);
}

static void worker(void *argument) {
  (void)argument;
  setup_job_t *job;
  for (;;) {
    if (xQueueReceive(s_jobs, &job, portMAX_DELAY) != pdTRUE) continue;
    if (job->scan) {
      lantern_wifi_network_t networks[4] = {0};
      size_t count = 0;
      esp_err_t result = lantern_network_scan_wifi(networks, 4, &count);
      portENTER_CRITICAL(&s_lock);
      memcpy(s_networks, networks, sizeof(networks));
      s_network_count = result == ESP_OK ? count : 0;
      portEXIT_CRITICAL(&s_lock);
      // Hidden networks and a failed scan can always use manual SSID entry.
      state("ready", result == ESP_OK ? NULL : "Enter your Wi-Fi name manually.");
    } else {
      quipus_setup_form_t form = {0};
      char error[96] = {0};
      bool valid = quipus_setup_parse_form(job->body, strlen(job->body), &form);
      // Erase the queued credential copy before doing any storage work.
      volatile unsigned char *bytes = (volatile unsigned char *)job;
      for (size_t i = 0; i < sizeof(*job); ++i) bytes[i] = 0;
      free(job);
      job = NULL;
      esp_err_t result = valid ? lantern_network_save_setup(&form, true, error, sizeof(error))
                               : ESP_ERR_INVALID_ARG;
      bytes = (volatile unsigned char *)&form;
      for (size_t i = 0; i < sizeof(form); ++i) bytes[i] = 0;
      if (result == ESP_OK) {
        state("saved", NULL);
        vTaskDelay(pdMS_TO_TICKS(2500));
        esp_restart();
      }
      state("error", error[0] ? error : "Setup was incomplete. Please try again.");
    }
    free(job); // Scan jobs contain no credentials; save jobs were erased above.
  }
}

static int write_json(struct os_mbuf *output, cJSON *root) {
  char buffer[512];
  int result = BLE_ATT_ERR_UNLIKELY;
  if (root && cJSON_PrintPreallocated(root, buffer, sizeof(buffer), false))
    result = os_mbuf_append(output, buffer, strlen(buffer)) == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
  cJSON_Delete(root);
  return result;
}

static int access(uint16_t connection, uint16_t attribute,
                    struct ble_gatt_access_ctxt *context, void *argument) {
  (void)attribute;
  (void)argument;
  if (ble_uuid_cmp(context->chr->uuid, &s_info.u) == 0 &&
      context->op == BLE_GATT_ACCESS_OP_READ_CHR) {
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "v", 1);
    cJSON_AddStringToObject(root, "firmware", LANTERN_FIRMWARE_VERSION);
    cJSON_AddStringToObject(root, "backend", LANTERN_API_BASE_URL);
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char hardware[40];
    snprintf(hardware, sizeof(hardware), "esp32s3:%02x%02x%02x%02x%02x%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    cJSON_AddStringToObject(root, "hardwareId", hardware);
    cJSON_AddBoolToObject(root, "available", lantern_network_bluetooth_allowed());
    return write_json(context->om, root);
  }
  struct ble_gap_conn_desc peer;
  if (!s_available || ble_gap_conn_find(connection, &peer) != 0 ||
      !peer.sec_state.encrypted || !peer.sec_state.authenticated ||
      peer.sec_state.key_size != 16) return BLE_ATT_ERR_INSUFFICIENT_AUTHEN;

  if (ble_uuid_cmp(context->chr->uuid, &s_status_uuid.u) == 0 &&
      context->op == BLE_GATT_ACCESS_OP_READ_CHR) {
    char current[16], error[96];
    lantern_wifi_network_t networks[4];
    size_t count;
    portENTER_CRITICAL(&s_lock);
    memcpy(current, s_state, sizeof(current));
    memcpy(error, s_error, sizeof(error));
    memcpy(networks, s_networks, sizeof(networks));
    count = s_network_count;
    portEXIT_CRITICAL(&s_lock);
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "v", 1);
    cJSON_AddStringToObject(root, "state", current);
    cJSON_AddStringToObject(root, "error", error);
    lantern_network_status_t network;
    lantern_network_get_status(&network);
    cJSON_AddStringToObject(root, "savedSsid", network.saved_ssid);
    cJSON *list = cJSON_AddArrayToObject(root, "networks");
    for (size_t i = 0; i < count; ++i) {
      cJSON *item = cJSON_CreateObject();
      cJSON_AddStringToObject(item, "ssid", networks[i].ssid);
      cJSON_AddBoolToObject(item, "secured", networks[i].secured);
      cJSON_AddItemToArray(list, item);
      char check[512];
      if (!cJSON_PrintPreallocated(root, check, sizeof(check), false)) {
        cJSON_DeleteItemFromArray(list, (int)i);
        break;
      }
    }
    return write_json(context->om, root);
  }
  if (context->op != BLE_GATT_ACCESS_OP_WRITE_CHR || busy() ||
      !lantern_network_bluetooth_allowed()) return BLE_ATT_ERR_WRITE_NOT_PERMITTED;
  uint8_t frame[20];
  uint16_t length = 0;
  if (ble_hs_mbuf_to_flat(context->om, frame, sizeof(frame), &length) != 0 || !length)
    return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
  bool scan = false;
  bool complete = false;
  if (frame[0] == QUIPUS_BLE_SCAN && length == 1) {
    quipus_ble_transfer_clear(&s_transfer);
    scan = true;
    state("scanning", NULL);
  } else {
    if (!quipus_ble_transfer_write(&s_transfer, frame, length,
            (uint64_t)esp_timer_get_time() / 1000, &complete)) {
      state("error", "Setup transfer interrupted. Please send it again.");
      return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    }
    if (!complete) { state("ready", NULL); return 0; }
    state("saving", NULL);
  }
  setup_job_t *job = calloc(1, sizeof(*job));
  if (job) {
    job->scan = scan;
    if (!scan) memcpy(job->body, s_transfer.body, sizeof(job->body));
  }
  quipus_ble_transfer_clear(&s_transfer);
  // Queue only a pointer: FreeRTOS queue slots retain received bytes, so a
  // by-value job would leave a password behind in the queue's backing buffer.
  if (!job || xQueueSend(s_jobs, &job, 0) != pdTRUE) {
    if (job) {
      volatile unsigned char *bytes = (volatile unsigned char *)job;
      for (size_t i = 0; i < sizeof(*job); ++i) bytes[i] = 0;
      free(job);
    }
    state("error", "Recorder is busy. Please try again.");
    return BLE_ATT_ERR_INSUFFICIENT_RES;
  }
  return 0;
}

static const struct ble_gatt_svc_def s_services[] = {{
  .type = BLE_GATT_SVC_TYPE_PRIMARY, .uuid = &s_service.u,
  .characteristics = (struct ble_gatt_chr_def[]) {
    {.uuid = &s_info.u, .access_cb = access, .flags = BLE_GATT_CHR_F_READ},
    {.uuid = &s_control.u, .access_cb = access,
      .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_ENC | BLE_GATT_CHR_F_WRITE_AUTHEN,
      .min_key_size = 16},
    {.uuid = &s_status_uuid.u, .access_cb = access,
      .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_READ_ENC | BLE_GATT_CHR_F_READ_AUTHEN,
      .min_key_size = 16}, {0}
  }
}, {0}};

static void advertise(void) {
  if (!s_synced || !s_available || !lantern_network_bluetooth_allowed() ||
      s_connection != BLE_HS_CONN_HANDLE_NONE || ble_gap_adv_active()) return;
  struct ble_hs_adv_fields fields = {0};
  fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
  fields.uuids128 = (ble_uuid128_t *)&s_service;
  fields.num_uuids128 = 1;
  fields.uuids128_is_complete = 1;
  int result = ble_gap_adv_set_fields(&fields);
  if (result != 0) {
    ESP_LOGE(TAG, "advertising service configuration failed: %d", result);
    return;
  }
  memset(&fields, 0, sizeof(fields));
  fields.name = (uint8_t *)ble_svc_gap_device_name();
  fields.name_len = strlen((char *)fields.name);
  fields.name_is_complete = 1;
  result = ble_gap_adv_rsp_set_fields(&fields);
  if (result != 0) {
    ESP_LOGE(TAG, "advertising name configuration failed: %d", result);
    return;
  }
  struct ble_gap_adv_params params = {0};
  params.conn_mode = BLE_GAP_CONN_MODE_UND;
  params.disc_mode = BLE_GAP_DISC_MODE_GEN;
  result = ble_gap_adv_start(s_address_type, NULL, BLE_HS_FOREVER, &params, gap_event, NULL);
  if (result != 0) ESP_LOGE(TAG, "Bluetooth advertising failed: %d", result);
  else {
    ESP_LOGI(TAG, "Bluetooth setup advertising as %s", ble_svc_gap_device_name());
    log_memory("advertising ready");
  }
}

static int gap_event(struct ble_gap_event *event, void *argument) {
  (void)argument;
  switch (event->type) {
  case BLE_GAP_EVENT_CONNECT:
    if (event->connect.status == 0) s_connection = event->connect.conn_handle;
    else advertise();
    break;
  case BLE_GAP_EVENT_DISCONNECT:
    s_connection = BLE_HS_CONN_HANDLE_NONE;
    quipus_ble_transfer_clear(&s_transfer);
    portENTER_CRITICAL(&s_lock);
    memset(s_pin, 0, sizeof(s_pin));
    portEXIT_CRITICAL(&s_lock);
    if (!busy()) state("ready", NULL);
    advertise();
    break;
  case BLE_GAP_EVENT_ADV_COMPLETE:
    advertise();
    break;
  case BLE_GAP_EVENT_PASSKEY_ACTION:
    if (event->passkey.params.action == BLE_SM_IOACT_DISP) {
      struct ble_sm_io input = {.action = BLE_SM_IOACT_DISP};
      input.passkey = esp_random() % 1000000;
      portENTER_CRITICAL(&s_lock);
      snprintf(s_pin, sizeof(s_pin), "%06lu", (unsigned long)input.passkey);
      portEXIT_CRITICAL(&s_lock);
      ble_sm_inject_io(event->passkey.conn_handle, &input);
    }
    break;
  case BLE_GAP_EVENT_ENC_CHANGE:
    if (event->enc_change.status != 0)
      ble_gap_terminate(event->enc_change.conn_handle, BLE_ERR_REM_USER_CONN_TERM);
    portENTER_CRITICAL(&s_lock);
    memset(s_pin, 0, sizeof(s_pin));
    portEXIT_CRITICAL(&s_lock);
    break;
  case BLE_GAP_EVENT_REPEAT_PAIRING:
    // Re-pairing is allowed only while the physical recorder is unowned.
    if (s_available && lantern_network_bluetooth_allowed()) {
      struct ble_gap_conn_desc peer;
      if (ble_gap_conn_find(event->repeat_pairing.conn_handle, &peer) == 0)
        ble_store_util_delete_peer(&peer.peer_id_addr);
      return BLE_GAP_REPEAT_PAIRING_RETRY;
    }
    return BLE_GAP_REPEAT_PAIRING_IGNORE;
  default: break;
  }
  return 0;
}

static void synced(void) {
  int result = ble_hs_util_ensure_addr(0);
  if (result == 0) result = ble_hs_id_infer_auto(0, &s_address_type);
  if (result != 0) {
    ESP_LOGE(TAG, "Bluetooth address initialization failed: %d", result);
    return;
  }
  s_synced = true;
  ESP_LOGI(TAG, "Bluetooth host synchronized");
  advertise();
}

static void host_reset(int reason) {
  s_synced = false;
  s_connection = BLE_HS_CONN_HANDLE_NONE;
  quipus_ble_transfer_clear(&s_transfer);
  portENTER_CRITICAL(&s_lock);
  memset(s_pin, 0, sizeof(s_pin));
  portEXIT_CRITICAL(&s_lock);
  ESP_LOGE(TAG, "Bluetooth host reset: %d; waiting for synchronization", reason);
}

static void host_task(void *argument) {
  (void)argument;
  nimble_port_run();
  nimble_port_freertos_deinit();
}

esp_err_t lantern_bluetooth_prepare(void) {
  if (s_initialized) return ESP_OK;
  log_memory("reserving Bluetooth memory before Wi-Fi");
  if (!s_jobs) {
    s_jobs = xQueueCreate(1, sizeof(setup_job_t *));
    if (!s_jobs) return ESP_ERR_NO_MEM;
    if (xTaskCreate(worker, "quipus_ble_setup", 6144, NULL, 4, NULL) != pdPASS) {
      vQueueDelete(s_jobs); s_jobs = NULL; return ESP_ERR_NO_MEM;
    }
  }
  esp_err_t result = nimble_port_init();
  if (result != ESP_OK) {
    ESP_LOGE(TAG, "Bluetooth initialization failed: %s", esp_err_to_name(result));
    log_memory("Bluetooth initialization failed");
    return result;
  }
  ble_hs_cfg.reset_cb = host_reset;
  ble_hs_cfg.sync_cb = synced;
  ble_hs_cfg.store_status_cb = ble_store_util_status_rr;
  ble_hs_cfg.sm_io_cap = BLE_HS_IO_DISPLAY_ONLY;
  ble_hs_cfg.sm_bonding = 1;
  ble_hs_cfg.sm_mitm = 1;
  ble_hs_cfg.sm_sc = 1;
  ble_hs_cfg.sm_our_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
  ble_hs_cfg.sm_their_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
  ble_svc_gap_init();
  ble_svc_gatt_init();
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_BT);
  char name[24];
  snprintf(name, sizeof(name), "Quipus-BT-%02X%02X", mac[4], mac[5]);
  int host_result = ble_svc_gap_device_name_set(name);
  if (host_result == 0) host_result = ble_gatts_count_cfg(s_services);
  if (host_result == 0) host_result = ble_gatts_add_svcs(s_services);
  if (host_result != 0) {
    ESP_LOGE(TAG, "Bluetooth service initialization failed: %d", host_result);
    nimble_port_deinit();
    return ESP_FAIL;
  }
  ble_store_config_init();
  s_initialized = true;
  nimble_port_freertos_init(host_task);
  log_memory("Bluetooth controller and host initialized");
  return ESP_OK;
}

esp_err_t lantern_bluetooth_start(void) {
  if (!lantern_network_bluetooth_allowed()) return ESP_ERR_INVALID_STATE;
  esp_err_t result = lantern_bluetooth_prepare();
  if (result != ESP_OK) return result;
  s_available = true;
  advertise();
  return ESP_OK;
}

static esp_err_t stop_host(void) {
  s_available = false;
  if (s_initialized) {
    ble_gap_adv_stop();
    if (s_connection != BLE_HS_CONN_HANDLE_NONE)
      ble_gap_terminate(s_connection, BLE_ERR_REM_USER_CONN_TERM);
    int stopped = nimble_port_stop();
    if (stopped != 0) {
      ESP_LOGE(TAG, "Bluetooth host stop failed: %d", stopped);
      return ESP_FAIL;
    }
    esp_err_t result = nimble_port_deinit();
    if (result != ESP_OK) {
      ESP_LOGE(TAG, "Bluetooth deinitialization failed: %s", esp_err_to_name(result));
      return result;
    }
    s_initialized = false;
  }
  s_synced = false;
  s_connection = BLE_HS_CONN_HANDLE_NONE;
  quipus_ble_transfer_clear(&s_transfer);
  portENTER_CRITICAL(&s_lock);
  memset(s_pin, 0, sizeof(s_pin));
  portEXIT_CRITICAL(&s_lock);
  return ESP_OK;
}

void lantern_bluetooth_close(void) {
  // Cloud pairing ends provisioning. Release controller/host memory before
  // microphone streaming and Agora start; the Wi-Fi fallback stays available.
  (void)stop_host();
}

esp_err_t lantern_bluetooth_forget_bonds(void) {
  if (busy()) return ESP_ERR_INVALID_STATE;
  esp_err_t result = stop_host();
  if (result != ESP_OK) return result;
  // A GATT write may have queued a save just before admission closed. Never
  // erase settings while that worker could still write old credentials back.
  if (busy()) return ESP_ERR_INVALID_STATE;
  // ESP-IDF 5.2 NimBLE persists peer keys, CCCDs and identity keys exclusively
  // here. The stopped host cannot repopulate the namespace, and its next
  // prepare() reloads an empty store. Do not initialize BLE just to clear it,
  // nor erase the NVS partition: quipus_keys may be the sole SD archive key.
  nvs_handle_t handle;
  result = nvs_open("nimble_bond", NVS_READWRITE, &handle);
  if (result == ESP_ERR_NVS_NOT_FOUND) return ESP_OK;
  if (result != ESP_OK) return result;
  result = nvs_erase_all(handle);
  if (result == ESP_OK) result = nvs_commit(handle);
  nvs_close(handle);
  if (result == ESP_OK) {
    state("ready", NULL);
    portENTER_CRITICAL(&s_lock);
    memset(s_networks, 0, sizeof(s_networks));
    s_network_count = 0;
    portEXIT_CRITICAL(&s_lock);
  }
  return result;
}
#else
esp_err_t lantern_bluetooth_prepare(void) { return ESP_OK; }
esp_err_t lantern_bluetooth_start(void) { return ESP_OK; }
void lantern_bluetooth_close(void) {}
esp_err_t lantern_bluetooth_forget_bonds(void) { return ESP_OK; }
void lantern_bluetooth_passkey(char output[7]) { output[0] = '\0'; }
#endif
