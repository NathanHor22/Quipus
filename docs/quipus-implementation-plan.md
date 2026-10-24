# Quipus implementation plan

The current hardware refinement is tracked in [Quipus hands free firmware plan](quipus-hands-free-firmware-plan.md). It records the latest agreed voice, screen and SD retention direction; earlier release history remains below.

22 September 2026. Approved plan and implementation checklist. The first Quipus
web release is deployed and firmware `0.8.0-quipus` is installed on the connected
touchscreen V2. See [release evidence and remaining checks](quipus-release.md).

## Current progress

- Phases 1–2: identity assets, top navigation, Home, Conversations, Calendar,
  Devices, profile preferences and first-time Calendar prompt implemented.
  Public sample interactions were checked; the owner reports that the signed-in
  dashboard looks good. New profile saving and mobile visual QA still need a
  live acceptance check. Historical CAD/PDF branding awaits the next engineering
  export; these files are not a released manufacturing package.
- Phase 3: both firmware profiles compile. V2 app-only flash verified, pairing
  retained, and idle heartbeats confirmed. Fresh recording/consent cycles and
  full-WAV replay on this particular image remain acceptance checks.
- Phase 4: dated reports, ordinal/time/person selection, full/quick/action
  sections, owner isolation and expiring context implemented and tested.
- Phase 5: tap/press interruption and spoken follow-up implemented. Actual
  playback/interruption test pending. Natural voice interruption is deferred
  until the microphone/AEC path passes acoustic tests.
- Phase 6: automated tests/builds pass; integrated device and mobile acceptance
  remain open. Previous firmware's five-minute recording evidence is preserved
  separately and is not presented as a new test of this release.

## Agreed direction

- Product: **Quipus**, by Fovea. Replace Lantern branding and the sector/oath/ring
  language throughout active product surfaces.
- Logo: an abstract central connection with curved threads spreading outward
  like wings. Deliver an editable vector mark, wordmark, monochrome version,
  favicon and simplified small-screen version.
- Website: spacious, personal, artistic, with restrained emerald accents,
  frosted navigation and meaningful transitions. No sidebar.
- Top navigation: **Home, Conversations, Calendar, Devices**. Account, settings
  and sign-out belong under the profile control. People/company information
  remains accessible within conversations and search.
- Hardware: quiet, static logo while idle; simple, distinct recording, saving,
  report and error states. No decorative animation.
- Reports: a conversation about the user's recorded meetings, with selectable
  dates, meetings and depth; eventually interruptible while speaking.
- Recording consent and approval of external actions remain separate. Asking
  for a report, interrupting speech or hearing a suggested action never sends it.

## Baseline checked before implementation

- The app uses Next.js App Router and already includes the `motion` package.
  Use shared layouts and real page routes, with the installed framework's docs.
  A second routing system is unnecessary.
- Existing pages include dashboard, calendar, people, devices and settings.
  `/dashboard/conversations` currently redirects to Calendar; it needs to become
  a real conversation index. Individual conversation URLs already exist.
- Google display names already reach the workspace. Preferred-name editing and
  consistent greetings still need to be designed and implemented.
- Full spoken report details and paged speech exist. The current report loader
  selects only today's ready meetings. Historical queries and conversational
  selection are additional work.
- Firmware disables the wake detector during report playback. Reliable speech
  interruption requires an audio/control change, not a new command string alone.
- Shared firmware has Original and touchscreen V2 board profiles. The installed
  prototype wake model is documented as recognising **Computer**.
- A USB serial port is visible at **COM10**. Windows device enumeration was
  restricted; registry visibility does not verify board identity or firmware.
  Confirm those before any flash.
- Prior release notes report successful full-WAV recordings and resumable
  uploads. They are historical evidence, not a fresh test of this connection.
- The current raw-audio upload contract caps files at **25 MiB**. Recording-hour
  support and recovery of every pending SD file after reboot are separate work.
- Existing app and firmware edits are already in the working tree. Preserve and
  review them; do not reset them as part of the rebrand.

## Phase 1 — Quipus identity and brand foundation

Deliverables:

1. Logo system and a small design reference: colour, type, spacing, surfaces,
   button states, focus states and reduced-motion behaviour.
2. Central product copy and naming, covering login, public sample, page titles,
   manifest/icons, onboarding, account pages, notifications and supported locales.
3. A polished Home screen and startup transition to establish the visual direction
   before extending it across the entire dashboard.
4. Revised hardware prompts as a script: short personal greeting, recording
   consent, recording state, archive state, report controls and recovery.
5. Rebrand current product documentation and the active PCB/enclosure review
   package in its next export; retain Fovea as company attribution. Historical
   release evidence remains clearly historical.

Compatibility rules:

- Keep user IDs, device identities, recordings, pairing credentials, stored Wi-Fi,
  SD originals and action history intact.
- Separate visible names from database names, environment keys, device HTTP
  headers, NVS namespaces and storage paths. Introduce aliases/migrations where
  needed; do not globally replace identifiers that existing devices rely on.
- Provide redirects for existing dashboard links, including `/dashboard/lantern`.
- Rebranding does not by itself change the deployed domain, Google client IDs or
  OAuth callback URLs. External branding changes get a coordinated release step.

Done when: the identity works in the dashboard and on the actual small display,
the primary screens read Quipus, and the compatibility inventory is documented.

## Phase 2 — Complete the website redesign

### Navigation and personal welcome

- Shared top navigation with real URLs, browser Back/Forward, deep linking and
  responsive layouts. Restore keyboard focus sensibly on navigation.
- Greet the person whenever they open the dashboard, using their preferred name
  or Google profile name and their local time. Never hard-code Nathan for users.
  Use a neutral greeting when a name is unavailable.
- Keep greetings inline. The startup animation does not replay on every page
  change or block access while data loads.
- Use roughly 150–250 ms transitions for routine navigation and a short,
  skippable startup treatment. Reduced-motion mode removes nonessential motion.

### Pages

| Page | Main purpose |
| --- | --- |
| Home | Personal greeting, useful daily brief, pending approvals, conversation journal. |
| Conversations | Search/filter by date, person or company; open a dedicated meeting page. |
| Meeting detail | Full audio replay, transcript, speaker labels, summary, commitments, follow-ups and contact corrections. |
| Calendar | Meetings and recorded conversations visible through calendar selection; no duplicated conversation sidebar/list below it. |
| Devices | First-time pairing when unpaired; health, storage, sync status, reconnect/revoke when paired. |
| Profile/settings | Preferred name, timezone, language, integration status/reconnect and sign-out. |

- Retain the sample experience before login, clearly labelled and isolated from
  live account data. Keep sign-in and sign-out easy to find.
- Preserve Google login and the separate Calendar permission grant after sign-in.
  Show declined, expired and revoked permissions honestly; support reconnect.
- Show a setup-network link to `http://192.168.4.1` with the instruction that the
  user's phone/laptop must first join that device's setup Wi-Fi.
- Show real upload/processing progress. An animation cannot imply a completed
  upload, successful invitation or connected integration without confirmation.
- Keep WhatsApp optional in setup/settings and preserve its existing delivery
  work. Official Meta onboarding completion remains a separately tested feature.
- Company/contact enrichment remains reviewable. Avoid representing a search
  match as a verified identity without evidence.

Done when: all pages work on desktop/mobile, login/sample/live modes stay distinct,
deep links and navigation work, and existing audio and approval flows pass checks.

## Phase 3 — Simple Quipus firmware on the current hardware

Identify the connected board, record the installed version and capabilities, and
preserve pairing/configuration before flashing an appropriate board-specific build.
Keep both supported board profiles building; test each only on available hardware.

| State | Intended behaviour |
| --- | --- |
| Boot | Brief static logo; once ready, say “Quipus ready, Nathan” using the owner's actual preferred/profile name. |
| Idle | Static logo with small, honest power/network/pending-upload indicators. |
| Tap | Begin the recording-consent flow. |
| Wake phrase | Open a short command window for “start recording” or “status report.” |
| Consent | Clear yes/no handling and bounded retries; recording starts only after valid consent. |
| Recording | Elapsed time and unmistakable recording indicator; physical/touch Stop remains available. |
| Saving/uploading | Distinguish saved on SD, uploading, accepted in cloud and summary processing. |
| Complete | Brief confirmation and return to the same idle screen. |
| Error | Explain the failed operation, offer retry/cancel, preserve pending audio. |

- Keep **Computer** as the working wake phrase for the initial firmware release.
  Brand screens and spoken identity as Quipus. A Quipus wake model is a separate
  deliverable and must be tested before changing the instruction shown to users.
- During idle, wake opens command selection because users also need reports;
  a tap goes directly to recording consent. Do not add a long spoken menu.
- No repeated boot greeting on heartbeats, routine reconnects or new sessions.
- If battery measurement is unavailable, show USB power or unknown status rather
  than displaying a fabricated battery percentage.
- Update the setup portal and future setup SSID to Quipus consistently with the
  dashboard instructions. Preserve saved network credentials and pairing.
- Retain the full WAV until the backend confirms complete archival and durable
  processing acceptance. Processing failure must not hide the replay recording.
- Scope voice retry commands to explicit recovery windows so they do not compete
  with capture, consent or action approval.

Done when: repeated start/consent/record/stop cycles return to idle, the five-minute
WAV plays in full, setup/reconnect works, and no startup or screen loops recur.

## Phase 4 — Context-aware status reports

Build and test meeting selection and conversation state before depending on
open-microphone interruption on the ESP32.

Supported requests:

- “Give me a quick report for today.”
- “Give me the full breakdown of my day.”
- “Only tell me about the third meeting.”
- “Tell me about the meeting I had at 2 pm.”
- “What happened yesterday?” / “Give me last Friday's report.”
- “What did Nigel ask for?” / “Just the action items.”
- “Next meeting.” / “Repeat that.” / “Continue my daily report.” / “Stop.”

Report rules:

1. Default to a full daily report covering every saved important detail of
   each included meeting: people, topics, decisions, concerns, commitments,
   deadlines and actions. Offer a concise overview or actions-only report when
   explicitly requested. Do not truncate the detailed report to one bullet.
2. Resolve relative dates in the user's configured timezone. Say the selected
   date and meeting time so the user can catch a wrong interpretation.
3. Number meetings chronologically within the selected date/range. Store the
   ordered meeting IDs for that report so “third meeting” does not change when
   another upload finishes in the background.
4. Keep the selected date, meeting, depth and playback position during follow-up
   questions. A new targeted answer pauses the daily report; “continue my daily
   report” resumes at the saved point.
5. If “2 pm” or a person's name matches several meetings, ask a short clarification.
   Use actual recorded times and distinguish them from scheduled calendar times.
6. Missing recordings, pending processing, no matches and unavailable transcripts
   have distinct responses. Do not invent a meeting, speaker identity or answer.
7. Retrieve only the authenticated owner's data. Keep report/detail answers linked
   to the meeting and supporting transcript where available; treat transcript text
   as meeting data rather than instructions to perform actions.
8. Segment speech by meeting/section so content can be cancelled and resumed.
   Snapshot/cache only within the correct owner/device scope and expire it.

Actions after a report:

- Say which actions were found: “There are two follow-ups. Would you like to
  review them?” A yes opens review; it does not approve sending everything.
- Read the precise recipient, purpose, date/time/timezone and invitation/email
  details before accepting approval for that specific action.
- Bind approval to the current action and version with an expiry. Interruption,
  changed details or a different meeting invalidate stale approval context.
- Prevent duplicate sends/events on retries; report confirmed success or an
  uncertain result accurately. Check the result before retrying an uncertain send.

Done when: date/time/person/ordinal selection, ambiguous matches, interruptions
of logical report context and action approvals pass scenario tests independently
of microphone performance.

## Phase 5 — Interruptible spoken reports on hardware

Target experience: while Quipus speaks, the user says “Only the third meeting.”
The old speech stops, the user's full request is captured, the selected meeting
is confirmed and its report begins. Tap-to-interrupt remains available.

Implementation and validation requirements:

- Verify the current board can capture microphone audio during playback and
  support a usable echo reference/cancellation path. Existing report code
  disables wake detection; it cannot provide this experience unchanged.
- Detect user speech locally, retain pre-roll, stop/mute playback promptly, and
  cancel queued audio plus pending report synthesis. A generation ID prevents
  late replies from restarting an abandoned report.
- Avoid recognising the device's own narration or nearby conversation as a
  confirmed action. Tune speech detection and echo cancellation on actual audio.
- Keep short listening windows after speech. Silence leads to an appropriate
  resume/idle state; it does not silently approve an action.
- Separate report controls from recording consent. A report interruption is not
  a meeting recording session or a new consent answer.
- Initial target: speech stops within roughly 300 ms of confirmed user-speech
  onset, measured on the device. This is a target, not an achieved latency.
  Measure request recognition and time-to-first-answer separately.
- If the existing board cannot pass natural-interruption tests, retain tap or
  wake-assisted interruption on that board and validate natural interruption
  with the selected microphone array. Do not promise parity without a test.
- Cloud report queries need connectivity unless the requested report is already
  cached. Say when the requested information is unavailable offline.

Done when: full/targeted/historical reports can be interrupted and resumed without
lost first words, stale playback, accidental actions or screen-state loops.

## Phase 6 — Integrated release and measured performance

Test the complete journey against a dedicated test account/fixtures, then the
connected device with real recordings:

1. Public sample -> Google login -> Calendar permission -> personalised Home.
2. New pairing, existing-device reconnect, revoke and re-pair.
3. Consent yes/no/timeout; 30-second and five-minute capture; full cloud replay.
4. Network loss during upload, resume, archive acknowledgement and summary retry.
5. Today's overview, full day, third meeting, 2 pm, yesterday, ambiguous matches,
   interrupted speech, resumed report and no-result cases.
6. Specific action review, expired approval, cancellation and duplicate retry.
   Live external sends use an explicitly intended test recipient/action.
7. Desktop/mobile navigation, keyboard access, reduced motion and owner isolation.
8. Benchmark capture-end -> archive accepted -> transcript ready -> first report
   audio, on comparable recordings/network conditions. Optimise the measured
   bottleneck; a redesigned progress indicator is not a latency improvement.

Run focused tests during each phase and the appropriate app/worker builds before
release. Firmware changes must compile for both profiles and be tested on the
identified target. Release backend compatibility before dependent firmware;
retain rollback files and keep device credentials/private backups out of exports.

## Follow-on hardware engineering, separate from this firmware release

- Continue the selected ready-made four-microphone module + custom ESP32 carrier
  plan only after the current product experience and audio capture are validated.
- **Correct the acoustic orientation in the CAD/PDF before fabrication.** Seeed
  specifies that the microphone inlets are on the back/Seeed-logo side and should
  face the sound source. The earlier placement draft treated the visible mic
  component side as the upward acoustic face. Position the actual sound holes
  upward with the screen and check connector/support clearances after flipping.
- Resolve the previously documented regulator stability, charger heating, pack
  current/NTC requirements, actual component selection and connector pin mapping.
- Complete native schematic checks, footprints, PCB routing, fabrication outputs
  and acoustic/thermal testing. The existing model/PDF is not manufacturing-ready.
- Test 1/3/5-metre recordings and speech interruption before claiming room-range
  performance. The array's echo processing is a capability, not a completed
  integration or guarantee for this enclosure.
- Longer recordings, compressed transport, upload during capture, full power-loss
  SD recovery and official Meta onboarding remain visible backlog items. Preserve
  full recordings while evaluating transport optimisation.

Manufacturer reference:
[Seeed XVF3800 guide — acoustic inlet orientation and audio processing](https://wiki.seeedstudio.com/respeaker_xvf3800_introduction/).

## Implementation entry points

- Brand/web: `app/layout.tsx`, `app/manifest.ts`, `app/icon.svg`, `app/login`,
  `components/brand`, `components/workspace`, dashboard routes and locale copy.
- Identity/time: `WorkspaceRoute.tsx`, user profile storage, `lib/calendar.ts`.
- Reports/actions: `lib/device-briefing*.ts`, `lib/device-command.ts`,
  `lib/device-dialogue.ts`, `lib/device-speech-response.ts`, device API routes.
- Hardware: `hardware/lantern-firmware/main`, board profiles, display, wake,
  network/audio playback, storage and the setup portal.
- Design documents: `hardware/lantern-custom-pcb`, current review exports and
  active setup guides. Keep references to preserved legacy interfaces explicit.

Next acceptance step: test a full historical report, tap to interrupt, request
one meeting, then resume; follow with a fresh recording and complete cloud replay.
