#pragma once
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"

// Available only for an unpaired recorder. GATT writes use authenticated,
// encrypted LE Secure Connections with a fresh passkey on the physical LCD.
// Reserve controller/host memory before Wi-Fi. Preparation never advertises;
// start() opens discovery only after the unpaired setup portal is active.
esp_err_t lantern_bluetooth_prepare(void);
esp_err_t lantern_bluetooth_start(void);
void lantern_bluetooth_close(void);
// Settings reset / owner transfer only, from a control task, never a GAP callback.
// Stops provisioning before erasing persistent BLE trust. Does not touch archive
// keys, Wi-Fi credentials or SD recordings; returns an error instead of resetting
// identity if the setup worker is busy or cleanup fails. No-op without BLE setup.
esp_err_t lantern_bluetooth_forget_bonds(void);
void lantern_bluetooth_passkey(char output[7]);
