#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define QUIPUS_BLE_SETUP_MAX 1024
// Framing fits even the default 23-byte ATT MTU. Writes require responses.
enum { QUIPUS_BLE_BEGIN = 1, QUIPUS_BLE_DATA, QUIPUS_BLE_COMMIT,
       QUIPUS_BLE_CANCEL, QUIPUS_BLE_SCAN };
typedef struct {
  char body[QUIPUS_BLE_SETUP_MAX + 1];
  size_t expected, received;
  uint16_t sequence;
  uint64_t deadline_ms;
} quipus_ble_transfer_t;
void quipus_ble_transfer_clear(quipus_ble_transfer_t *transfer);
bool quipus_ble_transfer_write(quipus_ble_transfer_t *transfer,
                               const uint8_t *frame, size_t length,
                               uint64_t now_ms, bool *complete);
