#pragma once

#include <stdbool.h>
#include <stddef.h>

#include "esp_err.h"

/**
 * Wireless firmware updates. The server offers a signed image in the heartbeat
 * response; the recorder installs it only while idle, verifies size, SHA-256
 * and the app signature, and keeps the new image only after it reaches the
 * server once. A new image that crashes or cannot check in is rolled back by
 * the bootloader on the next restart.
 */
void lantern_ota_boot(void);

/** Appends `,"update":{...}` to a heartbeat body when there is news to report. */
void lantern_ota_append_report(char *body, size_t capacity);

/** Called with the body of every acknowledged (HTTP 200) heartbeat. */
void lantern_ota_heartbeat_acknowledged(const char *response_body);

/** True when a valid offer is waiting and this image may be replaced. */
bool lantern_ota_offer_ready(void);

/** Downloads, verifies and activates the offered image, then restarts. Returns only on failure. */
esp_err_t lantern_ota_install(void);
