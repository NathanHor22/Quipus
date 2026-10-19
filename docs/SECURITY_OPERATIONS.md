# Quipus security operations

## Implemented boundaries

Private Supabase recordings, owner-scoped queries, session-backed RLS playback,
five-minute playback capabilities with renewal, browser mutation origin checks,
non-cacheable private responses, and optional distributed per-account playback
throttling are application controls. Vercel firewall rules do not cover uploads
that go directly to Supabase; configure provider controls and storage quotas too.
The Redis throttle deliberately permits authorised reads during a Redis outage.
It supplements authentication and provider rate limits; it is not a firewall.

Apply migration 015 before deploying the changed playback routes. The playback
access audit contains owner/resource IDs and event type, never transcripts,
audio, IP addresses, email addresses, bearer tokens or signed URLs.

## Audio retention operation

Migration 015 adds an immutable-for-browser retention clock (90 days from audio
ingestion), an owner-scoped private object-deletion ledger and lease RPCs.
POST `/api/internal/recording-retention` with `Authorization: Bearer <secret>`;
set a dedicated random 32+ byte `RECORDING_RETENTION_SECRET` server-side. Invoke
hourly from a trusted scheduler after migration/deployment if the dedicated
worker maintenance loop is not running. The dedicated recording worker runs
retention periodically when deployed; local source changes do not deploy it. The endpoint does bounded batches of 20;
repeat until no jobs remain when backfilling existing data. Failed storage deletes
are retried; SQL metadata is not marked deleted until storage confirms removal.
Both primary and attached `recording_audio_sources` objects are included.
Transcripts, person history and approved actions remain. Set backup-provider
retention separately: application deletion does not rewrite provider backups.
Audit events should follow an operator-defined security retention policy.

## Restricted security reviewer

The committed GitHub workflow runs on pull requests, main pushes, weekly and
manual dispatch after it is pushed and Actions is enabled. Its deterministic
credential checks redact matches; dependency advisories can change over time.
Enable repository secret scanning/dependency alerts when supported by the plan.
Protect the main branch and require checks/review. Pin Actions to reviewed commit
SHAs for a production supply-chain baseline.

An optional AI security reviewer receives redacted scanner results and minimal
code context in an isolated branch. It may draft explanations and tested patches.
It receives no production credentials, recordings, transcripts, database export,
Google tokens or deployment permissions. It cannot approve its own changes or
change IAM/RLS/encryption/firewall settings in production. Avoid running attacker
controlled PR instructions with elevated CI secrets. The scanner workflow is not
an autonomous AI agent, a penetration test, or continuous runtime intrusion detection.

## Operator tasks before external pilot

- Enable MFA and least-privilege admin access in GitHub, Supabase, Vercel, Railway,
  Upstash and Google Cloud. Use separate web/worker identities where possible.
- Configure managed firewall rules, upload quotas and alert recipients; review
  authentication failures, unusual downloads and pending deletion failures.
- Verify service-role keys never enter browser bundles, logs or support exports.
- Set provider data handling/retention, backup expiry and recovery procedures.
- Rehearse revoking a device, disabling credentials, restricting downloads and
  restoring service; rotate encryption keys through a versioned migration.
  Do not replace ACTION_APPROVAL_SECRET blindly: existing Google tokens need it.
- Commission an independent penetration test before broad launch.

## Explicit limitations / release gates

New firmware stores microphone PCM in versioned AES-256-GCM containers and
session recovery metadata in an encrypted append-only journal. A server-generated
per-device key is backed up encrypted under the server approval secret and stored
in a separate device NVS namespace. The encrypted header binds owner, device,
session and microphone source; each chunk also authenticates its sequence/length.
The card contains no decryption key. The streaming upload reader reconstructs the
original canonical WAV; existing plaintext WAV files are not silently converted
or erased. Legacy/orphan/quarantined audio blocks ownership transfer until an
explicit recovery/disposition. `scripts/recover-sd-recording.py` supports explicit
owner-assisted recovery with a private key file and never modifies originals.

This protects a removed SD card; it does not protect a stolen whole device from
physical flash extraction until reviewed flash/NVS encryption and secure-boot
production provisioning is completed. No eFuses have been burned. Cloud workers
must decrypt authorised audio for processing, so this is not end-to-end encryption.

The durable local queue, consent fallback, USB secondary capture and recovery
need physical acceptance/soak tests on the final card/board/phone combination.
Interrupted encrypted writes recover only authenticated complete blocks (up to
one 4 KiB block plus the bounded input queue can be lost on power failure).
Normal Stop drains/finalizes the complete file. Earlier plaintext recordings
remain available only through explicit manual recovery and still need protection.
No control guarantees zero breaches. Report precise coverage and remaining risk.
