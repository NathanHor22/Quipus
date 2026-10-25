#include <stdio.h>
#include <string.h>

#include "quipus_ota_policy.h"

#define CHECK(condition)                                                    \
  do {                                                                      \
    if (!(condition)) {                                                     \
      fprintf(stderr, "%s:%d: %s\n", __FILE__, __LINE__, #condition);       \
      return 1;                                                             \
    }                                                                       \
  } while (0)

#define PREFIX "https://example.supabase.co/storage/v1/object/sign/firmware/"
#define SLOT 0x3f0000u

static quipus_ota_offer_t offer(const char *version, const char *url, uint32_t size) {
  quipus_ota_offer_t value;
  memset(&value, 0, sizeof(value));
  snprintf(value.version, sizeof(value.version), "%s", version);
  snprintf(value.url, sizeof(value.url), "%s", url);
  memset(value.sha256, 'a', QUIPUS_OTA_SHA256_HEX);
  value.size = size;
  return value;
}

static quipus_ota_window_t idle_window(void) {
  quipus_ota_window_t window = {
      .ready = true, .phone_audio_idle = true, .external_power = true,
      .battery_level = -1, .user_idle_ms = QUIPUS_OTA_IDLE_MS};
  return window;
}

int main(void) {
  quipus_version_t a, b;
  CHECK(quipus_version_parse("0.13.0-quipus", &a) && a.major == 0 && a.minor == 13 && a.patch == 0);
  CHECK(quipus_version_parse("1.2.3", &b) && quipus_version_compare(&a, &b) < 0);
  CHECK(quipus_version_parse("0.12.9-quipus-experimental", &b) && quipus_version_compare(&a, &b) > 0);
  CHECK(quipus_version_parse("0.13.10", &b) && quipus_version_compare(&a, &b) < 0);
  CHECK(!quipus_version_parse("", &a));
  CHECK(!quipus_version_parse("0.13", &a));
  CHECK(!quipus_version_parse("0.13.0.1", &a));
  CHECK(!quipus_version_parse("0.13.0-Quipus", &a));
  CHECK(!quipus_version_parse("0.13.0-qu\"ipus", &a));
  CHECK(!quipus_version_parse("123456.0.0", &a));
  CHECK(!quipus_version_parse(NULL, &a));

  const char *url = PREFIX "Waveshare/0.13.1-quipus/lantern.bin?token=abc";
  quipus_ota_offer_t good = offer("0.13.1-quipus", url, 3300000);
  CHECK(quipus_ota_validate_offer(&good, "0.13.0-quipus", SLOT, PREFIX) == QUIPUS_OTA_OFFER_OK);
  // Same, older or unparsable running versions never reinstall or downgrade.
  CHECK(quipus_ota_validate_offer(&good, "0.13.1-quipus", SLOT, PREFIX) == QUIPUS_OTA_OFFER_NOT_NEWER);
  CHECK(quipus_ota_validate_offer(&good, "0.14.0-quipus", SLOT, PREFIX) == QUIPUS_OTA_OFFER_NOT_NEWER);
  CHECK(quipus_ota_validate_offer(&good, "dirty", SLOT, PREFIX) == QUIPUS_OTA_OFFER_NOT_NEWER);
  // The image must fit the spare slot.
  quipus_ota_offer_t large = offer("0.13.1-quipus", url, SLOT + 1);
  CHECK(quipus_ota_validate_offer(&large, "0.13.0-quipus", SLOT, PREFIX) == QUIPUS_OTA_OFFER_TOO_LARGE);
  quipus_ota_offer_t empty = offer("0.13.1-quipus", url, 0);
  CHECK(quipus_ota_validate_offer(&empty, "0.13.0-quipus", SLOT, PREFIX) == QUIPUS_OTA_OFFER_INVALID);
  // Checksums are exactly 64 lower-case hex digits.
  quipus_ota_offer_t upper = good;
  upper.sha256[3] = 'A';
  CHECK(quipus_ota_validate_offer(&upper, "0.13.0-quipus", SLOT, PREFIX) == QUIPUS_OTA_OFFER_INVALID);
  quipus_ota_offer_t short_sha = good;
  short_sha.sha256[10] = '\0';
  CHECK(quipus_ota_validate_offer(&short_sha, "0.13.0-quipus", SLOT, PREFIX) == QUIPUS_OTA_OFFER_INVALID);
  // Only the trusted HTTPS firmware prefix is accepted.
  const char *untrusted[] = {
      "http://example.supabase.co/storage/v1/object/sign/firmware/a.bin",
      "https://example.supabase.co.evil.test/storage/v1/object/sign/firmware/a.bin",
      "https://example.supabase.co/storage/v1/object/sign/recordings/a.bin",
      PREFIX "../recordings/a.bin",
      PREFIX "%2e%2e/recordings/a.bin",
      PREFIX "a b.bin",
      PREFIX "a.bin#fragment",
      PREFIX,
  };
  for (size_t i = 0; i < sizeof(untrusted) / sizeof(untrusted[0]); i++) {
    quipus_ota_offer_t bad = offer("0.13.1-quipus", untrusted[i], 3300000);
    CHECK(quipus_ota_validate_offer(&bad, "0.13.0-quipus", SLOT, PREFIX) == QUIPUS_OTA_OFFER_UNTRUSTED_URL);
  }
  CHECK(quipus_ota_validate_offer(&good, "0.13.0-quipus", SLOT, "http://insecure/") == QUIPUS_OTA_OFFER_UNTRUSTED_URL);
  CHECK(quipus_ota_validate_offer(&good, "0.13.0-quipus", SLOT, "https://example.supabase.co") == QUIPUS_OTA_OFFER_UNTRUSTED_URL);

  quipus_ota_window_t window = idle_window();
  CHECK(quipus_ota_window_open(&window));
  window.ready = false; CHECK(!quipus_ota_window_open(&window)); window = idle_window();
  window.recording = true; CHECK(!quipus_ota_window_open(&window)); window = idle_window();
  window.uploads_pending = true; CHECK(!quipus_ota_window_open(&window)); window = idle_window();
  window.sync_busy = true; CHECK(!quipus_ota_window_open(&window)); window = idle_window();
  window.phone_audio_idle = false; CHECK(!quipus_ota_window_open(&window)); window = idle_window();
  window.shutting_down = true; CHECK(!quipus_ota_window_open(&window)); window = idle_window();
  window.user_idle_ms = QUIPUS_OTA_IDLE_MS - 1; CHECK(!quipus_ota_window_open(&window)); window = idle_window();
  // On battery: allowed only with enough charge; USB-only boards report -1.
  window.external_power = false; CHECK(quipus_ota_window_open(&window));
  window.battery_level = QUIPUS_OTA_MIN_BATTERY - 1; CHECK(!quipus_ota_window_open(&window));
  window.battery_level = QUIPUS_OTA_MIN_BATTERY; CHECK(quipus_ota_window_open(&window));
  CHECK(!quipus_ota_window_open(NULL));

  uint8_t digest[32];
  for (int i = 0; i < 32; i++) digest[i] = (uint8_t)(i * 9);
  char hex[QUIPUS_OTA_SHA256_HEX + 1];
  quipus_ota_hex(digest, hex);
  CHECK(strlen(hex) == 64 && !strncmp(hex, "0009121b242d363f", 16));

  puts("ota policy tests passed");
  return 0;
}
