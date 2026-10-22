# Waveshare ESP32-S3-LCD-1.54

This profile targets the **non-touch** 240 × 240 Waveshare board, with ESP32-S3R8,
16 MB flash, 8 MB octal PSRAM, ST7789 LCD, ES7210 microphone ADC, ES8311 speaker
DAC, NS4150B amplifier and microSD slot. It uses the existing Quipus
`/api/device/v1/*` protocol, pairing, consent, wake word, reports, encrypted SD
archive and upload/recovery paths. No new backend routes or device-side cloud
API keys are required.

## Hardware mapping

| Function | ESP32-S3 GPIO |
| --- | --- |
| LCD MOSI / SCLK / CS / DC / RESET / backlight | 39 / 38 / 21 / 45 / 40 / 46 |
| Shared I2C SDA / SCL | 42 / 41 |
| Audio MCLK / BCLK / LRCK | 8 / 9 / 10 |
| ES7210 microphone data / ES8311 speaker data | 11 / 12 |
| NS4150B amplifier enable, active high | 7 |
| PLUS / BOOT / PWR | 4 / 0 / 5 |
| Battery power hold / charging signal, active low | 2 / 3 |
| Battery ADC, 3:1 divider | 1 (ADC1 channel 0) |
| SD CLK / CMD / D0 | 16 / 15 / 17 |

ES7210 uses I2C address `0x40`; ES8311 uses `0x18` (7-bit addresses). Both audio
directions run at 16 kHz, 16-bit stereo on one I2S clock. Only MIC1/MIC2 are
enabled, selecting ordinary stereo I2S instead of the factory four-channel TDM
example. MIC1 supplies Quipus's mono stream. Playback duplicates mono into both
output slots, using the existing 24-to-16 kHz speech conversion. Beamforming,
acoustic echo cancellation, stereo cloud recording, touchscreen, IMU and USB
phone microphone are not enabled by this profile. Firmware 0.10.0 adds BLE
setup with NimBLE and authenticated LE Secure Connections.

SD uses one-bit SDMMC at 10 MHz. **Recording requires a FAT32 microSD card**;
pairing and reports work without one. Cards are never formatted by Quipus.

## Build and flash

The Waveshare defaults target **https://quipus-sales-rep-assistant.vercel.app**. Device API calls
and the setup portal's return link use this same origin. For another deployment,
set **Lantern hardware → Quipus backend URL** in `menuconfig`, then rebuild.
An existing `sdkconfig.waveshare` keeps saved settings; editing the defaults
file alone does not override an already configured URL.

Use Quipus's **ESP-IDF 5.2.3**, pinned `esp_codec_dev` 1.5.11 and ESP-SR 2.0.1.
Waveshare's current examples use IDF 5.5.1; this integration implements the
hardware mapping through Quipus's existing 5.2 APIs and Agora integration.

On Windows, after installing the repository's toolchain, from this directory:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-agora-sdk.ps1
powershell -ExecutionPolicy Bypass -File .\build-waveshare.ps1
powershell -ExecutionPolicy Bypass -File .\flash-waveshare.ps1 -Port COM5 -Monitor
```

On Linux/macOS, install the existing Agora component and activate ESP-IDF:

```sh
idf.py -B build-waveshare -D IDF_TARGET=esp32s3 \
  -D SDKCONFIG=sdkconfig.waveshare \
  -D SDKCONFIG_DEFAULTS=sdkconfig.waveshare.defaults build
idf.py -B build-waveshare -D SDKCONFIG=sdkconfig.waveshare \
  -p /dev/ttyACM0 flash monitor
```

Output is isolated in `build-waveshare`. Flash the complete build initially to
install the bootloader, partition table, app and WakeNet model; this replaces
the factory application. Original and V2 images target different hardware.
If automatic USB reset fails, hold BOOT while reconnecting USB, release BOOT,
then use `-ManualBootloader` in the Windows flash script.

The default assumes USB power and reports battery percentage as unknown. With
a battery attached, run the build command with `menuconfig` instead of `build`,
enable **Lantern hardware → Waveshare lithium battery installed**, then rebuild.
Voltage uses ESP-IDF curve-fitting calibration and the board's 3:1 divider.
Percentage is an estimate to check against the actual battery; capacity and
charge-time estimates are not assumed for an optional accessory.

## Pair and use

### Bluetooth setup (Chrome on Windows or Android)

1. Flash all five images from firmware **0.10.1 or later** once through USB.
   Version 0.10.1 fixes an internal-RAM allocation failure that prevented the
   Bluetooth controller from starting on the physical Waveshare board.
   Keep the recorder unpaired and powered on, with Bluetooth enabled on the
   phone/computer. Bluetooth setup advertises as `Quipus-BT-XXXX`.
2. Sign in at **https://quipus-sales-rep-assistant.vercel.app/dashboard/devices** in Chrome and
   choose **Connect with Bluetooth**. Select your recorder in Chrome's chooser.
3. If Windows or Android requests a PIN, enter the six digits shown on the
   recorder's LCD. A protected GATT read triggers this OS pairing step before
   Wi-Fi credentials are sent. Previously bonded peers may reconnect directly.
4. Choose or enter a **2.4 GHz Wi-Fi network** and its password, or reuse saved
   Wi-Fi. Choose **Save and connect**. The website creates and sends the account's
   one-time pairing code automatically; no manual code or Wi-Fi switching is needed.
5. The recorder saves setup, restarts and joins Wi-Fi. Keep the page open until
   the matching hardware ID reports online in this account. Local BLE acceptance
   alone never certifies cloud pairing. Bluetooth provisioning closes after pairing,
   releasing controller/host memory before normal recording.

Bluetooth carries setup details; recording uploads and Agora still use Wi-Fi.
iPhone Safari can use the Wi-Fi fallback below. For a hidden Wi-Fi network or
an unsuccessful scan, enter its name manually. If OS pairing repeatedly fails,
remove the old Quipus Bluetooth entry in system settings and reconnect.

Saved sdkconfig files retain old settings. When upgrading an existing build,
enable **Component config → Bluetooth → NimBLE**, disable legacy SMP, enable
LE Secure Connections, and enable **Lantern hardware → Bluetooth setup from
Chrome**. The Waveshare defaults include these settings for a fresh build.
See [Bluetooth setup design and validation](../../docs/bluetooth-setup.md).

### Wi-Fi fallback and recording controls

1. Sign in at **https://quipus-sales-rep-assistant.vercel.app/dashboard/devices** and create a
   pairing code. Use the deployment configured in your firmware if you changed it.
   Join `Quipus-XXXX`, password `lanternsetup`, then return to that dashboard
   tab and choose **Open recorder setup**. Firmware 0.9.2 and later fill in the code;
   enter 2.4 GHz Wi-Fi/hotspot details and save. Reconnect the phone/laptop to
   normal internet; setup returns to the Quipus website when it is reachable.
   A **Return to Quipus** link remains available. The manual fallback is
   `http://192.168.4.1/` plus the pairing code shown on the dashboard.
2. Use the controls below with the screen facing you and the **three buttons
   ABOVE the display**, matching the Quipus screen orientation in our device photos.

| Position | Hardware button | Tap and release | Hold |
| --- | --- | --- | --- |
| **Left** | PLUS, GPIO 4 | Request consent/start; stop an active recording; interrupt a report | 1.2 s while ready: daily report; during recording: stop |
| **Middle** | PWR, GPIO 5 | **Volume down** by 10 points | 2 s while ready: safe power off/sleep after capture and queued writes finish |
| **Right** | BOOT, GPIO 0 | **Volume up** by 10 points | Hold while connecting USB only to enter the flashing bootloader |

These volume controls require **0.10.2 or later**. Range: 0–100; 0 mutes
speaker output, 100 is the configured codec maximum. Startup volume is 80;
changes last until restart. The top status bar shows `V80`, for example.
Chimes, spoken prompts, reports and local replay all follow the volume setting;
microphone gain and stored recordings do not change. Volume taps work during
report playback. Holds longer than 1.2 s do not produce a volume tap.

Hold **left + right** (PLUS + BOOT) for three seconds to clear Wi-Fi/pairing.
Unsynced private recordings still block reset. Chords never change volume or
start a recording.

Firmware **0.10.3** allows power off with finalized recordings waiting to upload;
the encrypted files and their ownership keys remain on SD/NVS. Shutdown is
blocked during an active session, while SD capture/writers or queued audio
writes remain active, or while phone audio is not idle. With USB attached,
shutdown enters deep sleep after release; press middle again to wake. For
normal power-on, leave BOOT released. The wake phrase is **Computer**, followed
by a command.

If you rotate the unit so the buttons are BELOW the display, left/right swap:
BOOT is then on the left and PLUS on the right. The middle PWR button is unchanged.

## Download compiled firmware

Open [Waveshare firmware builds](https://github.com/NathanHor22/Quipus/actions/workflows/waveshare-firmware.yml),
choose a successful run for the source commit you want, then download the
`quipus-waveshare-lcd-154` artifact. Extract the Actions download, then extract
`quipus-waveshare-lcd-154.zip` inside it. `README.txt` contains the Windows flash
command. Install **all five images together**, using the included `flash_args`.
The manifest records the firmware version, source commit, backend and file hashes.
A successful build establishes compilation and portable checks; the physical
acceptance checks below still apply.

## Validation

Run `python3 scripts/test-firmware-boards.py` from the repository root for
portable board selection, BLE frame validation and audio channel regressions.

Run `QUIPUS_CHROMIUM_EXECUTABLE=/path/to/chromium node
hardware/lantern-firmware/tests/bluetooth-setup.browser.mjs` from the repository
root for the real-browser UI test with a simulated GATT device. This tests mobile
layout, permission/cancel paths, wrong-backend rejection, transfer failures,
credential routing and exact-device cloud verification. Physical radio and OS
pairing prompts still need acceptance testing on Windows and Android.

Run `python3 hardware/lantern-firmware/generate-setup-portal.py --check` to check
the embedded HTML/JavaScript. The portal browser test also covers fragment
handoff, offline waiting and online return for both confirmation pages. On
Linux, set `QUIPUS_CHROMIUM_EXECUTABLE` to an installed Chromium binary, then
run `node hardware/lantern-firmware/tests/setup-portal.browser.mjs`.
Set `QUIPUS_WEB_ORIGIN=https://quipus-sales-rep-assistant.vercel.app` to test the Waveshare return
destination; otherwise the browser harness uses the original backend fallback.

Package the compiled image from the repository root:

```sh
python3 scripts/package-hardware-artifacts.py --profile waveshare
```

The ZIP contains the exact
generated flash offsets, all five images, checksums and setup instructions.

Physical checks on **22 October 2026** used the exact non-touch Waveshare
profile, flashed as firmware **0.10.3**. The inserted 64 GB microSD mounted and
reported **59,654 MiB**; WakeNet reported the **Computer** model ready, and BLE
setup advertising plus the setup Wi-Fi access point were observed.

The codec-control startup repair uses combined I2C reads and bounded register
retries, with a sticky error guard against vendor-swallowed failures. Five
controlled USB restarts reached setup with both codecs, SD and WakeNet ready;
there were no aborts or terminal register errors. Transient register errors were
recovered within the retry limit. These are warm software resets, not cold-power
or endurance tests. Physical voice recognition, audible playback, fresh account
pairing and full recording/upload acceptance still need testing after re-pairing.

Before using this image for a meeting, verify display colors/orientation,
microphone speech/silence levels, audible prompts, PLUS controls,
pairing/heartbeats and a recording over 60 seconds whose replay duration matches
capture. Test recovery after loss of Wi-Fi, safe power off with finalized pending
recordings, and reset protection for unsynced recordings. Check optional battery
voltage against a meter.

## Sources

- [Waveshare documentation](https://docs.waveshare.com/ESP32-S3-Touch-LCD-1.54)
  covers both touch and non-touch variants.
- [Waveshare schematic](https://files.waveshare.com/wiki/ESP32-S3-Touch-LCD-1.54/ESP32-S3-LCD-1.54-Schematic.pdf).
- [Factory BSP at commit 5157db7](https://github.com/waveshareteam/ESP32-S3-Touch-LCD-1.54/tree/5157db7c888e476fd57f8a95020800377447478f/examples/ESP32-S3-LCD-1.54-demo/ESP-IDF-5.5.1/01_factory/components/esp_bsp):
  `bsp_display.h/.c`, `bsp_codec.c`, `bsp_i2c.h`, `bsp_power_manager.c`,
  `bsp_sdcard.h`; buttons from `02_button_example/main/main.c`.
