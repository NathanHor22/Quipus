# Quipus

Quipus by Fovea: capture conversations and follow through. The active dashboard uses Home, Conversations, Calendar and Devices. See [the Quipus release notes](docs/quipus-release.md) for branding, hardware controls and tested limitations. Legacy `lantern` protocol identifiers and deployment URLs remain compatible.

Quipus turns Malaysian business conversations into a recap, follow-ups, and
meeting approvals. The dashboard combines captured conversations and upcoming
meetings in a calendar. Open an approved meeting to review the conversation
that led to it: bullet points, concerns, promises, and preparation tasks. When
the original recording is available, replay that conversation from its brief.

This phase implements the dashboard, a completed-transcript API, OpenAI
extraction, explicit Google Calendar actions, and the first Quipus capture
loop. It also adds Quipus Relay, a hackathon slice that uses OpenAI to find
evidence-backed introductions across conversations and holds each one for
human approval. The ESP32-S3 can open a consented session, publish microphone
audio to Agora, upload the final captions and original WAV, and ask OpenAI to
create the dashboard brief. The server supplies the authoritative Malaysia date
and time when capture starts. See [ARCHITECTURE.md](ARCHITECTURE.md) for the
boundaries, request contracts, data model, and remaining work.

## Run locally

1. Install Node.js 22.x, matching `package.json`.
2. Run `npm install`.
3. Run `npm run dev` and open `http://localhost:3000`.

With no Supabase configuration, local development permits credential-free
access. The sample workspace uses fictional conversations and browser storage.
Approvals, dismissals, and checklist changes in sample mode make no provider
calls and send no invitations. Use **Reset sample** to restore the preview.
The public home page always opens this sample. `/dashboard` remains the
authenticated live workspace.

## Configure a live workspace

Copy `.env.example` to `.env.local` and configure the paths you want to exercise.
Keep server credentials out of `NEXT_PUBLIC_` variables.

Apply these migrations to the target Supabase project in order:

1. `supabase/migrations/001_initial.sql`
2. `supabase/migrations/002_worker_hardening.sql`
3. `supabase/migrations/003_meeting_approvals.sql`
4. `supabase/migrations/004_lantern_devices.sql`
5. `supabase/migrations/005_lantern_recording_pipeline.sql`
6. `supabase/migrations/006_lantern_relay.sql`
7. `supabase/migrations/007_multi_user_workspaces.sql`

Migration 003 adds structured schedule details and dismissed approvals. It also
adds a unique Calendar-action index per follow-up. Reconcile any existing
duplicate Calendar actions for the same follow-up before applying that index.

Migration 004 adds one-time Quipus pairing, revocable device credentials,
telemetry, durable session state, and idempotent device-event records. It does
not add provider credentials or raw-audio storage to the device.

Migration 005 adds the Agora session identifiers, staged final captions,
private device recording linkage, provider retry fields, and completed Quipus
meeting link used by the first capture pilot.

Migration 006 stores user-scoped Relay proposals and their pending, dismissed,
or scheduled state. Re-running Relay preserves a proposal that was already
dismissed or scheduled.

Migration 007 removes the original single-account restriction, backfills a
profile for every existing Supabase Auth user, and gives each account isolated
row-level policies for conversations, devices, recordings, Relay proposals,
and provider connections.

If an existing deployment reports `column devices.model does not exist` or
cannot find `public.device_pairings` in the schema cache, that database has the
base schema but not the Quipus device upgrade. In the Supabase dashboard, open
**SQL Editor**, run migrations 003 through 007 above in numerical order, and
wait for each query to finish before starting the next one. Migration 004 is
the pairing boundary; 005 adds the recording pipeline, 006 adds Relay, and 007
backfills all Google users and replaces the original owner-only policies. The
migrations explicitly ask PostgREST to reload its schema cache after the device
and multi-user changes commit.

The live workspace requires `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Every
successful Supabase Google sign-in creates its own Quipus profile and private
workspace.

`NEXT_PUBLIC_SUPABASE_ANON_KEY` may contain Supabase's modern publishable key.
`SUPABASE_SERVICE_ROLE_KEY` may contain a modern `sb_secret_...` key; the
variable keeps its legacy name for compatibility. The elevated key is used
only by server routes and must never use a `NEXT_PUBLIC_` prefix.

### Google login

Quipus accepts any Google account allowed by the Google Cloud OAuth app. Web
routes require a valid Supabase session, and server-side data operations resolve
the user ID from that same session. The public homepage, privacy policy, terms,
login page, and Supabase callback remain available without signing in.

Enable Google under **Supabase Auth > Providers**, then allow these redirects
under **Auth > URL Configuration**:

- `http://localhost:3000/auth/callback`
- `https://YOUR-APP-DOMAIN/auth/callback`

For the Google OAuth client used by Supabase Auth, register the Supabase
callback shown on its provider page, normally
`https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`. The app's
`/auth/callback` belongs in Supabase's redirect allowlist.

The current production Site URL is `https://quipus-sales-rep-assistant.vercel.app`.
Set it in the hosted Supabase **Authentication > URL Configuration** page and
add `https://quipus-sales-rep-assistant.vercel.app/auth/callback` to Redirect URLs.
The checked-in `supabase/config.toml` does not automatically update hosted Auth.
Set Vercel's `NEXT_PUBLIC_APP_URL` to that same production origin and redeploy.
When migrating domains, also update `GOOGLE_REDIRECT_URI` and its Google Console
entry for the separate Calendar integration, as described below. Keep the
Supabase project's Google callback URI unchanged. A rejected app callback may
otherwise fall back to the old Site URL; browser session cookies cannot move
between the old and new hosts.

Production authentication requires both public Supabase values. Leaving
both unset disables authentication only in local development; incomplete
configuration fails closed.

### OpenAI understanding

Set `OPENAI_API_KEY` and, optionally, `OPENAI_EXTRACTION_MODEL` (default
`gpt-5.4-mini`). The adapter calls the OpenAI Responses API with a strict JSON
schema and validates the result locally. Its schedule extraction requires an agreed meeting and a
supporting quote found in the supplied transcript. Human review still decides
whether the details are correct before an invitation is sent.

`POST /api/conversations` accepts a completed, normalized transcript and
requires OpenAI and workspace storage. It does not call a speech provider or
accept raw audio. The contract and an example are in
[ARCHITECTURE.md](ARCHITECTURE.md#completed-transcript-api).

The configured prototype uses OpenAI for transcription recovery and structured
meeting extraction. A configured OpenAI failure is reported instead of
returning sample content. Older provider adapters remain in the source for
compatibility tests but need no production environment variables.

### Quipus Relay with OpenAI

Set `OPENAI_API_KEY` on the server. `OPENAI_RELAY_MODEL` defaults to
`gpt-5.4-mini`. Relay calls the OpenAI Responses API with strict structured
output and `store: false`. It compares up to twelve recent ready conversations,
accepts at most four proposals, and drops any proposal below a score of 70.
Each displayed quote must exactly match evidence already saved in Quipus.

```dotenv
OPENAI_API_KEY=your-openai-api-key
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe-diarize
OPENAI_EXTRACTION_MODEL=gpt-5.4-mini
OPENAI_RELAY_MODEL=gpt-5.4-mini
RELAY_EVENT_NAME=AITKL · Agents, Everywhere
RELAY_EVENT_VENUE=WORQ Bangsar
```

Contact email addresses remain on the Quipus server and are added only after
OpenAI returns valid conversation IDs. Exa is optional: set `EXA_API_KEY` to add
public company context. Its request receives company names, never transcripts,
contact details, or recordings.

Open **Relay** in the dashboard. Sample mode demonstrates the queue without any
provider or Calendar call. Live mode requires OpenAI, Supabase, migration 006,
and at least two ready conversations. Dismissal changes only Quipus state.
**Approve and send invites** checks that the two attendee emails and source
conversation still match the reviewed proposal, then creates the Google event
and marks that proposal scheduled in the same server action.

### Agora wearable transcription

Set `NEXT_PUBLIC_AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`,
`AGORA_CUSTOMER_ID`, and `AGORA_CUSTOMER_SECRET`, then enable Speech-to-Text
for that Agora project. The first hardware pilot publishes 16 kHz mono Opus and
starts Agora Speech-to-Text with `ms-MY,en-SG`. Change
`AGORA_STT_LANGUAGES` or `AGORA_STT_KEYWORDS` after measuring real Malaysian
conversations.

The browser never receives Agora REST credentials. The backend creates a
short-lived device RTC token and subscribes the transcription bot only to that
device UID. Final Agora protobuf captions are staged until the ESP32 uploads
its local WAV; OpenAI then receives those captions with the server-stamped
`Asia/Kuala_Lumpur` date and time.

### Google Calendar

Enable the Calendar API for the Google Cloud project and configure an OAuth
web client with these server settings:

```dotenv
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback
GOOGLE_CALENDAR_ID=primary
ACTION_APPROVAL_SECRET=your-random-secret-of-at-least-32-UTF8-bytes
```

Register `GOOGLE_REDIRECT_URI` in that OAuth client's authorized redirect URIs;
use `https://quipus-sales-rep-assistant.vercel.app/api/google/callback` in production. The
same Google Cloud web client may also serve Supabase login when its authorized
redirect URIs include
`https://cjogfunwcwytvooycjzv.supabase.co/auth/v1/callback`. Supabase Auth must
allow `https://quipus-sales-rep-assistant.vercel.app/auth/callback` as an application redirect.
The Calendar connection remains a separate consent step. Open **Settings >
Google Calendar** in the live workspace to connect. Credentials are encrypted
in `provider_connections`; the Google refresh token is created by this step and
does not need to be copied into Vercel.

For public access, set the Google Auth Platform audience to **External** and
the publishing status to **In production**. Configure the public homepage,
privacy policy, and terms as:

- `https://quipus-sales-rep-assistant.vercel.app`
- `https://quipus-sales-rep-assistant.vercel.app/privacy`
- `https://quipus-sales-rep-assistant.vercel.app/terms`

Declare only Quipus's active Calendar scopes:

- `https://www.googleapis.com/auth/calendar.events.owned`
- `https://www.googleapis.com/auth/calendar.events.freebusy`

Calendar access remains subject to Google's sensitive-scope verification. Use
a custom domain that you control before submitting brand and data-access
verification, then update the Vercel, Supabase, and Google redirect URLs to
that domain.

Review or complete the date, time, duration, and attendee emails, then approve.
The live action creates the Google event with a unique Google Meet link and
sends attendee updates. Quipus
saves the event and its source-conversation relationship through the action
record. The dashboard currently shows Quipus's stored conversations and
events, not a two-way mirror of everything in Google Calendar. The existing
availability endpoint is not automatically called by this approval flow.

### Audio uploads and browser capture

**Add recording** uploads audio directly to the private Supabase `recordings`
bucket using a signed upload token. `/api/process-meeting` receives the storage
reference, verifies ownership, and downloads the audio server-side. The
current limit is 25 MiB. Enter the original capture time and duration so
relative dates can be interpreted against the conversation.

Audio transcription uses OpenAI. Browser microphone capture publishes through
Agora and records a local
audio file for this same upload flow. It requires `NEXT_PUBLIC_AGORA_APP_ID`
and `AGORA_APP_CERTIFICATE`; it is not the future passive wearable transcript
transport. Completed transcript imports do not require these audio-provider keys.

### Replay original conversations

The conversation brief's **Replay** section plays the original uploaded or
browser-captured audio. Playback controls include speed, 15-second skips, and
timestamped transcript entries that jump to the corresponding point. Audio
remains in the private `recordings` bucket alongside its transcript metadata;
the player uses a temporary signed URL for access.

Transcript-only imports, sample conversations, and legacy hardware sessions
without an archived recording show an explicit no-audio state. Quipus does
not synthesize a replacement voice track from the transcript. No passive
wearable is connected by this change: future Agora capture must also archive
the actual conversation audio with timestamps aligned to its transcript.
See [replay architecture](ARCHITECTURE.md#original-audio-replay).

### Quipus core

Open **Quipus** in the dashboard. Sample mode contains an interactive device
simulator that records no audio and makes no provider calls. It demonstrates
the actual transition rules used by the server: recording starts only after a
current consent prompt, offline buffering is capped at 30 seconds, and a voice
confirmation creates a pending dashboard approval without sending anything.

In live mode, an authenticated user can create a ten-minute pairing code,
view device telemetry, and revoke a paired device. Firmware claims that code
once, stores the returned secret in device NVS, and then uses the device
heartbeat API. The secret is returned only during the claim; the database
stores its SHA-256 digest. Request examples and the current hardware status are
in [HARDWARE.md](HARDWARE.md).

The active ESP32-S3 firmware is in `hardware/lantern-firmware`. Version
`0.3.1-button-state-machine` keeps the idle microphone private and uses one
consistent centre-button flow: short press starts spoken consent, either press
stops an active recording, and long press while ready plays today's status
report. The provider-connected path records the server capture time, publishes
audio and captions through Agora, uploads a private WAV, runs OpenAI
processing, and delivers the dashboard brief. The WAV is uploaded even when
Agora captions are unavailable, allowing OpenAI diarized transcription to
recover the meeting before structured extraction runs. Stop and upload retries
reuse their original event IDs, and summary failures retry in the background.
The local replay archive is currently the latest 30 seconds; hour-long chunked
audio, reconnect, and token renewal remain the next reliability phase. Run
`setup-agora-sdk.ps1` once before a clean firmware build, then build and flash
the application with `flash.ps1`.

Legacy follow-up and WhatsApp experiments remain in the repository but are not
part of the Quipus prototype environment or its Calendar approval flow.

## Checks

```text
npm run typecheck
npm test
npm run build
```

`npm run check` also checks and builds the persistent worker; install its
dependencies separately with `npm --prefix worker install` first. Automated
checks do not establish live Agora delivery, OpenAI extraction accuracy, Google account
connectivity, or hour-long wearable reliability.
