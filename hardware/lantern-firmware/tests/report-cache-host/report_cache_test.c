#include "quipus_report_cache.h"
#include "quipus_archive.h"
#include "cJSON.h"
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#ifdef _WIN32
#include <direct.h>
#endif
#define CHECK(x) do { if (!(x)) { fprintf(stderr, "Cache check failed at %d: %s\n", __LINE__, #x); exit(1); } } while (0)
static const char *owner = "22222222-2222-4222-8222-222222222222";
static const char *other = "44444444-4444-4444-8444-444444444444";
static const char *device = "33333333-3333-4333-8333-333333333333";
static const char *report = "11111111-1111-4111-8111-111111111111";
static const char *profile = "quipus-marin-v1";
static uint8_t key[32], wrong_key[32], pcm[10000], second[10000];
static unsigned cases, sync_calls;
#ifdef fsync
#undef fsync
#endif
int quipus_test_fsync(int descriptor) {
  ++sync_calls;
#ifdef _WIN32
  return _commit(descriptor);
#else
  return fsync(descriptor);
#endif
}
void esp_fill_random(void *out, size_t bytes) {
  static uint32_t state = 17;
  uint8_t *p = out;
  while (bytes--) { state = state * 1664525u + 1013904223u; *p++ = (uint8_t)(state >> 24); }
}
static void checked_case(const char *label) { ++cases; printf("ok %u - %s\n", cases, label); }
static void configure(const uint8_t *secret, const char *user, const char *board) {
  CHECK(quipus_report_cache_configure("cache", secret, user, board) == ESP_OK);
}
static void fresh(void) { quipus_report_cache_clear_identity(); configure(key, owner, device); }
static void save(const uint8_t *audio, size_t bytes) {
  CHECK(quipus_report_cache_begin(report, profile) == ESP_OK);
  CHECK(quipus_report_cache_append(audio, 3) == ESP_OK);
  CHECK(quipus_report_cache_append(audio + 3, 4112) == ESP_OK);
  CHECK(quipus_report_cache_append(audio + 4115, bytes - 4115) == ESP_OK);
  CHECK(quipus_report_cache_commit() == ESP_OK);
}
static void replay(const uint8_t *expected, size_t bytes) {
  quipus_report_cache_reader_t *reader = NULL;
  CHECK(quipus_report_cache_open(profile, &reader) == ESP_OK);
  CHECK(reader && quipus_report_cache_busy());
  CHECK(quipus_report_cache_size(reader) == bytes);
  uint8_t output[777]; size_t position = 0;
  while (position < bytes) {
    size_t count = bytes - position < sizeof(output) ? bytes - position : sizeof(output);
    CHECK(quipus_report_cache_read(reader, output, count) == count);
    CHECK(!memcmp(output, expected + position, count));
    position += count;
  }
  CHECK(quipus_report_cache_read(reader, output, sizeof(output)) == 0);
  quipus_report_cache_close(reader);
  CHECK(!quipus_report_cache_busy());
}
static void tamper(const char *path, long offset) {
  FILE *file = fopen(path, "rb+"); CHECK(file);
  CHECK(!fseek(file, offset, SEEK_SET)); int value = fgetc(file); CHECK(value != EOF);
  CHECK(!fseek(file, offset, SEEK_SET)); CHECK(fputc(value ^ 0x80, file) != EOF); CHECK(!fclose(file));
}
static void truncate_tail(const char *path, long bytes) {
  FILE *file = fopen(path, "rb+"); CHECK(file);
  CHECK(!fseek(file, -bytes, SEEK_END)); long size = ftell(file); CHECK(size >= 0);
  CHECK(!ftruncate(fileno(file), size)); CHECK(!fclose(file));
}
static void *fail_all(size_t bytes) { (void)bytes; return NULL; }
int main(void) {
  for (size_t i = 0; i < 32; ++i) { key[i] = (uint8_t)i; wrong_key[i] = (uint8_t)(i + 1); }
  for (size_t i = 0; i < sizeof(pcm); ++i) { pcm[i] = (uint8_t)(i * 13 + 7); second[i] = pcm[i] ^ 0xA5; }
  FILE *sentinel = fopen("recording-sentinel.qpa", "wb"); CHECK(sentinel); fputs("preserved recording", sentinel); fclose(sentinel);
  configure(key, owner, device);
  CHECK(!quipus_report_cache_available(profile));
  CHECK(quipus_report_cache_begin("invalid", profile) != ESP_OK);
  CHECK(quipus_report_cache_begin(report, "unsafe/../../") != ESP_OK);
  save(pcm, sizeof(pcm)); replay(pcm, sizeof(pcm));
  CHECK(!quipus_report_cache_available("quipus-marin-v2"));
  checked_case("odd HTTP chunks commit exact raw24k PCM, strict profile and busy guards");

  quipus_archive_reader_t *archive = NULL;
  CHECK(quipus_archive_open("cache/report0.qpa", key, report, owner, device, 0, &archive) != ESP_OK);
  CHECK(quipus_archive_open("cache/report0.qpa", key, report, owner, device, 2, &archive) != ESP_OK);
  CHECK(quipus_archive_open_report("cache/report0.qpa", key, report, owner, device, &archive) == ESP_OK);
  uint8_t header[44]; CHECK(quipus_archive_read(archive, header, sizeof(header)) == sizeof(header));
  CHECK(header[24] == 0xC0 && header[25] == 0x5D && header[26] == 0 && header[27] == 0);
  CHECK(header[28] == 0x80 && header[29] == 0xBB); quipus_archive_close(archive);
  quipus_archive_writer_t *writer = NULL;
  CHECK(quipus_archive_create("strict.qpa", key, report, owner, device, 2, &writer) != ESP_OK);
  checked_case("report archive source2/rate24k cannot enter strict recording source0/1 API");

  CHECK(quipus_archive_create("durable-recording.qpa", key, report, owner, device, 0, &writer) == ESP_OK);
  unsigned before = sync_calls;
  CHECK(quipus_archive_append(writer, pcm, 8192) == ESP_OK);
  CHECK(sync_calls == before + 2); CHECK(quipus_archive_finish(writer, NULL) == ESP_OK);
  CHECK(!remove("durable-recording.qpa"));
  CHECK(quipus_report_cache_begin(report, profile) == ESP_OK);
  before = sync_calls;
  CHECK(quipus_report_cache_append(second, 8192) == ESP_OK);
  CHECK(sync_calls == before); CHECK(quipus_report_cache_commit() == ESP_OK);
  CHECK(sync_calls > before); replay(second, 8192);
  fresh(); save(pcm, sizeof(pcm));
  checked_case("recording sources fsync every block while disposable source2 defers fsync to commit");

  quipus_report_cache_detach(); CHECK(!quipus_report_cache_available(profile));
  configure(key, owner, device); replay(pcm, sizeof(pcm));
  CHECK(quipus_report_cache_begin(report, profile) == ESP_OK);
  CHECK(!quipus_report_cache_available(profile));
  CHECK(quipus_report_cache_append(second, 6000) == ESP_OK); quipus_report_cache_abort();
  replay(pcm, sizeof(pcm));
  CHECK(quipus_report_cache_begin(report, profile) == ESP_OK);
  CHECK(quipus_report_cache_append(second, 6000) == ESP_OK); quipus_report_cache_detach();
  configure(key, owner, device); replay(pcm, sizeof(pcm));
  checked_case("reboot preserves committed cache and interrupted/aborted downloads preserve prior report");

  save(second, sizeof(second)); replay(second, sizeof(second));
  tamper("cache/report1.qpa", QUIPUS_ARCHIVE_HEADER + 4116 + 24);
  replay(pcm, sizeof(pcm));
  save(second, sizeof(second)); truncate_tail("cache/report1.qpa", 8); replay(pcm, sizeof(pcm));
  save(second, sizeof(second)); FILE *file = fopen("cache/report1.qpm", "ab"); CHECK(file); fputs("QPM1torn", file); fclose(file);
  replay(pcm, sizeof(pcm));
  checked_case("full authentication and exact lengths reject later-block tamper, truncated audio and torn metadata before playback");

  save(second, sizeof(second));
  tamper("cache/report1.qpm", 25); replay(pcm, sizeof(pcm));
  save(second, sizeof(second));
  quipus_report_cache_detach(); configure(key, other, device); CHECK(!quipus_report_cache_available(profile));
  quipus_report_cache_detach(); configure(key, owner, other); CHECK(!quipus_report_cache_available(profile));
  quipus_report_cache_detach(); configure(wrong_key, owner, device); CHECK(!quipus_report_cache_available(profile));
  quipus_report_cache_detach(); configure(key, owner, device); replay(second, sizeof(second));
  checked_case("authenticated metadata, owner, device and key binding reject foreign cache without plaintext fallback");

  fresh(); save(pcm, sizeof(pcm));
  CHECK(quipus_report_cache_begin(report, profile) == ESP_OK);
  CHECK(quipus_report_cache_append(second, 3) == ESP_OK);
  CHECK(quipus_report_cache_commit() != ESP_OK); replay(pcm, sizeof(pcm));
  CHECK(quipus_report_cache_begin(report, profile) == ESP_OK);
  CHECK(quipus_report_cache_commit() != ESP_OK); replay(pcm, sizeof(pcm));
  CHECK(quipus_report_cache_begin(report, profile) == ESP_OK);
  CHECK(quipus_report_cache_append(second, sizeof(second)) == ESP_OK);
  CHECK(quipus_report_cache_append(NULL, 2) != ESP_OK);
  CHECK(quipus_report_cache_commit() != ESP_OK); replay(pcm, sizeof(pcm));
  checked_case("empty, odd-final and failed appends cannot commit a partial replacement");

  CHECK(quipus_report_cache_begin(report, profile) == ESP_OK);
  CHECK(quipus_report_cache_append(second, sizeof(second)) == ESP_OK);
#ifdef _WIN32
  CHECK(!_mkdir("cache/report1.qpm"));
#else
  CHECK(!mkdir("cache/report1.qpm", 0700));
#endif
  CHECK(quipus_report_cache_commit() != ESP_OK);
  CHECK(!rmdir("cache/report1.qpm")); replay(pcm, sizeof(pcm));
  checked_case("metadata commit I/O failure leaves previous committed report intact");

  cJSON_Hooks hooks = {fail_all, free}; cJSON_InitHooks(&hooks);
  CHECK(quipus_report_cache_begin(report, profile) == ESP_ERR_NO_MEM);
  cJSON_InitHooks(NULL); replay(pcm, sizeof(pcm));
  checked_case("metadata allocation failure cannot evict the last report");

  const char *bad_counts[] = {"-2", "0", "3", "2.5", "9007199254740992", "null", "\"10000\""};
  for (size_t i = 0; i < sizeof(bad_counts) / sizeof(bad_counts[0]); ++i) {
    save(second, sizeof(second)); CHECK(!remove("cache/report1.qpm"));
    char json[512]; snprintf(json, sizeof(json), "{\"kind\":\"quipus-report-v1\",\"owner\":\"%s\",\"device\":\"%s\",\"report\":\"%s\",\"profile\":\"%s\",\"bytes\":%s,\"generation\":2}", owner, device, report, profile, bad_counts[i]);
    CHECK(quipus_archive_journal_append("cache/report1.qpm", key, json) == ESP_OK);
    replay(pcm, sizeof(pcm));
  }
  checked_case("authenticated malformed byte counts never permit overflow, truncation or partial PCM");

  CHECK(quipus_report_cache_begin(report, profile) == ESP_OK);
  uint8_t chunk[32768]; memset(chunk, 0x31, sizeof(chunk));
  for (size_t bytes = 0; bytes < QUIPUS_REPORT_CACHE_MAX_PCM; bytes += sizeof(chunk))
    CHECK(quipus_report_cache_append(chunk, sizeof(chunk)) == ESP_OK);
  CHECK(quipus_report_cache_append(chunk, 2) != ESP_OK);
  CHECK(!quipus_report_cache_busy()); replay(pcm, sizeof(pcm));
  CHECK(quipus_report_cache_begin(report, profile) == ESP_OK);
  for (size_t bytes = 0; bytes < QUIPUS_REPORT_CACHE_MAX_PCM; bytes += sizeof(chunk))
    CHECK(quipus_report_cache_append(chunk, sizeof(chunk)) == ESP_OK);
  CHECK(quipus_report_cache_commit() == ESP_OK);
  quipus_report_cache_reader_t *reader = NULL;
  CHECK(quipus_report_cache_open(profile, &reader) == ESP_OK);
  CHECK(quipus_report_cache_size(reader) == QUIPUS_REPORT_CACHE_MAX_PCM);
  size_t remaining = QUIPUS_REPORT_CACHE_MAX_PCM; uint8_t output[1024];
  while (remaining) { CHECK(quipus_report_cache_read(reader, output, sizeof(output)) == sizeof(output)); CHECK(!memcmp(output, chunk, sizeof(output))); remaining -= sizeof(output); }
  quipus_report_cache_close(reader);
  checked_case("exact8MiB limit streams bounded memory; overflow abort never replaces previous report");

  CHECK(quipus_report_cache_open(profile, &reader) == ESP_OK);
  quipus_report_cache_clear_identity();
  CHECK(quipus_report_cache_read(reader, output, sizeof(output)) == 0);
  CHECK(quipus_report_cache_size(reader) == 0);
  CHECK(!quipus_report_cache_busy() && !quipus_report_cache_available(profile));
  CHECK(access("cache/report0.qpa", F_OK) && access("cache/report1.qpa", F_OK));
  CHECK(access("cache/report0.qpm", F_OK) && access("cache/report1.qpm", F_OK));
  CHECK(!access("recording-sentinel.qpa", F_OK));
  configure(key, owner, device); save(pcm, sizeof(pcm));
  configure(wrong_key, other, device); CHECK(!quipus_report_cache_available(profile));
  CHECK(access("cache/report0.qpa", F_OK));
  checked_case("identity change revokes open handles, wipes/removes cache only, preserves recording files");
  quipus_report_cache_clear_identity(); CHECK(!remove("recording-sentinel.qpa")); CHECK(!rmdir("cache"));
  printf("Report cache host tests passed: %u meaningful cases using actual AES-GCM and cJSON.\n", cases);
  return 0;
}
