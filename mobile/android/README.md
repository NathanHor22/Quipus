# Quipus wired phone microphone

One Android phone supplies a second microphone over a USB-C **data** cable. Quipus
records its onboard microphone at the same time, preserves both sources on its SD
card and uploads them under one meeting. There are no rooms, join links, Bluetooth,
phone-to-cloud uploads or networking permissions in this app.

## Supported first prototype

- Android 11 or newer with USB host/OTG support. Android system microphone and USB
  permission prompts are required; a cable cannot bypass those permissions.
- LCDWiki ES3C28P/ES3N28P with the native ESP32-S3 USB serial/JTAG connection
  (Espressif VID `303a`, PID `1001`). USB-to-UART-only connectors are not supported.
- The separate phone-audio firmware variant moves console logging to UART so logs
  cannot corrupt the binary audio stream. Existing firmware builds default this
  feature off and retain their current console arrangement.
- A USB-C data cable with the phone acting as USB host. The phone supplies USB
  power; the board may draw charging current as well. Validate the particular phone,
  cable and board power behaviour before a long meeting. Do not connect two power
  sources through an improvised cable or modify VBUS wiring.

The official board schematic connects native USB to ESP32-S3 GPIO19/20:
https://www.lcdwiki.com/res/ES3C28P/2.8inch_ESP32-S3_Display_Schematic.pdf
Android host operation and permission requirements:
https://developer.android.com/develop/connectivity/usb/host
Foreground microphone restrictions:
https://developer.android.com/develop/background-work/services/fgs/service-types#microphone

## Build

Use JDK 17+ and Android SDK platform 37.0. The repository includes a pinned Gradle
wrapper and AGP 9.3.0. From this directory:

```sh
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

Set `ANDROID_HOME` to your SDK location. On Windows use `gradlew.bat`. Output:
`app/build/outputs/apk/debug/app-debug.apk`. Debug signing is for the prototype;
production distribution needs a separately protected signing key.

For firmware, install the repository ESP-IDF and Agora dependencies, then run
`hardware/lantern-firmware/build-phone.ps1`. This **builds only**. It neither flashes
hardware nor changes eFuses. Keep normal and phone-enabled builds separate.

## Use

1. Install and open the companion app. Connect Quipus by a USB-C data cable.
2. Press **Enable phone microphone**, allow microphone/USB access, and optionally
   allow the ongoing notification. The app waits without capturing microphone audio.
3. Start a consented meeting on Quipus. It sends a fresh session UUID and random
   nonce; only matching audio frames are accepted. The notification shows recording.
4. Stop on Quipus. The phone stops its microphone, drains its bounded USB queue
   and acknowledges STOP (or ERROR). Quipus then closes admission, drains its SD
   writer, finalizes both sources and follows its normal secure upload flow.
   Handshake and queue waits have deadlines; a partial phone track never blocks
   the onboard recording indefinitely.

A foreground service allows capture while switching apps or locking the screen,
subject to Android/device power policies. This must be tested on the actual phone.
Other apps taking the microphone, denied/revoked permissions, USB power interruption
or removal of the cable can interrupt the phone track. Quipus continues its own
microphone recording. This prototype preserves the partial secondary track;
reconnection is validated for the next session rather than promising seamless
mid-session reconnection. The phone never receives existing Quipus recordings.

The app remembers the opt-in and can reconnect when its visible USB attachment
activity opens with valid permissions. Android controls launching/background access;
it does not silently start a microphone service from boot or circumvent a locked
phone's USB restrictions. **Disconnect** disables the remembered opt-in.

## Wire protocol and resource bounds

PCM is mono signed 16-bit little-endian at 16 kHz. Normal frames contain 512 samples
(32 ms), about 32 kB/s. Each binary frame has a 56-byte header:

| Offset | Field |
| --- | --- |
| 0 | ASCII `QPA1` |
| 4 | Version `1` |
| 5 | HELLO=1, READY=2, START=3, AUDIO=4, STOP=5, ERROR=6 |
| 6 | Payload byte count, uint16 little-endian, maximum 1024 |
| 8 | Sequence, uint32 little-endian |
| 12 | Monotonic microseconds, uint64 little-endian |
| 20 | Session UUID, 16 bytes |
| 36 | Fresh session nonce, 16 bytes |
| 52 | CRC32 of header bytes 0-51 followed by payload |
| 56 | Payload |

CRC detects corruption; it is not a cryptographic identity or encryption mechanism.
USB audio is not exposed to a network. The physical connection, explicit phone
permissions and consent-bound session guard the live input; encrypted SD storage
and authenticated cloud upload protect its later handling.

Both parsers have bounded buffers and resynchronise after invalid data. Both ends
use a 16-frame queue; USB transmission and SD writes run separately from capture.
A stalled USB send has a 500 ms deadline; queue overflow ends only the phone track. Missing sequence
frames are padded within a bounded window; a long interruption ends that source
rather than blocking or exhausting the main recorder. Timing metadata is compact:
first/last phone capture and device arrival times, written samples, inserted silence,
drops and disconnects. The backend labels arrival-based alignment as **estimated**;
it is not sample-accurate synchronisation between independent clocks.

## Validation boundary

Run `python scripts/test-firmware-phone.py` from the repository root for the native
C framing/corruption/bounds checks. It uses an isolated Zig compiler and asserts
the same independent CRC vector as the Android tests.

The APK build, protocol unit tests, Android lint and firmware compilation are local
checks. A successful compile does not prove a particular phone's USB compatibility,
background behaviour, audio quality or multi-hour battery performance. Those checks
require the target phone and board connected together.

After building all three firmware profiles and the APK, run
`python scripts/package-hardware-artifacts.py` from the repository root. It writes
`output/quipus-upgrade/hardware/quipus-hardware-local.zip`, with separate profiles,
exact flash offsets, the APK and a verified SHA-256 manifest. It does not flash or
deploy anything. Finish backend/archive-key setup before installing new firmware.
