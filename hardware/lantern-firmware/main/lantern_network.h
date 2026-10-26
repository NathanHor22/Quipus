#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "lantern_display.h"
#include "lantern_storage.h"
#include "quipus_setup_form.h"

#define LANTERN_WIFI_SCAN_LIMIT 5
#define LANTERN_REPORT_LIST_LIMIT 5

typedef struct {
  char ssid[33];
  int rssi;
  bool secured;
  bool remembered;
} lantern_wifi_network_t;

typedef struct {
  char id[37];
  char title[49];
  char time[17];
  char status[17];
  char summary[145];
  char action[97];
} lantern_report_item_t;

typedef struct {
  bool wifi_connected;
  int wifi_rssi;
  bool setup_portal_active;
  bool paired;
  lantern_connectivity_t connectivity;
  char setup_ssid[33];
  // The password the setup access point actually uses; shown on the device screen.
  char setup_password[17];
  char connected_ssid[33];
  char saved_ssid[33];
  char ip_address[16];
  char last_error[96];
} lantern_network_status_t;

typedef void (*lantern_network_callback_t)(
    const lantern_network_status_t *status);

typedef struct {
  char app_id[33];
  char channel[80];
  char token[512];
  uint32_t publisher_uid;
  uint32_t stt_bot_uid;
  char expires_at[40];
} lantern_agora_transport_t;

typedef struct {
  char session_id[37];
  char prompt_id[121];
  char begin_event_id[37];
  char consent_event_id[37];
  char capture_event_id[37];
  char stop_event_id[37];
  char transcript_event_id[37];
  char audio_event_id[37];
  char completion_event_id[37];
  char owner_id[37];
  char phone_event_id[37];
  bool offline_local;
  bool archive_accepted;
  bool archive_verified;
  // True only for a verified short_digital_silence completion receipt.
  bool discarded;
  bool processing_queued;
  unsigned version;
  char local_date[11];
  char local_time[9];
} lantern_cloud_session_t;

// Sets the per-device setup AP password before the portal starts. An invalid or
// missing value keeps the board's fallback password so setup always works.
void lantern_network_set_setup_password(const char *password);
esp_err_t lantern_network_start(lantern_config_t *config,
                                lantern_network_callback_t callback);
void lantern_network_get_status(lantern_network_status_t *status);
esp_err_t lantern_network_send_heartbeat(const char *state,
                                         unsigned state_version,
                                         int battery_level);
void lantern_network_set_realtime(bool enabled);
esp_err_t lantern_network_open_setup_portal(void);
// Shared validation and atomic save for local HTTP and authenticated BLE setup.
esp_err_t lantern_network_save_setup(quipus_setup_form_t *form, bool bluetooth,
                                      char *error, size_t error_capacity);
bool lantern_network_bluetooth_allowed(void);
esp_err_t lantern_network_scan_wifi(lantern_wifi_network_t *networks,
                                    size_t capacity, size_t *count);
esp_err_t lantern_network_connect_wifi(const char *ssid, const char *password);
esp_err_t lantern_network_get_reports(lantern_report_item_t *items,
                                      size_t capacity, size_t *count);
esp_err_t lantern_network_play_briefing(const char *kind, int battery_level);
// Read the last complete, authenticated same-voice report offline. No actions.
esp_err_t lantern_network_play_cached_report(void);
bool lantern_network_review_pending(void);
void lantern_network_cancel_review(void);
#define LANTERN_REPORT_INTERRUPTED ((esp_err_t)0x7f01)
bool lantern_network_report_playing(void);
void lantern_network_interrupt_report(void);
esp_err_t lantern_network_play_prompt(const char *kind);
esp_err_t lantern_network_run_voice_command(const char *context,
                                            int battery_level, char *intent,
                                            size_t intent_capacity);
esp_err_t lantern_network_restart_session(void);
esp_err_t lantern_network_begin_quick(lantern_cloud_session_t *session);
esp_err_t lantern_network_confirm_consent(lantern_cloud_session_t *session,
                                          bool accepted,
                                          lantern_agora_transport_t *transport);
esp_err_t lantern_network_capture_started(lantern_cloud_session_t *session);
esp_err_t lantern_network_stop_recording(lantern_cloud_session_t *session);
esp_err_t lantern_network_abort_session(lantern_cloud_session_t *session);
esp_err_t lantern_network_upload_transcript(lantern_cloud_session_t *session);
esp_err_t lantern_network_upload_audio(lantern_cloud_session_t *session);
esp_err_t lantern_network_complete_session(lantern_cloud_session_t *session,
                                           bool *transcript_ready);

esp_err_t lantern_network_prepare_archive_key(void);
esp_err_t lantern_network_begin_offline(lantern_cloud_session_t *session);
esp_err_t lantern_network_import_recording(lantern_cloud_session_t *session);
esp_err_t lantern_network_upload_phone(lantern_cloud_session_t *session);

// One owner calls this when leaving report mode; late PCM generations expire.
void lantern_network_end_report(void);
//0 until this boot has a plausible SNTP anchor with no clock jump.
int64_t lantern_network_trusted_time(void);
