#pragma once
#include <stdbool.h>
void test_codec_log(bool error, const char *tag, const char *format, ...);
#define ESP_LOGE(...) test_codec_log(true, __VA_ARGS__)
#define ESP_LOGW(...) test_codec_log(false, __VA_ARGS__)
