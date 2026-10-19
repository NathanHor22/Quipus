#include "lantern_transcript.h"

#include <stdint.h>
#include <string.h>

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#define TRANSCRIPT_CAPACITY (768 * 1024)
#define MAX_PACKET_LENGTH (64 * 1024)

static const char *TAG = "lantern_transcript";
static uint8_t *s_data;
static size_t s_size;
static unsigned s_packets;
static SemaphoreHandle_t s_lock;

esp_err_t lantern_transcript_init(void) {
  s_lock = xSemaphoreCreateMutex();
  if (!s_lock)
    return ESP_ERR_NO_MEM;
  s_data = heap_caps_malloc(TRANSCRIPT_CAPACITY,
                            MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!s_data)
    return ESP_ERR_NO_MEM;
  ESP_LOGI(TAG, "allocated %u-byte Agora caption buffer", TRANSCRIPT_CAPACITY);
  return ESP_OK;
}

void lantern_transcript_reset(void) {
  if (!s_lock || xSemaphoreTake(s_lock, pdMS_TO_TICKS(100)) != pdTRUE)
    return;
  if (s_data) {
    volatile uint8_t *bytes = s_data;
    for (size_t i = 0; i < s_size; ++i)
      bytes[i] = 0;
  }
  s_size = 0;
  s_packets = 0;
  xSemaphoreGive(s_lock);
}

bool lantern_transcript_append(const void *packet, size_t length) {
  if (!packet || !length || length > MAX_PACKET_LENGTH || !s_data || !s_lock)
    return false;
  if (xSemaphoreTake(s_lock, pdMS_TO_TICKS(100)) != pdTRUE)
    return false;
  if (s_size + sizeof(uint32_t) + length > TRANSCRIPT_CAPACITY) {
    xSemaphoreGive(s_lock);
    ESP_LOGW(TAG, "caption buffer full after %u packets", s_packets);
    return false;
  }
  uint32_t framed_length = (uint32_t)length;
  memcpy(s_data + s_size, &framed_length, sizeof(framed_length));
  memcpy(s_data + s_size + sizeof(framed_length), packet, length);
  s_size += sizeof(framed_length) + length;
  ++s_packets;
  xSemaphoreGive(s_lock);
  return true;
}

const void *lantern_transcript_data(void) { return s_data; }
size_t lantern_transcript_size(void) { return s_size; }
unsigned lantern_transcript_packet_count(void) { return s_packets; }
