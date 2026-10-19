#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define QUIPUS_USB_HEADER_BYTES 56u
#define QUIPUS_USB_MAX_PAYLOAD 1024u
#define QUIPUS_USB_PACKET_BYTES (QUIPUS_USB_HEADER_BYTES + QUIPUS_USB_MAX_PAYLOAD)
#define QUIPUS_USB_PROTOCOL_VERSION 1u

typedef enum {
  QUIPUS_USB_HELLO = 1,
  QUIPUS_USB_READY = 2,
  QUIPUS_USB_START = 3,
  QUIPUS_USB_AUDIO = 4,
  QUIPUS_USB_STOP = 5,
  QUIPUS_USB_ERROR = 6,
} quipus_usb_packet_type_t;

typedef struct {
  uint8_t type;
  uint16_t payload_bytes;
  uint32_t sequence;
  uint64_t monotonic_us;
  uint8_t session[16];
  uint8_t nonce[16];
  uint8_t payload[QUIPUS_USB_MAX_PAYLOAD];
} quipus_usb_packet_t;

typedef struct {
  uint8_t bytes[QUIPUS_USB_PACKET_BYTES * 2];
  size_t used;
} quipus_usb_parser_t;

typedef void (*quipus_usb_packet_callback_t)(const quipus_usb_packet_t *packet, void *context);
size_t quipus_usb_encode(const quipus_usb_packet_t *packet, uint8_t *out, size_t capacity);
void quipus_usb_parser_feed(quipus_usb_parser_t *parser, const uint8_t *bytes, size_t count,
                            quipus_usb_packet_callback_t callback, void *context);
bool quipus_usb_uuid(const char *text, uint8_t out[16]);
