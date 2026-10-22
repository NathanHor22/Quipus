#pragma once
#define ESP_RETURN_ON_ERROR(call, tag, message, ...) do { \
  esp_err_t checked = (call); if (checked != ESP_OK) return checked; \
} while (0)
