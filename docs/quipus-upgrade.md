# Quipus upgrade: implementation and rollout

18 October 2026. This document supersedes the September roadmap for this upgrade.
Source implementation and local checks are distinct from deployed/physical acceptance.

## Architecture

ESP32 captures onboard audio and optional Android phone audio over USB-C, stores
separate encrypted tracks under one owner-bound meeting, and uploads both.
Supabase keeps private files and durable leased jobs. A separate Railway recording
worker performs transcription/analysis and later optional research. Redis supplies
wakeups, temporary progress and selected caches. Vercel handles the workspace and
explicit approvals. Existing worker/ remains the WhatsApp relay.

Both originals must pass integrity verification before local deletion is allowed.
Replay offers Combined, Onboard mic and Phone mic when preserved sources are
available. Each uses its own private playback link and bookmark. Transcript-only
playback follows the consolidated timeline; phone-original offsets are not used
as transcript timestamps. A lost derivative-upload response is accepted only
after the complete remote file passes its declared length and SHA-256 checks.
Long-file processing uses fixed-size file buffers and lazy overlapping Blob slices.
No meeting rooms, join codes, phone networking or Bluetooth joining are included.

## Phase delivery and live gates

| Phase | Implemented in source | Live acceptance |
|---|---|---|
| 0: foundation | owner boundaries, origin guards, quotas, headers, CI and restricted security review | hosting WAF/alerts, admin MFA, actual network baseline |
| 1: recording | encrypted SD containers, key backup, journals, offline consent/recovery, Android USB capture | target phone/board, physical power loss and battery soak |
| 2: upload | resumable tracks, integrity acknowledgement, durable derivative ledger | interrupted Wi-Fi and full-length replay |
| 3: processing | independent Railway service, bounded SQL jobs, retry/readiness, retention | migrations, deployment and readiness before cutover |
| 4: understanding | evidence, cautious speakers, corrections, uncertain-clock date guard | representative mixed-language evaluation |
| 5: People | person history, unified meeting detail, unresolved recordings, onboarding | signed-in desktop/mobile |
| 6: research | LinkedIn candidates, confirmation, private notes and sourced Q&A | provider credentials and match quality |
| 7: Calendar | scoped health/refresh/disconnect, browser-bound OAuth, timezone validation | Google public access and external-account test |
| 8: preparation | evidence checklist, sourced venues and deterministic budgets | live venue quality and approved invitation |
| 9: operations | retention, audit, acknowledged device transfer, restricted security automation | restore drill, hardware soak, independent penetration test |

Security is checked throughout; phase 9 verifies operation. No perfect speaker
identity, zero-breach, universal phone support or week-long battery claim is made.

## Rollout order

1. Back up the hosted database and confirm migrations 001-012 are installed.
2. Apply migrations 013-019 in order using a database-owner connection. Do not
   rerun the initial schema. The convenience export is
   output/quipus-upgrade/upgrade-013-019.sql; individual migrations are authoritative.
3. Deploy the application to existing Vercel project roxanne. Its intended domain
   is https://quipus-sales-rep-assistant.vercel.app.
4. Create the separate Railway service from repository root, configuration path
   recording-worker/railway.json. Leave the WhatsApp relay separate.
5. Confirm /ready HTTP 200 and a complete processing job.
6. Set QUIPUS_PROCESSING_MODE=dedicated on Vercel and redeploy. Keep inline
   compatibility until the dedicated service is proven. SQL capacity covers both.
7. Install dependent firmware only after archive-key/import/source/transfer
   endpoints and migrations are available.
8. Install the Android APK for physical acceptance. Production signing/store
   distribution is separate release work.

## Configuration

Vercel retains existing server-only Supabase, OpenAI, Exa and Agora credentials.
Never put server secrets in NEXT_PUBLIC variables.

    NEXT_PUBLIC_APP_URL=https://quipus-sales-rep-assistant.vercel.app
    GOOGLE_CLIENT_ID=<web client>
    GOOGLE_CLIENT_SECRET=<secret>
    GOOGLE_REDIRECT_URI=https://quipus-sales-rep-assistant.vercel.app/api/google/callback
    GOOGLE_CALENDAR_ID=primary
    ACTION_APPROVAL_SECRET=<preserve existing value>
    UPSTASH_REDIS_REST_URL=<HTTPS REST endpoint>
    UPSTASH_REDIS_REST_TOKEN=<same database REST token>
    QUIPUS_PROCESSING_MODE=inline

ACTION_APPROVAL_SECRET protects existing Google credentials and wraps archive-key
backups with separate cryptographic purposes. Blind replacement breaks recovery;
rotation needs a versioned migration and rehearsal.

See recording-worker/.env.example for its actual variables. UPSTASH_REDIS_URL is
the native rediss:// connection to the same Redis database. The recording worker
needs no Google, Agora or WhatsApp keys.

Google Cloud/Supabase:
- Enable Calendar API; configure an External OAuth application and required public
  publishing/verification. Test-user access is not public launch.
- Calendar callback:
  https://quipus-sales-rep-assistant.vercel.app/api/google/callback.
- Supabase Google sign-in callback:
  https://cjogfunwcwytvooycjzv.supabase.co/auth/v1/callback.
- Supabase Site URL: the Quipus origin; allowed app redirect:
  https://quipus-sales-rep-assistant.vercel.app/auth/callback.
- Each owner grants their own Calendar connection. There is no global refresh token.
- Full inbound Google Calendar mirroring is not included.

## Android and hardware limits

See mobile/android/README.md. The app has no INTERNET permission. USB and microphone
permissions remain controlled by Android. Connecting alone does not start recording.
The USB firmware variant moves console output away from the binary audio stream.
These prototype builds use the restored ESP-IDF 5.2.3 toolchain; migration to a
supported patched SDK and dependency review are production release gates.

The phone acts as USB host and can power/charge the board. Test actual power draw
before long meetings; do not improvise dual-power wiring. Target-board USB native
wiring is required. This is not a claim that every USB-C phone is supported.

Audio source identity is not speaker identity. Clock alignment is estimated and
source selection is a preliminary heuristic, not beamforming or guaranteed overlap
separation. Both originals remain available. A phone interruption leaves onboard
capture running. Recovered partial sessions retain approximate timing warnings.

## Security and retention

- Private storage, database/storage RLS and explicit server ownership.
- User-session playback with renewable five-minute access links.
- The worker's elevated server key remains server-only. It is not presented as a
  custom least-privilege database role.
- SD encryption protects a removed card. Production secure boot/flash/NVS
  provisioning remains a physical release gate; a stolen whole development board
  is not protected to the same standard as a secured production device.
- No irreversible eFuses are burned by these changes.
- Audio expires 90 days after cloud ingestion. Registered original/derived objects
  are removed before deletion completes. Backups/provider expiry must be checked
  separately. Transcript/relationship history has its own lifecycle.
- Local unverified originals remain for recovery. Legacy plaintext SD files are
  preserved and block unsafe reset/transfer rather than being silently deleted.
- Transfer requires no remaining private SD files and verified server archives.
  Old cloud history retains its owner; new pairing creates a fresh device identity.
- Do not log recordings, transcript content, tokens or signed access links.
- Authorised cloud processing requires readable audio/text. This is not
  end-to-end encryption.

## Security automation

The security workflow runs deterministic scanners. Optional AI triage runs only on
trusted scheduled/manual events with QUIPUS_SECURITY_AI_REVIEW=true and a separate
low-budget SECURITY_REVIEW_OPENAI_API_KEY repository secret. It receives allowlisted
redacted findings, has no tools or production access, and produces advisory
artifacts. Dependabot prepares dependency update PRs.

Hosting WAF rules, incident alerts, log destinations and administrator MFA require
actual account configuration. A committed workflow is not proof of continuous
production monitoring.

## Physical acceptance

Record multiple sessions including a five-minute dual-source meeting. Test reboot,
lost Wi-Fi during capture/upload, locked phone, denied permissions and unplugging.
Verify full duration, both original integrity results, one consolidated report and
correct owner. Check uncertain dates and exact action previews. Test transfer with
non-sensitive fixtures only. Measure battery, heap and temperature through a
realistic working day.

Only send external test invitations/messages to an intentionally approved recipient.
Do not use real clients or private recordings as unannounced automated fixtures.


## People, evidence and private context

People replaces Conversations in the main navigation. A person card opens their
saved details, next step, conversation history and outstanding items. Optional
Client context expands professional research, a private reminder and meeting
questions. All recordings, including sessions without identified participants or
completed reports, remain accessible in the People meeting history. Calendar and
person-history links use the same meeting detail.

Identity is conservative: a name alone never merges histories. Matching uses an
unambiguous email or a unique name/company match without conflicting email
identity. Ambiguous people remain separate. Group follow-ups are unassigned
unless the extraction names an unambiguous participant. LinkedIn matches never
silently rewrite saved contact details or establish who spoke in the audio.

The Transcript tab lets the owner assign an original speaker label to a saved
participant in that meeting. Corrections change display labels while preserving
the original diarization label. They are not biometric identification and do not
establish identity in other recordings automatically.

LinkedIn research runs after the core report is ready in the separate enrichment
queue. It searches public indexed profile pages only, filters returned URLs and
presents possible matches for owner confirmation or rejection. It does not access
private profiles, LinkedIn messages or a complete connection graph. Automatic
checks are limited to once per contact per seven days; manual checks to once per
hour. A refresh cannot reverse a confirmation or rejection. Availability and
freshness depend on public indexing; these snippets are context to verify.

Private reminders live in a separate owner-scoped table. They are excluded from
shared meeting reports, venue requests and the meeting-question context. Meeting
questions use the latest twenty completed meetings linked to the owned person,
return only authorised meeting references, and have no action tools. They expose
no permanent autonomous agent or cross-account search. Uncertain recording clocks
are identified in the context and do not authorise resolved scheduling dates.

### People API contracts

| Route | Operation |
|---|---|
| GET /api/people/:id/research | Owned profile candidates and private reminder |
| POST /api/people/:id/research | Bounded manual LinkedIn refresh |
| PATCH /api/people/:id/research | `{candidateId,status}` confirmed/rejected, or `{note}` |
| POST /api/people/:id/assistant | `{question}` with sourced answer and owned meeting links |
| PATCH /api/meetings/:id/speakers | `{speakerLabel,contactId}`; null clears an assignment |

These routes require an authenticated owner. Mutations enforce the browser origin
boundary, and account-level request limits are supplementary to hosting controls.
Migration 014 provides composite owner foreign keys, private-note/profile RLS and
serialised profile decisions. A database migration failure is surfaced rather than
replacing a signed-in workspace with sample data.

## Meeting preparation and venue decisions

A completed meeting's Summary contains Be prepared. Checklist entries retain
verified conversation quotes; unsupported model statements and public research
cannot become preparation instructions. Completion changes are serialised in
Postgres so updating one item does not reset another browser's completed item.

Find meeting place opens an optional form: area, meeting type, party size,
explicit total/per-person MYR budget, preferred setting and quiet preference.
Nothing is researched until the owner requests it. Only these selected preferences
are sent to Exa/OpenAI, never the meeting transcript, client names or private notes.
A search reads at most five sources and produces at most three distinct venues,
with a five-minute per-meeting cooldown and account limits.

Names and addresses must be supported by their source. Per-person prices require
an exact MYR source quote explicitly stating per-person/pax/head pricing. A coffee
item price does not become an estimated total meeting cost. Budget comparison uses
integer cents and the chosen party size; unknown pricing never receives a
within-budget status. Published estimates may exclude taxes/service charges.
Ratings are quoted source context, not Quipus-generated scores. Current traffic
and crowd levels are unavailable until appropriate providers are integrated.

Use location updates only the explicitly selected pending schedule follow-up from
that owned meeting. It cannot update a sent invitation or choose another account's
follow-up. An over-budget published estimate cannot be selected through this
control. Unknown prices need checking. The invitation still requires its normal
review and approval; there is no booking, purchase or automatic client message.

| Route | Operation |
|---|---|
| GET /api/meetings/:id/preparation | Verified checklist and saved venue research |
| POST /api/meetings/:id/preparation | Explicit venue-preference search |
| PATCH /api/meetings/:id/preparation | `{requirementId,completed}` or `{followUpId,venueUrl,venueName}` |

Migration 016 adds the preparation record and server-only atomic checklist RPC.
The venue and person tools use ordinary bounded requests and durable records,
not permanently running per-conversation processes or database sharding.

## Restricted security-review setup

Deterministic code checks remain primary. To opt into the separate advisory review,
set repository variable `QUIPUS_SECURITY_AI_REVIEW=true` and repository secret
`SECURITY_REVIEW_OPENAI_API_KEY` to a dedicated low-budget review-project key.
`SECURITY_REVIEW_MODEL` is optional. The script deliberately refuses to reuse the
application's `OPENAI_API_KEY`; do not give this job Supabase, deployment, Google,
Redis, device or other production credentials.

The optional job runs only on the trusted default branch for the existing weekly
schedule or a manual workflow dispatch. It never runs with secrets on a pull
request. Its GitHub permissions are contents-read, checkout credentials are not
persisted, and dependency install scripts are disabled in this job. Inputs are
strictly allowlisted scanner metadata; token patterns, URLs, emails and unapproved
paths are redacted. Strict output validation drops unsupported source references.

The seven-day artifact contains redacted scanner context and prioritised advice
with a proposed fix/test approach. It cannot execute tools, apply a patch, change
IAM/firewalls, delete recordings, send messages or deploy. Dependabot separately
prepares limited weekly dependency/action update PRs for normal review. No optional
AI request or external notification was triggered during implementation. Hosting
alerts, incident routing and production monitoring still require account setup.

## Current release state

The user deferred cloud credentials on 18 October 2026. Production application,
database and device firmware were not switched to this upgrade.

An empty private Railway service named quipus-recording-worker was created in the
existing Roxanne project. It has only the Supabase project URL, time zone and
bounded worker settings. It has no deployment and no processing credentials.
Existing roxanne-whatsapp remains a separate service and was not redeployed.
Compatible transitive dependency patches are included in its local lockfile.

When ready:
1. Add SUPABASE_SERVICE_ROLE_KEY and OPENAI_API_KEY to the new worker. Add
   EXA_API_KEY for professional/venue research. Copy values through the hosting
   consoles; do not paste them into chat or commit them.
2. Create one Upstash Redis database near the application. Put its REST URL/token
   in Vercel and the new worker. Put its encrypted native rediss:// URL in the
   worker as UPSTASH_REDIS_URL. Redis is an accelerator; SQL remains durable.
3. Apply the supplied atomic 013-019 SQL bundle as database owner, or only missing
   individual migrations if part of the upgrade has already been installed.
4. Deploy Vercel and the worker, verify private storage/readiness and a complete
   test recording, then select dedicated processing.
5. Complete Google external-app publishing/verification and test Calendar from a
   different consenting Google account. Enable Calendar API and use the exact
   callback URLs above.
6. Flash the selected board firmware and install the companion APK for the
   physical Android USB-C test.

Verified callback settings in the existing Vercel project already use the Quipus
domain. Upgrade table probes did not find the new schema in the hosted API.
No hosted DDL was run. Existing Vercel secrets are marked sensitive and cannot be
read back; they were not replaced. Temporary CLI exports were removed after
configuration inspection.

### Dependency review

Next.js and its matching ESLint configuration were patched from 16.3.2 to 16.3.8.
Compatible transitive runtime patches were applied. The final production npm audit
reports zero known advisories. The relay production dependency audit also reports
zero after compatible patches. Neither result guarantees security.

The full development-tool audit still reports eight high-severity dependency
entries caused by an upstream braces glob-parser advisory, including cascading
entries for lint tools. The latest published braces release remains affected.
A forced audit repair proposes an incompatible Next ESLint downgrade and was not
applied. Lint patterns are repository-controlled; do not accept untrusted glob
patterns or run unreviewed repository scripts with production credentials.
Recheck this dependency when the upstream patch is released.

## Local validation

- Application: 290 tests passed, including actual PostgreSQL migration/ownership
  checks, OAuth race handling, full-WAV integrity, bounded processing and replay.
- SQL export: successfully applied as one transaction after schema 012 in the
  local PostgreSQL test harness. Hosted database was not modified.
- Both Node worker services: type checks, five tests each and builds passed.
- Android: debug APK assembled; nine unit tests passed; lint reported no issues.
- Firmware: original, touchscreen and USB-phone variants compiled without compiler
  warnings. No flash was performed.
- Native C protocol and encryption/tamper/recovery checks passed. Independent
  Python/OpenSSL decryption recovered every original PCM byte.
- Headless browser checks covered People/history/meeting preparation at 1440,
  390 and 320 pixels and real audio source switching/bookmarks in an isolated
  fixture. These are local sample checks, not signed-in production acceptance.

The hardware package is output/quipus-upgrade/hardware/quipus-hardware-local.zip.
It contains separate firmware profiles, exact flash offsets, the Android debug
APK and SHA-256 manifests. It contains no credentials or saved device NVS.
Check the included README and finish backend setup before using it.

The final patched Next.js 16.3.8 production build passed, including compilation,
TypeScript validation and route generation. Real Android USB permissions,
background capture, phone/board power, interrupted Wi-Fi, multi-hour operation,
cloud provider configuration, Google public verification and external-account
approval still require the physical and hosted acceptance steps above.

Final patched production browser smoke passed after restarting only the task's
preview server. People, expandable person context, meeting Summary/preparation
and Transcript were checked at 1440/390/320 pixels with no horizontal overflow,
JavaScript errors or private API calls in sample mode. Manifest and icon both
returned HTTP 200. Audio-source fixture checks preserved source bookmarks and
playback speed. The preview remains available at http://127.0.0.1:3022/demo.
