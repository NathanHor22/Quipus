# Quipus 0.12.x development validation

> Experimental 0.12.8 DS-CNN trial is now authorized with a preserved 0.12.7 rollback. Its build flag is default OFF; target installation and labelled consent validation are pending. See [the separate experimental validation record](quipus-firmware-0.12.8-validation.md). The 0.12.7 observations below remain historical and do not establish consent reliability.

Status: **0.12.7 installed and running; the user confirms screen and voice both work.** Computer -> record-choice YES reaches a separate consent question, but start-session consent remains unresolved. This is not an offline-consent reliability or endurance acceptance pass. Pairing and protected SD recordings remain preserved.

## Confirmed changes

- One shared `quipus-marin-v1` voice profile uses Marin for all 25 bundled cues and server-generated reports. There is no alternate-actor fallback. Bundled 24 kHz IMA ADPCM cues occupy 1,025,520 flash bytes; production playback is bounded and sample-checked against an independent decoder.
- Connected consent uses the existing cloud transcription as its authority. An experimental local score cannot override cloud YES, NO or a transport failure.
- Experimental offline navigation asks each YES/NO question once, with at most record and report questions. UNKNOWN exits. Consent is a separate fresh full-five-second response: its first refusal/unclear answer retries, its second returns to idle. Button presses cannot consent.
- Authorized SD recordings start from a durable local identity before cloud session work. Unverified recordings remain encrypted and queued. Existing verified-recording retention remains 24 hours, subject to trusted time.
- Optional offline report replay uses a separately authenticated, owner/device/voice-bound complete cache. Interrupted downloads preserve the previous complete report. Cached replay cannot authorize cloud actions.
- Report cancellation remains bound to the whole turn across HTTP pages. Safe shutdown closes the optional report cache before the SD quiescence check.

## Observed hardware evidence

Target: Waveshare ESP32-S3-LCD-1.54 non-touch, 16 MB flash / 8 MB PSRAM, MAC `28:84:85:91:C4:4C`, USB power only.

The app-only update preserved NVS pairing, archive keys and the SD card. The existing WakeNet Computer model partition was byte-identical to the preserved 0.11.2 package and was not reflashed.

The initial 0.12.0 image booted, mounted the 59,654 MiB card and initialized its local classifier with a fixed 49,064-byte workspace. Live five-second classification took approximately 490 to 532 ms. A connected cloud YES decision subsequently started an encrypted local recording; stopping produced a complete 327,724-byte / approximately 10-second archive. One pending archive remains preserved while the hotspot is off. This is not proof of successful offline consent or final dashboard delivery for that recording.

Instrumented image SHA-256: `36ea3df0918be397b9aa36f987522ffdb3b409bd0ea84b0777759f962d6d7e91` (3,281,264 bytes). On the ESP32 itself, the complete production frontend/model/decision path passed both pinned public samples: YES -> YES (255), NO -> NO (254), 41 windows each. These are numerical integration checks, not measured live recognition accuracy.

One subsequent boot returned digitally zero microphone samples for over 100 seconds despite successful codec initialization. A manual warm restart restored nonzero input. The historical 0.12.1 update added bounded startup validation/recovery and a stable error path. Two observed boots passed the sustained microphone check in 127 to 130 ms and maintained nonzero input and idle WakeNet operation. A persistent physical fault/recovery and cold-boot endurance run are still outstanding. Its 31 ADC cases pass at both tick rates; fault-loop tests cover 9 Waveshare, 8 original-button-board and 8 touchscreen cases, including safe power-off and no automatic reboot.

## 0.12.2 candidate repair and installed startup evidence

A saved numerical trace reproduced a whole-response voting defect: ten
speech-supported YES predictions could be overridden by two NO predictions over
non-speech tail audio (RMS 18-19, zero VAD speech). This is not an all-YES-labelled
microphone recording. The user tried YES/YES, NO/NO and YES/NO, and the individual
trace has no confirmed spoken label. It establishes the numerical failure path,
not the human word spoken in any given window.

The candidate admits votes only from speech-supported contexts and requires
independent accounting for separated speech regions before affirmative admission.
Missing/unavailable VAD, unexplained activity, incomplete speech and ambiguous
regions fail closed; score thresholds were not lowered. Connected consent remains
cloud-primary, and neither local labels nor a failed connected request can grant
it. Offline menu selection still requires a separate fresh consent capture.

The app-only 0.12.2 flash passed hash verification. On its actual startup, MIC1
passed the sustained-input check with seven active blocks in 129 ms; the public
numerical fixtures returned YES 255 and NO 254. WakeNet was available, reported
free heap was about 5.75 MB, and protected entries remained 21 with one queued
recording. These observations establish boot/input/integration and preservation,
not accurate live consent or final delivery of the queued recording.

Subsequent user clarification placed the rejection in Computer -> offline
intent, not the consent question. No labelled live acceptance pass was recorded
for 0.12.2.

## 0.12.3 integration repair and observed startup

The 0.12.2 offline intent menu used the short early-silence capture path with a
strict local checker designed for the full response window. This controller
integration regression is repaired: the local menu captures all five seconds,
and its YES is wiped before a separate fresh five-second consent response.

The candidate also reserves 100 ms before raw VAD onset from background
calibration. Only contiguous above-floor 20 ms blocks immediately adjoining an
onset can attach, for at most 100 ms; a quiet gap stops attachment. The entire
expanded region must fit one isolated trusted-YES context. Raw VAD still gates
word votes, and model thresholds are unchanged. This addresses a plausible
onset-delay mechanism, not a proven diagnosis of the actual microphone failure.
First raw VAD onset before 200 ms fails closed as UNKNOWN. A brief missed-VAD NO
adjoining a later YES may still be treated as onset activity; region containment
cannot identify the word. Labelled NO-then-YES and multiple-speaker acoustic
trials remain required.

The app-only 0.12.3 flash passed hash verification and preserved pairing, keys,
21 protected entries and one queued recording. Its first boot latched an ES7210
register 0x45 read error after three transfer attempts and stayed in the stable
fault path without an automatic reboot loop. A guarded manual warm restart
restored MIC1 with seven active blocks in 130 ms. Public startup numerical tests
passed YES 255 and NO 254, and Computer WakeNet was available. This does not
establish successful automatic recovery, cold-boot stability or live consent.

A subsequent trace showed the flow still rejecting at the intent menu, without
entering consent. It does not establish a labelled consent-refusal pass.

## 0.12.4 navigation-policy repair

The 0.12.3 trace `.tmp-firmware-face/offline-voice-114306.log` at timestamp
103861 had eight speech-supported YES windows, peak 255, no NO vote and all
speech regions explained. UNKNOWN resulted solely from one unvoiced 20 ms
block at RMS 44 against background 27 (upper bound 43). Later retries routed
to the report choice; there was no consent entry. The trace proves a controller
policy rejection, not every human spoken label or an unbounded wake loop.

The candidate adds an explicit non-authorizing navigation classifier while the
existing default and startup callback remain strict CONSENT. Both share bounded
inference, raw-VAD word support, trusted NO priority and possible-NO rejection.
Navigation alone skips environmental/region affirmative vetoes. It uses bounded
early-silence capture, with one attempt per question and at most two distinct
questions. Its YES is wiped before a fresh strict full-five-second consent
capture. Model weights and RMS/confidence thresholds were not changed.

Inputs shorter than 16,000 samples remain UNKNOWN. Exact-one-second wall-clock
capture can be short in PCM because of I2S/DMA alignment; that boundary remains
known and fail-closed. The policy/controller tests prove the demonstrated
menu-rejection path is separated from consent. They do not prove microphone
accuracy or successful live consent. The app-only 0.12.4 installation passed
hash verification. Its observed boot was clean without manual restart: MIC1
passed seven active blocks in 130 ms, VAD was available, public numerical
self-tests returned YES 255 / NO 254, and idle Computer WakeNet was available.
At 27-32 seconds of uptime, reported free heap was about 5.75 MB and internal
free heap about 112 KB. Secure SD health was OK; pairing, keys, 21 protected
entries and one queued item remained preserved.

The 0.12.4 field test requested Computer -> record-choice YES once, the exact
next question, and NO if a separate consent question was reached. No labelled
recognition acceptance was established before the later silent-speaker blocker.
This clean boot is not an automatic fault-recovery or endurance pass.

## 0.12.5 output diagnostics and 0.12.6 stack repair

After 0.12.4, the user confirmed that the volume HUD reached 90% but prompts
were silent. This demonstrates input/volume feedback, not speaker audibility.
The original silent-output cause has not been established.

The 0.12.5 diagnostic image read actual ES8311 registers rather than cached
mute/volume fields. One readback was `31/32/0D/12 = 1F/B7/01/00`, with all four
reads and the control latch successful. The mute bits `0x60` were clear, and the
amplifier's actual output latch and output-enable bit were both 1 when requested
on. No mute repair was needed. These observations do not prove the analog
speaker path works. The probe can repair one observed mute condition using a
checked `0x31 & 0x9F` write/readback, only at nonzero software volume. It never
changes gain/power, reopens/resets a codec, or clears a failed control latch.

That diagnostic image introduced a separate confirmed regression: the added
probe/logging nested inside the existing 4,096-byte `lantern_pcm` task exhausted
its stack. The target reported `A stack overflow in task lantern_pcm`. This
failure must not be presented as the established cause of the earlier silence.

Version 0.12.6 moves the single-owner PCM input/output/reference and serialized
chime payload buffers to static storage, uses static-constant silence buffers,
and gives the PCM task 6,144 bytes of stack. It reuses bounded storage, without
adding an audio owner or per-playback heap allocation. Health exposes the
minimum remaining playback stack as `pcm_stack`, alongside input-task age/stack
and current volume.

All three board profiles compile. The actual audio-output host suite passes 148
cases, including driver failures, cancellation/drain and stack-frame bounds.
The actual board probe/prepare suite passes 2,764 Waveshare assertions and 10
for each legacy configuration, covering read/write/readback/latch failures,
masked-bit preservation, zero-volume behavior and no gain/power/reset writes.
These are source/controller checks, not acoustic acceptance.

The confirmed 0.12.6 target run completed a 64,000-frame PCM submission/write,
with 62,723 nonzero frames and a peak of 19,232 at volume 80. Minimum remaining
PCM stack after speech was 3,984 bytes and no overflow was observed in that
run. **The user still reported no audio at all, including the boot beep.**
Digital submission/drain and this stack repair therefore pass the observed
check; physical audibility still failed on that 0.12.6 run. This was not
an endurance, microphone-recognition or consent acceptance pass.

## Automated evidence

The affected suites cover voice-only consent and physical controls, both SD and RAM controller profiles, startup ordering, whole-turn report cancellation (154 cases), command/consent transport (97), report recovery (41 SD / 23 RAM), report dialogue, completion/delivery/sync, original encrypted archive recovery, and the actual AES-GCM report cache (12 fault/ownership cases).

All 25 voice assets pass encoded/decoded hashes, exact shared catalog/actor matching, independent sample decoding and bounded playback/reset/cancel/drain checks. Original synthesis sources independently confirm signal-to-noise ratios above 18 dB. Isolated packaging tests reject stale images, missing voice/model/self-test assets and mismatched manifests.

The 0.12.4 candidate build, SD/RAM offline controller, voice-only consent and local recognizer policy/native suites pass. Independent final source review confirms the strict-default API, fresh consent and single-attempt navigation boundaries. The microphone guard, stable fault loop and millisecond-timeout correction remain included. The matching backend passed its full remote Next.js/TypeScript production build and targeted speech/report/consent tests, and is deployed at the Quipus production domain. Temporary speech-build deployments and their local token file were removed; the production-only build endpoint is disabled.

## Required physical acceptance

- Confirm sustained microphone input after warm and cold boot, without an automatic reboot loop.
- Capture clearly labelled fresh YES/NO trials and examine window scores, speech support and activity diagnostics. Historical diagnostic names containing shadow do not imply that the candidate ignores speech evidence. Fix or replace the local acoustic path based on labelled evidence; do not lower thresholds to force consent.
- Check Computer -> intent YES -> two consent NO responses, returning to idle without capture. Separately test real offline YES, silence, unrelated speech, a quiet NO after YES, NO then YES, multiple speakers and an onset before 200 ms. A numerical self-test is insufficient.
- Complete a 60 to 90 second offline recording, reconnect, then verify its full audio/transcript in the correct dashboard account.
- Complete a real report, disconnect and replay the protected cached answer. Verify cancellation and return to idle.
- Preserve the now-working 0.12.7 screen/voice state. User confirmation establishes current audibility, not the exact cause of recovery, long-run reliability or fully offline consent acceptance.
- Multi-hour endurance and battery operation have not been measured; this board is USB powered.

The pinned speech API is scheduled to retire on 2027-01-06. Migration requires a separately tested transport update, not a silent voice/model substitution.

## Latest installed development image

Version: `0.12.7-quipus`. Application bytes: 3,303,904.
SHA-256: `5009bbc016647f81e4079547ec1b50e260b00224f89fa5ec0545beb8886afc3d`.
App-only flash hash verification passed. The target subsequently ran after the
recovery sequence below, and the user confirmed screen and voice both work.
This does not establish offline-consent accuracy, endurance or a stable release.
No release ZIP or stable overwrite is created by this documentation update.

The previous 0.12.6 image was 3,302,352 bytes, SHA-256
`8d3af3981aa70ebc8aea56b1f2d11c78c2db9c69a83692a6bdffefd0af36e768`.
Its digital output and stack observations are retained above; the user still
reported silence on that earlier run.

The previous 0.12.4 image was 3,297,280 bytes, SHA-256
`812f9d1cafb8e2a4c41c379342f32497a6413e0cfa3e2ef5fd4f1d4883cf442e`.
Its app-only flash hash verification and clean boot were observed; pairing,
archive keys, 21 protected entries and one queued item were preserved.

The previous 0.12.3 image was 3,296,784 bytes, SHA-256
`0850a202402e3b1bd81585e1414215852beca104317d465b482a302ab9e5bbdc`.
The 0.12.2 image was 3,295,408 bytes, SHA-256
`238899eee301e32bd5b57c0631c9305e66d1c3c1f0f3d19bd3b841c67b318dbc`.
The earlier 0.12.1 image was 3,293,696 bytes, SHA-256
`99425e9333aaa862e2d1743b97e2132ca398d1892516a11ba785db8c756b7573`.
Its development ZIP remains separate at
`output/quipus-upgrade/hardware/development-0.12.1/quipus-waveshare-lcd-154.zip`.
The preserved 0.11.2 prototype remains separate. Source changes remain in the
working tree; this record does not claim a source commit, push or stable release.

## 0.12.7 installation and observed recovery

All three board profiles compile. The image adds one bounded read-only startup
check of ES8311 serial/clock registers and actual ESP32-S3 routing/clock state.
It makes no gain, power, mute or routing changes. The actual-function host
fixture passes 45 Waveshare assertions and one per unsupported profile,
including failed reads and invalid-handle no-access.

Earlier guarded attempts declined to reset during consent or without usable
serial evidence. A later fresh ROM probe, without resetting, identified the
expected MAC ending C44C and established that no application capture was active.
The app-only 0.12.7 installation passed hash verification. Hard reset left the
board in ROM download mode (`boot0`). A supported ROM soft-reset attempt using
`flash_begin(0)` lost its serial stream; no erase was performed. One ROM-verified
vendor watchdog reset was issued and USB re-enumerated. The user also performed
the requested ten-second physical USB power cycle before the subsequent fresh
power-on boot. **Recovery cannot be attributed separately to the watchdog
reset or physical power cycle.**

The passive target log then reported reset reason 1 (POWERON), accepted
Computer, classified record navigation as YES (255), and opened a separate fresh
consent question. Spoken output completed 63,680 written frames, 62,997 nonzero,
peak 19,241, with minimum remaining PCM stack 3,984 bytes. A chime microphone
peak of 1,906 is supporting telemetry, not a physical sound-level measurement.
**The user explicitly confirmed screen and voice both work.** The user then
identified start-session consent as the remaining broken behavior; navigation
YES and an audible question do not establish consent acceptance.

Pairing and secure SD remained preserved: 21 protected entries, one queued item,
secure=1 and SD status ESP_OK. The observer attached after startup, so the new
startup register/matrix diagnostic rows were not captured. No 0.12.7 pin-route
or complete startup-register readback is claimed. The working hardware state
was left unchanged; no further physical tests or reflashes were performed for
this documentation update. Long-run stability, cold-boot repeatability and
fully offline YES/NO consent reliability remain unproven.
