# Quipus firmware 0.11.1 maintenance verification

24 October 2026. Target: Waveshare ESP32-S3-LCD-1.54 non-touch,
MAC 28:84:85:91:C4:4C. USB power only; no battery installed.

## Scope

- Repair historical status reports blocked by a stale non-capture server state.
- Reconcile finalized local stop/import receipts before requesting reports.
- Return read-only report/command failures to idle so saved uploads can retry.
- Brief volume feedback, measured battery only, and USB for the current board.
- Conservative automatic disposition of verified short digital silence.
- Reversible calendar visibility with contained X, Undo and Hidden controls.

## Data preservation

No pairing, Wi-Fi, NVS, archive encryption keys or SD recordings are erased by
this update. Verified SD files keep the existing 24-hour grace period; unverified
files never expire automatically. Calendar visibility does not remove audio,
transcripts, People history, report history or Google Calendar events/invites.

Shortness or empty transcription alone cannot authorize deletion. Every expected
original source must be valid 16 kHz mono PCM strictly shorter than 5.000 seconds,
completely constant within +/-128 signed PCM, with no prior speech evidence.
Every transcription fallback must complete successfully with an explicit no-speech
result. An owner/device/session/event/recording-bound private proof authorizes
only the specific raw objects. Quiet speech, normal noise, missing phone data,
provider errors, missing migration or any uncertain evidence preserve the WAV.
This first policy intentionally retains noisy accidental recordings. It is not
a general speech detector or a promise to discard every empty-sounding clip.

## Production prerequisites

Existing schema020 projects use:
`supabase/setup/quipus-recording-calendar-upgrade.sql` (021+022).
The exact combined SQL was executed against PostgreSQL schema020 with existing
recording, transcript, meeting and storage rows. All remained unchanged; no
cleanup or discard decisions were created by installation. Fresh projects use
the separate fresh-project bundle. Do not rerun an installed migration.

Without021 ordinary uploads continue; a qualifying candidate is retained and
retries. Without022 the calendar still loads, while hiding gives an explicit
setup-required error without prematurely removing the entry.

## Verification evidence

Final build, device observations, deployment identity and user SQL confirmation
are recorded below when completed. Automated tests are distinct from a physical
spoken-report acceptance test; a mocked provider test cannot establish room
acoustics or actual speech playback.

## Live installation findings

The first physical test heard Computer and classified status_report correctly,
but the report guard still rejected the server's stale device-state snapshot.
The guard now checks the owned, unended, non-offline live capture slot for all
non-ready device states. A real active/consent/paused capture or missing end
receipt remains blocked. Foreign, ended and finalized offline sessions cannot
trap historical report access. No server capture state is changed by a report.

One first boot exposed an abandoned ES8311 constructor attempt's latched error
surviving a successful full retry. The retry now clears that error only BEFORE
a fresh constructor attempt. Errors within the successful constructor/open/probe
remain latched and fail initialization. Actual retry-loop fault tests pass at
1000Hz and100Hz. This replaces the intermediate image after its single reboot.

User confirmed the combined021+022 SQL was applied on24 October2026.

## Remaining dependency finding

A production-only npm audit reports one existing high Zod advisory,
GHSA-mrhx-c7xc-m3w5, in resolved3.25.76. It concerns memory exhaustion while
validating oversized collections, including authenticated import/calendar
boundaries; current maximum-length checks alone are insufficient. A separately
tested upgrade to4.6.6+ and bounded JSON/early collection gates remain necessary.
No untested major validation-library upgrade is mixed into this hardware repair.
This finding is separate from the focused tests and successful production build.

Sources: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5 and
https://github.com/colinhacks/zod/pull/6652.

## Final automated and deployment checks

- All three ESP-IDF5.2.3 profiles build sequentially with Ninja-j2: Waveshare,
  touchscreenV2 and original. Final Wave app size0x3d0730 in a0x3f0000 slot;
  0x1f8d0 bytes remain. No partition or NVS changes were made.
- Actual completion parser/SD metadata fixture54 cases; production-shaped
  ready/null machine receipts included. Explicit envelope sessionId and legacy
  hardware conversationId bind a receipt to the requested recording. Foreign,
  unbound or contradictory identities fail closed. Optional SD metadata remains
  compatible with older authenticated manifests.
- Actual delivery controller20 completions; report recovery35SD+17RAM cases;
  voice transport95 cases; recording startup17 cases; display4profiles; local
  prompt catalog19 fixed assets; codec fault tests at1000Hz and100Hz; authenticated
  24-hour SD retention tests pass. Consent remains voice-only and unchanged.
- Report backend30 focused tests pass, including all stale device states versus
  actual owned active capture. Silence49 focused tests (including6 actual
  pipeline cases) and calendar28 tests pass. Relevant strict semantic TypeScript,
  ESLint, CSS lint and generated SQL checks pass.
- Final Vercel production deployment passed Next16.4.3 compilation and full
  TypeScript check. Deployment: roxanne-21e5q2c4w-nathans-projects-b0bfd21e.vercel.app;
  aliased to https://quipus-sales-rep-assistant.vercel.app.
- Root, demo and login returned200 on the previous equivalent site release.
  A physical spoken-report success and final preserved-archive verification are
  recorded separately below; they are not inferred from automated tests.

## Final physical observation

The final application and Computer model were flashed on COM5 with esptool's
SHA verification for both images. Application SHA256:
`e0f52a78004d0a4ad1dde6fb63b6c42fdc0340148cbe71393c922d4d9007c35a`.
The final boot completed without a panic/reboot, restored Wi-Fi and pairing,
initialized audio and WakeNet, and reported healthy idle state with wake enabled.
The previously preserved queue completed automatically: one pending archive
became zero after the server's verified receipt. Protected archive evidence remained in place; this was verified delivery,
not deletion of pending audio. Completion
speech PCM played and drained before idle resumed.

A successful physical spoken-report retest is still awaiting the user's reply.
The initial test's wake and command recognition were observed; no claim of a
successful final spoken report is inferred. Volume/battery layout was inspected
in actual-renderer captures; a battery percentage was not physically measured
because this device is USB-powered with no battery installed.

The versioned validation JSON and packaged hashes are in
`output/quipus-upgrade/hardware/quipus-waveshare-0.11.1-validation.json`.
Isolated source snapshot branch: `codex/firmware-report-calendar-20261024`.
The user's main HEAD and staging index remain unchanged.

## Expired-consent repair

The real spoken retest isolated an old owned awaiting_recording_consent slot.
Its recording-consent prompt had expired without capture starting. Reports now
allow only that narrow proven-unstarted case: full state-machine schema and
session binding, both consent states matching, strictly expired prompt, absent
machine consent/start timestamps, and every durable recording/audio/transcript
field empty. Malformed, missing, future, equal-time or contradictory evidence
stays blocked. This does not mutate or cancel the session; a late YES remains
invalid. The final report suite passes30 tests; the exception itself passes8
availability tests with approximately100 negative combinations.

Read-only report errors now use the existing neutral retry cue rather than
claiming that successful voice recognition failed or Wi-Fi is unavailable.
Latest deployment: roxanne-21e5q2c4w-nathans-projects-b0bfd21e.vercel.app, aliased
to the Quipus production domain after a full build and TypeScript check.
