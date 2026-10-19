import { createServer, type ServerResponse } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { Redis } from "ioredis";
import { processNextRecording } from "../../lib/processing-queue";
import { processNextMeetingEnrichment } from "../../lib/meeting-enrichment";
import { purgeExpiredRecordingAudio } from "../../lib/recording-retention";
import { PROCESSING_WAKEUP_CHANNEL } from "../../lib/redis";
import { loadRecordingWorkerConfig } from "./config";
import { QueueLoop } from "./loop";

function log(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  console[level](JSON.stringify({ level, event, at: new Date().toISOString(), ...fields }));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function main(): Promise<void> {
  const config = loadRecordingWorkerConfig();
  const client = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(60_000)])
            : AbortSignal.timeout(60_000),
        }),
    },
  });
  let shuttingDown = false;
  let lastReadyAt = 0;
  let probing = false;
  let redisConnected = false;
  const reportError = () => log("warn", "queue_operation_failed");
  const recordings = new QueueLoop({
    concurrency: config.concurrency,
    pollIntervalMs: config.pollIntervalMs,
    runNext: () => processNextRecording(client),
    onError: reportError,
  });
  const enrichment = new QueueLoop({
    concurrency: 1,
    pollIntervalMs: config.pollIntervalMs,
    runNext: () => processNextMeetingEnrichment(client),
    onError: reportError,
  });
  const maintenance = new QueueLoop({
    concurrency: 1,
    pollIntervalMs: 60 * 60_000,
    runNext: async () => {
      const result = await purgeExpiredRecordingAudio(client, 20);
      log("info", "audio_retention_sweep", result);
      return false;
    },
    onError: () => log("warn", "audio_retention_sweep_deferred"),
  });
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    const path = new URL(request.url || "/", "http://worker.local").pathname;
    if (request.method !== "GET" || (path !== "/health" && path !== "/ready")) {
      json(response, 404, { error: "Not found." });
      return;
    }
    const ready = !shuttingDown && Date.now() - lastReadyAt < 75_000;
    json(response, path === "/ready" && !ready ? 503 : 200, {
      service: "quipus-recording-worker",
      ready,
      stopping: shuttingDown,
      uptimeSeconds: Math.floor(process.uptime()),
      activeRecordings: recordings.activeCount,
      activeResearch: enrichment.activeCount,
      wakeups: config.redisUrl ? (redisConnected ? "connected" : "polling") : "polling",
    });
  });
  server.maxConnections = 64;
  server.maxHeadersCount = 32;
  server.maxRequestsPerSocket = 100;
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const probe = async () => {
    if (probing || shuttingDown) return;
    probing = true;
    try {
      const [capacity, jobs, research, retention, bucket] = await Promise.all([
        client
          .from("quipus_processing_capacity")
          .select("global_limit,per_user_limit")
          .eq("id", true)
          .single(),
        client
          .from("lantern_processing_jobs")
          .select("session_id,lease_token,lease_until")
          .limit(0),
        client.from("quipus_meeting_enrichment_jobs").select("meeting_id,lease_token").limit(0),
        client.from("recording_audio_deletions").select("recording_id,lease_token").limit(0),
        client.storage.getBucket("recordings"),
      ]);
      if (
        capacity.error ||
        !capacity.data ||
        jobs.error ||
        research.error ||
        retention.error ||
        bucket.error ||
        !bucket.data ||
        bucket.data.public
      ) {
        throw new Error("Private storage or processing schema is unavailable.");
      }
      lastReadyAt = Date.now();
    } catch {
      lastReadyAt = 0;
      log("warn", "readiness_check_failed");
    } finally {
      probing = false;
    }
  };
  await probe();
  if (!lastReadyAt) {
    server.close();
    throw new Error("Worker prerequisites failed. Check migrations and private storage access.");
  }
  recordings.start();
  enrichment.start();
  maintenance.start();
  const readinessTimer = setInterval(() => void probe(), 30_000);
  readinessTimer.unref();
  let subscriber: Redis | undefined;
  if (config.redisUrl) {
    subscriber = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    subscriber.on("message", (channel: string) => {
      if (channel === PROCESSING_WAKEUP_CHANNEL) {
        recordings.wake();
        enrichment.wake();
      }
    });
    subscriber.on("ready", () => {
      redisConnected = true;
    });
    subscriber.on("close", () => {
      redisConnected = false;
    });
    subscriber.on("error", () => {
      redisConnected = false;
    });
    void subscriber
      .connect()
      .then(() => subscriber?.subscribe(PROCESSING_WAKEUP_CHANNEL))
      .catch(() => log("warn", "redis_wakeup_unavailable_using_sql_poll"));
  }
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(readinessTimer);
    subscriber?.disconnect(false);
    log("info", "shutdown_started", { signal });
    server.close();
    server.closeIdleConnections();
    // In-flight jobs keep their SQL lease. If the platform kills this process,
    // another worker recovers them after expiry; never release a live job early.
    const deadline = setTimeout(() => process.exit(0), config.shutdownGraceMs);
    deadline.unref();
    await Promise.allSettled([recordings.stop(), enrichment.stop(), maintenance.stop()]);
    clearTimeout(deadline);
    log("info", "shutdown_complete");
  };
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  log("info", "worker_started", {
    concurrency: config.concurrency,
    pollIntervalMs: config.pollIntervalMs,
  });
}

void main().catch(() => {
  log("error", "worker_start_failed_check_configuration_and_migrations");
  process.exitCode = 1;
});
