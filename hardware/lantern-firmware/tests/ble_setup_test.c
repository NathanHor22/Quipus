#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "quipus_ble_transfer.h"
#include "quipus_setup_form.h"

int main(void) {
  quipus_ble_transfer_t transfer = {0};
  bool complete = false;
  const char *body = "ssid=Office+%26+Lab&password=a%2Bb%26c%3Dd123&code=ABCDE-23456";
  size_t length = strlen(body);
  uint8_t begin[] = {QUIPUS_BLE_BEGIN, (uint8_t)length, 0};
  assert(quipus_ble_transfer_write(&transfer, begin, 3, 10, &complete));
  for (size_t offset = 0, seq = 0; offset < length; offset += 17, ++seq) {
    uint8_t frame[20] = {QUIPUS_BLE_DATA, (uint8_t)seq, 0};
    size_t count = length - offset > 17 ? 17 : length - offset;
    memcpy(frame + 3, body + offset, count);
    assert(quipus_ble_transfer_write(&transfer, frame, count + 3, 20, &complete));
    assert(!complete); // No partial packet can become a saved setup.
  }
  uint8_t commit[] = {QUIPUS_BLE_COMMIT};
  assert(quipus_ble_transfer_write(&transfer, commit, 1, 30, &complete) && complete);
  quipus_setup_form_t form;
  assert(quipus_setup_parse_form(transfer.body, transfer.received, &form));
  assert(!strcmp(form.ssid, "Office & Lab"));
  assert(!strcmp(form.password, "a+b&c=d123"));
  assert(quipus_setup_normalize_pairing_code(form.pairing_code));
  assert(!strcmp(form.pairing_code, "ABCDE23456"));
  quipus_ble_transfer_clear(&transfer); // Also called on BLE disconnect.
  for (size_t i = 0; i < sizeof(transfer); ++i)
    assert(((const unsigned char *)&transfer)[i] == 0);
  assert(!quipus_ble_transfer_write(&transfer, commit, 1, 40, &complete));

  assert(quipus_ble_transfer_write(&transfer, begin, 3, 0, &complete));
  assert(!quipus_ble_transfer_write(&transfer, commit, 1, 1, &complete));
  assert(!complete && !transfer.expected);
  assert(quipus_ble_transfer_write(&transfer, begin, 3, 0, &complete));
  uint8_t out_of_order[] = {QUIPUS_BLE_DATA, 1, 0, 'x'};
  assert(!quipus_ble_transfer_write(&transfer, out_of_order, 4, 1, &complete));
  assert(!transfer.expected);
  uint8_t excessive[] = {QUIPUS_BLE_BEGIN, 1, 4};
  assert(!quipus_ble_transfer_write(&transfer, excessive, 3, 1, &complete));
  uint8_t empty[] = {QUIPUS_BLE_BEGIN, 0, 0};
  assert(!quipus_ble_transfer_write(&transfer, empty, 3, 1, &complete));
  assert(quipus_ble_transfer_write(&transfer, begin, 3, 0, &complete));
  uint8_t data[] = {QUIPUS_BLE_DATA, 0, 0, 'a'};
  assert(!quipus_ble_transfer_write(&transfer, data, 4, 30000, &complete));
  assert(quipus_ble_transfer_write(&transfer, begin, 3, 0, &complete));
  data[3] = 0;
  assert(!quipus_ble_transfer_write(&transfer, data, 4, 1, &complete));
  assert(quipus_ble_transfer_write(&transfer, begin, 3, 0, &complete));
  uint8_t cancel[] = {QUIPUS_BLE_CANCEL};
  assert(quipus_ble_transfer_write(&transfer, cancel, 1, 1, &complete));
  assert(!transfer.expected && !transfer.body[0]);
  puts("BLE setup: complete transfer only, encoded credentials, replay, ordering, bounds, deadline and credential clearing passed.");
}
