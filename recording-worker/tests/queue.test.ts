import assert from "node:assert/strict";
import test from "node:test";
import { QueueLoop } from "../src/loop";
import { loadRecordingWorkerConfig } from "../src/config";
import { usesDedicatedRecordingWorker } from "../../lib/processing-mode";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const base = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-server-key",
  OPENAI_API_KEY: "test-only-provider-key",
};

test("dedicated processor has independent credentials, bounded defaults and strict TLS", () => {
  const config = loadRecordingWorkerConfig(base);
  assert.equal(config.concurrency, 1);
  assert.equal(config.pollIntervalMs, 10000);
  assert.equal(config.port, 3002);
  assert.equal(config.redisUrl, undefined);
  assert.throws(() => loadRecordingWorkerConfig({ ...base, OPENAI_API_KEY: "" }), /OPENAI_API_KEY/);
  assert.throws(
    () => loadRecordingWorkerConfig({ ...base, UPSTASH_REDIS_URL: "redis://remote.example:6379" }),
    /rediss/,
  );
  assert.throws(
    () => loadRecordingWorkerConfig({ ...base, RECORDING_WORKER_CONCURRENCY: "50" }),
    /between 1 and 4/,
  );
  assert.throws(
    () =>
      loadRecordingWorkerConfig({
        ...base,
        NEXT_PUBLIC_SUPABASE_URL: "https://user:secret@example.com",
      }),
    /HTTPS project origin/,
  );
  assert.equal(usesDedicatedRecordingWorker({}), false);
  assert.equal(usesDedicatedRecordingWorker({ QUIPUS_PROCESSING_MODE: "dedicated" }), true);
  assert.throws(
    () => usesDedicatedRecordingWorker({ QUIPUS_PROCESSING_MODE: "dedciated" }),
    /inline or dedicated/,
  );
});

test("repeated wakeups do not exceed local concurrency and drain queued work", async () => {
  let remaining = 6,
    running = 0,
    maximum = 0,
    completed = 0;
  const releases: Array<() => void> = [];
  const errors: unknown[] = [];
  const loop = new QueueLoop({
    concurrency: 2,
    pollIntervalMs: 60000,
    runNext: async () => {
      if (!remaining) return false;
      remaining--;
      running++;
      maximum = Math.max(maximum, running);
      await new Promise<void>((resolve) => releases.push(resolve));
      running--;
      completed++;
      return true;
    },
    onError: (error) => errors.push(error),
  });
  try {
    loop.start();
    for (let i = 0; i < 50; i++) loop.wake();
    await flush();
    assert.equal(running, 2);
    for (let batch = 0; batch < 3; batch++) {
      releases.splice(0).forEach((release) => release());
      await flush();
      await flush();
    }
    assert.equal(completed, 6);
    assert.equal(maximum, 2);
    assert.equal(loop.activeCount, 0);
    assert.deepEqual(errors, []);
  } finally {
    releases.splice(0).forEach((release) => release());
    await loop.stop();
  }
});

test("a wakeup arriving during an empty SQL claim is not lost", async () => {
  let calls = 0;
  let firstResult: ((value: boolean) => void) | undefined;
  const loop = new QueueLoop({
    concurrency: 1,
    pollIntervalMs: 60000,
    runNext: async () => {
      calls++;
      if (calls === 1)
        return new Promise<boolean>((resolve) => {
          firstResult = resolve;
        });
      return false;
    },
    onError: () => assert.fail("Unexpected queue error"),
  });
  try {
    loop.start();
    await flush();
    loop.wake();
    firstResult?.(false);
    await flush();
    await flush();
    assert.equal(calls, 2);
  } finally {
    firstResult?.(false);
    await loop.stop();
  }
});

test("outages back off and shutdown waits for active work without starting another job", async () => {
  let calls = 0,
    failures = 0;
  let release: (() => void) | undefined;
  const loop = new QueueLoop({
    concurrency: 1,
    pollIntervalMs: 60000,
    runNext: async () => {
      calls++;
      if (calls === 1) throw new Error("Database unavailable");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return true;
    },
    onError: () => {
      failures++;
    },
  });
  loop.start();
  await flush();
  await flush();
  assert.equal(calls, 1);
  assert.equal(failures, 1);
  loop.wake();
  await flush();
  const stopped = loop.stop();
  loop.wake();
  release?.();
  await stopped;
  await flush();
  assert.equal(calls, 2);
  assert.equal(loop.activeCount, 0);
});
