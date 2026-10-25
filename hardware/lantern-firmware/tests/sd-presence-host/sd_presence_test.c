/* Actual lantern_sd_poll; only the card, driver and logging are stubbed. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define LANTERN_HAS_SD_CARD 1
typedef enum { ESP_LOG_NONE = 0, ESP_LOG_WARN = 2, ESP_LOG_INFO = 3 } esp_log_level_t;
typedef enum { LANTERN_SD_UNCHANGED = 0, LANTERN_SD_INSERTED, LANTERN_SD_REMOVED } lantern_sd_change_t;
typedef struct { bool present, mounted; uint64_t capacity_bytes, free_bytes; uint32_t sector_size; char name[8]; } lantern_sd_status_t;
typedef struct { int unused; } sdmmc_card_t;

static const char *TAG = "lantern_sd";
static lantern_sd_status_t s_status;
static sdmmc_card_t card, *s_card;
static void *s_file, *s_phone_file;
static volatile bool s_accepting, s_finish_requested;

static bool inserted, responsive = true;
static unsigned mounts, unmounts, status_checks, invalidations, warnings, infos;
static esp_log_level_t levels[8];
static const char *tags[8];
static unsigned quiet_during_mount;

static int tag_index(const char *tag) {
  for (int i = 0; i < 8; ++i) if (tags[i] && !strcmp(tags[i], tag)) return i;
  for (int i = 0; i < 8; ++i) if (!tags[i]) { tags[i] = tag; levels[i] = ESP_LOG_INFO; return i; }
  assert(false);
  return 0;
}
static esp_log_level_t esp_log_level_get(const char *tag) { return levels[tag_index(tag)]; }
static void esp_log_level_set(const char *tag, esp_log_level_t level) { levels[tag_index(tag)] = level; }
#define ESP_LOGW(tag, ...) ((void)(tag), ++warnings)
#define ESP_LOGI(tag, ...) ((void)(tag), ++infos)

static esp_err_t sdmmc_get_status(sdmmc_card_t *c) { assert(c == &card); ++status_checks; return inserted && responsive ? ESP_OK : ESP_FAIL; }
static void invalidate_upload_count(void) { ++invalidations; }
static void unmount_card(void) { assert(s_status.mounted); ++unmounts; s_card = NULL; s_status.mounted = false; }
static esp_err_t mount_card(void) {
  ++mounts;
  // Driver chatter for an empty slot must be silenced only during the probe.
  for (int i = 0; i < 8; ++i) if (tags[i] && levels[i] == ESP_LOG_NONE) ++quiet_during_mount;
  if (!inserted) { memset(&s_status, 0, sizeof(s_status)); return ESP_FAIL; }
  s_card = &card;
  s_status.present = s_status.mounted = true;
  s_status.capacity_bytes = 64ULL << 30;
  snprintf(s_status.name, sizeof(s_status.name), "SD64G");
  responsive = true;
  return ESP_OK;
}

#include "sd_presence_under_test.c"

int main(void) {
  // Empty slot: probes stay quiet and change nothing.
  for (int i = 0; i < 3; ++i) assert(lantern_sd_poll() == LANTERN_SD_UNCHANGED);
  assert(mounts == 3 && !s_status.mounted && warnings == 0 && infos == 0);
  assert(quiet_during_mount >= 3 * 5);
  for (int i = 0; i < 8; ++i) if (tags[i]) assert(levels[i] == ESP_LOG_INFO);

  // A card slotted in is mounted and reported once.
  inserted = true;
  assert(lantern_sd_poll() == LANTERN_SD_INSERTED && s_status.mounted && infos == 1);
  unsigned before = mounts;
  assert(lantern_sd_poll() == LANTERN_SD_UNCHANGED && mounts == before && status_checks == 1);

  // Pulling it out unmounts and clears status; the next poll probes again.
  inserted = false;
  assert(lantern_sd_poll() == LANTERN_SD_REMOVED && unmounts == 1 && !s_status.mounted);
  assert(!s_status.present && !s_status.capacity_bytes && !s_status.name[0] && warnings == 1);
  assert(lantern_sd_poll() == LANTERN_SD_UNCHANGED && !s_status.mounted);

  // A different card goes in: detected without a restart.
  inserted = true;
  assert(lantern_sd_poll() == LANTERN_SD_INSERTED && s_status.mounted && infos == 2);

  // Never touch the card while anything is being written.
  unsigned checks = status_checks, mounted = mounts;
  inserted = false;
  void *open_file = &card;
  s_file = open_file;
  assert(lantern_sd_poll() == LANTERN_SD_UNCHANGED);
  s_file = NULL; s_phone_file = open_file;
  assert(lantern_sd_poll() == LANTERN_SD_UNCHANGED);
  s_phone_file = NULL; s_accepting = true;
  assert(lantern_sd_poll() == LANTERN_SD_UNCHANGED);
  s_accepting = false; s_finish_requested = true;
  assert(lantern_sd_poll() == LANTERN_SD_UNCHANGED);
  s_finish_requested = false;
  assert(status_checks == checks && mounts == mounted && s_status.mounted);
  // Once idle, the missing card is noticed.
  assert(lantern_sd_poll() == LANTERN_SD_REMOVED);
  assert(invalidations >= 5);

  puts("SD presence: empty-slot quiet probes, insert, remove, swap and write-safety cases passed");
  return 0;
}
