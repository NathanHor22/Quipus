# Quipus delivery checklist

Last verified: 13 September 2026 (Asia/Kuala_Lumpur)

This file separates code-complete work from live infrastructure work. A phase is
only marked complete when its checks pass; a provider is not called "live"
until it has been exercised with real credentials.

## Phase 1 — Foundation and safety

- [x] Next.js application and persistent Baileys worker are separate services.
- [x] Google Auth gives every authenticated account an isolated workspace and
      fails closed when production credentials are incomplete.
- [ ] Change the deployed `DEMO_ACCESS_MODE` from `public` to `owner` after the
      Quipus build and Supabase redirect allowlist are deployed.
- [x] WhatsApp pairing and sends are restricted to `601154444038`.
- [x] Provider secrets stay server-side.
- [x] External sends require an explicit approved action.

Reviewer check:

- Open `/dashboard` signed out and confirm Quipus redirects to `/login`.
- Sign in with two Google accounts and confirm each dashboard opens with an
  isolated workspace.
- Use **Settings > Access & privacy > Sign out** and confirm the session closes.

## Phase 2 — Product experience

- [x] Six-week August 2026 calendar, meeting drawer, people view, and settings.
- [x] English, Bahasa Melayu, Simplified Chinese, Cantonese, and Tamil switching.
- [x] Manual meeting creation includes client name, company, email, and time.
- [x] Audio upload and Agora microphone recording enter the same processing flow.
- [x] Transcript, insight, commitments, follow-ups, audio, and reload persistence.
- [x] Responsive desktop/mobile layouts.

Reviewer check:

- Switch through all five languages and confirm the main navigation changes.
- Open the James Tan meeting and inspect transcript, insight, and follow-ups.
- Create a meeting, reload, and confirm it remains after Supabase is connected.

## Phase 3 — Recording and intelligence pipeline

- [x] Browser uploads audio directly to the private Supabase bucket.
- [x] Owner/path validation, 25 MB limit, MIME allowlist, and failed-state handling.
- [x] ElevenLabs Scribe v2 transcription adapter with diarization.
- [x] Agora device transcription and final-caption ingestion for the first
      hardware capture slice.
- [x] OpenAI strict structured extraction with the authoritative Malaysia clock.
- [x] Groq Whisper/Qwen remain available for browser-upload compatibility.
- [x] Devin produces proposals only; it cannot execute a send.
- [x] Production rejects credential-free fixture fallbacks.
- [ ] Run one real ESP32 recording through Agora → OpenAI → Supabase.
- [ ] Prepare one real Devin follow-up proposal.

Reviewer check:

- Upload a short clear recording under 25 MB.
- Wait for `Ready`, reload, and confirm transcript and insights still exist.
- Confirm a provider error shows `Failed` instead of fabricated success data.

## Phase 4 — Approved actions

- [x] Google OAuth credentials are encrypted at rest.
- [x] Free/busy lookup returns available 30-minute Malaysia-time slots.
- [x] Calendar invitations are idempotent and persisted as meetings.
- [x] WhatsApp relay uses bearer authentication and delivery idempotency.
- [x] WhatsApp follow-up is completed only after a successful delivery.
- [ ] Connect the owner Google Calendar and send one invitation.
- [ ] Pair the owner WhatsApp and send one message to `01154444038`.

Reviewer check:

- Cancel an action and verify nothing is sent.
- Repeat the same approved action and verify no duplicate event/message is made.

## Phase 5 — Quipus Relay hackathon slice

- [x] Relay is a dedicated dashboard view with a fictional provider-free sample.
- [x] OpenAI Responses matching uses strict structured output and `store: false`.
- [x] Unknown contacts, partial or invented evidence, duplicate pairs, and scores
      below 70 are rejected after the model response.
- [x] Participant emails and recordings are excluded from the OpenAI request.
- [x] Optional Exa research receives company names only and fails independently.
- [x] Proposals persist with owner-scoped pending, dismissed, or scheduled state.
- [x] Calendar execution rechecks the stored pair and exact attendees and is the
      only path that can mark a live proposal scheduled.
- [ ] Apply `006_lantern_relay.sql` and add `OPENAI_API_KEY` to Vercel.
- [ ] Run Relay against two real event conversations and approve one test invite.

Reviewer check:

- Open `/dashboard?mode=sample&view=relay`, inspect the evidence, and approve the
  sample; confirm no network invitation is created.
- In live mode, confirm a dismissed proposal cannot be scheduled and an edited
  attendee list is rejected before Google is called.

## Phase 6 — Automated verification

- [x] Application TypeScript check passes.
- [x] Worker TypeScript check passes.
- [x] 116/116 application tests pass.
- [x] 2/2 worker hardening tests pass.
- [x] Next.js production build passes.
- [x] Baileys worker build passes.
- [x] Local multipart smoke request returns HTTP 200.
- [x] Direct private-upload route is used in production.

Run locally:

```powershell
npm.cmd run check
```

## Phase 7 — Live infrastructure and release

- [x] Vercel account authenticated and `nathans-projects-b0bfd21e/roxanne` linked.
- [x] GitHub repository connected to the Vercel project.
- [ ] Commit and push the current Quipus application and firmware rebrand.
- [x] Quipus Supabase project created and linked as `cjogfunwcwytvooycjzv`.
- [x] Local Supabase configuration records the production URL and Auth redirects.
- [x] Remote migrations `001_initial.sql` and `002_worker_hardening.sql` applied;
      14 tables, 12 public RLS policies, and the private recording bucket verified.
- [ ] Apply migrations `003_meeting_approvals.sql`,
      `004_lantern_devices.sql`, `005_lantern_recording_pipeline.sql`,
      `006_lantern_relay.sql`, and `007_multi_user_workspaces.sql`.
- [x] Supabase Google Auth is enabled and email/password signup is disabled.
- [ ] Add the Supabase and Quipus callback URLs to the Google Cloud OAuth client.
- [x] Remove Qwen, Groq, Redis/KV, and WhatsApp variables from Vercel; they are
      outside the active prototype path.
- [x] Keep only Supabase, OpenAI, Agora, Google Calendar, owner, timezone, and
      approval variables in Vercel Production.
- [ ] Verify `OPENAI_API_KEY` with a real capture; add `EXA_API_KEY` only if
      public research will be demonstrated.
- [x] Initial Vercel production build deployed and assigned to
      `https://roxanne-two.vercel.app`.
- [x] Deploy the Ilmu-free Quipus build and verify the production login page
      and signed-out dashboard protection.
- [ ] Verify live Agora/OpenAI readiness from an authenticated dashboard.
- [ ] Run the complete credential-backed golden path.
- [ ] Record the Railway URL and final golden-path verification time below.

Release record:

- Git branch: `origin/main`
- Vercel URL: `https://roxanne-two.vercel.app` (live)
- Supabase project ref: `cjogfunwcwytvooycjzv` (base schema applied;
  migrations 003 through 007 pending)
- Infrastructure verified: 23 August 2026, 14:52 (Asia/Kuala_Lumpur)
- Registered hardware ID: `561bc32e-df1a-4b00-9f46-ef08cf2df9b9`
- Golden-path result: pending

### Owner-only actions

These steps require an account decision, secret, or physical confirmation and
cannot be completed by repository automation alone:

- [x] Confirm Supabase reports Google login enabled and set the production app,
      Calendar redirect, model, language, and timezone defaults in Vercel.
- [ ] Add `https://cjogfunwcwytvooycjzv.supabase.co/auth/v1/callback` and
      `https://roxanne-two.vercel.app/api/google/callback` to the existing Google
      Cloud OAuth client's authorized redirect URIs, then complete the one-time
      Google Calendar consent from Quipus Settings.
- [ ] Approve one real Google Calendar invitation during the final golden-path
      test.

## Explicit MVP scope decisions

- [x] Approved Google Calendar events send the attendee invitation; a separate
      free-form Gmail message remains outside the first golden path.
- [x] Browser Agora recording plus device registration and short-lived hardware
      Agora bootstrap endpoints are implemented.
- [ ] Existing Google Calendar event import and automatic recording matching
      are deferred; V0.1 includes free/busy input and invitation output.
- [ ] Daily cross-meeting aggregation, Supabase Realtime, and background jobs
      are deferred beyond the credential-backed golden path.

## Live golden path — final gate

- [ ] Sign in with the owner Google account and open the live dashboard.
- [ ] Pair the Quipus through its on-screen `QUIPUS-XXXXXX` network and password and `http://192.168.4.1`.
- [ ] Record real audio on the ESP32-S3.
- [ ] Confirm live Agora transcription and live OpenAI extraction.
- [ ] Reload and confirm the meeting, audio, transcript, and follow-ups persist.
- [ ] Check Google free/busy, approve a slot, and receive the calendar invite.
- [ ] Verify Settings reports Supabase, OpenAI, Google Calendar, Agora, and
      any optional integration used in the demo as connected.
