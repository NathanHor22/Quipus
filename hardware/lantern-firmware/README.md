# Quipus firmware

> Current smaller-board pilot: [Waveshare controls and installation](WAVESHARE.md),
> [offline recording and voice guide](../../docs/quipus-offline-voice-pilot.md).
> Firmware 0.12.1 uses one warm, confident female voice and local YES/NO consent
> on the Waveshare profile. The older board instructions below remain available
> for the separate demo form factors.


Current release and open acceptance checks: [0.8.0 release notes](../../docs/quipus-release.md).
The source directory and protocol names remain `lantern` for compatibility.
The actual local wake word remains **Computer**. Natural voice interruption
during speaker playback is not enabled; tap/press to interrupt, then speak.

This is the shared Quipus ESP32-S3 firmware. The default build
profile is **Quipus Original**, the ZHENGCHEN 1.54-inch M1307/ML307 board. It
uses the board manufacturer's proven display, microphone, speaker, battery,
and button pin map.

The **Waveshare ESP32-S3-LCD-1.54** non-touch board has its own profile with
ES7210 microphone capture, ES8311 playback, ST7789 display, native USB and SD
recording. See [Waveshare build, pairing and hardware acceptance](WAVESHARE.md).
Use `build-waveshare.ps1` and `flash-waveshare.ps1`; recordings require a FAT32
microSD card. Battery telemetry is optional and disabled in the USB default.

The second profile is **Quipus V2**, the LCDWiki ES3C28P. It uses the board's
240 x 320 ILI9341 display, FT6336G touchscreen, ES8311 microphone/audio codec,
native USB, 16 MB flash, and an SDIO microSD slot. A battery and microSD card
are not required to flash the USB-powered prototype. Touching the screen
provides the same primary control as the centre button on Quipus Original.

The V2 image reads the board's built-in 1:1 battery divider on GPIO 9 and shows
a smoothed percentage in the top status bar. Validate its endpoints against the
final battery before treating it as laboratory-grade state of charge. The top bar
shows `CHG` while a detectable charging source is connected and `BAT` while the
device runs from its battery. It automatically
mounts a FAT16/FAT32 microSD card without formatting it, streams the complete
16 kHz mono PCM meeting into a temporary file, finalizes a WAV on Stop, and
uploads the full file directly to private Storage using resumable 6 MiB requests
with a 16 KiB RAM buffer. A server without the new upload endpoint uses the
legacy chunked upload. An SD-backed session never substitutes the 30-second
PSRAM buffer when its full recording cannot be uploaded.

Hardware-specific pins and capabilities live under `main/boards`. Session,
voice, networking, and dashboard behavior remain in the shared firmware. Each
board gets its own build image; the original board does not need an SD card and
continues to use its PSRAM streaming/retry strategy.

Version `0.8.0-quipus` keeps the existing local WakeNet activation gate and
buffered, low-latency speech playback while keeping one consistent
centre-button fallback:

- say "Computer" while ready: open a voice-activity command window (four seconds maximum)
- say "start recording" or "status report" during that command window

- short press while ready: open a new session and ask for spoken consent
- short or long press while recording: stop and upload the session
- long press while ready: play today's status report
- short press on an error: retry the exact failed operation
- long press on an error: cancel the session and return to ready
- tap/short press during report speech: interrupt and open a spoken follow-up window
- after the report chime: ask for a date/meeting, repeat, continue the daily report, or stop
- short or long press on completion: return to ready immediately

After pairing or reboot, Quipus says “Quipus ready” with the paired owner’s
preferred/profile name and the working wake phrase. Idle uses a static Quipus
mark and a short wake/tap instruction. No sector or oath is required. Spoken yes/no remains mandatory because
activation cannot provide consent for the other people in the conversation.

## Supported features (see release notes for actual validation)

- 240 x 240 ST7789 display with a green Quipus palette
- I2S microphone capture at 16 kHz and speaker playback at 24 kHz
- first-boot 2.4 GHz Wi-Fi or phone-hotspot setup through `Quipus-XXXX`
- one-time dashboard pairing and authenticated device heartbeats
- server-bound spoken consent with a second confirmation after the first no
- Malaysia server time stamped when capture begins
- live 16 kHz publishing and caption staging through the Agora IoT SDK
- automatic local WAV fallback if the device cannot join Agora
- private resumable full-WAV upload, background OpenAI transcription, structured meeting summary,
  and dashboard follow-up approval generation
- direct spoken daily status reports from a long press while ready
- operation-specific saving, completion, status, and error screens
- idempotent stop, transcript, audio, and completion retries
- automatic stale-session reset and one fresh start attempt after HTTP 409
- background summary retries after the audio has safely uploaded
- full spoken reports with specific yes/no approvals for supported Calendar and Gmail actions
- local WakeNet9 activation while idle, with no wake-word cloud request loop

### Upload performance diagnostics

Both profiles use performance compilation (`-O2`) with assertions still enabled.
Screen rendering runs in its own task with a single pending update, so network
and audio callers never wait for LCD transfers. Repeated screens only redraw
the detail line; upload progress is limited to twice a second. Automatic retries
reuse the immutable WAV's checksum within one upload call and recover the
server-confirmed offset. A fresh upload skips the redundant recovery request.

Serial `WAV timing` lines report each attempt's sent/confirmed bytes and elapsed
milliseconds for checksum SD reads, hashing, recovery, preparation, TLS connection,
upload SD reads, TLS writes, storage acknowledgement, progress notices, and final
verification. `Save timing` reports the spoken announcement, caption submission,
and queue acceptance separately. `tls_write` includes waiting on the network; it
is not a CPU-only encryption measurement. Cloud transcription runs afterward.
Measure on the same hotspot and comparable recording lengths before claiming a
speed improvement. Local originals are retained until full cloud acceptance.

The bundled prototype WakeNet model recognises "Computer." The firmware keeps
the model selector isolated so a separately trained "Quipus" WakeNet model can
replace it later; changing the displayed name cannot retrain a wake model.

Quipus V2 records the complete meeting to microSD while keeping the rolling
30-second PSRAM retry archive. The current raw-WAV server contract accepts up
to 256 MB, which is about 2 hours 19 minutes at 16 kHz mono 16-bit PCM. The
five-minute prototype target uses about 9.6 MB. Hour-long replay will require
an encoded on-device format plus resumable upload state across power cycles.

The firmware never formats an inserted card. Use FAT32 for the current ESP-IDF
build. A card inserted after boot is mounted automatically when the next
recording starts. A finalized WAV stays under `/lantern` until the backend has
verified the full WAV and durably queued its processing. Failed uploads leave
the complete local WAV intact for retry. Once cloud acceptance is confirmed,
transcription retries use the preserved cloud WAV, so the device can begin a
new session while the summary is still processing. Automatic recovery of every
unsent SD file after a power loss is not implemented in this release. The
cloud WAV is attached to Replay before transcription begins, so processing
failures do not hide or replace the recording.

Deploy database migrations 009 and 010 plus the matching website and worker
before flashing this release. See [the coordinated rollout guide](../../docs/recording-delivery-rollout.md).

Hold both volume buttons for three seconds on Quipus Original to clear Wi-Fi
and pairing settings. On touchscreen Quipus V2, hold the screen continuously
for eight seconds. The screen shows **KEEP HOLDING TO RESET** before erasing the
saved connection and reopening `Quipus-XXXX`.

## Wi-Fi and pairing

When no saved Wi-Fi is available, connect your phone or this laptop to the
device network named `Quipus-XXXX` using password `lanternsetup`, then open
`http://192.168.4.1`. Enter the 2.4 GHz phone hotspot name and password plus the
one-time pairing code from the live dashboard. The setup page can also install
a locally built `build/lantern.bin` into the inactive OTA slot.

If the dashboard revokes a device, the next authenticated request clears only
the rejected device credential and automatically reopens `Quipus-XXXX` while
preserving the saved Wi-Fi. During re-pairing, submit the new pairing code and
leave the Wi-Fi fields blank to reuse that connection.

After setup, reconnect the laptop to normal internet. The ESP32 connects to the
phone hotspot itself; the dashboard and ESP32 communicate through the deployed
Quipus backend and do not need to be on the same local network.

OpenAI, Agora, Google, Supabase, and Exa secrets stay on the backend. The device
stores only its own paired credential and receives a short-lived Agora session
token when a recording begins.

## Build and flash

The ignored `.tools/esp-idf` checkout is ESP-IDF 5.2.3, matching the Agora
embedded SDK integration. ESP-SR supplies only WakeNet; OpenAI recognises the
two commands after wake activation and verifies spoken consent.

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-agora-sdk.ps1
powershell -ExecutionPolicy Bypass -File .\build.ps1
powershell -ExecutionPolicy Bypass -File .\flash.ps1 -Port COM5
```

Build and flash Quipus V2 as an independent image:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-v2.ps1
powershell -ExecutionPolicy Bypass -File .\flash-v2.ps1 -Port COM10 -Monitor
```

The V2 build uses `sdkconfig.v2`, `build-v2`, and native USB logging. It does
not overwrite the original board's `sdkconfig` or `build` outputs. The first
V2 flash writes the bootloader, partition table, app, and WakeNet model.

This CH340K board may not enter the ROM loader through DTR/RTS. If automatic
flashing fails:

1. Unplug the ESP32.
2. Hold the large centre/BOOT button.
3. Reconnect USB while continuing to hold it.
4. Run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\flash.ps1 -Port COM5 -ManualBootloader
   ```

5. Release the centre button once writing begins.
6. After the hash is verified, tap the small RESET/EN button once.

The first WakeNet installation requires a full manual flash so `srmodels.bin`
is written to the model partition. Later application-only flashes preserve the
installed model as well as Wi-Fi and pairing credentials.

## End-to-end hardware test

Before testing, deploy the current web build and migrations with Supabase,
Agora, and OpenAI configured. Google is needed only when approving a Calendar
invitation from the dashboard.

1. Open the live dashboard and confirm the paired device is online.
2. Restart the board. It should announce the sector, battery, owner, and
   "Ready," then show **SAY COMPUTER OR PRESS**.
3. Say "Computer." Confirm the screen changes once to **LISTENING**. Say
   "start recording" during the command window. It closes after you stop
   speaking, with a four-second maximum. The centre button remains available
   as a fallback.
4. Quipus asks for recording consent and shows **SAY YES OR NO**.
5. Say "yes." Quipus confirms consent and changes to **RECORDING** with an
   elapsed timer and **PRESS CENTRE TO STOP**.
6. Speak for at least 60 seconds when testing the SD path. Include a clear agreement such as: "Mr Chung,
   let's meet tomorrow at 1 PM Malaysia time for 30 minutes."
7. Short-press the centre button. The display moves through finalising,
   uploading audio, and processing summary.
8. Confirm Quipus says "Recording uploaded. Session complete," shows
   **UPLOADED TO DASHBOARD**, then returns to **READY** after three seconds.
9. Open the new conversation in the dashboard. Verify the recording replay,
   timestamped transcript, bullet summary, and pending meeting approval.
10. Say "Computer," followed by "status report." Confirm Quipus plays today's
   report and opens a short follow-up listening window. Silence or “stop” returns
    to ready. Long-pressing the
   centre button while ready provides the same fallback.

To test refusal, say "no" to the first consent prompt. Quipus asks again. A
second no cancels the session; saying yes on the second prompt starts it.

If an operation fails, read the specific error text. Short-press to retry it.
Long-press to cancel and return to ready. If audio upload succeeded but summary
processing did not, Quipus still reports session completion and retries the
same completion request in the background without creating a duplicate.

## Provider boundary and remaining reliability work

Agora is the live transport and caption layer. OpenAI performs consent
transcription, final diarized transcription, Malaysian code-switching
extraction, and device speech. Exa enriches public company context in Quipus
Relay; it does not identify people or speakers.

Before a field pilot, add persisted cross-reboot upload resumption, encoded
hour-long capture, Agora token renewal, durable incremental transcripts, and
explicit gap records. Production firmware also needs encrypted NVS, flash encryption,
secure boot, signed OTA updates, and rollback validation.
