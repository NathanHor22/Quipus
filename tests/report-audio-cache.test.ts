import assert from "node:assert/strict";
import test from "node:test";
import { ReportAudioCache, reportAudioCacheKey } from "../lib/report-audio-cache";
import { QUIPUS_VOICE_PROFILE, quipusVoiceProfile } from "../lib/quipus-voice-profile";

const limits = { maxBytes: 12, maxEntryBytes: 8, maxEntries: 2, maxFills: 2, ttlMs: 100, fillTtlMs: 30 };
const audio = (bytes: number[]) => new Response(Uint8Array.from(bytes), { headers: { "content-type": "audio/pcm" } });
const read = async (response: Response) => [...new Uint8Array(await response.arrayBuffer())];

test("voice profile and cache keys include exact text, owner/device, model, instructions and rendering versions", () => {
  assert.equal(quipusVoiceProfile().voice, "marin");
  assert.equal(quipusVoiceProfile().model, "gpt-4o-mini-tts-2025-12-15");
  assert.throws(() => quipusVoiceProfile({ voice: "cedar" }), /shared Quipus voice profile/);
  assert.throws(() => quipusVoiceProfile({ model: "tts-1" }), /shared Quipus voice profile/);
  const owner = { userId: "owner", deviceId: "board" };
  const key = reportAudioCacheKey(owner, "Private report.", QUIPUS_VOICE_PROFILE);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(reportAudioCacheKey(owner, "Private report.", QUIPUS_VOICE_PROFILE), key);
  for (const input of [{ owner: { ...owner, userId: "another" } }, { owner: { ...owner, deviceId: "another" } },
    { text: "Private report!" }, ...["version", "model", "voice", "instructions", "responseFormat"].map(field =>
      ({ profile: { ...QUIPUS_VOICE_PROFILE, [field]: "changed" } })),
    { profile: { ...QUIPUS_VOICE_PROFILE, textVersion: 2 } },
    { profile: { ...QUIPUS_VOICE_PROFILE, speed: 1.1 } },
    { profile: { ...QUIPUS_VOICE_PROFILE, sampleRate: 16000 } },
  ]) assert.notEqual(reportAudioCacheKey(("owner" in input ? input.owner : undefined) ?? owner,
    ("text" in input ? input.text : undefined) ?? "Private report.", ("profile" in input ? input.profile : undefined) ?? QUIPUS_VOICE_PROFILE), key);
  assert.throws(() => reportAudioCacheKey({ ...owner, userId: "" }, "test", QUIPUS_VOICE_PROFILE));
});

test("complete PCM is reusable, immutable to consumers, LRU-bounded and expires on TTL or clock rollback", async () => {
  let now = 1000;
  const cache = new ReportAudioCache(limits, () => now);
  await read(cache.capture("a", audio([1, 0, 2, 0])));
  assert.deepEqual(cache.stats(), { bytes: 4, entries: 1, fills: 0 });
  const first = await read(cache.get("a")!); first[0] = 99;
  assert.deepEqual(await read(cache.get("a")!), [1, 0, 2, 0]);
  await read(cache.capture("b", audio([3, 0, 4, 0])));
  await read(cache.get("a")!); // a is now newer than b.
  await read(cache.capture("c", audio([5, 0, 6, 0])));
  assert.equal(cache.get("b"), null);
  assert.ok(cache.stats().bytes <= limits.maxBytes);
  now += 100;
  assert.deepEqual(cache.stats(), { bytes: 0, entries: 0, fills: 0 });
  await read(cache.capture("d", audio([1, 0])));
  now--;
  assert.equal(cache.get("d"), null);
});

test("oversized, empty, odd-length and excessively fragmented responses remain streamable without caching", async () => {
  for (const bytes of [[], [1, 2, 3], Array(10).fill(0)]) {
    const cache = new ReportAudioCache(limits);
    assert.deepEqual(await read(cache.capture("a", audio(bytes))), bytes);
    assert.equal(cache.get("a"), null);
    assert.equal(cache.stats().bytes, 0);
  }
  const cache = new ReportAudioCache({ ...limits, maxBytes: 1024, maxEntryBytes: 1024 });
  let count = 0;
  const response = new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (count++ < 300) controller.enqueue(new Uint8Array([1, 0])); else controller.close();
  } }));
  assert.equal((await read(cache.capture("fragmented", response))).length, 600);
  assert.equal(cache.get("fragmented"), null);
  assert.equal(cache.stats().bytes, 0);
});

test("the first bytes stream before completion; cancellation/error never retains partial report audio", async () => {
  for (const fails of [false, true]) {
    const cache = new ReportAudioCache(limits);
    let source: ReadableStreamDefaultController<Uint8Array>;
    let cancelled = 0;
    const response = cache.capture("private", new Response(new ReadableStream<Uint8Array>({
      start(controller) { source = controller; controller.enqueue(new Uint8Array([1, 0, 2, 0])); },
      cancel() { cancelled++; },
    })));
    const reader = response.body!.getReader();
    assert.deepEqual([...(await reader.read()).value!], [1, 0, 2, 0]);
    assert.equal(cache.get("private"), null);
    if (fails) { source!.error(new Error("network failed")); await assert.rejects(reader.read(), /network failed/); }
    else { await reader.cancel(); assert.equal(cancelled, 1); }
    assert.deepEqual(cache.stats(), { bytes: 0, entries: 0, fills: 0 });
  }
});

test("simultaneous fills share the byte budget, duplicate fills bypass retention and stale fills release memory", async () => {
  let now = 1000;
  const cache = new ReportAudioCache({ ...limits, maxBytes: 8 }, () => now);
  const pending = () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 0, 2, 0])); } }));
  const a = cache.capture("a", pending()), b = cache.capture("b", pending());
  const duplicate = pending(), c = pending();
  assert.equal(cache.capture("a", duplicate), duplicate);
  assert.equal(cache.capture("c", c), c);
  const readers = [a, b].map(response => response.body!.getReader());
  await Promise.all(readers.map(reader => reader.read()));
  assert.deepEqual(cache.stats(), { bytes: 8, entries: 0, fills: 2 });
  now += limits.fillTtlMs;
  assert.deepEqual(cache.stats(), { bytes: 0, entries: 0, fills: 0 });
  await Promise.all([...readers.map(reader => reader.cancel()), duplicate.body!.cancel(), c.body!.cancel()]);
  assert.equal(cache.get("a"), null);
});
