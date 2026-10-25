# Mobile app API access

The Quipus mobile app (`quipus-app` repository) uses the same Route Handlers,
Supabase project and database as the website. There is no separate mobile API
or meeting store.

## Authentication

- The app signs in with Google through Supabase (PKCE, system browser) and
  keeps its session in platform secure storage.
- Each API request sends `Authorization: Bearer <Supabase access token>`.
- `proxy.ts` verifies the token with Supabase Auth (`auth.getUser(token)`)
  before any `/api/*` route runs. A present but malformed, expired or rejected
  token returns `401`. Cookies are never used as a fallback when an
  `Authorization` header is present.
- `getAuthenticatedLanternUser()` and `createSessionSupabase()` in
  `lib/supabase/session.ts` resolve the same user from the bearer token. The
  session client carries the token, so database and storage RLS run as that
  user, exactly as for a browser cookie.
- Device (`/api/device/v1/*`) and internal worker routes keep their own
  machine credentials and return before user authentication.
- Browser behaviour is unchanged: cookie sessions, the cross-site mutation
  check and the CSRF origin rules still apply. A bearer request carries no
  ambient credential, so it is not a CSRF vector.

## Routes the app uses

| Route | Use |
| --- | --- |
| `GET /api/profile` | Greeting name, email and timezone (same `profiles` row as the web greeting) |
| `GET /api/devices` | Owner-visible devices, for setup verification and device health |
| `POST /api/devices/pairing` | `{ name }` only; returns `{ pairing: { id, code, expiresAt } }` (10 minutes) |
| `GET /api/meetings` | Meetings with transcript, insights, follow-ups and recording progress |
| `GET /api/recordings/:id/playback` | Short-lived (5 minute) signed URL for the original audio |
| Website routes for follow-ups, approvals, contacts, people, preparation, speakers, calendar visibility, devices and Google status | The same actions as the website |
| `POST /api/google/mobile` → `GET /api/google/mobile/authorize` → `GET /api/google/mobile/callback` → `POST /api/google/mobile/complete` | Google Calendar/Gmail connection from the app (below) |

## Google connection from the app

The website callback is bound to the browser's Quipus session cookie, which a
system browser opened by the app does not have. The mobile flow binds the
result to the app instead:

1. The signed-in app sends `SHA-256(verifier)` and receives a two-minute
   encrypted ticket URL.
2. `/api/google/mobile/authorize` turns the ticket into the usual encrypted
   OAuth state (with the challenge) and nonce cookie, then redirects to Google.
3. `/api/google/mobile/callback` exchanges the code and seals the credentials
   for `quipus://google/callback`. It saves nothing.
4. The app posts the sealed result, its verifier and its bearer token to
   `/api/google/mobile/complete`, which saves only for that same user.

A start link sent to someone else cannot attach their Google account to the
sender's workspace, and an intercepted deep link is useless without the
verifier and the user's session. The website callback and its proxy
protection are unchanged.

Wi-Fi credentials are sent only from the app to the recorder over encrypted
Bluetooth. They never reach these routes.

## Google Cloud configuration

On the existing OAuth client, add a second **Authorized redirect URI**:
`<website origin>/api/google/mobile/callback`, e.g.
`https://quipus-sales-rep-assistant.vercel.app/api/google/mobile/callback`.
Keep the existing website callback.

## Supabase configuration

Add the app's callback, `quipus://auth/callback`, to **Authentication → URL
Configuration → Redirect URLs**. Do not change the Google provider's existing
Supabase callback URL.
