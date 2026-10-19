#include "quipus_phone_audio.h"
#include "sdkconfig.h"
#include <stdio.h>
#include <string.h>

#if CONFIG_QUIPUS_PHONE_USB_AUDIO
#if CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG
#error "Phone USB audio needs the USB serial/JTAG data channel. Move console logs to UART."
#endif
#include "driver/usb_serial_jtag.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "lantern_sd.h"
#include "quipus_usb_protocol.h"

#define FRAME_SAMPLES 512u
#define QUEUE_FRAMES 16u
#define MAX_MISSING_FRAMES 32u

static QueueHandle_t s_frames;
static SemaphoreHandle_t s_state_mutex, s_tx_mutex, s_finished, s_phone_stopped;
static quipus_phone_audio_status_t s_status;
static quipus_usb_parser_t s_parser;
static uint8_t s_session[16], s_nonce[16];
static char s_session_id[37];
static bool s_active, s_failed, s_draining, s_closing;
typedef struct {
  quipus_usb_packet_t packet;
  uint64_t received_us;
} received_frame_t;
static int64_t s_last_seen;

static bool equal16(const uint8_t *a, const uint8_t *b) {
  uint8_t difference = 0;
  for (unsigned i = 0; i < 16; i++)
    difference |= a[i] ^ b[i];
  return difference == 0;
}
static void control(uint8_t type) {
  quipus_usb_packet_t packet = {.type = type, .monotonic_us = (uint64_t)esp_timer_get_time()};
  xSemaphoreTake(s_state_mutex, portMAX_DELAY);
  memcpy(packet.session, s_session, 16);
  memcpy(packet.nonce, s_nonce, 16);
  xSemaphoreGive(s_state_mutex);
  uint8_t bytes[QUIPUS_USB_HEADER_BYTES];
  size_t length = quipus_usb_encode(&packet, bytes, sizeof(bytes));
  if (xSemaphoreTake(s_tx_mutex, pdMS_TO_TICKS(30)) == pdTRUE) {
    usb_serial_jtag_write_bytes(bytes, length, pdMS_TO_TICKS(20));
    xSemaphoreGive(s_tx_mutex);
  }
}
static void receive(const quipus_usb_packet_t *packet, void *context) {
  (void)context;
  if (packet->type == QUIPUS_USB_HELLO && packet->payload_bytes == 0) {
    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
    s_status.connected = true;
    s_last_seen = esp_timer_get_time();
    uint8_t reply = s_active ? ((s_failed || s_closing) ? QUIPUS_USB_STOP : QUIPUS_USB_START)
                             : QUIPUS_USB_READY;
    xSemaphoreGive(s_state_mutex);
    control(reply);
    return;
  }
  xSemaphoreTake(s_state_mutex, portMAX_DELAY);
  bool valid = s_active && !s_failed && equal16(packet->session, s_session) &&
               equal16(packet->nonce, s_nonce);
  if (valid && packet->type == QUIPUS_USB_STOP && packet->payload_bytes == 0 && s_closing) {
    s_status.recording = false;
    xSemaphoreGive(s_phone_stopped);
  }
  if (valid && packet->type == QUIPUS_USB_ERROR && packet->payload_bytes == 0) {
    s_failed = true;
    s_status.recording = false;
    s_status.error = ESP_FAIL;
    s_status.disconnects++;
    if (s_closing)
      xSemaphoreGive(s_phone_stopped);
  }
  if (valid && packet->type == QUIPUS_USB_AUDIO && packet->payload_bytes > 0 &&
      packet->payload_bytes % 2 == 0) {
    s_last_seen = esp_timer_get_time();
    received_frame_t frame = {.packet = *packet, .received_us = (uint64_t)esp_timer_get_time()};
    if (xQueueSend(s_frames, &frame, 0) != pdTRUE)
      s_status.dropped_packets++;
  }
  xSemaphoreGive(s_state_mutex);
}
static void usb_task(void *unused) {
  (void)unused;
  uint8_t bytes[256];
  while (true) {
    int count = usb_serial_jtag_read_bytes(bytes, sizeof(bytes), pdMS_TO_TICKS(50));
    if (count > 0)
      quipus_usb_parser_feed(&s_parser, bytes, (size_t)count, receive, NULL);
    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
    if (s_status.connected && esp_timer_get_time() - s_last_seen > 2500000) {
      s_status.connected = false;
      if (s_active && s_status.recording) {
        s_status.disconnects++;
        s_status.recording = false;
        s_failed = true;
      }
    }
    xSemaphoreGive(s_state_mutex);
    taskYIELD();
  }
}
static void writer_task(void *unused) {
  (void)unused;
  received_frame_t frame;
  uint32_t next = 0;
  bool opened = false, writer_failed = false;
  static const int16_t silence[FRAME_SAMPLES] = {0};
  static char first_timing[768];
  while (true) {
    if (xQueueReceive(s_frames, &frame, pdMS_TO_TICKS(100)) != pdTRUE) {
      xSemaphoreTake(s_state_mutex, portMAX_DELAY);
      bool finish_requested = s_draining && uxQueueMessagesWaiting(s_frames) == 0;
      xSemaphoreGive(s_state_mutex);
      if (!finish_requested)
        continue;
      // Closing is a state request, not a queue item: a full/stalled queue can
      // never lose STOP and permanently prevent the next meeting.
      esp_err_t result = opened ? lantern_sd_phone_finish() : ESP_OK;
      xSemaphoreTake(s_state_mutex, portMAX_DELAY);
      if (result != ESP_OK)
        s_status.error = result;
      s_status.recording = false;
      s_status.stored = opened && result == ESP_OK;
      s_draining = false;
      xSemaphoreGive(s_state_mutex);
      opened = false;
      writer_failed = false;
      next = 0;
      xSemaphoreGive(s_finished);
      continue;
    }
    const quipus_usb_packet_t *packet = &frame.packet;
    if (packet->type != QUIPUS_USB_AUDIO || writer_failed)
      continue;
    if (!opened) {
      if (packet->sequence > MAX_MISSING_FRAMES)
        continue;
      esp_err_t result = lantern_sd_phone_begin(s_session_id);
      if (result != ESP_OK) {
        xSemaphoreTake(s_state_mutex, portMAX_DELAY);
        s_status.error = result;
        s_failed = true;
        writer_failed = true;
        xSemaphoreGive(s_state_mutex);
        continue;
      }
      opened = true;
      // Journal the clock anchor before the first PCM block can reach disk.
      xSemaphoreTake(s_state_mutex, portMAX_DELAY);
      s_status.first_packet_device_us = frame.received_us;
      s_status.first_packet_phone_us = packet->monotonic_us;
      s_status.last_packet_device_us = frame.received_us;
      s_status.last_packet_phone_us = packet->monotonic_us;
      xSemaphoreGive(s_state_mutex);
      quipus_phone_audio_timing_json(first_timing, sizeof(first_timing));
      result = lantern_sd_set_phone_timing(first_timing);
      if (result != ESP_OK) {
        xSemaphoreTake(s_state_mutex, portMAX_DELAY);
        s_status.error = result;
        s_failed = true;
        writer_failed = true;
        xSemaphoreGive(s_state_mutex);
        continue;
      }
    }
    if (packet->sequence < next)
      continue; // Discard duplicate/replayed frames.
    uint32_t missing = packet->sequence - next;
    if (missing > MAX_MISSING_FRAMES) {
      xSemaphoreTake(s_state_mutex, portMAX_DELAY);
      s_failed = true;
      writer_failed = true;
      s_status.error = ESP_ERR_TIMEOUT;
      xSemaphoreGive(s_state_mutex);
      continue;
    }
    esp_err_t write_result = ESP_OK;
    for (uint32_t i = 0; i < missing && write_result == ESP_OK; i++)
      write_result = lantern_sd_phone_write(silence, FRAME_SAMPLES);
    int16_t samples[FRAME_SAMPLES];
    size_t count = packet->payload_bytes / 2;
    for (size_t i = 0; i < count; i++)
      samples[i] =
          (int16_t)((uint16_t)packet->payload[i * 2] | ((uint16_t)packet->payload[i * 2 + 1] << 8));
    if (write_result == ESP_OK)
      write_result = lantern_sd_phone_write(samples, count);
    if (write_result != ESP_OK) {
      xSemaphoreTake(s_state_mutex, portMAX_DELAY);
      s_status.error = write_result;
      s_status.recording = false;
      s_failed = true;
      writer_failed = true;
      xSemaphoreGive(s_state_mutex);
      continue;
    }
    next = packet->sequence + 1;
    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
    uint64_t now = frame.received_us;
    s_status.last_packet_device_us = now;
    s_status.last_packet_phone_us = packet->monotonic_us;
    s_status.received_samples += (uint32_t)count + missing * FRAME_SAMPLES;
    s_status.missing_samples += missing * FRAME_SAMPLES;
    s_status.recording = !s_failed;
    xSemaphoreGive(s_state_mutex);
  }
}

static void free_resources(void) {
  if (s_frames)
    vQueueDelete(s_frames);
  if (s_state_mutex)
    vSemaphoreDelete(s_state_mutex);
  if (s_tx_mutex)
    vSemaphoreDelete(s_tx_mutex);
  if (s_finished)
    vSemaphoreDelete(s_finished);
  if (s_phone_stopped)
    vSemaphoreDelete(s_phone_stopped);
  s_frames = NULL;
  s_state_mutex = s_tx_mutex = s_finished = s_phone_stopped = NULL;
}

esp_err_t quipus_phone_audio_init(void) {
  if (s_status.enabled)
    return ESP_OK;
  s_frames = xQueueCreate(QUEUE_FRAMES, sizeof(received_frame_t));
  s_state_mutex = xSemaphoreCreateMutex();
  s_tx_mutex = xSemaphoreCreateMutex();
  s_finished = xSemaphoreCreateBinary();
  s_phone_stopped = xSemaphoreCreateBinary();
  if (!s_frames || !s_state_mutex || !s_tx_mutex || !s_finished || !s_phone_stopped) {
    free_resources();
    return ESP_ERR_NO_MEM;
  }
  usb_serial_jtag_driver_config_t config = {.tx_buffer_size = 2048, .rx_buffer_size = 4096};
  esp_err_t result = usb_serial_jtag_driver_install(&config);
  if (result != ESP_OK) {
    free_resources();
    return result;
  }
  TaskHandle_t usb_handle = NULL, writer_handle = NULL;
  BaseType_t usb_created = xTaskCreate(usb_task, "phone_usb", 6144, NULL, 3, &usb_handle);
  BaseType_t writer_created = xTaskCreate(writer_task, "phone_sd", 6144, NULL, 3, &writer_handle);
  if (usb_created != pdPASS || writer_created != pdPASS) {
    if (usb_handle)
      vTaskDelete(usb_handle);
    if (writer_handle)
      vTaskDelete(writer_handle);
    usb_serial_jtag_driver_uninstall();
    free_resources();
    return ESP_ERR_NO_MEM;
  }
  s_status.enabled = true;
  return ESP_OK;
}
esp_err_t quipus_phone_audio_begin(const char *session_id) {
  if (!s_status.enabled)
    return ESP_ERR_INVALID_STATE;
  uint8_t session[16];
  if (!quipus_usb_uuid(session_id, session))
    return ESP_ERR_INVALID_ARG;
  xSemaphoreTake(s_state_mutex, portMAX_DELAY);
  if (s_active || s_draining) {
    xSemaphoreGive(s_state_mutex);
    return ESP_ERR_INVALID_STATE;
  }
  bool connected = s_status.connected;
  memset(&s_status, 0, sizeof(s_status));
  s_status.enabled = true;
  s_status.connected = connected;
  memcpy(s_session, session, 16);
  memcpy(s_session_id, session_id, 37);
  esp_fill_random(s_nonce, 16);
  s_status.device_started_us = (uint64_t)esp_timer_get_time();
  s_active = true;
  s_failed = false;
  s_closing = false;
  xSemaphoreGive(s_state_mutex);
  control(QUIPUS_USB_START);
  return ESP_OK;
}
esp_err_t quipus_phone_audio_stop(void) {
  if (!s_status.enabled)
    return ESP_OK;
  xSemaphoreTake(s_state_mutex, portMAX_DELAY);
  bool active = s_active;
  bool draining = s_draining;
  bool wait_phone = active && s_status.connected && s_status.received_samples > 0 && !s_failed;
  if (active) {
    xSemaphoreTake(s_finished, 0);
    xSemaphoreTake(s_phone_stopped, 0);
    s_closing = true;
  }
  xSemaphoreGive(s_state_mutex);
  if (!active && !draining)
    return ESP_OK;
  if (active) {
    control(QUIPUS_USB_STOP);
    bool acknowledged =
        !wait_phone || xSemaphoreTake(s_phone_stopped, pdMS_TO_TICKS(2500)) == pdTRUE;
    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
    s_active = false;
    s_closing = false;
    s_draining = true;
    if (!acknowledged) {
      s_status.disconnects++;
      s_status.error = ESP_ERR_TIMEOUT;
    }
    xSemaphoreGive(s_state_mutex);
  }
  if (xSemaphoreTake(s_finished, pdMS_TO_TICKS(4000)) != pdTRUE)
    return ESP_ERR_TIMEOUT;
  quipus_phone_audio_status_t status;
  quipus_phone_audio_get_status(&status);
  return status.error;
}
bool quipus_phone_audio_idle(void) {
  if (!s_state_mutex)
    return true;
  xSemaphoreTake(s_state_mutex, portMAX_DELAY);
  bool idle = !s_active && !s_draining && !s_closing;
  xSemaphoreGive(s_state_mutex);
  return idle;
}
void quipus_phone_audio_get_status(quipus_phone_audio_status_t *status) {
  if (!status)
    return;
  if (!s_state_mutex) {
    memset(status, 0, sizeof(*status));
    return;
  }
  xSemaphoreTake(s_state_mutex, portMAX_DELAY);
  *status = s_status;
  xSemaphoreGive(s_state_mutex);
}
#else
esp_err_t quipus_phone_audio_init(void) { return ESP_OK; }
esp_err_t quipus_phone_audio_begin(const char *session_id) {
  (void)session_id;
  return ESP_OK;
}
esp_err_t quipus_phone_audio_stop(void) { return ESP_OK; }
bool quipus_phone_audio_idle(void) { return true; }
void quipus_phone_audio_get_status(quipus_phone_audio_status_t *status) {
  if (status)
    memset(status, 0, sizeof(*status));
}
#endif

void quipus_phone_audio_timing_json(char *out, size_t capacity) {
  if (!out || !capacity)
    return;
  quipus_phone_audio_status_t s;
  quipus_phone_audio_get_status(&s);
  int result = snprintf(
      out, capacity,
      "{\"version\":1,\"sampleRate\":16000,\"channels\":1,\"deviceStartedUs\":%llu,"
      "\"firstPacketDeviceUs\":%llu,\"lastPacketDeviceUs\":%llu,\"firstPacketPhoneUs\":%llu,"
      "\"lastPacketPhoneUs\":%llu,\"receivedSamples\":%lu,\"missingSamples\":%lu,"
      "\"droppedPackets\":%lu,\"disconnects\":%lu}",
      (unsigned long long)s.device_started_us, (unsigned long long)s.first_packet_device_us,
      (unsigned long long)s.last_packet_device_us, (unsigned long long)s.first_packet_phone_us,
      (unsigned long long)s.last_packet_phone_us, (unsigned long)s.received_samples,
      (unsigned long)s.missing_samples, (unsigned long)s.dropped_packets,
      (unsigned long)s.disconnects);
  if (result < 0 || (size_t)result >= capacity) {
    out[0] = '{';
    if (capacity > 1)
      out[1] = '}';
    if (capacity > 2)
      out[2] = '\0';
    else
      out[capacity - 1] = '\0';
  }
}
