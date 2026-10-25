# Waveshare ESP32-S3-LCD-1.54

> Experimental 0.12.8 DS-CNN trial is now authorized with a preserved 0.12.7 rollback. Its build flag is default OFF; target installation and labelled consent validation are pending. See [the separate experimental validation record](../../docs/quipus-firmware-0.12.8-validation.md). The 0.12.7 observations below remain historical and do not establish consent reliability.

This profile targets the **non-touch** 240 × 240 Waveshare board, with ESP32-S3R8,
16 MB flash, 8 MB octal PSRAM, ST7789 LCD, ES7210 microphone ADC, ES8311 speaker
DAC, NS4150B amplifier and microSD slot. It uses the existing Quipus
`/api/device/v1/*` protocol, pairing, consent, wake word, reports, encrypted SD
archive and upload/recovery paths. No new backend routes or device-side cloud
API keys are required.

## 0.12.7 installed: screen/voice working, consent still unresolved

The app-only 0.12.7 image passed hash verification and is running. **The user
confirms screen and voice both work.** Computer was accepted, record navigation
returned YES (255), and the device asked a separate fresh consent question. The
user identifies start-session consent as the remaining broken behavior; this
is not a reliable offline-consent or endurance acceptance pass.

After installation, hard reset left ROM download mode. A supported zero-length
ROM reset command lost its stream without erasing flash; one ROM-verified
watchdog reset was then issued. The user also performed a ten-second physical
USB cycle before a fresh POWERON boot. Those effects cannot be separated, so
neither is claimed as the sole cause of recovery. The observer attached late:
new startup register/matrix rows were not captured, and no complete 0.12.7
routing/readback result is invented.

Target speech wrote 63,680 frames, 62,997 nonzero, peak 19,241, with 3,984 bytes
of remaining PCM stack. A chime microphone peak of 1,906 supports output
activity but is not a sound-level measurement. Pairing and secure SD were
preserved: 21 protected entries, one queued item, secure=1 and SD ESP_OK.
The working device is left unchanged; no additional physical tests/reflashes
are implied by this documentation update.

Historically, 0.12.5 showed unmuted DAC/amp control readback but introduced a
separate PCM stack overflow through added diagnostic call depth. Version 0.12.6
moved single-owner PCM/chime buffers to static storage and raised the task from
4,096 to 6,144 bytes. Its digital checks passed before the user still reported
silence. The original silent-output cause is not established. The bounded
mute-only repair never changes gain/power or resets/reopens/clears audio errors.
All three profiles compile; 148 actual audio host cases and 2,764 Waveshare plus
10/10 legacy probe assertions pass. These tests do not prove room/consent accuracy.

Installed development application: 3,303,904 bytes, SHA-256
`5009bbc016647f81e4079547ec1b50e260b00224f89fa5ec0545beb8886afc3d`.
See [the validation record](../../docs/quipus-firmware-0.12.0-validation.md).
Recognition/consent thresholds are unchanged; no validated-distribution claim
is made.

## 0.12.4 candidate: experimental offline recognition

The 0.12.4 navigation update was installed by an app-only, hash-verified
update and independently reviewed. Boot was clean without manual restart: MIC1
passed seven active blocks in 130 ms, VAD was available, public numerical tests
passed YES 255 / NO 254, and idle WakeNet was available. Pairing, archive keys,
21 protected entries and one queued item were preserved; secure SD health was OK.
Labelled microphone acceptance remains pending. A clean boot is not an endurance
or automatic fault-recovery pass; the earlier 0.12.3 codec fault and manual
restart remain historical observations.

The 0.12.3 trace demonstrates a menu-policy rejection: eight trusted YES windows
(peak 255), no NO votes and all speech regions explained still returned UNKNOWN
because one unvoiced 20 ms block was RMS 44 against background 27 (upper bound
43). Retries led to the report question without entering consent. This is not
proof of every spoken label or an unbounded self-wake loop.

The new explicit NAVIGATION API keeps raw-VAD keyword support, NO priority and
possible-NO rejection within its response. It omits consent-only environmental
YES vetoes and uses one bounded short capture per question: record once, then
optionally report once after NO. UNKNOWN exits. A menu YES is wiped before a
separate fresh full-five-second strict CONSENT capture. Default consent and
connected cloud authority are unchanged. No RMS/confidence threshold changed.
Sub-one-second PCM is UNKNOWN; exact-one-second wall-clock/DMA shortfall is a
known fail-closed boundary, not a repaired case.

The prior bounded onset attachment remains hypothesis-driven. Strict consent
still returns UNKNOWN for first raw VAD onset before 200 ms, and a brief
missed-VAD NO adjoining YES cannot be identified by region containment alone.
Model accuracy remains pending. The latest 0.12.7 run reaches the separate
fresh consent question after record-choice YES, but the user still reports
start-session consent failure; no full consent acceptance is claimed. No new release ZIP or stable
replacement is created by this documentation update.

The source uses one **Marin** voice for all 25 local interface clips and
online reports (`quipus-marin-v1`). Local clips are 24 kHz IMA ADPCM with a bounded
512-byte decoder; they do not require network synthesis. Online provider failure
never switches to another actor. Connected commands and consent use cloud
recognition as the primary authority; the local model cannot approve or veto
connected consent. When offline, Computer offers a local YES/NO menu: YES selects recording, then a
**separate consent question and fresh five-second response** are mandatory.
Menu selection, a button, silence or uncertain speech cannot grant consent.

Only Waveshare includes the stock four-label TensorFlow micro_speech model
(YES, NO, UNKNOWN, SILENCE). It is not trained for "start recording", "status
report" or "Quipus". Host and native-fixture tests do not establish room/microphone
accuracy. The real board passes both pinned public YES/NO startup self-tests,
but the user's earlier live spoken YES was rejected at the offline intent menu. Offline acoustic acceptance
has **not passed**; do not distribute this as a working offline-consent pilot.
The public self-test bypasses the microphone and does not resolve that failure.
First NO repeats consent; second NO returns idle without reboot.
Initial account pairing/key provisioning and a usable FAT32 SD card are required.
After consent, SD-backed capture starts locally even when Wi-Fi is available;
cloud import/upload follows Stop. The existing encrypted 24-hour retention after
verified upload remains; unverified recordings never age out.

Offline status can replay only the latest complete owner-bound saved report turn,
using two encrypted 8 MiB slots. It cannot answer new questions or execute actions.
A failed/interrupted replacement preserves the prior cache, and a corrupt newest
slot can fall back to the previous valid one. This disposable cache is separate
from protected meeting recordings. Middle-button interruption remains available;
natural mid-speech interruption is still disabled pending acoustic calibration.

See [offline flow and voice/cache limits](../../docs/quipus-offline-voice-pilot.md)
and [stock-model provenance and acceptance](../../docs/quipus-local-recognition.md).
The current OpenAI Speech API model retires **6 January 2027**; the online synthesis
path must migrate before then. Embedded prompts remain usable afterward. Hardware
observations/remaining acceptance belong in the release validation record; the
historical 0.10/0.11 sections below do not establish 0.12.x acoustic/endurance success.

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

`flash-waveshare.ps1` signs the app with your local key before writing it (see
[wireless firmware updates](../../docs/firmware-updates.md)); pass
`-ExpectMac aa:bb:cc:dd:ee:ff` to refuse any other board. Recorders on 0.13.0
or later then update over Wi-Fi; only the first install needs USB.

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
| **Left** | PLUS, GPIO 4 | Volume down by 10 points | Continue lowering volume |
| **Middle** | PWR, GPIO 5 | Request session; stop recording; interrupt report | Hold 2 s: save locally, then power off/sleep |
| **Right** | BOOT, GPIO 0 | Volume up by 10 points | Continue raising volume; hold during USB connection only for programming |

Firmware **0.10.4** shows a static face, READY and the available wake/press hint.
Boot progress stays separate until screen, audio and WakeNet initialization have
finished. Firmware 0.10.4 supported local recording after an explicit offline
button confirmation. Version 0.12.1 replaces that button bypass with the local YES/NO menu and
separate voice-only consent described above; uncertain local recognition fails
closed offline. Connected consent uses cloud STT as the primary authority,
not a fallback for the local classifier. A session already recording
continues saving to SD when Wi-Fi drops. The ready screen does not wait for a
cloud boot greeting.

The consent question is a fixed spoken 24 kHz ADPCM asset in flash. Firmware **0.10.6**
requires spoken consent only: no physical button, touchscreen tap or hold can
approve. Start requests a session, plays the question, then listens for the full
five-second room response. The meeting session/SD archive begins only after a
recognized affirmative. The first recognized NO repeats the consent question;
a second NO returns to the main READY screen without rebooting. Silence, unclear
responses and voice service failures also get at most one repeated question,
then return to READY without recording. The outer buttons remain volume controls. A middle hold still requests
safe power off. Connected consent uses full-utterance cloud STT. Stock local YES/NO inference is
an experimental offline path with failed live acoustic acceptance. There is no button
bypass and no unrestricted offline phrase recognizer.

Consent requests negotiate an intent-only response from the command endpoint:
HTTP 204 plus the existing command header. This skips cloud speech synthesis;
older clients receive a short acknowledgement tone without synthesis. The device
accepts only consent_yes, consent_no or unknown and fails closed on missing or
unexpected headers. Other voice/report responses retain their existing protocol.

The consistent three-button mapping requires **0.10.4 or later**. Range: 0–100; 0 mutes
speaker output, 100 is the configured codec maximum. Startup volume is 80;
changes last until restart. The top status bar shows `V80`, for example.
Chimes, spoken prompts, reports and local replay all follow the volume setting;
microphone gain and stored recordings do not change. Volume taps work during
report playback. Volume holds repeat after 500 ms at most once every 200 ms; releasing a repeated hold adds no extra tap.

Hold **left + right** (PLUS + BOOT) for three seconds to open Wi-Fi setup
without clearing saved pairing, archive keys or recordings. Middle returns to
the main face. Factory reset is not a button shortcut; protected recordings still
block account/key erasure. Chords never change volume or start a recording.

Firmware **0.10.4 and later** saves an active recording locally before powering off. The
encrypted files and their ownership keys remain on SD/NVS for later upload.
Shutdown stays blocked if recording finalization, the SD checkpoint, queued
writes or phone capture cannot finish safely. It does not wait for a cloud upload.
With USB attached, shutdown enters deep sleep after release; press middle again
to wake. For normal power-on, leave BOOT released. The wake phrase is **Computer**,
followed by a command.

If you rotate the unit so the buttons are BELOW the display, left/right swap:
BOOT is then on the left and PLUS on the right. The middle PWR button is unchanged.

## Delivery repair 0.10.8

The current application was installed on the Waveshare board without changing
NVS, pairing, archive keys or SD recordings. All three existing board profiles
compile. The physical log confirms the SD mounted, owner-bound encryption is
ready and 15 pending entries remain; this is not a claim that all entries have
passed cloud verification. A prior physical test finalized 793,004 WAV bytes
(24 seconds); its dashboard delivery remains pending the database repair.

Production diagnostics confirmed `23505` on
`lantern_one_open_session_per_device` for repeated offline imports. Apply only
`supabase/migrations/020_offline_archive_control_slot.sql` to an existing project
with migrations 001?019. The replacement index and queue transition keep completed
offline archives independent of live recording control, without deleting or
force-ending any session. Matching start/restart/report route changes are required.

The face has two small eyes and a soft mouth. Recording holds the mouth open;
actual PCM playback drives mouth movement. Delivery speech is fixed local audio:
?Uploading your recording. Please keep Quipus on.? and, only with the backend's
verified receipt, ?Recording uploaded to your dashboard.? Offline/pending saves
use a separate message. Repeated retries do not repeat the same delivery cue.
The main screen retains an upload-pending hint until the queue clears.

Default spoken reports now include all saved meeting details. Explicit requests
for a quick overview or just actions still apply. Background upload retries,
voice-only consent, error recovery, SD fault preservation and notification
semantics have portable regressions; physical full-duration and long-run tests
remain necessary after the database migration.

## Queue latency refinement 0.10.9

The matching production backend passed its full Next build/typecheck and was
deployed. The operator applied migration 020; subsequent production imports,
uploads and completion requests returned HTTP 200, and fixed local success
speech played only after full-archive verification. Manual dashboard replay of
the recent longer recording remains a separate acceptance check.

A failed attempt retains the 30-second backoff. An accepted upload awaiting
checksum verification is checked after 5 seconds; verified successful cleanup
permits the next archive after 2 seconds. The existing 30-second user quiet rule
still applies. Attempt timers begin at completion, and the original RAM-only
board retains its separate completion-retry behavior. Host tests exercise actual
production scheduling and failure paths on both SD and RAM profiles.

`lantern_sd_upload_pending_count()` counts upload-candidate `.qpm` manifests;
`lantern_sd_pending_count()` remains the conservative private-data protection
count, including trusted recovery evidence. Reset/key-erasure guards still use
the latter. The idle UI distinguishes UPLOAD PENDING from SD FILES NEED REVIEW,
so an orphan/quarantine marker alone cannot cause endless fictional upload
retries or permit unsafe account transfer. No recovery markers or audio are
erased merely to reduce the displayed count.

## Verified local cache: 24-hour retention

The next firmware stores a verified recording as encrypted `.qpa`/`.qpb` audio
with authenticated `.qpc` metadata. Verification leaves the upload queue; it no
longer immediately deletes local audio. `firstVerifiedAt`, `deleteAfter` and
`retentionLastSeenAt` persist in the encrypted journal. Retrying, reconnecting
or rebooting does not reset an existing deadline.

The first trustworthy complete-verification time starts a full 24 hours.
Unknown-time or legacy verified metadata is preserved and receives a fresh full
24-hour deadline on its first trusted idle maintenance pass. Unverified audio,
quarantined metadata and protected recovery evidence never expire by this rule.
Invalid/untrusted clocks and time moving backward relative to authenticated
last-seen time preserve the copy. Dashboard retention remains a separate policy.

`lantern_sd_recording_confirm_uploaded_at(trusted_unix_seconds)` commits the
cache handoff; pass zero if time is uncertain. The older no-argument API also
preserves audio. Call `lantern_sd_retention_cleanup(now, time_trusted, 4, &removed)`
only while idle under the session-control lock, with replay/upload/capture stopped.
Each call examines at most eight directory entries, preserving its cursor between
calls. Authenticated cleanup proof precedes idempotent removal; an interrupted
cleanup retains metadata and account/key protection for its next safe pass.
Unexpected unsealed tracks or conflicting recovery metadata block automatic expiry.

The advisory upload count is cached for at most 60 seconds and invalidated on
manifest/cache/quarantine/mount/identity/expiry changes. A concurrent mutation
cannot publish an obsolete scan. Security/protection checks remain uncached.

Verified cache remains protected against account/key reset. `.qpc` files are
excluded from upload candidates, and authenticated verified `.qpm` evidence from
a torn rename is not reuploaded. New recording filenames also avoid cache/recovery
stems. No existing recovery evidence is deleted to make the queue look empty.

Host validation (no physical 24-hour claim):

```sh
python scripts/test-firmware-sd-retention.py
python scripts/test-firmware-sd-queue.py
python scripts/test-firmware-sd.py
python scripts/test-firmware-storage.py
python scripts/test-firmware-archive.py
```

These cover the actual production retention/serialization functions with real
cJSON allocation-fault injection, deadlines across reboot, rollback/invalid time,
conservative legacy migration, failed verification writes/renames, interrupted
cleanup, owner/authentication/recovery protection and bounded scans. Separate
archive tests authenticate the actual retention fields through a torn encrypted
journal append. A real clock/reboot/card-retention run is still required.

## Historical feature parity:0.10.9 snapshot

This historical comparison records **0.10.9 source** against the saved **0.9.6 source snapshot
`710df87b8fb99d0b0f76bc4dd21d62a754aa6caa`**. Source inspection and portable tests
establish the behavior below; they do not establish a successful hardware upload.
The older board profiles and saved firmware binaries remain separate from the
Waveshare image.

| Area |0.10.9 Waveshare source | Difference or limit at that snapshot |
| --- | --- | --- |
| Wake and commands | Computer activation, start recording, status report and Wi-Fi setup remain implemented. | Commands depend on the cloud. Spoken stop-recording and spoken interruption while report audio is playing are not added; middle-button interruption and spoken follow-ups at the report listening prompt remain available. |
| Recording and upload | Full SD recording, encrypted ownership, chunked uploads and verified-upload retention remain implemented. | A real recording must still be checked against full dashboard replay and transcript; the 30-second RAM buffer must not replace an SD-backed meeting. |
| Upload recovery | Heartbeat redraws no longer reset user idle time. Finalized SD network failures can retry at 30-second intervals; online error commands allow retry, cancel, status and Wi-Fi setup. | Corrupt/incomplete capture is not automatically retried. RAM-only pending audio blocks error voice capture to avoid overwriting it. |
| Consent and offline use | A local question precedes session creation. Spoken YES is mandatory; first NO repeats, second NO returns to READY without reboot. | New offline sessions cannot start until consent recognition can reach the cloud. Already-authorized recording and retained SD uploads survive a Wi-Fi interruption. |
| Physical navigation | Middle tap starts/stops a session; middle hold saves and powers off; outer buttons control volume. | No three-button Wi-Fi picker, meeting browser or physical status-report shortcut exists. The old V2 touchscreen menus are not ported to this non-touch board. |
| Startup greeting | A local chime makes READY available without waiting for a cloud greeting. | The personalized spoken boot briefing used by the older profiles is not played on Waveshare. |
| Battery | Charging input and optional calibrated battery monitoring exist in the profile. | The current build disables `CONFIG_LANTERN_WAVESHARE_BATTERY_INSTALLED`; percentage is unknown. Capacity/current are unspecified, so there is no charge-time estimate. |
| Bluetooth and phone audio | Encrypted BLE setup is added; the Wi-Fi portal remains available. | BLE closes after pairing and does not carry meeting audio. USB phone microphone support remains an optional ES3C28P/V2 feature, not a Waveshare capability. |

The relevant host checks are:

```sh
python3 scripts/test-firmware-sync-policy.py
python3 scripts/test-firmware-recovery.py
python3 scripts/test-firmware-consent.py
python3 scripts/test-firmware-recording-start.py
```

Before claiming end-to-end acceptance on this image:

1. Check NO then NO returns to READY without rebooting or creating a meeting.
   Check NO then YES starts only after the second spoken answer. Buttons and
   touchscreen taps must never approve consent.
2. Record for at least 90 seconds, speaking distinct markers near the beginning
   and end. Stop, then verify both markers in the transcript and the full replay
   duration in the correct account. A stopped recorder or queued SD file alone
   does not prove upload success.
3. After consent and recording have started, interrupt Wi-Fi and stop. Restore
   Wi-Fi and leave the device idle; verify retained-audio recovery begins after
   its 30-second quiet/retry intervals despite routine heartbeats. Confirm the
   complete recording eventually reaches the dashboard.
4. With a recoverable upload error visible, test Computer followed by retry or
   cancel. Confirm there is no new unconsented session and retained audio is not
   discarded. Check that an incomplete SD capture stays visibly failed.
5. Hold middle during recording; check that SD finalization precedes shutdown.
   Power on and verify the retained recording can resume upload. Validate any
   enabled battery reading against a meter.

These checks remain pending until observed on the physical device. Do not infer
speech accuracy, a successful upload or multi-hour stability from compilation or
host tests.

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

Run `python3 scripts/test-firmware-sd-queue.py` to check pending recordings are
processed in sequence, including uploaded meetings awaiting completion. This
prevents newer offline imports repeatedly jumping ahead of an older session.

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

On **23 October 2026**, firmware **0.10.4-quipus** was installed on the paired
Waveshare recorder without changing NVS, the account binding, archive keys or SD
files. Startup confirmed the 59,654 MiB SD card, both audio codecs, the Computer
WakeNet model, saved Wi-Fi and pairing. READY had WakeNet enabled; internal free
heap was about 128 KiB. One transient ES7210 register write recovered within the
existing three-attempt limit. This observation does not establish audible speaker
output, acoustic wake accuracy, a complete cloud transcript or multi-hour stability.

Portable checks cover 30 consent/input/shutdown cases, 17 actual recording-start
and shutdown race cases, the bundled prompt and PCM drain failures, FIFO queue
selection, SD failures/recovery, network recovery, storage reset gates, codec I2C,
and all board/volume/BLE profiles. Original and touchscreen firmware also compile.
The face renderer passed seven host previews without clipped pixels and retained
partial status redraws. No added face animation, timer or runtime synthesis task is
required. The fixed question occupies about 184 KiB of flash and streams through
the existing bounded playback buffer.

On **24 October 2026**, firmware **0.10.5-quipus** was flashed without changing
NVS, pairing or SD files. It removes every manual consent-approval path. The host
suite exercises actual physical/touch input handlers, voice-only consent and
non-destructive refusal restart. Forty additional transport/capture cases test
the production HTTP handler, decision allowlist, full five-second response and
power cancellation; all 17 recording-start interruption cases remain passing.
Twenty focused server tests verify classification, authenticated intent-only
responses, legacy tone compatibility and transcription deadlines. All three board
profiles compile. Startup confirmed SD, both codecs, WakeNet and retained pairing;
the saved Wi-Fi was unavailable, so acoustic YES/NO acceptance is still pending
reconnection. Do not interpret these host tests as separate identity checks for
every person in the room.

Firmware **0.10.6** updates refusal handling: the first NO repeats the question;
the second NO returns to READY without restarting. The updated host suite also
checks NO then YES, NO then unclear/error, no button/touch approval and no reset
side effects. During the preceding physical 0.10.5 test, the user confirmed saying
NO; serial logs showed Computer activation, start-recording recognition and two
HTTP 204 consent_no responses. This establishes the microphone-to-cloud command
path, but positive-consent meeting capture and the revised two-NO sequence still
require a physical check on 0.10.6.

Before using this image for a meeting, verify display colors/orientation,
microphone speech/silence levels, audible prompts, middle session/power and outer volume controls,
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


## 0.11.0 hands-free interaction update

- The main view is a larger warm face with one bottom caption. Recording keeps
  the mouth open; streamed speaker PCM drives speaking motion. No recovery-file
  warning is surfaced during normal idle. Diagnostics remain available in logs.
- Local Computer detection is independent of Wi-Fi. One atomic activation is
  consumed once. Network redraws cannot erase an outstanding wake event.
- The local listening question finishes before a5s command window. One retry
  is allowed. Voice-only consent is unchanged: YES starts; first NO asks again;
  second NO returns idle, with no button approval and no reboot.
- Upload/saved/verified announcements return immediately to idle. Cloud storage
  acceptance alone is not verification. SD copies remain encrypted until the
  authenticated verified cache has aged24h, using bounded idle cleanup.
- Plain status asks which meeting. Time/person/day and follow-up questions use
  saved facts. Repeat plays a single previous section; continue retains its
  own unfinished cursor. A completed page never advances on an HTTP/audio error.
- A report has a30s initial-speech allowance, but spoken requests are capped at
  7s and uploaded with up to8s of onset context, below the320KiB command limit.
- Report-only AEC/VAD uses bounded pre-roll and scratch buffers, no MultiNet.
  Local interruption cancels queued PCM and obsolete response generations.
  Partial-page resume restarts only the interrupted section; it is not sample
  accurate. Real self-echo/room/noise/volume acceptance must be recorded below.
- LEFT+RIGHT held3s opens Wi-Fi setup; MIDDLE returns. This preserves saved
  networks, pairing and audio keys. USB-only builds hide unknown battery/ETA.

Historical 0.11.0 offline limit: WakeNet and essential prompts were local;
command transcription, consent decisions and fresh report retrieval required
Internet. The experimental 0.12.x path above adds the bounded local YES/NO
menu/consent path and previously saved report replay; offline acoustic acceptance
has not passed.


## 0.11.1 maintenance update (24 October 2026)

- The Waveshare top strip shows a transient volume percentage for 1.5 seconds
  after an actual change, plus compact connectivity and power information. USB
  builds show USB; battery estimates require the battery-enabled board profile.
- A stale non-capture server state with no owned live capture no longer blocks
  historical reports. Before a report, a finalized local archive can reconcile its
  stop/import receipt without uploading WAV data or starting another session.
- A read-only report/command error speaks its guidance and returns to true idle,
  releasing the saved-upload retry queue. Recording, consent, storage and upload
  failures retain their existing guarded recovery paths.
- A verified short-silence discard has its own neutral local spoken cue. It never
  claims a new dashboard meeting. The conservative server policy is documented
  in docs/quipus-short-silence-policy.md: strictly under five seconds, completely
  flat near-zero PCM on every source, and successful no-speech transcription.
  Quiet/varying audio and uncertain/provider-error results are preserved.
- New migrations 021 and 022 enable discard proofs and reversible calendar
  visibility. Existing projects on schema020 can apply the combined handoff in
  supabase/setup/quipus-recording-calendar-upgrade.sql. Installation of these
  migrations does not delete existing recordings. Do not rerun installed SQL.
- Verified local SD files retain the existing 24-hour grace period. Unverified
  recordings never expire. This maintenance change does not erase pairing, keys,
  saved Wi-Fi, or any pending recordings.


## 0.11.2 report turn-taking repair (24 October 2026)

Physical tests showed the uncalibrated AEC/VAD interruption detector hearing the
board's own speaker as a new user, causing speaking/listening loops. Waveshare
now skips that DSP initialization and both reference/microphone admission paths.
This also avoids allocating the unused echo-processing state. Reports finish and
drain their speech before a new, bounded microphone window opens. A short tail
settle precedes the fresh RAM window; speaker audio and interruption preroll are
not reused. Silence returns to idle; two consecutive unknown replies also exit,
while meaningful questions remain unlimited. I'm done closes the report.

Natural mid-speech voice interruption is disabled on this board pending acoustic
calibration. Middle-button cancellation remains responsive and now exits rather
than silently opening another listening turn. Original/touchscreen audio
interruption code is preserved; those saved demo devices were not reflashed.
