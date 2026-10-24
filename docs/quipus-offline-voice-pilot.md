# Quipus experimental offline voice - 0.12.7 development candidate

> Experimental 0.12.8 DS-CNN trial is now authorized with a preserved 0.12.7 rollback. Its build flag is default OFF; target installation and labelled consent validation are pending. See [the separate experimental validation record](quipus-firmware-0.12.8-validation.md). The 0.12.7 observations below remain historical and do not establish consent reliability.

**Offline consent acceptance has not passed; this is not ready for distributed
pilots.** The installed, hash-verified 0.12.7 image is running, and the user
confirms screen and voice both work. Computer -> record-choice YES reaches a
separate consent question; the user reports start-session consent is still
broken. Speaker recovery does not establish offline consent reliability.
Connected consent remains cloud-primary; local scores cannot approve or veto
it. The separate navigation/strict-consent policies are unchanged.

The implementation starts SD-backed storage and session admission locally after
accepted consent. It does not run a language model from the SD card or recognize
arbitrary commands offline.

## Demonstrated menu failure and candidate repair

In the 0.12.3 trace `offline-voice-114306.log`, the first record-menu response had
eight speech-supported YES predictions, peak 255, no NO vote and all speech
regions accounted for. Strict affirmative admission nevertheless returned UNKNOWN
because of one unvoiced 20 ms block: RMS 44 against background 27 (upper bound
43). Subsequent retries routed to the report question; no consent prompt was
entered. These are numeric/model observations, not independently labelled proof
of every word spoken in the trace, and they do not show an unbounded self-wake loop.

The 0.12.4 API explicitly separates non-authorizing NAVIGATION from strict
CONSENT. Navigation keeps raw-VAD-supported keyword votes, trusted NO priority
and possible-NO rejection within its captured response, while omitting the
consent-only environmental affirmative veto. It uses one bounded early-silence
capture per question: recording once, then optionally report once after NO.
UNKNOWN exits rather than repeating the same question. A menu YES is wiped and
opens a separate fresh full-five-second strict consent answer; it cannot start
recording. No RMS or keyword confidence threshold was changed.

The local model requires at least 16,000 samples. Less than one second of PCM is
rejected as UNKNOWN; the known exact-one-second wall-clock/DMA boundary can fall
just below that sample count and is not claimed fixed here. Consent deliberately
retains its whole five-second response and its own bounded retry policy.

The prior bounded onset attachment remains a hypothesis-driven safeguard, not a
proven acoustic diagnosis. Strict consent needs a stable baseline; first raw VAD
onset before 200 ms remains UNKNOWN. A brief missed-VAD NO adjoining YES cannot
be identified by region containment alone. Labelled late-NO, NO-then-YES and
multiple-speaker trials remain required. The earlier mixed trace (YES/YES,
NO/NO and YES/NO) has no confirmed per-attempt spoken label.

The app-only 0.12.4 installation preserved pairing, archive keys, 21 protected
SD entries and one queued item. This boot was clean without a manual restart:
MIC1 passed seven active blocks in 130 ms, VAD was available, public numerical
fixtures passed YES 255 / NO 254, and idle WakeNet was available. Secure SD health
was OK. This single boot is not an endurance or fault-recovery acceptance pass.
The latest 0.12.7 target reaches the fresh consent question after navigation YES,
but the requested labelled consent acceptance/refusal checks remain unpassed. No new release ZIP or stable replacement is created by this
documentation update.

## Current recovery and remaining consent blocker

The earlier volume-HUD-but-silent report was real. Actual 0.12.5 DAC/amp readback
did not establish its cause; the added diagnostic call depth also introduced a
separate overflow of the 4,096-byte PCM task. Version 0.12.6 moved fixed payload
buffers off that stack and increased it to 6,144 bytes. Historical digital
checks passed while the user still heard nothing.

The app-only 0.12.7 update passed hash verification. After ROM download/reset
recovery and the user's ten-second USB power cycle, a fresh POWERON boot ran
normally. Both a watchdog reset and physical power cycle occurred, so neither
can be identified as the sole recovery cause. The user confirmed screen and
voice both work. Target speech wrote 63,680 frames, 62,997 nonzero, peak 19,241,
with 3,984 bytes of remaining PCM stack. Startup register/routing rows were not
captured by the late observer; no new complete pin-route readback is claimed.
Pairing, 21 protected SD entries and one queued item remained intact and secure.

Navigation YES (255) reached a separate fresh consent question, but the user
reports that start-session consent remains broken. The working output state
is being preserved. No model or consent threshold was loosened, and no further
physical testing/reflashing is implied by this record. Offline consent,
late-refusal reliability and endurance still need separate validation.

## What the user hears

- **Online:** say **Computer**, then **start recording** or **status report**. Commands and the full fresh consent response use cloud recognition. A failed command request can offer the experimental local binary menu; selecting recording still requires the separate consent question. When Wi-Fi remains connected, consent still uses cloud recognition rather than a local-model fast path.
- **Offline, experimental:** say **Computer**. Quipus asks **Start a recording? Say yes or no.** The question is asked once. YES selects recording; it does **not** grant consent. Quipus asks its separate consent question and starts a fresh five-second capture. NO offers one report question instead. UNKNOWN returns to idle.
- **Consent:** an explicit recognized YES is required. The whole five-second consent response is inspected, including later NO speech. A first NO or unclear answer asks the consent question once more. A second NO, silence, uncertainty or failure returns to idle. Buttons never approve consent.
- **Status reports offline:** only the last completely saved, owner-bound report may play. It cannot execute follow-ups or answer new historical queries offline. Without a usable cache, Quipus explains that a new report needs Wi-Fi.

The local recognizer is the stock YES/NO model, with UNKNOWN and SILENCE outcomes. Computer is the existing local WakeNet word. A custom local model for **start recording**, **status report** or **Quipus** is not included. When Wi-Fi is connected, full-utterance online STT is the primary consent authority and local keyword scores cannot override it. A failed online request fails closed; it does not silently switch to the experimental local classifier. When offline, only explicit local YES/NO are considered, and uncertainty never authorizes recording. Quantized model confidence is not a measured accuracy percentage.

## One voice and the saved-report cache

All 25 essential interface clips and online report speech use the shared **Marin**
profile, `quipus-marin-v1`, pinned in `lib/quipus-voice-profile.json`. Local clips
are generated speech embedded as 24 kHz mono IMA ADPCM; the device decodes them in
512-byte chunks to at most 1024 PCM samples without allocating a whole clip.
This is prerecorded speech, not an offline speech-synthesis engine. Changing
model/voice environment values without updating the shared profile is rejected;
a provider failure never substitutes another speaker.

Only a completely downloaded and played eligible meeting-report turn can replace
the local report cache. Its paged audio must finish with the same interaction,
profile and expected order. The introductory "which meeting?" selector,
clarifications, repeats, cancelled/failed responses and action-review speech do
not replace the saved report. There are two alternating slots, each limited to
8 MiB of 24 kHz signed 16-bit mono PCM (about 2 minutes 55 seconds), plus encryption
metadata. Oversized downloads remain playable online and preserve the previous
cache. A report cache is not a recording, transcript or whole meeting database.

Cached report audio and commit metadata are encrypted/authenticated and bound to
the owner, device, report UUID and exact voice profile. The whole chosen archive
is authenticated before playback; a damaged newest slot can fall back to its
previous valid slot. Partial downloads cannot replace the last committed report.
Cached audio cannot approve/send an action or open a cloud conversation offline.
The cache is disposable on account/key change and never blocks account transfer.
It lives separately from recordings and does not change their 24-hour verified
retention rule. Unverified recordings remain protected indefinitely.

The server also has a private, owner/device-scoped PCM cache, limited to 8 MiB per
process and 15 minutes. It streams the first request immediately and reuses only
completed output. This process-local optimization is not durable offline storage
or a promise that every request avoids a provider call.

OpenAI schedules the current Speech API TTS models for retirement on
**6 January 2027**. Migrate online synthesis before that date; the documented
Realtime replacement requires a different transport/workflow, not just another
model name in the Speech API request. Already embedded clips and verified local
report PCM do not depend on continued synthesis availability. See the official
[deprecation schedule](https://developers.openai.com/api/docs/deprecations).

## Admission and storage order

1. Initial dashboard pairing and archive-key provisioning must already have succeeded. The device must retain its matching owner/device identity, and a usable SD card must be present. Card remount is local; meeting start does not fetch a key from the server.
2. After accepted spoken consent, an SD-backed meeting receives a new local session UUID even when Wi-Fi is connected. Its owner-bound manifest and encrypted archive are created before either microphone starts. No cloud session-start, consent-confirmation, Agora join or capture-start request sits on this path.
3. The local **Recording now** cue drains before phone capture or onboard recording starts, so that cue is not part of the meeting. A power request or SD failure stops admission; a failed local start does not invent a cloud session to abort.
4. Stop finalizes the complete SD archive. The existing import/checkpoint/chunk-upload/completion-verification path transfers it to the correct account when connected. A failed transfer retains the local queue. Uploaded speech still requires a verified completion receipt; silent discarded recordings use their distinct skipped notice. The existing verified 24-hour local retention policy is unchanged.

The original RAM-only demonstration hardware keeps its cloud admission path and recording limit. Its unsupported local classifier cannot provide offline consent.

## Resource and time limits

The application allocates one bounded 160 KB PCM scratch buffer in PSRAM at boot and reuses it. Local inference uses the recognizer module's fixed workspace; it is not called from the real-time I2S callback. Scratch PCM is wiped after each decision. A final I2S block may straddle the five-second deadline; only the newest five-second window is copied, preserving a late refusal within that bounded window. Intent navigation uses early-silence detection; consent deliberately does not.

The saved manifest permits an uncertain capture time when the clock is invalid after a cold offline boot. It does not fabricate a synchronized timestamp. Configure Wi-Fi and allow normal clock synchronization before trials that require accurate meeting dates.

No extra microphone task, cloud processing worker, recording-deletion policy or new general-purpose offline assistant is introduced by this controller change.

## Verification and pilot acceptance

Host regressions compile the actual controller functions with inference, I2S, storage and HTTP boundaries mocked:

- `python scripts/test-firmware-offline-voice.py`: local and cloud dispatch, connected consent authority despite conflicting local labels, a fresh consent capture after menu YES, two-refusal behavior, unknown/error rejection, power cancellation, bounded/wiped PCM, SD-first ordering even online, and the legacy cloud profile.
- `python scripts/test-firmware-consent.py`: physical/touch buttons cannot approve, bounded speech retries, local card-remount failures and safe power-down.
- `python scripts/test-firmware-recording-start.py`: startup failure injection and manifest / drained cue / phone / onboard microphone order.
- `python scripts/test-firmware-consent-transport.py`: the real capture loop retains the full consent window and late NO, while ordinary utterances retain early-silence behavior.
- `python scripts/test-firmware-adpcm.py` and `python scripts/test-firmware-prompts.py`: the actual decoder/playback, all 25 encoded/decoded hashes, exact profile/text catalog, bounded chunks, reset, cancellation and speaker failures. Add `--require-sources` to the prompts test when original synthesis PCM is available to recompute all SNR values.
- `python scripts/test-firmware-audio-output.py`: actual speaker/PCM/chime functions, bounded driver faults and stack-frame checks; 148 cases across profiles/tick rates.
- `python scripts/test-firmware-speaker-output.py`: actual DAC probe/prepare and output-latch functions, including failed reads/writes, one verified mute-only repair, zero-volume behavior and legacy unsupported paths.
- `python scripts/test-firmware-report-cache.py`: actual AES-GCM/cJSON storage, owner/key/profile binding, interrupted commits, corruption/truncation fallback, memory/file limits and reset isolation.
- `python scripts/test-firmware-report-recovery.py`: cached offline reports cannot upload/delete captures or enter the cloud action dialogue; existing queued recording receipts remain protected.

On the preceding physical build, both pinned public YES/NO fixtures passed the startup numerical integration test through the production frontend, classifier and strict keyword thresholds. That test bypasses the microphone and does not validate the candidate speech-region gates. A live offline trial nevertheless rejected the user's spoken YES. Offline acoustic acceptance has **not passed**, and controller/native/reference tests do not resolve that failure. The exact public PCM fixtures and their upstream/source/PCM digests are included in the hardware handoff. They are internal test inputs, not additional spoken interface voices.

These tests establish controller safety and ordering. They do not establish microphone recognition accuracy, acoustic refusal reliability, real-board timing, battery endurance or a week of runtime. Before distributing the pilot, bench-test representative speakers and background noise, a late second-person NO, SD removal/failure, cold offline boot, reconnect/import, and full-duration dashboard playback. If local recognition is not reliable enough on the actual microphone, keep the pilot restricted rather than replacing explicit consent with a button or assumed YES.
