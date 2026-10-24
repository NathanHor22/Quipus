# Quipus release — 22 September 2026

Live website: <https://roxanne-two.vercel.app>. Firmware: `0.8.0-quipus`.
Final web deployment: `https://roxanne-117tdqykk-nathans-projects-b0bfd21e.vercel.app`.
The domain and internal device/database identifiers intentionally remain stable.
No accounts, recordings, pairing credentials or SD originals were reset for this
release. The existing Railway recording worker is unchanged by this rebrand.

## Delivered

- Quipus wing/thread SVG mark, editable wordmark, monochrome mark and app icon.
- Sidebar replaced with Home, Conversations, Calendar and Devices tabs, real
  URLs and retained browser navigation. Light/dark themes, subtle page/tab motion,
  nonblocking startup mark reveal and reduced-motion support.
- Personal greeting from the owner's profile; editable preferred name and
  timezone. Google reconnect preserves the chosen name. Journal grouping,
  calendar, details, invitation editing and spoken report date selection use the
  profile timezone. Ambiguous/skipped DST invitation times require correction.
- Dedicated searchable conversation journal and detail pages with original
  replay, transcript, summary, contact correction and separate action approvals.
  Calendar recordings open in a popup without a duplicate conversation list.
- Optional first-time Calendar permission prompt after sign-in. Declining or
  postponing does not block the dashboard. Settings retains reconnect. “Connection
  saved” describes stored credentials, not a fresh Google API health check.
- Simple static Quipus hardware mark and consistent state labels. Boot uses the
  owner's name. V2 battery telemetry is reported as unknown rather than 100%.
- Full, quick and action reports for today, yesterday, a weekday or ISO date;
  meeting number, exact clock time and person selection. Ambiguous matches ask
  for clarification. Report order is stable while new recordings arrive.
- Paged report speech can be stopped with a tap/press. After the listening chime,
  a short spoken request selects another meeting, repeats or resumes the daily
  report. Report context expires after two hours and is scoped to its owner and
  device. Changing report context cancels stale send approvals.

## Device controls

| Situation | Control |
| --- | --- |
| Idle | Say **Computer**, wait for the chime, then give a command. |
| Start recording | Say “start recording” after waking, or tap/short press while idle. Answer the consent prompt. |
| Stop recording | Tap/press; keep power connected until upload is acknowledged. |
| Report | Say “give me the full report for yesterday” after waking; long press requests today's report. |
| Interrupt report | Tap/press once while speech plays, wait for the listening chime, then speak. |
| Select a meeting | “Only the third meeting,” “the meeting at 2 pm,” or “the meeting with Nigel.” |
| Resume/end | “Continue my daily report,” “repeat that,” “next meeting,” or “stop.” |
| Action review | A yes to reviewing actions opens review. Each invitation/email still needs its own specific approval. |

The local wake word is **Computer**, not Quipus. The microphone is not used for
natural voice interruption during speaker playback on this board. Tap-to-interrupt
is the current fallback. These queries select saved report content; this release
does not claim unrestricted question-answering over every transcript.

## Verification and rollout

- Final web suite: all 168 tests passed, including the new timezone and expired
  report checks. The 20 focused report/calendar/time tests also passed. TypeScript and production
  builds passed. Worker suite: 5 tests passed.
- Both Original and V2 firmware profiles compile. Original was not flashed.
- Supabase migration `011_quipus_reports.sql` applied. Verified the report context
  table is inaccessible to anonymous/browser roles and accessible to service role.
- V2 identified as LCDWIKI ES3C28P, ESP32-S3 rev 0.2, 8 MB PSRAM, COM10.
  Application only flashed at `0x20000`; esptool verified its hash. NVS and previous
  app were backed up locally in ignored `hardware/backups/es3c28p`. Those files
  contain private configuration and are excluded from deployment/export.
- Flashed image: 1,677,488 bytes. SHA-256:
  `6f84a59a4d9b1510dd2a7ff2b5251d1005a1b5905a745becd91c2115b5c90999`.
- Post-flash board stayed idle and repeatedly acknowledged authenticated
  heartbeats. No reset/crash appeared during the observation window.
- Browser checks covered public sample navigation, conversation search/detail,
  calendar popups, populated invitation fields, Devices/setup copy and themes.
  The owner signed in independently and reported that the live dashboard looks
  good. Automated screenshots were unavailable in the background Browser panel;
  full mobile visual QA and authenticated profile save remain unverified.

## Remaining acceptance checks

1. Hear the new boot greeting, play a historical full report, tap to interrupt,
   select a meeting and resume the daily report. Confirm the physical display
   and speaker response; heartbeat alone does not prove audio works.
2. Fresh consent refusal/timeout/yes, 60-second and five-minute recording,
   complete cloud replay, network-loss upload retry and return to idle.
3. Preferred-name/timezone save with page reload; first-time Calendar grant and
   declined/revoked permissions; phone layout, keyboard and reduced-motion checks.
4. Specific Calendar/Gmail action using an explicitly chosen test recipient.
   No external email or invitation was sent during this release's checks.
5. Measure tap-to-silence, command recognition and first report audio separately.
   The 300 ms interruption goal is not yet a measured result.

Prior full-recording/upload timing evidence is in
[recording-release-status.md](recording-release-status.md). Audio transport and
the 25 MiB upload limit are unchanged here. Natural speech interruption, a custom
Quipus wake model, hour-long capture, complete power-loss SD recovery and official
Meta onboarding remain separate work. The custom PCB/CAD package still needs the
documented acoustic orientation and electrical/fabrication corrections.

## Compatibility and rollback

Keep the existing Vercel domain/OAuth callbacks, `lantern_*` storage/table names,
`X-Lantern-*` headers, environment keys and `roxanne` NVS namespace. Protocol 3 adds
`X-Quipus-*` report context headers; older firmware retains its existing path.
New firmware setup uses a unique `QUIPUS-XXXXXX` network with a per-device password
shown on the screen; older firmware uses `Quipus-XXXX` or `Lantern-XXXX` with `lanternsetup`.

Firmware rollback must restore only the backed-up app image on the identified
board, preserving NVS/models/SD. Coordinate it with the backend because the new
device report flow requires protocol 3 routes and migration 011. Database changes
are additive; do not drop the new table or reverse earlier recording migrations
as a routine rollback.
