import type { SupabaseClient } from "@supabase/supabase-js";

export function validateRetentionPaths(paths: unknown, ownerId: string): string[] {
  if (!Array.isArray(paths) || paths.length > 16) throw new Error("Invalid deletion manifest.");
  const result = new Set<string>();
  for (const path of paths) {
    if (typeof path !== "string" || path.length > 512 || !path.startsWith(`${ownerId}/`) ||
        path.includes("\\") || path.includes("%") || path.split("/").some(part => !part || part === "." || part === "..")) {
      throw new Error("Deletion manifest does not belong to its recording owner.");
    }
    result.add(path);
  }
  return [...result];
}

/** Bounded, lease-based and idempotent across storage/SQL failures. Never reads audio. */
export async function purgeExpiredRecordingAudio(client: SupabaseClient, batchSize = 20) {
  const { data: jobs, error } = await client.rpc("claim_recording_audio_deletions", { p_limit: batchSize });
  if (error) throw new Error("Could not claim audio retention work.");
  let deleted = 0;
  let deferred = 0;
  for (const job of jobs || []) {
    try {
      const paths = validateRetentionPaths(job.object_paths, job.user_id);
      if (paths.length) {
        const { error: removalError } = await client.storage.from("recordings").remove(paths);
        if (removalError) throw new Error("Audio removal is not confirmed.");
      }
      const { data: finished, error: finishError } = await client.rpc("finish_recording_audio_deletion", {
        p_recording_id: job.recording_id, p_lease_token: job.lease_token,
      });
      if (finishError || finished !== true) throw new Error("Audio deletion lease changed.");
      deleted++;
    } catch {
      deferred++;
      // Keep exact object paths in the private SQL ledger, never application logs.
      await client.from("recording_audio_deletions").update({ state: "pending", lease_until: null,
        available_at: new Date(Date.now() + 60 * 60_000).toISOString() })
        .eq("recording_id", job.recording_id).eq("lease_token", job.lease_token);
    }
  }
  return { deleted, deferred };
}
