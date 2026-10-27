# Quipus device revocation and factory reset

Revocation now requests an authenticated factory reset. The confirmation deletes
unsynced local recordings, cached reports, account/pairing credentials, archive
keys, saved Wi-Fi networks and Bluetooth bonds. Uploaded meetings and their
original account ownership are preserved.

## State and ownership

- Access stops immediately: normal device credentials are disabled in the same
  transaction that creates the reset request.
- An online recorder persists the explicit reset instruction before erasing data.
  Generic authentication failures never authorize deletion.
- The reset-only verifier cannot read account data or upload recordings. It allows
  status and acknowledgement only, including a repeated acknowledgement after a
  lost response.
- The physical hardware identity stays reserved until cleanup is acknowledged.
  A new pairing then creates a new device UUID and a fresh archive identity.
- Offline devices show Reset pending. Firmware 0.14.1 or later is required for
  automatic cleanup; older or unknown builds show Reset required for recovery.
- The recorder retains its factory setup password. This is device identity, not
  an account credential.

## Interruption handling

A separate NVS journal records requested, erased and acknowledged stages. Pairing
and recording are blocked while that journal exists or cannot be read. Wi-Fi is
retained only long enough to acknowledge cleanup, then erased. Failed, missing or
unreadable SD storage does not count as empty and cannot complete a reset. The
setup portal permits Wi-Fi recovery without accepting another pairing code.

## Rollout

1. Apply `supabase/migrations/024_device_factory_reset.sql` once.
2. Deploy the website and its `/api/device/v1/reset` endpoint.
3. Install supported firmware on each hardware profile before expecting automatic
   reset. A revoked legacy recorder that has already erased its old credential
   requires owner-authorized, verified physical recovery.
4. Verify an online reset, an offline/reconnect reset, and interrupted cleanup.
   Confirm old credentials fail ordinary APIs and old uploaded audio still plays.
5. Pair into the destination account; confirm the new device UUID and that old
   recording manifests cannot be imported into the new identity.

No public endpoint releases a recorder based only on its MAC or hardware ID.
Administrator recovery must verify physical cleanup and keep an audit record;
never weaken account ownership checks to bypass a pairing conflict.
