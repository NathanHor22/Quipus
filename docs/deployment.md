# Deploying the full Quipus application

The active application is Nathan's Next.js codebase, with the Waveshare board
addition. The earlier Vite prototype is preserved only on
`backup/pre-nathan-import-20261021`.

## Vercel build settings

Deploy the `main` branch from the repository root. `vercel.json` selects
`nextjs`, installs with `npm ci`, builds with `npm run build`, and outputs
`.next`. These settings override a Vite preset or `dist` output directory left
over from the earlier prototype. Node.js 22.x is declared in `package.json`.

The error about `app/api/process-meeting/route.ts` not matching a Serverless
Function can occur when the Next.js App Router is not being built by the
Next.js framework adapter. That route exists in this repository. Function
durations are declared in the route files: 300 seconds for meeting processing
and 60 seconds for recording upload authorization. No `functions` glob in
`vercel.json` is required.

After a new commit triggers deployment, inspect that deployment rather than
redeploying the old import commit. Keep Vercel's Root Directory at the repository
root and its Production Branch at `main`.

## Services and environment variables

| Capability | Service | Configuration |
| --- | --- | --- |
| Public landing page and fictional sample | No external credentials required | Deploy the code; sample actions make no provider calls. |
| Live login, device pairing, database and private recording storage | Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; database migrations and Auth configuration below. |
| Transcription, meeting summaries, reports and generated device speech | OpenAI API | `OPENAI_API_KEY`; model overrides are listed in `.env.example`. |
| Encrypted archive-key backup, Calendar token protection and approvals | Application secret | A persistent random `ACTION_APPROVAL_SECRET`, at least 32 UTF-8 bytes; keep the same value when sharing an existing backend. |
| Live Agora audio and Speech-to-Text | Agora | `NEXT_PUBLIC_AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `AGORA_CUSTOMER_ID`, `AGORA_CUSTOMER_SECRET`. |
| Calendar invitations and availability | Google Calendar OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, plus per-user Calendar consent. Optional for pairing and basic recordings. |
| Processing progress/wakeups | Upstash Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`. Additional dedicated-worker settings are documented in `recording-worker/README.md`. |
| Dedicated processing | Separate recording worker | Optional initially. Keep `QUIPUS_PROCESSING_MODE=inline` until the worker and its database migrations are ready. |
| WhatsApp relay, external event research and retention jobs | Optional integrations | See `.env.example` and the respective worker documentation. |

Set `NEXT_PUBLIC_APP_URL` to the stable HTTPS website origin and
`APP_TIMEZONE=Asia/Kuala_Lumpur`. Configure the same values in the intended
Vercel environment (Production, Preview, or both), then redeploy. Changing a
public build-time variable requires another build. Do not use an expiring
preview hostname as the permanent application or firmware API origin.

For a fresh Supabase project, apply **all** SQL migrations in
`supabase/migrations/`, in numerical order (`001` through `019` at the time of
this change). For a single SQL Editor action, use the generated
[fresh-project setup bundle](../supabase/setup/README.md) instead of copying each
migration separately. Keep **Enable Data API** and **Automatically expose new
tables** checked when creating a project for these migrations.
For an existing project, apply only migrations not already
recorded as applied. Never recreate or reset a co-founder's database to deploy
this copy. The migrations include the private recording bucket, policies,
device pairing, archive keys and safe device transfers.

Enable Google in Supabase Auth and add the chosen website's
`https://YOUR-APP-DOMAIN/auth/callback` to its redirect allowlist. The Google
OAuth client used by Supabase must allow the Supabase callback shown in the
provider settings. Google Calendar uses its separate `/api/google/callback`
route and consent flow.

To use the same accounts and recordings as the co-founder, obtain the approved
existing project configuration through the team's secret manager or hosting
settings. Git copying does not copy environment variables, accounts, databases,
storage objects or OAuth permissions. Keep server keys in Vercel environment
variables; never commit them or paste them into chat.

The Waveshare firmware defaults to `https://quipus-sales-rep-assistant.vercel.app`; the original
and V2 profiles retain `https://quipus-sales-rep-assistant.vercel.app`.
For another backend, set **Lantern hardware → Quipus backend URL** in ESP-IDF
`menuconfig` (`CONFIG_LANTERN_API_BASE_URL`), then rebuild and flash the firmware.
An existing sdkconfig retains saved settings rather than applying changed
defaults. A recorder must claim a pairing code issued by the backend it calls.

Waveshare firmware 0.10.0 adds [Bluetooth setup](bluetooth-setup.md) from Chrome
on Windows and Android. Deploy this website version and flash the matching
firmware once. Bluetooth sends pairing/Wi-Fi setup; the recorder continues to
upload over Wi-Fi. Existing Supabase, Agora and OpenAI variables are unchanged.

References: [Vercel framework/output overrides](https://vercel.com/docs/project-configuration/vercel-json)
and [Next.js function durations](https://vercel.com/docs/functions/configuring-functions/duration).
