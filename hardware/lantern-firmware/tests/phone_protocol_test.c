#include "quipus_usb_protocol.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(condition)                                                                           \
  do {                                                                                             \
    if (!(condition)) {                                                                            \
      fprintf(stderr, "USB protocol check failed at line %d\n", __LINE__);                         \
      exit(1);                                                                                     \
    }                                                                                              \
  } while (0)

static unsigned decoded_count;
static quipus_usb_packet_t last;
static void decoded(const quipus_usb_packet_t *packet, void *context) {
  (void)context;
  decoded_count++;
  last = *packet;
}

int main(void) {
  quipus_usb_packet_t hello = {.type = QUIPUS_USB_HELLO};
  uint8_t bytes[QUIPUS_USB_PACKET_BYTES];
  CHECK(quipus_usb_encode(&hello, bytes, sizeof(bytes)) == 56);
  // Independent Python zlib vector, also asserted by Android's Java tests.
  const uint8_t crc[4] = {0x82, 0x2e, 0xf0, 0xf1};
  CHECK(!memcmp(bytes, "QPA1", 4) && !memcmp(bytes + 52, crc, 4));
  CHECK(!quipus_usb_encode(&hello, bytes, 55));

  quipus_usb_packet_t source = {
      .type = QUIPUS_USB_AUDIO, .payload_bytes = 1024, .sequence = 123, .monotonic_us = 123456789};
  memset(source.session, 3, 16);
  memset(source.nonce, 9, 16);
  for (unsigned i = 0; i < source.payload_bytes; i++)
    source.payload[i] = (uint8_t)i;
  size_t length = quipus_usb_encode(&source, bytes, sizeof(bytes));
  quipus_usb_parser_t parser = {0};
  for (size_t i = 0; i < length; i++)
    quipus_usb_parser_feed(&parser, bytes + i, 1, decoded, NULL);
  CHECK(decoded_count == 1 && last.sequence == 123 && last.monotonic_us == 123456789);
  CHECK(!memcmp(last.session, source.session, 16) && !memcmp(last.nonce, source.nonce, 16));
  CHECK(last.payload_bytes == 1024 && !memcmp(last.payload, source.payload, 1024));
  CHECK(parser.used == 0);

  uint8_t noise[513];
  memset(noise, 33, sizeof(noise));
  for (unsigned i = 0; i < 200; i++)
    quipus_usb_parser_feed(&parser, noise, sizeof(noise), decoded, NULL);
  uint8_t corrupt[QUIPUS_USB_PACKET_BYTES];
  memcpy(corrupt, bytes, length);
  corrupt[90] ^= 1;
  quipus_usb_parser_feed(&parser, corrupt, length, decoded, NULL);
  corrupt[6] = 0xff;
  corrupt[7] = 0x7f;
  quipus_usb_parser_feed(&parser, corrupt, length, decoded, NULL);
  quipus_usb_parser_feed(&parser, bytes, length, decoded, NULL);
  CHECK(decoded_count == 2 && last.sequence == 123);
  CHECK(parser.used < QUIPUS_USB_HEADER_BYTES);

  uint8_t uuid[16];
  CHECK(quipus_usb_uuid("11111111-1111-4111-8111-111111111111", uuid));
  CHECK(uuid[0] == 0x11 && uuid[6] == 0x41 && uuid[8] == 0x81);
  CHECK(!quipus_usb_uuid("11111111_1111-4111-8111-111111111111", uuid));
  CHECK(!quipus_usb_uuid("11111111-1111-4111-8111-11111111111z", uuid));
  CHECK(!quipus_usb_uuid("short", uuid));
  source.payload_bytes = 1025;
  CHECK(!quipus_usb_encode(&source, bytes, sizeof(bytes)));
  puts("Phone USB protocol: framing, independent CRC, fragmentation, corruption, bounds and UUID "
       "checks passed.");
  return 0;
}
