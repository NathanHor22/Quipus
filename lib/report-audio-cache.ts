import { createHash } from "node:crypto";
import type { QuipusVoiceProfile } from "./quipus-voice-profile";

type Entry = { chunks: Uint8Array[]; bytes: number; createdAt: number; expiresAt: number };
type Fill = Entry & { active: boolean };

export function reportAudioCacheKey(owner: { userId: string; deviceId: string }, text: string, profile: QuipusVoiceProfile): string {
  if (!owner.userId || !owner.deviceId) throw new Error("An authenticated speech owner is required.");
  return createHash("sha256").update(JSON.stringify([owner.userId, owner.deviceId,
    profile.version, profile.textVersion, profile.model, profile.voice, profile.instructions,
    profile.speed, profile.sampleRate, profile.responseFormat, text])).digest("hex");
}

/** Private process-local LRU: no storage URLs, cross-owner keys, or durable/offline guarantee.
 * The first request streams immediately. Only complete PCM is reusable; retained
 * entries plus in-progress fills share one memory budget. Duplicate fills bypass
 * caching rather than retaining two copies or waiting for a slow consumer.
 */
export class ReportAudioCache {
  private readonly entries = new Map<string, Entry>();
  private readonly fills = new Map<string, Fill>();
  private bytes = 0;
  constructor(private readonly limits = { maxBytes: 8 * 1024 * 1024, maxEntryBytes: 2 * 1024 * 1024,
    maxEntries: 32, maxFills: 2, ttlMs: 15 * 60_000, fillTtlMs: 60_000 }, private readonly now = Date.now) {
    for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid audio cache bounds.");
  }
  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key); }
  }
  private abandon(key: string, fill: Fill) {
    if (!fill.active) return;
    fill.active = false; this.bytes -= fill.bytes; fill.bytes = 0; fill.chunks = [];
    if (this.fills.get(key) === fill) this.fills.delete(key);
  }
  private prune() {
    const now = this.now();
    for (const [key, entry] of this.entries)
      if (now < entry.createdAt || now >= entry.expiresAt) this.remove(key);
    for (const [key, fill] of this.fills)
      if (now < fill.createdAt || now >= fill.expiresAt) this.abandon(key, fill);
  }
  stats() { this.prune(); return { bytes: this.bytes, entries: this.entries.size, fills: this.fills.size }; }
  get(key: string): Response | null {
    this.prune();
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key); this.entries.set(key, entry);
    let index = 0;
    return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      if (index < entry.chunks.length) controller.enqueue(entry.chunks[index++].slice());
      else controller.close();
    } }), { headers: { "content-type": "audio/pcm" } });
  }
  capture(key: string, response: Response): Response {
    this.prune();
    if (!response.ok || !response.body || this.entries.has(key) || this.fills.has(key) || this.fills.size >= this.limits.maxFills) return response;
    const now = this.now();
    const fill: Fill = { active: true, chunks: [], bytes: 0, createdAt: now, expiresAt: now + this.limits.fillTtlMs };
    this.fills.set(key, fill);
    const reader = response.body.getReader();
    const retain = (chunk: Uint8Array) => {
      this.prune();
      if (!fill.active || !chunk.byteLength) return;
      // Cap chunk metadata as well as PCM bytes under pathological fragmentation.
      if (fill.chunks.length >= 256) { this.abandon(key, fill); return; }
      if (fill.bytes + chunk.byteLength > this.limits.maxEntryBytes) { this.abandon(key, fill); return; }
      while (this.bytes + chunk.byteLength > this.limits.maxBytes && this.entries.size)
        this.remove(this.entries.keys().next().value!);
      if (this.bytes + chunk.byteLength > this.limits.maxBytes) { this.abandon(key, fill); return; }
      fill.chunks.push(chunk.slice()); fill.bytes += chunk.byteLength; this.bytes += chunk.byteLength;
    };
    const finish = () => {
      this.prune();
      if (!fill.active) return;
      if (!fill.bytes || fill.bytes % 2) { this.abandon(key, fill); return; }
      while (this.entries.size >= this.limits.maxEntries) this.remove(this.entries.keys().next().value!);
      fill.active = false; this.fills.delete(key);
      this.entries.set(key, { chunks: fill.chunks, bytes: fill.bytes, createdAt: this.now(), expiresAt: this.now() + this.limits.ttlMs });
    };
    return new Response(new ReadableStream<Uint8Array>({
      pull: async controller => {
        try {
          const chunk = await reader.read();
          if (chunk.done) { finish(); controller.close(); return; }
          retain(chunk.value); controller.enqueue(chunk.value);
        } catch (error) { this.abandon(key, fill); controller.error(error); }
      },
      cancel: async reason => { this.abandon(key, fill); await reader.cancel(reason); },
    }), { status: response.status, headers: response.headers });
  }
}

export const reportAudioCache = new ReportAudioCache();
