#include "quipus_network_policy.h"
#include "quipus_setup_form.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(condition) do { if (!(condition)) { \
  fprintf(stderr, "check failed at line %d: %s\n", __LINE__, #condition); \
  exit(1); } } while (0)

static void form_tests(void) {
  quipus_setup_form_t form;
  const char *encoded = "ssid=Client%20WiFi&password=a%26b%2Bc%3D&code=abcde-f2345";
  CHECK(quipus_setup_parse_form(encoded, strlen(encoded), &form));
  CHECK(!strcmp(form.ssid, "Client WiFi"));
  CHECK(!strcmp(form.password, "a&b+c="));
  CHECK(quipus_setup_normalize_pairing_code(form.pairing_code));
  CHECK(!strcmp(form.pairing_code, "ABCDEF2345"));

  const char *bad[] = {"ssid=x&ssid=y", "ssid=%00", "password=%GG", "code=%",
                      "ssid=123456789012345678901234567890123", "ssid=x&bad=x",
                      "code=123456789012345678901", "ssid", "ssid=x&password=%0"};
  for (size_t i = 0; i < sizeof(bad) / sizeof(bad[0]); ++i)
    CHECK(!quipus_setup_parse_form(bad[i], strlen(bad[i]), &form));
  char code[21] = "12345\"7890";
  CHECK(!quipus_setup_normalize_pairing_code(code));
  strcpy(code, "12345678901");
  CHECK(!quipus_setup_normalize_pairing_code(code));
  char maximum[256];
  snprintf(maximum, sizeof(maximum), "ssid=%032d&password=%064d&code=", 0, 0);
  CHECK(quipus_setup_parse_form(maximum, strlen(maximum), &form));
  CHECK(strlen(form.ssid) == 32 && strlen(form.password) == 64);
  CHECK(quipus_setup_parse_form("ssid=&password=&code=", 21, &form));
}

static void network_tests(void) {
  quipus_network_policy_t policy = {0};
  quipus_network_input_t input = {.has_saved_wifi = true};
  CHECK(quipus_network_next(&policy, &input, 0) == 0);
  CHECK(quipus_network_next(&policy, &input, 2999) == 0);
  CHECK(quipus_network_next(&policy, &input, 3000) == QUIPUS_NETWORK_CONNECT);
  CHECK(quipus_network_next(&policy, &input, 3001) == 0);
  CHECK(quipus_network_next(&policy, &input, 15000) == QUIPUS_NETWORK_TRY_REMEMBERED);
  unsigned actions = quipus_network_next(&policy, &input, 18000);
  CHECK(actions & QUIPUS_NETWORK_OPEN_PORTAL);

  // Late Wi-Fi recovery still claims the pending code without rebooting.
  input.portal_active = true;
  input.wifi_connected = true;
  input.has_pairing_code = true;
  CHECK(quipus_network_next(&policy, &input, 21000) == QUIPUS_NETWORK_CLAIM);
  CHECK(quipus_network_next(&policy, &input, 21001) == 0);
  CHECK(quipus_network_next(&policy, &input, 36000) == QUIPUS_NETWORK_CLAIM);
  input.paired = true;
  CHECK(quipus_network_next(&policy, &input, 36001) == QUIPUS_NETWORK_CLOSE_PORTAL);
  input.portal_manual = true;
  CHECK(quipus_network_next(&policy, &input, 36002) == 0);
  input.connection_busy = true;
  input.wifi_connected = false;
  CHECK(quipus_network_next(&policy, &input, 100000) == 0);
  input.connection_busy = false;
  CHECK(quipus_network_next(&policy, &input, 100001) == 0);
  CHECK(quipus_network_next(&policy, &input, 103001) == QUIPUS_NETWORK_CONNECT);
  CHECK(quipus_network_next(&policy, &input, 115001) == QUIPUS_NETWORK_TRY_REMEMBERED);

  quipus_network_policy_t fresh = {0};
  quipus_network_input_t empty = {0};
  CHECK(quipus_network_next(&fresh, &empty, 0) == QUIPUS_NETWORK_OPEN_PORTAL);
  empty.portal_active = true;
  CHECK(quipus_network_next(&fresh, &empty, 300000) == 0);
}

int main(void) {
  form_tests();
  network_tests();
  puts("Network recovery and setup form tests passed");
  return 0;
}
