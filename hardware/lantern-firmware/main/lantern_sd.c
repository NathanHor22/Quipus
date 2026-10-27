#include "lantern_sd.h"
#include "quipus_report_cache.h"
#include "cJSON.h"
#include "driver/sdmmc_host.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_vfs_fat.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/stream_buffer.h"
#include "freertos/task.h"
#include "lantern_board.h"
#include "nvs.h"
#include "sdmmc_cmd.h"
#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#if LANTERN_HAS_SD_CARD
#if CONFIG_FATFS_LFN_NONE
#error "Quipus SD report-cache paths require FATFS_LFN_HEAP (see this board sdkconfig defaults)."
#endif
#define SD_MOUNT_POINT "/sdcard"
#define SD_RECORDING_DIRECTORY SD_MOUNT_POINT "/lantern"
#define SD_WRITE_BUFFER_BYTES (128 * 1024)
#define SD_WRITE_BLOCK_BYTES (16 * 1024)
#define MANIFEST_JSON_BYTES 4096
#define SD_RETENTION_SECONDS INT64_C(86400)
#define SD_CLOCK_MIN INT64_C(1735689600)
#define SD_CLOCK_MAX INT64_C(4102444800)
static const char *TAG = "lantern_sd";
static lantern_sd_status_t s_status;
static sdmmc_card_t *s_card;
static quipus_archive_writer_t *s_file, *s_phone_file;
static char s_temporary_path[96], s_recording_path[96], s_manifest_path[96],
    s_phone_path[96], s_phone_temporary[96];
static char s_recording_session_id[37], s_owner_id[37], s_device_id[37],
    s_stem[9], s_captured_at[25], s_phone_timing[768];
static uint8_t s_archive_key[32];
static bool s_secure_ready, s_time_uncertain, s_cloud_stopped, s_audio_uploaded,
    s_phone_uploaded, s_finalized, s_verified;
static uint64_t s_sequence;
static int64_t s_first_verified_at, s_delete_after, s_retention_last_seen;
static bool s_retention_cleanup_started;
static DIR *s_retention_directory;
static DIR *s_factory_reset_directory;
static unsigned s_factory_reset_phase;
static bool s_factory_reset_blocked;
static _Atomic uint32_t s_upload_count_generation, s_upload_count_revision;
static _Atomic size_t s_upload_count_value;
static _Atomic TickType_t s_upload_count_checked_at;
static atomic_bool s_upload_count_valid;
static void invalidate_upload_count(void) {
  atomic_fetch_add_explicit(&s_upload_count_generation, 1, memory_order_release);
}

static lantern_cloud_session_t s_session, s_prepared_session;
static size_t s_pcm_bytes, s_recording_bytes, s_phone_bytes;
static volatile bool s_accepting, s_finish_requested, s_writer_failed;
static volatile bool s_phone_finishing;
// The microphone producer and SD task can fail independently. Keep the first
// error until the next recording/recovery so a later failure cannot hide it.
static _Atomic esp_err_t s_recording_error = ESP_OK;
static uint8_t *s_write_block;
static StreamBufferHandle_t s_write_stream;
static StaticStreamBuffer_t s_write_stream_state;
static uint8_t *s_write_stream_storage;
static SemaphoreHandle_t s_writer_finished;
static TaskHandle_t s_writer_task;
static esp_err_t ensure_writer(void);
static esp_err_t write_manifest(void);

static void recording_failed(esp_err_t error) {
  esp_err_t expected = ESP_OK;
  if (error == ESP_OK)
    error = ESP_FAIL;
  atomic_compare_exchange_strong_explicit(&s_recording_error, &expected, error,
                                          memory_order_relaxed,
                                          memory_order_relaxed);
  s_accepting = false;
  s_writer_failed = true;
}

static bool valid_id(const char *value) {
  if (!value || strlen(value) != 36)
    return false;
  for (size_t i = 0; i < 36; ++i)
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (value[i] != '-')
        return false;
    } else if (!isxdigit((unsigned char)value[i]))
      return false;
  return true;
}
static void refresh_space(void) {
  uint64_t bytes = 0;
  if (s_status.mounted &&
      esp_vfs_fat_info(SD_MOUNT_POINT, &bytes, &s_status.free_bytes) ==
          ESP_OK &&
      bytes)
    s_status.capacity_bytes = bytes;
}
static void close_active_file(void) {
  if (s_file)
    quipus_archive_abort(s_file);
  s_file = NULL;
  if (s_phone_file)
    quipus_archive_abort(s_phone_file);
  s_phone_file = NULL;
}
static void unmount_card(void) {
  quipus_report_cache_detach();
  if (s_factory_reset_directory) closedir(s_factory_reset_directory);
  s_factory_reset_directory = NULL;
  s_factory_reset_phase = 0;
  s_factory_reset_blocked = false;
  invalidate_upload_count();
  if (s_retention_directory) {
    closedir(s_retention_directory);
    s_retention_directory = NULL;
  }
  close_active_file();
  if (s_status.mounted && s_card)
    esp_vfs_fat_sdcard_unmount(SD_MOUNT_POINT, s_card);
  s_card = NULL;
  s_status.mounted = false;
}
static void paths_for_stem(const char *stem) {
  snprintf(s_stem, sizeof(s_stem), "%s", stem);
  snprintf(s_temporary_path, sizeof(s_temporary_path),
           SD_RECORDING_DIRECTORY "/%s.tmp", stem);
  snprintf(s_recording_path, sizeof(s_recording_path),
           SD_RECORDING_DIRECTORY "/%s.qpa", stem);
  snprintf(s_manifest_path, sizeof(s_manifest_path),
           SD_RECORDING_DIRECTORY "/%s.qpm", stem);
  snprintf(s_phone_path, sizeof(s_phone_path), SD_RECORDING_DIRECTORY "/%s.qpb",
           stem);
  snprintf(s_phone_temporary, sizeof(s_phone_temporary),
           SD_RECORDING_DIRECTORY "/%s.qpt", stem);
}
static esp_err_t pending_marker(const char *stem, const char *session,
                                bool verified, bool remove_marker) {
  char key[12], value[48];
  snprintf(key, sizeof(key), "p%s", stem);
  nvs_handle_t handle;
  esp_err_t result = nvs_open("quipus_keys", NVS_READWRITE, &handle);
  if (result != ESP_OK)
    return result;
  if (remove_marker) {
    result = nvs_erase_key(handle, key);
    if (result == ESP_ERR_NVS_NOT_FOUND)
      result = ESP_OK;
  } else {
    snprintf(value, sizeof(value), "%c:%s", verified ? 'v' : 'p', session);
    if (!verified) {
      char prior[48];
      size_t length = sizeof(prior);
      esp_err_t found = nvs_get_str(handle, key, prior, &length);
      if (found == ESP_OK && strcmp(prior, value)) {
        nvs_close(handle);
        return ESP_ERR_INVALID_STATE;
      }
      if (found != ESP_OK && found != ESP_ERR_NVS_NOT_FOUND) {
        nvs_close(handle);
        return found;
      }
    }
    result = nvs_set_str(handle, key, value);
  }
  if (result == ESP_OK)
    result = nvs_commit(handle);
  nvs_close(handle);
  return result;
}
static bool stem_has_files(const char *stem) {
  static const char *extensions[] = {"qpm", "qpc", "qpa", "qpb", "qpt", "tmp", "qpx"};
  for (size_t i = 0; i < sizeof(extensions) / sizeof(extensions[0]); ++i) {
    char path[96];
    snprintf(path, sizeof(path), SD_RECORDING_DIRECTORY "/%.8s.%s", stem,
             extensions[i]);
    if (access(path, F_OK) == 0)
      return true;
  }
  return false;
}
static size_t pending_marker_count(void) {
  nvs_iterator_t iterator = NULL;
  // Never mutate NVS while its iterator is live. A bounded cleanup batch keeps
  // recovery memory independent of the number of captured meetings.
  char removable[8][9];
  size_t removable_count = 0, count = 0;
  esp_err_t result =
      nvs_entry_find("nvs", "quipus_keys", NVS_TYPE_STR, &iterator);
  while (result == ESP_OK) {
    nvs_entry_info_t info;
    if (nvs_entry_info(iterator, &info) != ESP_OK) {
      count++;
      break;
    }
    if (info.key[0] == 'p' && strlen(info.key) == 9) {
      count++;
      // Only trusted proof of backend verification permits completing a torn
      // deletion. An absent/swapped SD card cannot erase an unverified marker.
      bool clean = false;
      nvs_handle_t handle;
      if (s_status.mounted && removable_count < 8 &&
          nvs_open("quipus_keys", NVS_READONLY, &handle) == ESP_OK) {
        char value[48];
        size_t length = sizeof(value);
        if (nvs_get_str(handle, info.key, value, &length) == ESP_OK &&
            strncmp(value, "v:", 2) == 0 && strlen(value) == 38 &&
            !stem_has_files(info.key + 1))
          clean = true;
        nvs_close(handle);
      }
      if (clean)
        memcpy(removable[removable_count++], info.key + 1, 9);
    }
    result = nvs_entry_next(&iterator);
  }
  nvs_release_iterator(iterator);
  // An unreadable trusted journal is not evidence of an empty queue.
  if (result != ESP_OK && result != ESP_ERR_NVS_NOT_FOUND)
    count++;
  for (size_t i = 0; i < removable_count; ++i) {
    if (pending_marker(removable[i], "", true, true) == ESP_OK)
      count--;
  }
  return count;
}
static esp_err_t next_sequence(uint64_t *sequence) {
  nvs_handle_t h;
  esp_err_t result = nvs_open("quipus_keys", NVS_READWRITE, &h);
  if (result != ESP_OK)
    return result;
  uint64_t previous = 0;
  result = nvs_get_u64(h, "sequence", &previous);
  if (result == ESP_ERR_NVS_NOT_FOUND)
    result = ESP_OK;
  if (result == ESP_OK && previous < UINT64_MAX) {
    *sequence = previous + 1;
    result = nvs_set_u64(h, "sequence", *sequence);
  } else
    result = ESP_FAIL;
  if (result == ESP_OK)
    result = nvs_commit(h);
  nvs_close(h);
  return result;
}
static esp_err_t mount_card(void) {
  if (s_status.mounted) {
    refresh_space();
    // A previous task/buffer allocation can fail after the card mounts. Do not
    // report a usable recorder until the bounded writer is ready as well.
    return ensure_writer();
  }

  sdmmc_host_t host = SDMMC_HOST_DEFAULT();
  // One-bit SDIO at 10 MHz is well above Lantern's 32 KB/s PCM stream and
  // leaves generous signal margin on the integrated prototype slot.
  host.max_freq_khz = 10000;
  sdmmc_slot_config_t slot = SDMMC_SLOT_CONFIG_DEFAULT();
  slot.width = 1;
  slot.clk = LANTERN_SD_CLK_GPIO;
  slot.cmd = LANTERN_SD_CMD_GPIO;
  slot.d0 = LANTERN_SD_D0_GPIO;
  slot.flags |= SDMMC_SLOT_FLAG_INTERNAL_PULLUP;
  const esp_vfs_fat_mount_config_t mount = {
      .format_if_mount_failed = false,
      .max_files = 8,
      .allocation_unit_size = 64 * 1024,
      .disk_status_check_enable = true,
  };

  esp_err_t result =
      esp_vfs_fat_sdmmc_mount(SD_MOUNT_POINT, &host, &slot, &mount, &s_card);
  if (result != ESP_OK) {
    memset(&s_status, 0, sizeof(s_status));
    ESP_LOGW(TAG,
             "microSD could not be mounted (%s); use a FAT32 card, existing "
             "data was not changed",
             esp_err_to_name(result));
    return result;
  }

  s_status.present = true;
  s_status.mounted = true;
  if (s_secure_ready)
    (void)quipus_report_cache_configure(SD_MOUNT_POINT "/quipus-reports",
                                        s_archive_key, s_owner_id, s_device_id);
  invalidate_upload_count();
  s_status.sector_size = s_card->csd.sector_size;
  s_status.capacity_bytes =
      (uint64_t)s_card->csd.capacity * (uint64_t)s_card->csd.sector_size;
  snprintf(s_status.name, sizeof(s_status.name), "%s", s_card->cid.name);
  refresh_space();
  if (mkdir(SD_RECORDING_DIRECTORY, 0775) != 0 && errno != EEXIST) {
    ESP_LOGE(TAG, "could not create %s: errno=%d", SD_RECORDING_DIRECTORY,
             errno);
    unmount_card();
    return ESP_FAIL;
  }
  ESP_RETURN_ON_ERROR(ensure_writer(), TAG, "SD writer");
  ESP_LOGI(TAG, "microSD mounted name=%s capacity=%llu MiB free=%llu MiB",
           s_status.name[0] ? s_status.name : "unknown",
           s_status.capacity_bytes / (1024ULL * 1024ULL),
           s_status.free_bytes / (1024ULL * 1024ULL));

  return ESP_OK;
}

static bool add_session(cJSON *json, const lantern_cloud_session_t *session) {
#define SAVE_FIELD(name) do { if (!cJSON_AddStringToObject(json, #name, session->name)) return false; } while (0)
  SAVE_FIELD(session_id);
  SAVE_FIELD(prompt_id);
  SAVE_FIELD(begin_event_id);
  SAVE_FIELD(consent_event_id);
  SAVE_FIELD(capture_event_id);
  SAVE_FIELD(stop_event_id);
  SAVE_FIELD(transcript_event_id);
  SAVE_FIELD(audio_event_id);
  SAVE_FIELD(completion_event_id);
  SAVE_FIELD(phone_event_id);
  SAVE_FIELD(owner_id);
  SAVE_FIELD(local_date);
  SAVE_FIELD(local_time);
#undef SAVE_FIELD
  return cJSON_AddNumberToObject(json, "version", session->version) &&
         cJSON_AddBoolToObject(json, "offline_local", session->offline_local) &&
         cJSON_AddBoolToObject(json, "discarded", session->discarded);
}
static bool json_string(cJSON *json, const char *name, char *out, size_t size,
                        bool required) {
  cJSON *item = cJSON_GetObjectItemCaseSensitive(json, name);
  if (!cJSON_IsString(item) || strlen(item->valuestring) >= size)
    return !required;
  snprintf(out, size, "%s", item->valuestring);
  return true;
}
static bool read_session(cJSON *json, lantern_cloud_session_t *session) {
  memset(session, 0, sizeof(*session));
#define LOAD_FIELD(name)                                                       \
  if (!json_string(json, #name, session->name, sizeof(session->name), true))   \
  return false
  LOAD_FIELD(session_id);
  LOAD_FIELD(prompt_id);
  LOAD_FIELD(begin_event_id);
  LOAD_FIELD(consent_event_id);
  LOAD_FIELD(capture_event_id);
  LOAD_FIELD(stop_event_id);
  LOAD_FIELD(transcript_event_id);
  LOAD_FIELD(audio_event_id);
  LOAD_FIELD(completion_event_id);
  LOAD_FIELD(phone_event_id);
  LOAD_FIELD(owner_id);
  LOAD_FIELD(local_date);
  LOAD_FIELD(local_time);
#undef LOAD_FIELD
  cJSON *version = cJSON_GetObjectItemCaseSensitive(json, "version");
  if (!cJSON_IsNumber(version) || version->valuedouble < 0 ||
      version->valuedouble > UINT32_MAX)
    return false;
  session->version = (unsigned)version->valuedouble;
  session->offline_local =
      cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json, "offline_local"));
  // Optional for manifests created before the verified-discard receipt existed.
  session->discarded = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json, "discarded"));
  return valid_id(session->session_id) && valid_id(session->owner_id);
}
static bool retention_clock_valid(int64_t now) {
  return now >= SD_CLOCK_MIN && now <= SD_CLOCK_MAX - SD_RETENTION_SECONDS;
}

static bool retention_fields(cJSON *json, int64_t *first, int64_t *after,
                             int64_t *seen) {
  cJSON *a = cJSON_GetObjectItemCaseSensitive(json, "firstVerifiedAt");
  cJSON *b = cJSON_GetObjectItemCaseSensitive(json, "deleteAfter");
  cJSON *c = cJSON_GetObjectItemCaseSensitive(json, "retentionLastSeenAt");
  *first = *after = *seen = 0;
  if (!a && !b && !c) return true; // Legacy proof: no known deletion deadline.
  if (!cJSON_IsNumber(a) || !cJSON_IsNumber(b) || !cJSON_IsNumber(c) ||
      !isfinite(a->valuedouble) || !isfinite(b->valuedouble) ||
      !isfinite(c->valuedouble) || a->valuedouble < 0 ||
      a->valuedouble > SD_CLOCK_MAX || b->valuedouble < 0 ||
      b->valuedouble > SD_CLOCK_MAX || c->valuedouble < 0 ||
      c->valuedouble > SD_CLOCK_MAX)
    return false;
  *first = (int64_t)a->valuedouble;
  *after = (int64_t)b->valuedouble;
  *seen = (int64_t)c->valuedouble;
  if ((double)*first != a->valuedouble || (double)*after != b->valuedouble ||
      (double)*seen != c->valuedouble) return false;
  if (!*first && !*after && !*seen) return true;
  return retention_clock_valid(*first) &&
         *after == *first + SD_RETENTION_SECONDS && *seen >= *first;
}

static bool retention_set_fields(cJSON *json, int64_t first, int64_t after,
                                 int64_t seen, bool cleaning) {
  static const char *names[] = {"firstVerifiedAt", "deleteAfter",
                                "retentionLastSeenAt", "cleanupStarted"};
  for (size_t i = 0; i < sizeof(names) / sizeof(names[0]); ++i)
    cJSON_DeleteItemFromObjectCaseSensitive(json, names[i]);
  return cJSON_AddNumberToObject(json, "firstVerifiedAt", (double)first) &&
         cJSON_AddNumberToObject(json, "deleteAfter", (double)after) &&
         cJSON_AddNumberToObject(json, "retentionLastSeenAt", (double)seen) &&
         cJSON_AddBoolToObject(json, "cleanupStarted", cleaning);
}

// A separate extension makes verified retained audio independent of uploads.
static esp_err_t retain_verified_manifest(const char *stem, const char *from) {
  char cached[96];
  snprintf(cached, sizeof(cached), SD_RECORDING_DIRECTORY "/%s.qpc", stem);
  if (!strcmp(from, cached)) return ESP_OK;
  if (access(cached, F_OK) == 0) return ESP_ERR_INVALID_STATE;
  if (rename(from, cached) != 0) return ESP_FAIL;
  invalidate_upload_count();
  return ESP_OK;
}

static esp_err_t write_manifest(void) {
  if (!s_secure_ready || !s_manifest_path[0])
    return ESP_ERR_INVALID_STATE;
  cJSON *json = cJSON_CreateObject(), *session = cJSON_CreateObject();
  if (!json || !session) {
    cJSON_Delete(json);
    cJSON_Delete(session);
    return ESP_ERR_NO_MEM;
  }
  if (!add_session(session, &s_session) ||
      !cJSON_AddItemToObject(json, "session", session)) {
    cJSON_Delete(json);
    cJSON_Delete(session);
    return ESP_ERR_NO_MEM;
  }
  // A partial authenticated snapshot could strand audio after reboot. Fail
  // before appending if any field allocation fails, retaining the prior entry.
  if (!cJSON_AddNumberToObject(json, "format", 1) ||
      !cJSON_AddStringToObject(json, "owner", s_owner_id) ||
      !cJSON_AddStringToObject(json, "device", s_device_id) ||
      !cJSON_AddStringToObject(json, "capturedAt", s_captured_at) ||
      !cJSON_AddBoolToObject(json, "timeUncertain", s_time_uncertain) ||
      !cJSON_AddNumberToObject(json, "sequence", (double)s_sequence) ||
      !cJSON_AddNumberToObject(json, "audioBytes", s_recording_bytes) ||
      !cJSON_AddNumberToObject(json, "phoneBytes", s_phone_bytes) ||
      !cJSON_AddStringToObject(json, "phoneTiming", s_phone_timing) ||
      !cJSON_AddBoolToObject(json, "finalized", s_finalized) ||
      !cJSON_AddBoolToObject(json, "verified", s_verified) ||
      !cJSON_AddBoolToObject(json, "cloudStopped", s_cloud_stopped) ||
      !cJSON_AddBoolToObject(json, "audioUploaded", s_audio_uploaded) ||
      !cJSON_AddBoolToObject(json, "phoneUploaded", s_phone_uploaded) ||
      !retention_set_fields(json, s_first_verified_at, s_delete_after,
                             s_retention_last_seen, s_retention_cleanup_started)) {
    cJSON_Delete(json);
    return ESP_ERR_NO_MEM;
  }
  char *text = cJSON_PrintUnformatted(json);
  cJSON_Delete(json);
  if (!text)
    return ESP_ERR_NO_MEM;
  esp_err_t result =
      quipus_archive_journal_append(s_manifest_path, s_archive_key, text);
  free(text);
  if (result == ESP_OK) invalidate_upload_count();
  return result;
}
static cJSON *load_manifest(const char *path) {
  char *text = heap_caps_malloc(MANIFEST_JSON_BYTES + 1,
                                MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!text)
    return NULL;
  esp_err_t result = quipus_archive_journal_read(path, s_archive_key, text,
                                                 MANIFEST_JSON_BYTES + 1);
  cJSON *json = result == ESP_OK ? cJSON_Parse(text) : NULL;
  memset(text, 0, MANIFEST_JSON_BYTES + 1);
  free(text);
  char owner[37] = {0}, device[37] = {0};
  cJSON *format =
      json ? cJSON_GetObjectItemCaseSensitive(json, "format") : NULL;
  if (!json || !cJSON_IsNumber(format) || format->valueint != 1 ||
      !json_string(json, "owner", owner, sizeof(owner), true) ||
      strcmp(owner, s_owner_id) ||
      !json_string(json, "device", device, sizeof(device), true) ||
      strcmp(device, s_device_id)) {
    cJSON_Delete(json);
    return NULL;
  }
  return json;
}
static bool manifest_name(const char *name, char stem[9]) {
  if (!name || strlen(name) != 12 || strcasecmp(name + 8, ".qpm"))
    return false;
  for (size_t i = 0; i < 8; ++i)
    if (!isxdigit((unsigned char)name[i]))
      return false;
  memcpy(stem, name, 8);
  stem[8] = 0;
  return true;
}
static bool activate_manifest(cJSON *json, const char *stem) {
  lantern_cloud_session_t session;
  if (!read_session(cJSON_GetObjectItemCaseSensitive(json, "session"),
                    &session))
    return false;
  cJSON *seq = cJSON_GetObjectItemCaseSensitive(json, "sequence"),
        *audio = cJSON_GetObjectItemCaseSensitive(json, "audioBytes"),
        *phone = cJSON_GetObjectItemCaseSensitive(json, "phoneBytes");
  if (!cJSON_IsNumber(seq) || !isfinite(seq->valuedouble) ||
      seq->valuedouble < 1 || seq->valuedouble > 9007199254740991.0 ||
      !cJSON_IsNumber(audio) || !isfinite(audio->valuedouble) ||
      audio->valuedouble < 0 || audio->valuedouble > 268435456 ||
      !cJSON_IsNumber(phone) || !isfinite(phone->valuedouble) ||
      phone->valuedouble < 0 || phone->valuedouble > 268435456)
    return false;
  int64_t first, after, seen;
  if (!retention_fields(json, &first, &after, &seen) ||
      (first && !cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json, "verified"))))
    return false;
  paths_for_stem(stem);
  s_first_verified_at = first;
  s_delete_after = after;
  s_retention_last_seen = seen;
  s_retention_cleanup_started = cJSON_IsTrue(
      cJSON_GetObjectItemCaseSensitive(json, "cleanupStarted"));
  s_session = session;
  s_sequence = (uint64_t)seq->valuedouble;
  s_recording_bytes = (size_t)audio->valuedouble;
  s_phone_bytes = (size_t)phone->valuedouble;
  snprintf(s_recording_session_id, sizeof(s_recording_session_id), "%s",
           session.session_id);
  s_finalized =
      cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json, "finalized"));
  s_verified = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json, "verified"));
  if (s_verified && access(s_manifest_path, F_OK) != 0) {
    char cached[96];
    snprintf(cached, sizeof(cached), SD_RECORDING_DIRECTORY "/%s.qpc", stem);
    if (access(cached, F_OK) == 0)
      snprintf(s_manifest_path, sizeof(s_manifest_path), "%s", cached);
  }
  s_cloud_stopped =
      cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json, "cloudStopped"));
  s_audio_uploaded =
      cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json, "audioUploaded"));
  s_phone_uploaded =
      cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json, "phoneUploaded"));
  s_time_uncertain =
      cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json, "timeUncertain"));
  s_captured_at[0] = 0;
  s_phone_timing[0] = 0;
  json_string(json, "capturedAt", s_captured_at, sizeof(s_captured_at), false);
  json_string(json, "phoneTiming", s_phone_timing, sizeof(s_phone_timing),
              false);
  return true;
}
static esp_err_t normalize_recovered_phone_timing(void) {
  if (s_phone_bytes <= 44)
    return ESP_OK;
  cJSON *timing = cJSON_Parse(s_phone_timing);
  // cJSON does not distinguish malformed input from parse allocation failure.
  // Leave an ambiguous parse failure queued; never quarantine on possible OOM.
  if (!timing)
    return ESP_ERR_NO_MEM;
  if (!cJSON_IsObject(timing)) {
    cJSON_Delete(timing);
    return ESP_ERR_INVALID_ARG;
  }
  cJSON_DeleteItemFromObjectCaseSensitive(timing, "receivedSamples");
  if (!cJSON_AddNumberToObject(timing, "receivedSamples",
                              (s_phone_bytes - 44) / 2)) {
    cJSON_Delete(timing);
    return ESP_ERR_NO_MEM;
  }
  cJSON *missing = cJSON_GetObjectItemCaseSensitive(timing, "missingSamples");
  if (cJSON_IsNumber(missing) &&
      missing->valuedouble > (s_phone_bytes - 44) / 2)
    cJSON_SetNumberValue(missing, (s_phone_bytes - 44) / 2);
  cJSON_DeleteItemFromObjectCaseSensitive(timing, "recovered");
  if (!cJSON_AddBoolToObject(timing, "recovered", true)) {
    cJSON_Delete(timing);
    return ESP_ERR_NO_MEM;
  }
  char *text = cJSON_PrintUnformatted(timing);
  cJSON_Delete(timing);
  if (!text)
    return ESP_ERR_NO_MEM;
  bool valid = strlen(text) < sizeof(s_phone_timing);
  if (valid)
    snprintf(s_phone_timing, sizeof(s_phone_timing), "%s", text);
  free(text);
  return valid ? ESP_OK : ESP_ERR_INVALID_SIZE;
}
// Keep the authenticated metadata available for repair, but remove it from
// automatic selection. Neither encrypted track nor its protected pending marker
// is changed. Categories are fixed strings; logs never contain private IDs.
static void quarantine_manifest(const char *stem, const char *category) {
  char manifest[96], quarantined[96];
  snprintf(manifest, sizeof(manifest), SD_RECORDING_DIRECTORY "/%s.qpm", stem);
  snprintf(quarantined, sizeof(quarantined), SD_RECORDING_DIRECTORY "/%s.qpx",
           stem);
  const char *result = "already_present";
  // Never overwrite an earlier quarantine or discard either metadata copy.
  if (access(quarantined, F_OK) != 0)
    result = rename(manifest, quarantined) == 0 ? "preserved" : "rename_failed";
  if (!strcmp(result, "preserved")) invalidate_upload_count();
  ESP_LOGW(TAG, "SD queue quarantine category=%s result=%s", category, result);
}
static esp_err_t recover_track(const char *temporary, const char *finished,
                               bool phone, size_t *bytes) {
  const char *path = access(finished, F_OK) == 0 ? finished : temporary;
  if (access(path, F_OK) != 0) {
    if (phone) {
      *bytes = 0;
      return ESP_OK;
    }
    return ESP_ERR_NOT_FOUND;
  }
  if (phone && !*bytes) {
    struct stat info;
    if (stat(path, &info) == 0 && info.st_size <= QUIPUS_ARCHIVE_HEADER)
      return ESP_OK;
  }
  quipus_archive_reader_t *reader = NULL;
  esp_err_t result =
      quipus_archive_open(path, s_archive_key, s_session.session_id, s_owner_id,
                          s_device_id, phone ? 1 : 0, &reader);
  if (result != ESP_OK)
    return result;
  size_t recovered = quipus_archive_size(reader);
  quipus_archive_close(reader);
  if (*bytes && *bytes != recovered)
    return ESP_FAIL; // A finalized archive must never silently shrink.
  *bytes = recovered;
  if (path == temporary && rename(temporary, finished) != 0)
    return ESP_FAIL;
  return ESP_OK;
}

static bool retention_metadata_name(const char *name, char stem[9]) {
  if (manifest_name(name, stem)) return true;
  if (!name || strlen(name) != 12 || strcasecmp(name + 8, ".qpc")) return false;
  char pending[13];
  snprintf(pending, sizeof(pending), "%.8s.qpm", name);
  return manifest_name(pending, stem);
}

static esp_err_t retention_persist(const char *path, cJSON *json,
                                    const char *stem, int64_t first,
                                    int64_t after, int64_t seen, bool cleaning) {
  if (!retention_set_fields(json, first, after, seen, cleaning))
    return ESP_ERR_NO_MEM;
  char *text = cJSON_PrintUnformatted(json);
  if (!text) return ESP_ERR_NO_MEM;
  esp_err_t result = quipus_archive_journal_append(path, s_archive_key, text);
  free(text);
  if (result == ESP_OK && !strcmp(stem, s_stem)) {
    s_first_verified_at = first;
    s_delete_after = after;
    s_retention_last_seen = seen;
    s_retention_cleanup_started = cleaning;
  }
  return result;
}

static esp_err_t retention_cleanup_record(const char *stem, const char *path,
                                           cJSON *json, int64_t now,
                                           bool *removed) {
  *removed = false;
  if (!cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json, "verified")) ||
      !cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json, "finalized")))
    return ESP_OK;
  lantern_cloud_session_t session;
  int64_t first, after, seen;
  if (!read_session(cJSON_GetObjectItemCaseSensitive(json, "session"), &session) ||
      strcmp(session.owner_id, s_owner_id) ||
      !retention_fields(json, &first, &after, &seen))
    return ESP_ERR_INVALID_STATE;
  cJSON *audio_bytes = cJSON_GetObjectItemCaseSensitive(json, "audioBytes");
  cJSON *phone_bytes = cJSON_GetObjectItemCaseSensitive(json, "phoneBytes");
  cJSON *counts[] = {audio_bytes, phone_bytes};
  for (size_t i = 0; i < 2; ++i) {
    cJSON *count = counts[i];
    if (!cJSON_IsNumber(count) || !isfinite(count->valuedouble) ||
        count->valuedouble < 0 || count->valuedouble > 268435456)
      return ESP_ERR_INVALID_STATE;
    uint64_t bytes = (uint64_t)count->valuedouble;
    if ((double)bytes != count->valuedouble ||
        (i == 0 && bytes <= 44) ||
        (i == 1 && bytes > 0 && bytes <= 44) ||
        (bytes > 44 && (bytes - 44) % sizeof(int16_t)))
      return ESP_ERR_INVALID_STATE;
  }
  esp_err_t result = retain_verified_manifest(stem, path);
  if (result != ESP_OK) return result;
  char cached[96];
  snprintf(cached, sizeof(cached), SD_RECORDING_DIRECTORY "/%s.qpc", stem);
  if (!strcmp(stem, s_stem))
    snprintf(s_manifest_path, sizeof(s_manifest_path), "%s", cached);
  if (!first) {
    // Unknown/legacy verification time cannot justify earlier deletion.
    return retention_persist(cached, json, stem, now,
                              now + SD_RETENTION_SECONDS, now, false);
  }
  // Authenticated last-seen time survives reboot and protects rollback clocks.
  if (now < first || now < seen) return ESP_OK;
  if (now < after) {
    if (now - seen >= 3600)
      return retention_persist(cached, json, stem, first, after, now, false);
    return ESP_OK;
  }
  char quarantine[96], pending[96], tracks[4][96];
  snprintf(quarantine, sizeof(quarantine), SD_RECORDING_DIRECTORY "/%s.qpx", stem);
  snprintf(pending, sizeof(pending), SD_RECORDING_DIRECTORY "/%s.qpm", stem);
  // Conflicting metadata/recovery evidence is never removed by expiry.
  if (access(quarantine, F_OK) == 0 || access(pending, F_OK) == 0)
    return ESP_ERR_INVALID_STATE;
  static const char *extensions[] = {"qpa", "qpb", "tmp", "qpt"};
  for (size_t i = 0; i < 4; ++i)
    snprintf(tracks[i], sizeof(tracks[i]), SD_RECORDING_DIRECTORY "/%s.%s",
             stem, extensions[i]);
  // A nonempty unsealed track is additional unverified recovery evidence.
  for (size_t i = 2; i < 4; ++i) {
    struct stat info;
    if (stat(tracks[i], &info) == 0) {
      if (info.st_size > QUIPUS_ARCHIVE_HEADER) return ESP_ERR_INVALID_STATE;
    } else if (errno != ENOENT) return ESP_FAIL;
  }
  if (phone_bytes->valuedouble <= 44) {
    struct stat info;
    if (stat(tracks[1], &info) == 0) {
      if (info.st_size > QUIPUS_ARCHIVE_HEADER) return ESP_ERR_INVALID_STATE;
    } else if (errno != ENOENT) return ESP_FAIL;
  }
  // Journal the due deletion before changing files; each removal is idempotent.
  result = retention_persist(cached, json, stem, first, after, now, true);
  if (result != ESP_OK ||
      pending_marker(stem, session.session_id, true, false) != ESP_OK)
    return ESP_FAIL;
  for (size_t i = 0; i < 4; ++i)
    if (remove(tracks[i]) != 0 && errno != ENOENT) return ESP_FAIL;
  if (remove(cached) != 0 && errno != ENOENT) return ESP_FAIL;
  if (pending_marker(stem, session.session_id, true, true) != ESP_OK)
    return ESP_FAIL;
  if (!strcmp(stem, s_stem)) {
    s_recording_bytes = s_phone_bytes = 0;
    s_recording_path[0] = s_manifest_path[0] = s_recording_session_id[0] = 0;
  }
  *removed = true;
  invalidate_upload_count();
  refresh_space();
  return ESP_OK;
}

static void finish_file(void) {
  esp_err_t result = ESP_FAIL;
  // A producer overflow does not corrupt PCM already accepted by the writer.
  // Flush its remaining authenticated block when possible. The archive writer
  // itself refuses to seal after an I/O failure, retaining its recoverable prefix.
  if (s_file)
    result = quipus_archive_finish(s_file, &s_pcm_bytes);
  s_file = NULL;
  if (result == ESP_OK && rename(s_temporary_path, s_recording_path) != 0)
    result = ESP_FAIL;
  if (result == ESP_OK) {
    s_recording_bytes = 44 + s_pcm_bytes;
    s_finalized = true;
    result = write_manifest();
  }
  if (result != ESP_OK) {
    recording_failed(result);
    s_recording_bytes = 0;
    ESP_LOGE(TAG, "Encrypted recording retained for recovery");
  }
  refresh_space();
  s_finish_requested = false;
  xSemaphoreGive(s_writer_finished);
}
static void writer_task(void *argument) {
  (void)argument;
  // Allocated before task creation: recording_begin must never succeed with
  // a writer that immediately exits because its working buffer is unavailable.
  uint8_t *const block = s_write_block;
  while (true) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    while (s_file) {
      size_t n = xStreamBufferReceive(s_write_stream, block,
                                      SD_WRITE_BLOCK_BYTES, pdMS_TO_TICKS(100));
      if (n) {
        esp_err_t result = quipus_archive_append(s_file, block, n);
        if (result != ESP_OK)
          recording_failed(result);
      }
      if (s_finish_requested &&
          xStreamBufferBytesAvailable(s_write_stream) == 0) {
        finish_file();
        break;
      }
      if (!n && !s_finish_requested)
        break;
    }
  }
}
static esp_err_t ensure_writer(void) {
  if (s_writer_task)
    return ESP_OK;
  // Retain at most one allocation of each bounded resource across retries.
  // A partially successful initialization must not leak a second buffer/task.
  if (!s_write_stream_storage)
    s_write_stream_storage = heap_caps_malloc(
        SD_WRITE_BUFFER_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!s_write_block)
    s_write_block = heap_caps_malloc(SD_WRITE_BLOCK_BYTES,
                                     MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!s_writer_finished)
    s_writer_finished = xSemaphoreCreateBinary();
  if (!s_write_stream_storage || !s_write_block || !s_writer_finished)
    return ESP_ERR_NO_MEM;
  if (!s_write_stream)
    s_write_stream = xStreamBufferCreateStatic(
        SD_WRITE_BUFFER_BYTES, 1, s_write_stream_storage, &s_write_stream_state);
  if (!s_write_stream)
    return ESP_ERR_NO_MEM;
  if (xTaskCreatePinnedToCore(writer_task, "lantern_sd_write", 4096, NULL, 5,
                              &s_writer_task, 0) != pdPASS) {
    s_writer_task = NULL;
    return ESP_ERR_NO_MEM;
  }
  return ESP_OK;
}
#endif
esp_err_t lantern_sd_init(lantern_sd_status_t *status) {
#if LANTERN_HAS_SD_CARD
  invalidate_upload_count();
  esp_err_t result = mount_card();
  if (status)
    *status = s_status;
  return result;
#else
  if (status)
    memset(status, 0, sizeof(*status));
  return ESP_ERR_NOT_SUPPORTED;
#endif
}
lantern_sd_change_t lantern_sd_poll(void) {
#if LANTERN_HAS_SD_CARD
  if (s_file || s_phone_file || s_accepting || s_finish_requested)
    return LANTERN_SD_UNCHANGED;
  if (s_status.mounted) {
    if (s_card && sdmmc_get_status(s_card) == ESP_OK)
      return LANTERN_SD_UNCHANGED;
    ESP_LOGW(TAG, "microSD removed; recordings stay on that card");
    unmount_card();
    memset(&s_status, 0, sizeof(s_status));
    return LANTERN_SD_REMOVED;
  }
  // An empty slot fails every probe; keep the driver's per-attempt errors
  // out of the log, and report only the outcome.
  const char *const quiet[] = {"sdmmc_common", "sdmmc_sd", "sdmmc_init",
                                      "vfs_fat_sdmmc", "diskio_sdmmc", TAG};
  esp_log_level_t previous[sizeof(quiet) / sizeof(quiet[0])];
  for (size_t i = 0; i < sizeof(quiet) / sizeof(quiet[0]); ++i) {
    previous[i] = esp_log_level_get(quiet[i]);
    esp_log_level_set(quiet[i], ESP_LOG_NONE);
  }
  invalidate_upload_count();
  esp_err_t mounted = mount_card();
  for (size_t i = 0; i < sizeof(quiet) / sizeof(quiet[0]); ++i)
    esp_log_level_set(quiet[i], previous[i]);
  if (mounted != ESP_OK) return LANTERN_SD_UNCHANGED;
  ESP_LOGI(TAG, "microSD inserted name=%s capacity=%llu MiB free=%llu MiB",
           s_status.name[0] ? s_status.name : "unknown",
           s_status.capacity_bytes / (1024ULL * 1024ULL),
           s_status.free_bytes / (1024ULL * 1024ULL));
  return LANTERN_SD_INSERTED;
#else
  return LANTERN_SD_UNCHANGED;
#endif
}

void lantern_sd_get_status(lantern_sd_status_t *status) {
  if (!status)
    return;
#if LANTERN_HAS_SD_CARD
  refresh_space();
  *status = s_status;
#else
  memset(status, 0, sizeof(*status));
#endif
}
esp_err_t lantern_sd_configure_identity(const char *owner, const char *device,
                                        const uint8_t key[32]) {
#if LANTERN_HAS_SD_CARD
  if (!valid_id(owner) || !valid_id(device) || !key || s_file || s_phone_file)
    return ESP_ERR_INVALID_ARG;
  if (s_retention_directory) {
    closedir(s_retention_directory);
    s_retention_directory = NULL;
  }
  invalidate_upload_count();
  snprintf(s_owner_id, sizeof(s_owner_id), "%s", owner);
  snprintf(s_device_id, sizeof(s_device_id), "%s", device);
  memcpy(s_archive_key, key, 32);
  (void)quipus_report_cache_configure(SD_MOUNT_POINT "/quipus-reports",
                                      key, owner, device);
  s_secure_ready = true;
  return ESP_OK;
#else
  (void)owner;
  (void)device;
  (void)key;
  return ESP_ERR_NOT_SUPPORTED;
#endif
}
bool lantern_sd_secure_ready(void) {
#if LANTERN_HAS_SD_CARD
  return s_secure_ready && s_status.mounted;
#else
  return false;
#endif
}
void lantern_sd_set_session(const lantern_cloud_session_t *session) {
#if LANTERN_HAS_SD_CARD
  if (session)
    s_prepared_session = *session;
#else
  (void)session;
#endif
}
esp_err_t lantern_sd_recording_begin(const char *session_id) {
#if LANTERN_HAS_SD_CARD
  invalidate_upload_count();
  if (!s_secure_ready || !valid_id(session_id) ||
      strcmp(session_id, s_prepared_session.session_id) || s_file)
    return ESP_ERR_INVALID_STATE;
  if (mount_card() != ESP_OK)
    return ESP_FAIL;
  bool selected = false;
  for (unsigned attempt = 0; attempt < 256; ++attempt) {
    char stem[9];
    snprintf(stem, sizeof(stem), "%08lx", (unsigned long)esp_random());
    paths_for_stem(stem);
    if (!stem_has_files(stem)) {
      selected = true;
      break;
    }
  }
  if (!selected || next_sequence(&s_sequence) != ESP_OK)
    return ESP_FAIL;
  s_session = s_prepared_session;
  snprintf(s_recording_session_id, sizeof(s_recording_session_id), "%s",
           session_id);
  s_recording_bytes = 0;
  s_phone_bytes = 0;
  s_pcm_bytes = 0;
  s_finalized = false;
  s_verified = false;
  s_first_verified_at = s_delete_after = s_retention_last_seen = 0;
  s_retention_cleanup_started = false;
  s_cloud_stopped = false;
  s_audio_uploaded = false;
  s_phone_uploaded = false;
  s_phone_timing[0] = 0;
  time_t now = time(NULL);
  s_time_uncertain = now < 1735689600;
  s_captured_at[0] = 0;
  if (!s_time_uncertain) {
    struct tm utc;
    gmtime_r(&now, &utc);
    strftime(s_captured_at, sizeof(s_captured_at), "%Y-%m-%dT%H:%M:%SZ", &utc);
  }
  if (pending_marker(s_stem, session_id, false, false) != ESP_OK)
    return ESP_FAIL;
  if (write_manifest() != ESP_OK) {
    remove(s_manifest_path);
    pending_marker(s_stem, session_id, false, true);
    return ESP_FAIL;
  }
  esp_err_t result =
      quipus_archive_create(s_temporary_path, s_archive_key, session_id,
                            s_owner_id, s_device_id, 0, &s_file);
  if (result != ESP_OK) {
    // No PCM was accepted yet; only these newly allocated empty files exist.
    remove(s_temporary_path);
    remove(s_manifest_path);
    pending_marker(s_stem, session_id, false, true);
    return result;
  }
  xStreamBufferReset(s_write_stream);
  while (xSemaphoreTake(s_writer_finished, 0) == pdTRUE) {
  }
  atomic_store_explicit(&s_recording_error, ESP_OK, memory_order_relaxed);
  s_writer_failed = false;
  s_finish_requested = false;
  s_accepting = true;
  return ESP_OK;
#else
  (void)session_id;
  return ESP_ERR_NOT_SUPPORTED;
#endif
}
void lantern_sd_recording_write(const int16_t *samples, size_t count) {
#if LANTERN_HAS_SD_CARD
  if (!samples || !count || !s_accepting || !s_file || s_writer_failed)
    return;
  if (count > SIZE_MAX / sizeof(*samples)) {
    recording_failed(ESP_ERR_INVALID_SIZE);
    return;
  }
  size_t bytes = count * sizeof(*samples);
  // There is exactly one producer. Check space before sending so a slow card
  // never inserts half a PCM frame (possibly an odd byte) into the archive.
  if (xStreamBufferSpacesAvailable(s_write_stream) < bytes ||
      xStreamBufferSend(s_write_stream, samples, bytes, 0) != bytes) {
    recording_failed(ESP_ERR_NO_MEM);
    ESP_LOGE(TAG, "SD writer overflow; incomplete archive preserved");
  }
  xTaskNotifyGive(s_writer_task);
#else
  (void)samples;
  (void)count;
#endif
}
esp_err_t lantern_sd_recording_finish(void) {
#if LANTERN_HAS_SD_CARD
  if (!s_file || s_phone_file)
    return ESP_ERR_INVALID_STATE;
  s_accepting = false;
  s_finish_requested = true;
  xTaskNotifyGive(s_writer_task);
  if (xSemaphoreTake(s_writer_finished, pdMS_TO_TICKS(15000)) != pdTRUE) {
    recording_failed(ESP_ERR_TIMEOUT);
    return ESP_ERR_TIMEOUT;
  }
  esp_err_t error = lantern_sd_recording_error();
  return error != ESP_OK ? error : (!s_recording_bytes ? ESP_FAIL : ESP_OK);
#else
  return ESP_ERR_NOT_SUPPORTED;
#endif
}
void lantern_sd_recording_abort(void) {
#if LANTERN_HAS_SD_CARD
  if (s_file)
    lantern_sd_recording_finish();
#endif
}
bool lantern_sd_capture_active(void) {
#if LANTERN_HAS_SD_CARD
  return s_file || s_phone_file || s_finish_requested || s_phone_finishing;
#else
  return false;
#endif
}
esp_err_t lantern_sd_recording_error(void) {
#if LANTERN_HAS_SD_CARD
  return atomic_load_explicit(&s_recording_error, memory_order_relaxed);
#else
  return ESP_OK;
#endif
}
bool lantern_sd_can_power_down(void) {
#if LANTERN_HAS_SD_CARD
  // Called by the serialized control owner after capture/phone tasks stop.
  // Pending authenticated files and ownership keys remain intact on SD/NVS.
  return !lantern_sd_capture_active() && !s_accepting &&
         !quipus_report_cache_busy() &&
         (!s_write_stream || xStreamBufferBytesAvailable(s_write_stream) == 0);
#else
  return true;
#endif
}
bool lantern_sd_recording_ready(void) {
#if LANTERN_HAS_SD_CARD
  return s_status.mounted && !lantern_sd_capture_active() &&
         !s_writer_failed && s_recording_bytes > 44;
#else
  return false;
#endif
}
const char *lantern_sd_recording_path(void) {
#if LANTERN_HAS_SD_CARD
  return lantern_sd_recording_ready() ? s_recording_path : NULL;
#else
  return NULL;
#endif
}
size_t lantern_sd_recording_size(void) {
#if LANTERN_HAS_SD_CARD
  return lantern_sd_recording_ready() ? s_recording_bytes : 0;
#else
  return 0;
#endif
}
bool lantern_sd_recording_matches_session(const char *session_id) {
#if LANTERN_HAS_SD_CARD
  return session_id && lantern_sd_recording_ready() &&
         !strcmp(session_id, s_recording_session_id);
#else
  (void)session_id;
  return false;
#endif
}
esp_err_t lantern_sd_recording_confirm_uploaded_at(int64_t trusted_verified_at) {
#if LANTERN_HAS_SD_CARD
  if (!lantern_sd_recording_ready() || !s_finalized || s_phone_file)
    return ESP_ERR_INVALID_STATE;
  bool verified_before = s_verified;
  int64_t first_before = s_first_verified_at;
  s_verified = true;
  // Never move an existing deadline on retries, reconnection or reboot.
  if (!s_first_verified_at && retention_clock_valid(trusted_verified_at)) {
    s_first_verified_at = trusted_verified_at;
    s_delete_after = trusted_verified_at + SD_RETENTION_SECONDS;
    s_retention_last_seen = trusted_verified_at;
  }
  if (!verified_before || s_first_verified_at != first_before) {
    if (write_manifest() != ESP_OK) {
      s_verified = verified_before;
      s_first_verified_at = first_before;
      if (!first_before) s_delete_after = s_retention_last_seen = 0;
      return ESP_FAIL;
    }
  }
  if (pending_marker(s_stem, s_recording_session_id, true, false) != ESP_OK)
    return ESP_FAIL;
  esp_err_t result = retain_verified_manifest(s_stem, s_manifest_path);
  if (result == ESP_OK)
    snprintf(s_manifest_path, sizeof(s_manifest_path),
             SD_RECORDING_DIRECTORY "/%s.qpc", s_stem);
  return result;
#else
  (void)trusted_verified_at;
  return ESP_ERR_NOT_SUPPORTED;
#endif
}

esp_err_t lantern_sd_recording_confirm_uploaded(void) {
  // Existing callers without trustworthy time still leave the upload queue,
  // but cannot shorten retention. A trusted idle pass starts their full 24 h.
  return lantern_sd_recording_confirm_uploaded_at(0);
}
esp_err_t lantern_sd_checkpoint(const lantern_cloud_session_t *session,
                                bool stopped, bool audio_uploaded,
                                bool phone_uploaded) {
#if LANTERN_HAS_SD_CARD
  if (!session || strcmp(session->session_id, s_recording_session_id))
    return ESP_ERR_INVALID_ARG;
  s_session = *session;
  s_cloud_stopped = stopped;
  s_audio_uploaded = audio_uploaded;
  s_phone_uploaded = phone_uploaded;
  return write_manifest();
#else
  (void)session;
  (void)stopped;
  (void)audio_uploaded;
  (void)phone_uploaded;
  return ESP_ERR_NOT_SUPPORTED;
#endif
}
size_t lantern_sd_upload_pending_count(void) {
#if LANTERN_HAS_SD_CARD
  // Operational queue candidates only. Do not inspect or mutate the trusted
  // ownership journal: quarantined/orphan evidence still blocks identity reset.
  if (!s_status.mounted)
    return 0;
  uint32_t revision = atomic_load_explicit(&s_upload_count_generation, memory_order_acquire);
  TickType_t now = xTaskGetTickCount();
  if (atomic_load_explicit(&s_upload_count_valid, memory_order_acquire) &&
      atomic_load(&s_upload_count_revision) == revision &&
      (TickType_t)(now - atomic_load(&s_upload_count_checked_at)) < pdMS_TO_TICKS(60000))
    return atomic_load(&s_upload_count_value);
  DIR *dir = opendir(SD_RECORDING_DIRECTORY);
  if (!dir)
    return 0;
  size_t count = 0;
  struct dirent *entry;
  while ((entry = readdir(dir))) {
    char stem[9];
    if (manifest_name(entry->d_name, stem)) {
      char path[96];
      snprintf(path, sizeof(path), SD_RECORDING_DIRECTORY "/%s.qpm", stem);
      cJSON *json = load_manifest(path);
      // Unreadable metadata remains pending/protected, never assumed delivered.
      if (!json || !cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json, "verified")))
        count++;
      cJSON_Delete(json);
    }
  }
  closedir(dir);
  // Do not publish a snapshot overtaken by a concurrent manifest mutation.
  if (revision == atomic_load_explicit(&s_upload_count_generation, memory_order_acquire)) {
    atomic_store(&s_upload_count_value, count);
    atomic_store(&s_upload_count_checked_at, now);
    atomic_store(&s_upload_count_revision, revision);
    atomic_store_explicit(&s_upload_count_valid, true, memory_order_release);
  }
  return count;
#else
  return 0;
#endif
}
size_t lantern_sd_pending_count(void) {
#if LANTERN_HAS_SD_CARD
  if (!s_status.mounted)
    return 0;
  DIR *dir = opendir(SD_RECORDING_DIRECTORY);
  if (!dir)
    return 0;
  size_t count = 0;
  struct dirent *entry;
  while ((entry = readdir(dir))) {
    char stem[9];
    if (retention_metadata_name(entry->d_name, stem))
      count++;
  }
  closedir(dir);
  size_t trusted = pending_marker_count();
  return trusted > count ? trusted : count;
#else
  return 0;
#endif
}
esp_err_t lantern_sd_retention_cleanup(int64_t now, bool time_trusted,
                                      size_t scan_limit, size_t *removed) {
  if (removed) *removed = 0;
#if LANTERN_HAS_SD_CARD
  if (!scan_limit) return ESP_ERR_INVALID_ARG;
  if (!s_secure_ready || !s_status.mounted || !lantern_sd_can_power_down())
    return ESP_ERR_INVALID_STATE;
  if (!time_trusted || !retention_clock_valid(now)) return ESP_OK;
  if (!s_retention_directory)
    s_retention_directory = opendir(SD_RECORDING_DIRECTORY);
  if (!s_retention_directory) return ESP_FAIL;
  if (scan_limit > 8) scan_limit = 8;
  esp_err_t outcome = ESP_OK;
  for (size_t scanned = 0; scanned < scan_limit; ++scanned) {
    struct dirent *entry = readdir(s_retention_directory);
    if (!entry) {
      closedir(s_retention_directory);
      s_retention_directory = NULL;
      break;
    }
    char stem[9], path[96];
    if (!retention_metadata_name(entry->d_name, stem)) continue;
    snprintf(path, sizeof(path), SD_RECORDING_DIRECTORY "/%.12s", entry->d_name);
    cJSON *json = load_manifest(path);
    if (!json) continue; // Authentication, I/O and allocation failures preserve.
    bool deleted = false;
    esp_err_t result = retention_cleanup_record(stem, path, json, now, &deleted);
    cJSON_Delete(json);
    if (deleted && removed) ++*removed;
    if (result != ESP_OK) outcome = result;
  }
  return outcome;
#else
  (void)now;
  (void)time_trusted;
  (void)scan_limit;
  return ESP_ERR_NOT_SUPPORTED;
#endif
}

esp_err_t lantern_sd_next_pending(const char *owner, const char *device,
                                  lantern_cloud_session_t *session,
                                  bool *stopped, bool *audio_uploaded,
                                  bool *phone_uploaded) {
#if LANTERN_HAS_SD_CARD
  if (!s_secure_ready || !owner || strcmp(owner, s_owner_id) || !device ||
      strcmp(device, s_device_id) || s_file || s_phone_file)
    return ESP_ERR_INVALID_STATE;
  DIR *dir = opendir(SD_RECORDING_DIRECTORY);
  if (!dir)
    return ESP_ERR_NOT_FOUND;
  uint64_t sequence = UINT64_MAX;
  char selected[9] = {0};
  struct dirent *entry;
  while ((entry = readdir(dir))) {
    char stem[9], path[96];
    if (!manifest_name(entry->d_name, stem))
      continue;
    snprintf(path, sizeof(path), SD_RECORDING_DIRECTORY "/%.12s",
             entry->d_name);
    cJSON *json = load_manifest(path);
    if (json && cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json, "verified"))) {
      // Complete a torn cache handoff without touching any encrypted track.
      retain_verified_manifest(stem, path);
      cJSON_Delete(json);
      continue;
    }
    cJSON *seq =
        json ? cJSON_GetObjectItemCaseSensitive(json, "sequence") : NULL;
    // Finish older meetings before importing newer ones. The cloud permits
    // one open session per device, including a fully uploaded meeting whose
    // completion is still pending. Letting a newer offline file jump ahead
    // would conflict forever and starve that older completion.
    if (cJSON_IsNumber(seq) && seq->valuedouble > 0 &&
        (uint64_t)seq->valuedouble < sequence) {
      sequence = (uint64_t)seq->valuedouble;
      snprintf(selected, sizeof(selected), "%s", stem);
    }
    cJSON_Delete(json);
  }
  closedir(dir);
  if (!selected[0])
    return ESP_ERR_NOT_FOUND;
  char path[96];
  snprintf(path, sizeof(path), SD_RECORDING_DIRECTORY "/%s.qpm", selected);
  cJSON *json = load_manifest(path);
  // Loading can fail transiently (I/O or allocation); only authenticated,
  // successfully loaded metadata is classified as structurally invalid here.
  if (!json)
    return ESP_FAIL;
  bool valid = activate_manifest(json, selected);
  cJSON_Delete(json);
  if (!valid) {
    quarantine_manifest(selected, "metadata");
    return ESP_FAIL;
  }
  atomic_store_explicit(&s_recording_error, ESP_OK, memory_order_relaxed);
  s_writer_failed = false;
  if (s_verified) {
    retain_verified_manifest(selected, s_manifest_path);
    return ESP_ERR_NOT_FOUND;
  }
  bool recovered = !s_finalized;
  if (recover_track(s_temporary_path, s_recording_path, false,
                    &s_recording_bytes) != ESP_OK ||
      recover_track(s_phone_temporary, s_phone_path, true, &s_phone_bytes) !=
          ESP_OK) {
    // One corrupt session must not block subsequent meetings indefinitely.
    quarantine_manifest(selected, "audio");
    return ESP_FAIL;
  }
  if (recovered) {
    esp_err_t timing = normalize_recovered_phone_timing();
    if (timing != ESP_OK) {
      if (timing == ESP_ERR_INVALID_ARG || timing == ESP_ERR_INVALID_SIZE)
        quarantine_manifest(selected, "phone_timing");
      return timing;
    }
  }
  s_finalized = true;
  if (write_manifest() != ESP_OK)
    return ESP_FAIL;
  if (session)
    *session = s_session;
  if (stopped)
    *stopped = s_cloud_stopped;
  if (audio_uploaded)
    *audio_uploaded = s_audio_uploaded;
  if (phone_uploaded)
    *phone_uploaded = s_phone_uploaded;
  return ESP_OK;
#else
  (void)owner;
  (void)device;
  (void)session;
  (void)stopped;
  (void)audio_uploaded;
  (void)phone_uploaded;
  return ESP_ERR_NOT_SUPPORTED;
#endif
}
const char *lantern_sd_captured_at(void) {
#if LANTERN_HAS_SD_CARD
  return s_captured_at;
#else
  return "";
#endif
}
bool lantern_sd_time_uncertain(void) {
#if LANTERN_HAS_SD_CARD
  return s_time_uncertain;
#else
  return true;
#endif
}
esp_err_t lantern_sd_set_phone_timing(const char *json) {
#if LANTERN_HAS_SD_CARD
  if (!json || strlen(json) >= sizeof(s_phone_timing))
    return ESP_ERR_INVALID_ARG;
  bool first = s_phone_timing[0] == 0;
  snprintf(s_phone_timing, sizeof(s_phone_timing), "%s", json);
  if (first && s_file) {
    esp_err_t result = write_manifest();
    if (result != ESP_OK)
      s_phone_timing[0] = 0;
    return result;
  }
  return ESP_OK;
#else
  (void)json;
  return ESP_ERR_NOT_SUPPORTED;
#endif
}
const char *lantern_sd_phone_timing(void) {
#if LANTERN_HAS_SD_CARD
  return s_phone_timing;
#else
  return "";
#endif
}
esp_err_t lantern_sd_phone_begin(const char *session_id) {
#if LANTERN_HAS_SD_CARD
  if (!s_file || s_phone_file || !session_id ||
      strcmp(session_id, s_recording_session_id))
    return ESP_ERR_INVALID_STATE;
  return quipus_archive_create(s_phone_temporary, s_archive_key, session_id,
                               s_owner_id, s_device_id, 1, &s_phone_file);
#else
  (void)session_id;
  return ESP_ERR_NOT_SUPPORTED;
#endif
}
esp_err_t lantern_sd_phone_write(const int16_t *samples, size_t count) {
#if LANTERN_HAS_SD_CARD
  return s_phone_file ? quipus_archive_append(s_phone_file, samples,
                                              count * sizeof(int16_t))
                      : ESP_ERR_INVALID_STATE;
#else
  (void)samples;
  (void)count;
  return ESP_ERR_NOT_SUPPORTED;
#endif
}
esp_err_t lantern_sd_phone_finish(void) {
#if LANTERN_HAS_SD_CARD
  if (!s_phone_file)
    return ESP_OK;
  size_t pcm = 0;
  s_phone_finishing = true;
  esp_err_t result = quipus_archive_finish(s_phone_file, &pcm);
  s_phone_file = NULL;
  if (result == ESP_OK && pcm && rename(s_phone_temporary, s_phone_path) == 0) {
    s_phone_bytes = 44 + pcm;
    s_phone_finishing = false;
    return ESP_OK;
  }
  s_phone_finishing = false;
  return result == ESP_OK ? ESP_FAIL : result;
#else
  return ESP_ERR_NOT_SUPPORTED;
#endif
}
size_t lantern_sd_phone_size(void) {
#if LANTERN_HAS_SD_CARD
  return s_phone_bytes;
#else
  return 0;
#endif
}
lantern_sd_reader_t *lantern_sd_reader_open(bool phone) {
#if LANTERN_HAS_SD_CARD
  quipus_archive_reader_t *reader = NULL;
  const char *path = phone ? s_phone_path : s_recording_path;
  return quipus_archive_open(path, s_archive_key, s_recording_session_id,
                             s_owner_id, s_device_id, phone ? 1 : 0,
                             &reader) == ESP_OK
             ? reader
             : NULL;
#else
  (void)phone;
  return NULL;
#endif
}
size_t lantern_sd_reader_read(lantern_sd_reader_t *reader, void *out,
                              size_t length) {
  return quipus_archive_read(reader, out, length);
}
int lantern_sd_reader_seek(lantern_sd_reader_t *reader, size_t offset) {
  return quipus_archive_seek(reader, offset);
}
void lantern_sd_reader_close(lantern_sd_reader_t *reader) {
  quipus_archive_close(reader);
}
size_t lantern_sd_phone_read(size_t offset, void *out, size_t length) {
  lantern_sd_reader_t *reader = lantern_sd_reader_open(true);
  if (!reader)
    return 0;
  size_t n = lantern_sd_reader_seek(reader, offset) == 0
                 ? lantern_sd_reader_read(reader, out, length)
                 : 0;
  lantern_sd_reader_close(reader);
  return n;
}

bool lantern_sd_has_private_material(void) {
#if LANTERN_HAS_SD_CARD
  if (s_file || s_phone_file || pending_marker_count() > 0)
    return true;
  if (!s_status.mounted)
    return true; // An absent card is not proof of deletion.
  DIR *dir = opendir(SD_RECORDING_DIRECTORY);
  if (!dir)
    return true;
  bool found = false;
  struct dirent *entry;
  while ((entry = readdir(dir))) {
    const char *extension = strrchr(entry->d_name, '.');
    if (extension &&
        (!strcasecmp(extension, ".qpm") || !strcasecmp(extension, ".qpc") ||
         !strcasecmp(extension, ".qpa") ||
         !strcasecmp(extension, ".qpb") || !strcasecmp(extension, ".qpt") ||
         !strcasecmp(extension, ".qpx") || !strcasecmp(extension, ".wav") ||
         !strcasecmp(extension, ".tmp"))) {
      found = true;
      break;
    }
  }
  closedir(dir);
  return found;
#else
  return false;
#endif
}
void lantern_sd_clear_identity(void) {
  quipus_report_cache_clear_identity();
#if LANTERN_HAS_SD_CARD
  if (s_retention_directory) {
    closedir(s_retention_directory);
    s_retention_directory = NULL;
  }
  invalidate_upload_count();
  volatile uint8_t *key = s_archive_key;
  for (size_t i = 0; i < sizeof(s_archive_key); ++i)
    key[i] = 0;
  s_owner_id[0] = 0;
  s_device_id[0] = 0;
  s_secure_ready = false;
#endif
}

#if LANTERN_HAS_SD_CARD
static bool factory_reset_card_ready(void) {
  if (s_status.mounted && s_card && sdmmc_get_status(s_card) == ESP_OK)
    return true;
  if (s_factory_reset_directory) closedir(s_factory_reset_directory);
  s_factory_reset_directory = NULL;
  s_factory_reset_phase = 0;
  s_factory_reset_blocked = false;
  return false;
}
static bool factory_reset_private_extension(const char *name) {
  const char *extension = strrchr(name, '.');
  const char *extensions[] = {".qpm", ".qpc", ".qpa", ".qpb", ".qpt", ".qpx", ".wav", ".tmp"};
  if (!extension) return false;
  for (size_t i = 0; i < sizeof(extensions) / sizeof(extensions[0]); ++i)
    if (!strcasecmp(extension, extensions[i])) return true;
  return false;
}
static bool factory_reset_file_name(const char *name, bool report) {
  if (!factory_reset_private_extension(name)) return false;
  if (report)
    return !strcasecmp(name, "report0.qpa") || !strcasecmp(name, "report0.qpm") ||
           !strcasecmp(name, "report1.qpa") || !strcasecmp(name, "report1.qpm");
  if (strlen(name) != 12 || name[8] != '.') return false;
  for (size_t i = 0; i < 8; ++i)
    if (!isxdigit((unsigned char)name[i])) return false;
  return true;
}
#endif
esp_err_t lantern_sd_factory_reset_step(size_t scan_limit, bool *complete) {
  if (!complete || !scan_limit) return ESP_ERR_INVALID_ARG;
  *complete = false;
#if LANTERN_HAS_SD_CARD
  if (!factory_reset_card_ready() || !lantern_sd_can_power_down())
    return ESP_ERR_INVALID_STATE;
  if (scan_limit > 8) scan_limit = 8;
  if (s_retention_directory) {
    closedir(s_retention_directory);
    s_retention_directory = NULL;
  }
  // The caller has recorded destructive owner consent durably. Cache detach
  // closes readers and clears its in-memory key; physical files are checked
  // below, including when no cache identity could be loaded after reboot.
  if (s_factory_reset_phase == 0 && !s_factory_reset_directory)
    quipus_report_cache_detach();
  static const char *directories[] = {SD_RECORDING_DIRECTORY, SD_MOUNT_POINT "/quipus-reports"};
  for (size_t scanned = 0; scanned < scan_limit && s_factory_reset_phase < 2; ++scanned) {
    const char *directory = directories[s_factory_reset_phase];
    if (!s_factory_reset_directory) {
      errno = 0;
      s_factory_reset_directory = opendir(directory);
      if (!s_factory_reset_directory) {
        if (errno == ENOENT) { ++s_factory_reset_phase; continue; }
        return ESP_FAIL;
      }
    }
    errno = 0;
    struct dirent *entry = readdir(s_factory_reset_directory);
    if (!entry) {
      int read_error = errno;
      closedir(s_factory_reset_directory);
      s_factory_reset_directory = NULL;
      if (read_error) return ESP_FAIL;
      ++s_factory_reset_phase;
      continue;
    }
    bool recognized = factory_reset_file_name(entry->d_name, s_factory_reset_phase == 1);
    if (!recognized) {
      // Unknown private-looking files need manual inspection; never release
      // identity on a false "empty" result or recursively erase user folders.
      s_factory_reset_blocked |= factory_reset_private_extension(entry->d_name);
      continue;
    }
    char path[160];
    int length = snprintf(path, sizeof(path), "%s/%s", directory, entry->d_name);
    struct stat info;
    bool failed = length < 0 || (size_t)length >= sizeof(path) ||
        stat(path, &info) || !S_ISREG(info.st_mode);
    if (!failed && remove(path) != 0 && errno != ENOENT) failed = true;
    if (failed) {
      // Revisit the failed entry on the next attempt. Keeping an advanced
      // cursor could otherwise acknowledge an incomplete erase.
      closedir(s_factory_reset_directory);
      s_factory_reset_directory = NULL;
      return ESP_FAIL;
    }
    invalidate_upload_count();
  }
  if (s_factory_reset_phase == 2) {
    if (s_factory_reset_blocked) {
      s_factory_reset_phase = 0;
      s_factory_reset_blocked = false;
      return ESP_FAIL;
    }
    if (!factory_reset_card_ready()) return ESP_ERR_INVALID_STATE;
    *complete = true;
  }
  return ESP_OK;
#else
  (void)scan_limit;
  *complete = true;
  return ESP_OK;
#endif
}
