#include "quipus_ble_transfer.h"
#include <string.h>

void quipus_ble_transfer_clear(quipus_ble_transfer_t *transfer) {
  // Credentials must not survive cancellation, disconnect or a failed frame.
  volatile unsigned char *bytes = (volatile unsigned char *)transfer;
  for (size_t i = 0; i < sizeof(*transfer); ++i) bytes[i] = 0;
}

bool quipus_ble_transfer_write(quipus_ble_transfer_t *t, const uint8_t *frame,
                               size_t length, uint64_t now_ms, bool *complete) {
  *complete = false;
  if (!frame || !length || length > 20) goto invalid;
  if (frame[0] == QUIPUS_BLE_CANCEL && length == 1) {
    quipus_ble_transfer_clear(t);
    return true;
  }
  if (frame[0] == QUIPUS_BLE_BEGIN && length == 3) {
    quipus_ble_transfer_clear(t);
    t->expected = frame[1] | ((size_t)frame[2] << 8);
    if (!t->expected || t->expected > QUIPUS_BLE_SETUP_MAX) goto invalid;
    t->deadline_ms = now_ms + 30000;
    return true;
  }
  if (!t->expected || now_ms >= t->deadline_ms) goto invalid;
  if (frame[0] == QUIPUS_BLE_DATA && length > 3) {
    uint16_t sequence = frame[1] | ((uint16_t)frame[2] << 8);
    if (sequence != t->sequence || t->received + length - 3 > t->expected ||
        memchr(frame + 3, 0, length - 3)) goto invalid;
    memcpy(t->body + t->received, frame + 3, length - 3);
    t->received += length - 3;
    ++t->sequence;
    return true;
  }
  if (frame[0] == QUIPUS_BLE_COMMIT && length == 1 && t->received == t->expected) {
    *complete = true;
    return true;
  }
invalid:
  quipus_ble_transfer_clear(t);
  return false;
}
