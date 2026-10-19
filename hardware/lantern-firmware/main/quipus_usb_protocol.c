#include "quipus_usb_protocol.h"

#include <string.h>

static uint32_t crc_part(uint32_t crc, const uint8_t *bytes, size_t count) {
  for (size_t i = 0; i < count; ++i) {
    crc ^= bytes[i];
    for (unsigned bit = 0; bit < 8; ++bit)
      crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1u)));
  }
  return crc;
}
static uint16_t u16(const uint8_t *p) { return (uint16_t)p[0] | ((uint16_t)p[1] << 8); }
static uint32_t u32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static uint64_t u64(const uint8_t *p) { return (uint64_t)u32(p) | ((uint64_t)u32(p + 4) << 32); }
static void put32(uint8_t *p, uint32_t v) {
  for (unsigned i = 0; i < 4; ++i)
    p[i] = (uint8_t)(v >> (i * 8));
}
static void put64(uint8_t *p, uint64_t v) {
  for (unsigned i = 0; i < 8; ++i)
    p[i] = (uint8_t)(v >> (i * 8));
}

size_t quipus_usb_encode(const quipus_usb_packet_t *p, uint8_t *out, size_t capacity) {
  if (!p || !out || p->type < QUIPUS_USB_HELLO || p->type > QUIPUS_USB_ERROR ||
      p->payload_bytes > QUIPUS_USB_MAX_PAYLOAD ||
      capacity < QUIPUS_USB_HEADER_BYTES + p->payload_bytes)
    return 0;
  memset(out, 0, QUIPUS_USB_HEADER_BYTES);
  memcpy(out, "QPA1", 4);
  out[4] = QUIPUS_USB_PROTOCOL_VERSION;
  out[5] = p->type;
  out[6] = (uint8_t)p->payload_bytes;
  out[7] = (uint8_t)(p->payload_bytes >> 8);
  put32(out + 8, p->sequence);
  put64(out + 12, p->monotonic_us);
  memcpy(out + 20, p->session, 16);
  memcpy(out + 36, p->nonce, 16);
  memcpy(out + QUIPUS_USB_HEADER_BYTES, p->payload, p->payload_bytes);
  uint32_t crc = crc_part(0xffffffffu, out, 52);
  crc = crc_part(crc, p->payload, p->payload_bytes) ^ 0xffffffffu;
  put32(out + 52, crc);
  return QUIPUS_USB_HEADER_BYTES + p->payload_bytes;
}

static void parse(quipus_usb_parser_t *parser, quipus_usb_packet_callback_t callback,
                  void *context) {
  while (parser->used >= QUIPUS_USB_HEADER_BYTES) {
    uint8_t *b = parser->bytes;
    if (memcmp(b, "QPA1", 4) || b[4] != QUIPUS_USB_PROTOCOL_VERSION || b[5] < QUIPUS_USB_HELLO ||
        b[5] > QUIPUS_USB_ERROR || u16(b + 6) > QUIPUS_USB_MAX_PAYLOAD) {
      memmove(b, b + 1, --parser->used);
      continue;
    }
    uint16_t length = u16(b + 6);
    size_t total = QUIPUS_USB_HEADER_BYTES + length;
    if (parser->used < total)
      return;
    uint32_t crc = crc_part(0xffffffffu, b, 52);
    crc = crc_part(crc, b + QUIPUS_USB_HEADER_BYTES, length) ^ 0xffffffffu;
    if (crc != u32(b + 52)) {
      memmove(b, b + 1, --parser->used);
      continue;
    }
    quipus_usb_packet_t packet = {
        .type = b[5], .payload_bytes = length, .sequence = u32(b + 8), .monotonic_us = u64(b + 12)};
    memcpy(packet.session, b + 20, 16);
    memcpy(packet.nonce, b + 36, 16);
    memcpy(packet.payload, b + QUIPUS_USB_HEADER_BYTES, length);
    parser->used -= total;
    memmove(b, b + total, parser->used);
    callback(&packet, context);
  }
}

void quipus_usb_parser_feed(quipus_usb_parser_t *parser, const uint8_t *bytes, size_t count,
                            quipus_usb_packet_callback_t callback, void *context) {
  if (!parser || !bytes || !callback)
    return;
  while (count) {
    size_t room = sizeof(parser->bytes) - parser->used;
    if (!room) {
      parser->used = 0;
      room = sizeof(parser->bytes);
    }
    size_t take = count < room ? count : room;
    memcpy(parser->bytes + parser->used, bytes, take);
    parser->used += take;
    bytes += take;
    count -= take;
    parse(parser, callback, context);
  }
}

static int nibble(char c) {
  if (c >= '0' && c <= '9')
    return c - '0';
  if (c >= 'a' && c <= 'f')
    return c - 'a' + 10;
  if (c >= 'A' && c <= 'F')
    return c - 'A' + 10;
  return -1;
}
bool quipus_usb_uuid(const char *text, uint8_t out[16]) {
  if (!text || strlen(text) != 36)
    return false;
  size_t n = 0;
  for (size_t i = 0; i < 36;) {
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (text[i++] != '-')
        return false;
      continue;
    }
    int a = nibble(text[i++]), b = nibble(text[i++]);
    if (a < 0 || b < 0 || n >= 16)
      return false;
    out[n++] = (uint8_t)((a << 4) | b);
  }
  return n == 16;
}
