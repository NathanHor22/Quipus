#include "quipus_setup_form.h"

#include <ctype.h>
#include <string.h>

static int hex_digit(unsigned char value) {
  if (value >= '0' && value <= '9')
    return value - '0';
  if (value >= 'a' && value <= 'f')
    return value - 'a' + 10;
  if (value >= 'A' && value <= 'F')
    return value - 'A' + 10;
  return -1;
}

static bool decode_value(const char *value, size_t length, char *output,
                         size_t capacity) {
  size_t written = 0;
  for (size_t index = 0; index < length; ++index) {
    unsigned char byte = (unsigned char)value[index];
    if (byte == '%') {
      if (index + 2 >= length)
        return false;
      int high = hex_digit((unsigned char)value[index + 1]);
      int low = hex_digit((unsigned char)value[index + 2]);
      if (high < 0 || low < 0)
        return false;
      byte = (unsigned char)((high << 4) | low);
      index += 2;
    } else if (byte == '+') {
      byte = ' ';
    }
    if (!byte || written + 1 >= capacity)
      return false;
    output[written++] = (char)byte;
  }
  output[written] = '\0';
  return true;
}

bool quipus_setup_parse_form(const char *body, size_t length,
                            quipus_setup_form_t *form) {
  if (!body || !form || !length || memchr(body, '\0', length))
    return false;
  quipus_setup_form_t result = {0};
  unsigned seen = 0;
  size_t offset = 0;
  while (offset < length) {
    size_t end = offset;
    while (end < length && body[end] != '&')
      ++end;
    size_t equals = offset;
    while (equals < end && body[equals] != '=')
      ++equals;
    if (equals == end)
      return false;
    const char *key = body + offset;
    size_t key_length = equals - offset;
    char *target = NULL;
    size_t capacity = 0;
    unsigned field = 0;
    if (key_length == 4 && !memcmp(key, "ssid", 4)) {
      target = result.ssid;
      capacity = sizeof(result.ssid);
      field = 1;
    } else if (key_length == 8 && !memcmp(key, "password", 8)) {
      target = result.password;
      capacity = sizeof(result.password);
      field = 2;
    } else if (key_length == 4 && !memcmp(key, "code", 4)) {
      target = result.pairing_code;
      capacity = sizeof(result.pairing_code);
      field = 4;
    } else {
      return false;
    }
    if ((seen & field) ||
        !decode_value(body + equals + 1, end - equals - 1, target, capacity))
      return false;
    seen |= field;
    offset = end + 1;
  }
  *form = result;
  return true;
}

bool quipus_setup_normalize_pairing_code(char code[21]) {
  if (!code)
    return false;
  char normalized[21] = {0};
  size_t length = 0;
  for (size_t index = 0; code[index]; ++index) {
    unsigned char value = (unsigned char)code[index];
    if (value == '-' || isspace(value))
      continue;
    // Match the dashboard/server alphabet exactly: ambiguous 0, 1, I and O
    // are never issued. Invalid codes must not enter a cloud retry loop.
    value = (unsigned char)toupper(value);
    if (!strchr("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", value) || length >= 10)
      return false;
    normalized[length++] = (char)value;
  }
  if (length != 10)
    return false;
  memcpy(code, normalized, length + 1);
  return true;
}
