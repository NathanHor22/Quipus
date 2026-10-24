#include "quipus_report_cache.h"
#include "quipus_archive.h"
#include "cJSON.h"
#include "mbedtls/platform_util.h"
#include <ctype.h>
#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#ifdef _WIN32
#include <direct.h>
#endif

#define PROFILE_CAPACITY 65
#define DIRECTORY_CAPACITY 128
#define PATH_CAPACITY 160
#define METADATA_CAPACITY 512
#define CACHE_INVALID ESP_ERR_INVALID_ARG

typedef struct {
  char report[37], profile[PROFILE_CAPACITY];
  uint32_t generation;
  size_t bytes;
  unsigned slot;
} cache_metadata_t;
struct quipus_report_cache_reader {
  quipus_archive_reader_t *archive;
  size_t bytes, position;
};
static char s_directory[DIRECTORY_CAPACITY], s_owner[37], s_device[37];
static uint8_t s_key[32];
static bool s_configured, s_writing, s_odd;
static uint8_t s_odd_byte;
static cache_metadata_t s_pending;
static quipus_archive_writer_t *s_writer;
static struct quipus_report_cache_reader s_reader;

static bool valid_id(const char *text) {
  if (!text || strlen(text) != 36)
    return false;
  for (size_t i = 0; i < 36; ++i)
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (text[i] != '-')
        return false;
    } else if (!isxdigit((unsigned char)text[i]))
      return false;
  return true;
}
static bool valid_profile(const char *text) {
  if (!text || !*text || strlen(text) >= PROFILE_CAPACITY)
    return false;
  for (const unsigned char *p = (const unsigned char *)text; *p; ++p)
    if (!isalnum(*p) && *p != '-' && *p != '_' && *p != '.')
      return false;
  return true;
}
static void path_for(unsigned slot, bool metadata, char path[PATH_CAPACITY]) {
  snprintf(path, PATH_CAPACITY, "%s/report%u.%s", s_directory, slot,
           metadata ? "qpm" : "qpa");
}
static bool remove_slot_file(unsigned slot, bool metadata) {
  char path[PATH_CAPACITY];
  path_for(slot, metadata, path);
  return !remove(path) || errno == ENOENT;
}
static bool json_string_equals(cJSON *json, const char *name, const char *value) {
  cJSON *item = cJSON_GetObjectItemCaseSensitive(json, name);
  return cJSON_IsString(item) && !strcmp(item->valuestring, value);
}
static esp_err_t read_metadata(unsigned slot, cache_metadata_t *out) {
  char path[PATH_CAPACITY], json[METADATA_CAPACITY];
  struct stat info;
  path_for(slot, true, path);
  if (stat(path, &info) || info.st_size < 38 ||
      info.st_size > METADATA_CAPACITY + 36)
    return CACHE_INVALID;
  esp_err_t result = quipus_archive_journal_read(path, s_key, json, sizeof(json));
  if (result != ESP_OK)
    return result == ESP_ERR_NO_MEM ? result : CACHE_INVALID;
  // Only one complete authenticated commit record is valid. A torn or appended
  // tail must not benefit from the recording journal's recovery semantics.
  if ((size_t)info.st_size != strlen(json) + 36)
    return CACHE_INVALID;
  cJSON *value = cJSON_ParseWithLengthOpts(json, strlen(json) + 1, NULL, true);
  if (!value)
    return ESP_ERR_NO_MEM; // Could be allocation failure: never evict on doubt.
  cJSON *report = cJSON_GetObjectItemCaseSensitive(value, "report");
  cJSON *profile = cJSON_GetObjectItemCaseSensitive(value, "profile");
  cJSON *bytes = cJSON_GetObjectItemCaseSensitive(value, "bytes");
  cJSON *generation = cJSON_GetObjectItemCaseSensitive(value, "generation");
  bool valid = cJSON_IsObject(value) &&
      json_string_equals(value, "kind", "quipus-report-v1") &&
      json_string_equals(value, "owner", s_owner) &&
      json_string_equals(value, "device", s_device) &&
      cJSON_IsString(report) && valid_id(report->valuestring) &&
      cJSON_IsString(profile) && valid_profile(profile->valuestring) &&
      cJSON_IsNumber(bytes) && isfinite(bytes->valuedouble) &&
      bytes->valuedouble >= 2 && bytes->valuedouble <= QUIPUS_REPORT_CACHE_MAX_PCM &&
      floor(bytes->valuedouble) == bytes->valuedouble &&
      fmod(bytes->valuedouble, 2) == 0 &&
      cJSON_IsNumber(generation) && isfinite(generation->valuedouble) &&
      generation->valuedouble >= 1 && generation->valuedouble <= UINT32_MAX &&
      floor(generation->valuedouble) == generation->valuedouble;
  if (valid) {
    memset(out, 0, sizeof(*out));
    snprintf(out->report, sizeof(out->report), "%s", report->valuestring);
    snprintf(out->profile, sizeof(out->profile), "%s", profile->valuestring);
    out->bytes = (size_t)bytes->valuedouble;
    out->generation = (uint32_t)generation->valuedouble;
    out->slot = slot;
  }
  cJSON_Delete(value);
  return valid ? ESP_OK : CACHE_INVALID;
}
static esp_err_t validate_archive(const cache_metadata_t *metadata,
                                   quipus_archive_reader_t **out) {
  char path[PATH_CAPACITY];
  struct stat info;
  path_for(metadata->slot, false, path);
  size_t blocks = (metadata->bytes + QUIPUS_ARCHIVE_BLOCK - 1) / QUIPUS_ARCHIVE_BLOCK;
  size_t physical = QUIPUS_ARCHIVE_HEADER + metadata->bytes + blocks * 20;
  if (stat(path, &info) || info.st_size < 0 || (size_t)info.st_size != physical)
    return CACHE_INVALID;
  quipus_archive_reader_t *reader = NULL;
  esp_err_t result = quipus_archive_open_report(path, s_key, metadata->report,
                                               s_owner, s_device, &reader);
  if (result != ESP_OK)
    return result == ESP_ERR_NO_MEM ? result : CACHE_INVALID;
  if (quipus_archive_size(reader) != metadata->bytes + 44 ||
      quipus_archive_seek(reader, 44)) {
    quipus_archive_close(reader);
    return CACHE_INVALID;
  }
  // Authenticate every block before playback or committing replacement metadata.
  // Bounded scratch memory; never allocate or retain a complete report in RAM.
  uint8_t scratch[512];
  size_t remaining = metadata->bytes;
  while (remaining) {
    size_t count = remaining < sizeof(scratch) ? remaining : sizeof(scratch);
    if (quipus_archive_read(reader, scratch, count) != count) {
      mbedtls_platform_zeroize(scratch, sizeof(scratch));
      quipus_archive_close(reader);
      return CACHE_INVALID;
    }
    remaining -= count;
  }
  mbedtls_platform_zeroize(scratch, sizeof(scratch));
  if (quipus_archive_seek(reader, 44)) {
    quipus_archive_close(reader);
    return CACHE_INVALID;
  }
  *out = reader;
  return ESP_OK;
}
static esp_err_t select_report(const char *profile, cache_metadata_t *chosen,
                                quipus_archive_reader_t **reader,
                                uint32_t *highest_generation) {
  cache_metadata_t metadata[2];
  bool valid[2] = {false, false};
  uint32_t highest = 0;
  for (unsigned i = 0; i < 2; ++i) {
    esp_err_t result = read_metadata(i, &metadata[i]);
    if (result == ESP_ERR_NO_MEM)
      return result;
    valid[i] = result == ESP_OK;
    if (valid[i] && metadata[i].generation > highest)
      highest = metadata[i].generation;
  }
  if (highest_generation)
    *highest_generation = highest;
  unsigned first = valid[1] && (!valid[0] || metadata[1].generation > metadata[0].generation) ? 1 : 0;
  for (unsigned n = 0; n < 2; ++n) {
    unsigned slot = (first + n) % 2;
    if (!valid[slot] || (profile && strcmp(profile, metadata[slot].profile)))
      continue;
    esp_err_t result = validate_archive(&metadata[slot], reader);
    if (result == ESP_ERR_NO_MEM)
      return result;
    if (result == ESP_OK) {
      *chosen = metadata[slot];
      return ESP_OK;
    }
  }
  return CACHE_INVALID;
}
void quipus_report_cache_abort(void) {
  if (s_writer)
    quipus_archive_abort(s_writer);
  s_writer = NULL;
  if (s_writing) {
    // Inactive slot only: never remove the previously committed report.
    remove_slot_file(s_pending.slot, true);
    remove_slot_file(s_pending.slot, false);
  }
  s_writing = false;
  s_odd = false;
  s_odd_byte = 0;
  memset(&s_pending, 0, sizeof(s_pending));
}
void quipus_report_cache_close(quipus_report_cache_reader_t *reader) {
  if (reader != &s_reader)
    return;
  quipus_archive_close(s_reader.archive);
  memset(&s_reader, 0, sizeof(s_reader));
}
void quipus_report_cache_detach(void) {
  quipus_report_cache_abort();
  quipus_report_cache_close(&s_reader);
  mbedtls_platform_zeroize(s_key, sizeof(s_key));
  memset(s_owner, 0, sizeof(s_owner));
  memset(s_device, 0, sizeof(s_device));
  memset(s_directory, 0, sizeof(s_directory));
  s_configured = false;
}
void quipus_report_cache_clear_identity(void) {
  quipus_report_cache_abort();
  quipus_report_cache_close(&s_reader);
  if (s_configured)
    for (unsigned i = 0; i < 2; ++i) {
      remove_slot_file(i, true);
      remove_slot_file(i, false);
    }
  quipus_report_cache_detach();
}
esp_err_t quipus_report_cache_configure(const char *directory,
                                        const uint8_t key[32],
                                        const char *owner, const char *device) {
  if (!directory || !*directory || strlen(directory) >= DIRECTORY_CAPACITY ||
      !key || !valid_id(owner) || !valid_id(device))
    return ESP_ERR_INVALID_ARG;
  if (s_configured && !strcmp(s_directory, directory) && !strcmp(s_owner, owner) &&
      !strcmp(s_device, device) && !memcmp(s_key, key, 32))
    return ESP_OK;
  if (s_configured)
    quipus_report_cache_clear_identity();
  memcpy(s_key, key, sizeof(s_key));
  snprintf(s_directory, sizeof(s_directory), "%s", directory);
  snprintf(s_owner, sizeof(s_owner), "%s", owner);
  snprintf(s_device, sizeof(s_device), "%s", device);
  s_configured = true;
  return ESP_OK;
}
bool quipus_report_cache_busy(void) { return s_writing || s_reader.archive; }
esp_err_t quipus_report_cache_begin(const char *report, const char *profile) {
  if (!s_configured || quipus_report_cache_busy() || !valid_id(report) || !valid_profile(profile))
    return ESP_ERR_INVALID_ARG;
#ifdef _WIN32
  if (_mkdir(s_directory) && errno != EEXIST)
#else
  if (mkdir(s_directory, 0700) && errno != EEXIST)
#endif
    return ESP_FAIL;
  cache_metadata_t previous;
  quipus_archive_reader_t *reader = NULL;
  uint32_t highest = 0;
  esp_err_t result = select_report(NULL, &previous, &reader, &highest);
  if (result == ESP_ERR_NO_MEM || highest == UINT32_MAX)
    return result == ESP_ERR_NO_MEM ? result : ESP_FAIL;
  unsigned slot = result == ESP_OK ? 1 - previous.slot : 0;
  quipus_archive_close(reader);
  // Revoke the inactive slot's old commit before overwriting its archive.
  if (!remove_slot_file(slot, true))
    return ESP_FAIL;
  memset(&s_pending, 0, sizeof(s_pending));
  s_pending.slot = slot;
  s_pending.generation = highest + 1;
  snprintf(s_pending.report, sizeof(s_pending.report), "%s", report);
  snprintf(s_pending.profile, sizeof(s_pending.profile), "%s", profile);
  s_writing = true;
  char path[PATH_CAPACITY];
  path_for(slot, false, path);
  result = quipus_archive_create_report(path, s_key, report, s_owner, s_device, &s_writer);
  if (result != ESP_OK)
    quipus_report_cache_abort();
  return result;
}
esp_err_t quipus_report_cache_append(const void *pcm, size_t bytes) {
  if (!s_writing || !s_writer)
    return ESP_ERR_INVALID_ARG;
  if (!pcm && bytes) {
    quipus_report_cache_abort();
    return ESP_ERR_INVALID_ARG;
  }
  if (bytes > QUIPUS_REPORT_CACHE_MAX_PCM - s_pending.bytes) {
    quipus_report_cache_abort();
    return ESP_ERR_INVALID_ARG;
  }
  s_pending.bytes += bytes;
  const uint8_t *input = pcm;
  esp_err_t result = ESP_OK;
  if (s_odd && bytes) {
    uint8_t pair[2] = {s_odd_byte, *input++};
    result = quipus_archive_append(s_writer, pair, sizeof(pair));
    --bytes;
    s_odd = false;
  }
  size_t even = bytes & ~(size_t)1;
  if (result == ESP_OK && even)
    result = quipus_archive_append(s_writer, input, even);
  if (result == ESP_OK && (bytes & 1)) {
    s_odd_byte = input[even];
    s_odd = true;
  }
  if (result != ESP_OK)
    quipus_report_cache_abort();
  return result;
}
esp_err_t quipus_report_cache_commit(void) {
  if (!s_writing || !s_writer)
    return ESP_ERR_INVALID_ARG;
  if (s_odd || !s_pending.bytes) {
    quipus_report_cache_abort();
    return ESP_ERR_INVALID_ARG;
  }
  quipus_archive_writer_t *writer = s_writer;
  s_writer = NULL;
  size_t actual = 0;
  esp_err_t result = quipus_archive_finish(writer, &actual);
  quipus_archive_reader_t *reader = NULL;
  if (result == ESP_OK && actual != s_pending.bytes)
    result = ESP_FAIL;
  if (result == ESP_OK)
    result = validate_archive(&s_pending, &reader);
  quipus_archive_close(reader);
  if (result != ESP_OK) {
    quipus_report_cache_abort();
    return result;
  }
  // UUIDs and the tightly restricted profile alphabet cannot inject JSON.
  char json[METADATA_CAPACITY], path[PATH_CAPACITY];
  int count = snprintf(json, sizeof(json),
      "{\"kind\":\"quipus-report-v1\",\"owner\":\"%s\",\"device\":\"%s\","
      "\"report\":\"%s\",\"profile\":\"%s\",\"bytes\":%lu,\"generation\":%lu}",
      s_owner, s_device, s_pending.report, s_pending.profile,
      (unsigned long)s_pending.bytes, (unsigned long)s_pending.generation);
  path_for(s_pending.slot, true, path);
  result = count > 0 && (size_t)count < sizeof(json) ?
      quipus_archive_journal_append(path, s_key, json) : ESP_FAIL;
  if (result != ESP_OK) {
    quipus_report_cache_abort();
    return result;
  }
  s_writing = false;
  memset(&s_pending, 0, sizeof(s_pending));
  return ESP_OK;
}
esp_err_t quipus_report_cache_open(const char *profile,
                                   quipus_report_cache_reader_t **out) {
  if (out)
    *out = NULL;
  if (!out || !s_configured || quipus_report_cache_busy() || !valid_profile(profile))
    return ESP_ERR_INVALID_ARG;
  cache_metadata_t metadata;
  quipus_archive_reader_t *reader = NULL;
  esp_err_t result = select_report(profile, &metadata, &reader, NULL);
  if (result != ESP_OK)
    return result;
  s_reader.archive = reader;
  s_reader.bytes = metadata.bytes;
  s_reader.position = 0;
  *out = &s_reader;
  return ESP_OK;
}
bool quipus_report_cache_available(const char *profile) {
  quipus_report_cache_reader_t *reader = NULL;
  if (quipus_report_cache_open(profile, &reader) != ESP_OK)
    return false;
  quipus_report_cache_close(reader);
  return true;
}
size_t quipus_report_cache_size(const quipus_report_cache_reader_t *reader) {
  return reader == &s_reader && reader->archive ? reader->bytes : 0;
}
size_t quipus_report_cache_read(quipus_report_cache_reader_t *reader,
                                void *pcm, size_t bytes) {
  if (reader != &s_reader || !reader->archive || (!pcm && bytes))
    return 0;
  size_t remaining = reader->bytes - reader->position;
  if (bytes > remaining)
    bytes = remaining;
  size_t count = quipus_archive_read(reader->archive, pcm, bytes);
  reader->position += count;
  return count;
}
