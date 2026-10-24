# Quipus 0.11.2 verification

24 October 2026. Connected target: Waveshare ESP32-S3-LCD-1.54 non-touch,
MAC28:84:85:91:C4:4C, USB power only. Original and touchscreen demo firmware
remain preserved and are not flashed onto this different board.

## Behavior delivered

- Compact face and one bottom caption. Volume changes show a percentage for1.5s.
  USB power shows USB; no battery percentage or charge estimate is invented.
- Calendar X hides an entry with Undo and a Hidden filter. It preserves its
  audio, transcript, people/report history and external Google Calendar events.
- Automatic fluke disposal is deliberately conservative: validated originals
  strictly under5s, flat near-zero PCM on every source, and successful no-speech
  transcription. Quiet/noisy audio, short speech, failures and uncertainty stay.
- Identity-bound private proof permits only targeted cleanup. Verified local SD
  files keep their24h grace; unverified files never expire automatically.
- Reports distinguish stale device snapshots and expired, never-started consent
  slots from actual capture. The narrow consent exception requires a valid,
  expired prompt and no machine or durable capture/transcript evidence. It is
  read-only; late YES and active/uncertain recordings remain blocked.
- Completion receipts bind the recording separately from the state machine,
  which deliberately clears its active ID once processing is queued.
- Read-only errors speak once, return idle and release the saved-upload queue.
  A recovered audio-chip constructor no longer retains an abandoned error.

## Real report-loop repair

Physical testing showed the AEC/VAD detector hearing the board's own speaker and
feeding that audio into a fresh report command. On Waveshare this uncalibrated
path is now disabled at initialization, microphone/reference admission and all
public interruption APIs. No unused DSP state is allocated. Legacy paths remain
unchanged. Reports drain speech, reset interruption state, let its tail settle,
then capture a fresh bounded microphone window. Silence returns idle. Two
consecutive report_clarify replies exit, while valid questions remain unlimited.
I'm done closes the report. Physical middle-button cancellation exits instead
of opening another recording window.

Natural mid-speech voice interruption is intentionally unavailable on this board
until it passes acoustic calibration. Users can ask the next question after a
reply or use the middle button to cancel speech. This is distinct from the
Computer wake phrase and voice-only meeting consent, which remain enabled.

## Validation

- Production build and full Next16.4.3 TypeScript check passed. Final site is
  https://quipus-sales-rep-assistant.vercel.app; deployed report_clarify support
  is roxanne-xaknntzpj-nathans-projects-b0bfd21e.vercel.app.
- Report backend31 tests; silence49 tests; calendar28 tests pass. SQL021+022
  was applied by the user. Both migrations preserve existing recordings when
  installed; old projects must not run the fresh-project setup bundle.
- Actual completion parser54 cases; delivery20 cases; report recovery35SD/17RAM;
  recording start17; consent transport95; display4profiles; fixed local prompt
  catalog19 assets. Codec retry tests at1000Hz and100Hz and authenticated24h SD
  retention pass. Report-dialogue29 actual-function cases and Wave/legacy audio
  admission tests pass, including a Wave build linked without any DSP symbols.
- Source, release hashes, final three-profile build and physical installation
  evidence are recorded in the versioned validation JSON after completion.
- The preserved pending recording received verified completion (queue1 to0) in
  the preceding maintenance test; no SD data was erased for this upgrade.

## Remaining verification and dependency work

A final physical spoken report and idle return must be distinguished from
host tests. Record the user's actual result rather than inferring success.

Production npm audit also identifies existing Zod3.25.76 memory-exhaustion issue
GHSA-mrhx-c7xc-m3w5. A separately tested4.6.6+ upgrade and bounded validation
inputs remain necessary. No untested major validation-library upgrade is mixed
into this hardware repair. See the0.11.1 validation notes for the reproduced
advisory and boundary details.

Nested spoken action review uses the same speaker/power/fresh-capture guards.
Silent windows never produce approval requests; unknown replies are bounded,
meaningful reviews remain unlimited, and a review failure returning to Ready
cannot reopen report capture. This is included in the29 actual-function cases.

On the connected board the idle heap increased from approximately5,625,000 to
5,981,000 bytes after removing unused echo DSP state. This is an observed memory
saving, not a measured battery-life or power-consumption claim.
