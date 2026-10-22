# Quipus hardware and device protocol

For the Waveshare ESP32-S3-LCD-1.54, use the
[board-specific build and setup guide](hardware/lantern-firmware/WAVESHARE.md).

Current release: [Quipus 0.8.0](docs/quipus-release.md), installed on the LCDWIKI
ES3C28P touchscreen V2 on 22 September 2026. Both board profiles still build.
Use the [firmware guide](hardware/lantern-firmware/README.md) for current controls.
The bring-up notes below are historical evidence and retain their original names,
ports and version numbers; they are not instructions to flash the current board.

Production base URL:

```text
https://roxanne-two.vercel.app
```

## Current hardware gate

The target board is the ZHENGCHEN 1.54-inch M1307 ESP32-S3 variant with a
240 x 240 ST7789 display, microphone, speaker path, buttons, battery support,
and an ML307 cellular module. The active Lantern firmware is under
`hardware/lantern-firmware`; the earlier Agora experiment remains under
`hardware/firmware` for reference.

Windows exposes the ZHENGCHEN board as `USB-SERIAL CH340K (COM5)`, with USB
VID `1A86` and PID `7522`. The original factory boot log confirmed ESP32-S3
revision 0.2, 8 MB octal PSRAM, 16 MB quad flash at 3.3 V, and Xiaozhi 2.4.0.

Lantern `0.1.0-bringup` was first flashed and boot-verified on 12
September 2026. Version `0.1.1-bringup` was then flashed with every block hash
verified and ran continuously with changing microphone and battery readings,
stable heap, and the full 8 MB PSRAM buffer available. The firmware preserves
the factory partition layout and initializes the ST7789 display, I2S microphone
and speaker, buttons, battery telemetry, and first-boot `Lantern-XXXX` setup
network. Version `0.1.1-bringup` also adds a 30-second consent timeout, local WAV
download, five-second on-device replay, settings reset, and development OTA.
Version `0.1.2-bringup` removed the startup speaker noise. Version
`0.2.1-lantern-pilot` corrected the ST7789 RGB565 byte order so the Lantern accent
renders green and added an elapsed recording timer. It was built and flashed over
the manual BOOT-button path on 13 September 2026, and every block passed esptool
hash verification. The board then booted with the corrected green display,
completing the visual bench check. Version `0.2.2-lantern-pilot` additionally
preserves and uploads the WAV when Agora captions are missing, allowing the
backend to recover with OpenAI transcription before OpenAI extraction. Its complete
capture path also needs migration 005 plus live Agora and OpenAI
credentials.

The recovery gate is complete. Holding the main/BOOT button on GPIO0 while
reconnecting enters the ROM downloader. The full 16,777,216-byte flash image is
stored under the Git-ignored `hardware/backups` directory and passed esptool's
digest verification. Its SHA-256 checksum is stored beside it. A final reset
successfully returned the board to the factory firmware.

The factory partition layout is preserved as CSV in the same ignored folder:

| Partition | Offset | Size |
| --- | ---: | ---: |
| NVS | `0x9000` | 16 KB |
| OTA metadata | `0xd000` | 8 KB |
| PHY data | `0xf000` | 4 KB |
| OTA slot 0 | `0x20000` | 4,032 KB |
| OTA slot 1 | `0x410000` | 4,032 KB |
| Assets | `0x800000` | 8 MB |

The remaining bench checks are visual confirmation of screen orientation and
color, audible chime/replay quality, button sequences, and the printed ML307
markings before cellular work begins.

## Network model

The ESP32-S3 needs an internet path to reach Lantern. For the first release,
use 2.4 GHz Wi-Fi from a phone hotspot or trusted router. Hotspot credentials
stay in device NVS; Lantern's backend does not receive them. The field-pilot
firmware must add encrypted NVS, flash encryption, secure boot and signed OTA
before device credentials are treated as hardware-protected.
The ML307 can become a later cellular fallback after its exact variant and SIM
behavior are verified.

Google, OpenAI, and other provider credentials stay on Lantern's backend. The
device receives only its own Lantern credential and, later, short-lived capture
session credentials. It never stores a Google refresh token or sends a Google
invitation directly.

## Pair once

Apply migrations 001 through 005 and open **Lantern** in the authenticated live
dashboard. Choose **Create pairing code**. The code lasts ten minutes and can be
claimed once.

The firmware claims it with a stable hardware identifier:

```http
POST /api/device/v1/claim
Content-Type: application/json

{
  "pairingCode": "24G7N-8R5XQ",
  "hardwareId": "esp32s3:<factory-mac>",
  "model": "ZHENGCHEN-1.54-M1307",
  "firmwareVersion": "0.2.2-lantern-pilot"
}
```

A successful claim returns the device UUID and a 32-byte secret once:

```json
{
  "device": {
    "id": "00000000-0000-4000-8000-000000000000",
    "name": "Nathan's Lantern"
  },
  "credential": {
    "scheme": "Device",
    "secret": "store-this-once-in-protected-nvs"
  }
}
```

The bring-up firmware stores both values in ordinary NVS. Every later device
request uses the following header; field-pilot hardening must encrypt that
storage:

```http
Authorization: Device <device-uuid>.<device-secret>
```

The server stores only a SHA-256 digest of the secret. Revoking the device from
the dashboard clears that digest, so every subsequent device request fails.

## Heartbeat

Post telemetry every 15 seconds while connected and after every meaningful
state change:

```http
POST /api/device/v1/heartbeat
Authorization: Device <device-uuid>.<device-secret>
Content-Type: application/json

{
  "eventId": "11111111-1111-4111-8111-111111111111",
  "firmwareVersion": "0.2.2-lantern-pilot",
  "state": "ready",
  "stateVersion": 0,
  "batteryLevel": 82,
  "networkType": "wifi",
  "freeHeapBytes": 185000,
  "lastError": null
}
```

The response supplies server time, the accepted version, a 15-second heartbeat
interval, and a 30-second retry-buffer limit. A stale version receives `409`.

## Start Quick or Status mode

Generate a new UUID for every event. The same event UUID can be retried safely.

```http
POST /api/device/v1/sessions
Authorization: Device <device-uuid>.<device-secret>
Content-Type: application/json

{
  "eventId": "22222222-2222-4222-8222-222222222222",
  "mode": "quick"
}
```

Quick mode returns an `awaiting_recording_consent` session with a server-created
prompt ID and expiry. Status mode returns an `oath_listening` session. Persist
the returned session and version before sending the next event.

## Apply a transition

Send the exact session ID, a fresh event UUID, and the current version:

```http
POST /api/device/v1/sessions/<session-uuid>/events
Authorization: Device <device-uuid>.<device-secret>
Content-Type: application/json

{
  "eventId": "33333333-3333-4333-8333-333333333333",
  "expectedVersion": 1,
  "event": {
    "type": "RECORDING_CONSENT",
    "at": "2026-09-11T12:00:00+08:00",
    "promptId": "<prompt-id-from-session>",
    "accepted": true
  }
}
```

The backend replaces the event time with server time. The exact prompt must
still be active and unexpired. A random, stale, or replayed spoken "yes" cannot
start recording or approve an action. A valid response returns the new session
and version. A new event based on stale state receives `409`; retrying the same
event UUID returns its stored result.

After the ESP32 has joined its Agora channel and played the visible and audible
start cue, it sends `CAPTURE_STARTED`. The backend replaces that event's time
with its own clock and returns both UTC and `Asia/Kuala_Lumpur` date/time. That
timestamp becomes the recording origin for OpenAI relative-date interpretation,
the dashboard calendar, the WAV metadata, and transcript seek positions.

The implemented transition types are defined in `lib/lantern-state.ts`. The
critical Quick path is:

```text
ready -> awaiting_recording_consent -> recording (CAPTURE_STARTED) -> finalising
      -> processing -> report_ready
```

The Status path ends a voice-confirmed proposal at:

```text
status_report -> awaiting_action_confirmation -> pending_dashboard_approval
```

Voice confirmation never calls Google. The authenticated dashboard remains the
authority that sends a Calendar invitation.

## Current capture pilot and remaining scale work

The `0.2.2-lantern-pilot` image adds the v1 session client, server-confirmed
consent and capture clock, 16 kHz mono publishing to Agora, final caption
collection, private WAV upload, OpenAI extraction, and automatic dashboard
delivery. It keeps the existing local setup, pairing, heartbeat, display,
buttons, microphone, speaker and PSRAM diagnostics.

This first vertical slice intentionally records for at most 29 seconds. It
keeps the complete WAV in PSRAM and stages final captions before upload. The
next capture phase must replace that bounded pilot with acknowledged chunks,
reconnect/resume, hour-long token renewal, explicit gap records and encrypted
device storage. Google/Gmail execution remains behind dashboard approval.

The old `/api/devices/register` and `/api/hardware/*` routes belong to the
earlier speaking-agent experiment. New Lantern firmware should use the v1
device routes above.
