# Quipus recording processor

This is a separate Railway service. It executes transcription and meeting analysis
in its own Node process; it never POSTs back to Vercel to run the expensive work.
The existing `worker/` WhatsApp relay remains a separate service and is unchanged.

## Deploy safely

1. Apply migration `013_dedicated_processing_worker.sql` together with the later
   upgrade migrations in order. It bounds claims across all instances, including
   the temporary inline path. Default fleet capacity is 2 recordings, 1 per owner.
2. Create a new Railway service from the repository **root**. Set its configuration
   file path to `recording-worker/railway.json`. The Dockerfile builds only the
   shared server processing code; no Next request/UI runtime is allowed in the bundle.
3. Set variables from `.env.example` in this directory. Use the same Supabase
   project and Upstash database as Vercel. Google, Agora and WhatsApp keys are not
   required. The existing Supabase server key is elevated; keep it server-only,
   restrict service access, and rotate with a reviewed migration. This release does
   not claim that key is a custom least-privilege database role.
4. Check `/ready` returns HTTP 200. It verifies the processing schema and that the
   recording bucket is private. `/health` is liveness; readiness can be unavailable
   independently. Neither endpoint exposes credentials, user IDs or meeting data.
5. Set `QUIPUS_PROCESSING_MODE=dedicated` on Vercel and redeploy it. Completion and
   retry routes now enqueue and publish a best-effort wakeup only. The old internal
   trigger can still process approved report deliveries; it skips audio work.
6. Record and verify the full audio appears, then interrupt/restart the processor
   and Redis independently. SQL polling must continue without Redis. Keep the SD
   source until the device receives explicit complete-archive verification.

Rollback: set Vercel mode back to `inline` and stop the new service. Do not remove
queued jobs or reset leases. The shared atomic capacity limit protects a brief
overlap during migration. Only increase capacity after measuring peak memory and provider throughput. Audio
preparation uses fixed-size file buffers and transcription uses lazy file slices,
but concurrent recognition requests and SDK buffering still consume memory. The
worker defaults to one concurrent recording.

## Queue semantics

Postgres is the durable ledger. A worker claims atomically, renews a six-minute
lease every minute, and fences writes with its token and unexpired lease. Retries
preserve the original archive; completed meetings are recovered without replacing
approved actions. Research is queued by the database only after the core meeting
becomes ready and runs in a separate, bounded pool. Company/LinkedIn research never
holds the core report in a processing state.

Redis pub/sub contains only identifiers; it is a latency hint, not durable work.
Optional REST credentials provide short-lived progress and public-company caching.
No raw audio or transcript is placed in Redis by this processor.

The process handles SIGTERM/SIGINT, stops claiming and drains active work for the
configured grace period. If Railway ends it sooner, the SQL lease expires and the
next instance recovers the job. It never releases a lease while old work may still
be running. Readiness becomes unavailable as soon as shutdown starts.

## Local validation

From repository root:

```sh
npm run recording-worker:typecheck
npm run recording-worker:test
npm run recording-worker:build
```

Run the resulting `node recording-worker/dist/server.cjs` with environment variables
supplied by your local secret manager or deployment platform. The process does not
read `.env` files itself. Never commit credentials.

Audio retention runs on startup and hourly, at most 20 expired recordings per
sweep, with private SQL deletion leases preventing duplicate cross-instance work.
Both originals and derived audio are removed before SQL confirms deletion. A
storage outage defers work and does not falsely mark audio deleted. Only aggregate
counts are logged. Monitor the backlog as trials grow and raise sweep frequency
through a reviewed change before it can exceed the deletion service target.

Keep this service on Railway's private networking unless an authorised external
monitor specifically needs the health endpoint. It has no public job-submission or
administration API. Railway can perform its deployment health check without a
public application domain. The small HTTP surface caps headers, connections and
request lifetimes; it is not a substitute for platform network protections.
