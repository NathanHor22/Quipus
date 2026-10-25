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

Wi-Fi credentials are sent only from the app to the recorder over encrypted
Bluetooth. They never reach these routes.

## Supabase configuration

Add the app's callback, `quipus://auth/callback`, to **Authentication → URL
Configuration → Redirect URLs**. Do not change the Google provider's existing
Supabase callback URL.
