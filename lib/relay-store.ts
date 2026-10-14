import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { relayMatchSchema, type RelayMatch } from "./relay";

type RelayRow = {
  id: string;
  pair_key: string;
  snapshot: unknown;
  status: RelayMatch["status"];
  provider: "openai";
  model: string;
  created_at: string;
};

function fromRow(row: RelayRow): RelayMatch {
  const snapshot =
    row.snapshot && typeof row.snapshot === "object" ? row.snapshot : {};
  return relayMatchSchema.parse({
    ...snapshot,
    id: row.id,
    pairKey: row.pair_key,
    status: row.status,
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
  });
}

function snapshot(match: RelayMatch) {
  const metadata = new Set(["id", "pairKey", "status", "provider", "model", "createdAt"]);
  return Object.fromEntries(Object.entries(match).filter(([field]) => !metadata.has(field)));
}

export async function loadRelayMatches(
  client: SupabaseClient,
  userId: string,
): Promise<RelayMatch[]> {
  const { data, error } = await client
    .from("relay_matches")
    .select("id,pair_key,snapshot,status,provider,model,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error("Relay matches could not be loaded. Apply migration 006.");
  return (data || []).map((row) => fromRow(row as RelayRow));
}

export async function loadRelayMatchById(
  client: SupabaseClient,
  userId: string,
  id: string,
): Promise<RelayMatch | null> {
  const { data, error } = await client
    .from("relay_matches")
    .select("id,pair_key,snapshot,status,provider,model,created_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error)
    throw new Error("The Relay proposal could not be loaded. Apply migration 006.");
  return data ? fromRow(data as RelayRow) : null;
}

export async function saveRelayMatches(
  client: SupabaseClient,
  userId: string,
  matches: readonly RelayMatch[],
): Promise<RelayMatch[]> {
  if (!matches.length) return [];
  const keys = matches.map((match) => match.pairKey);
  const { data: existing, error: existingError } = await client
    .from("relay_matches")
    .select("id,pair_key,status,created_at")
    .eq("user_id", userId)
    .in("pair_key", keys);
  if (existingError)
    throw new Error("Relay matches could not be checked. Apply migration 006.");
  const byKey = new Map((existing || []).map((row) => [row.pair_key, row]));
  const rows = matches.map((match) => {
    const previous = byKey.get(match.pairKey);
    return {
      id: previous?.id || randomUUID(),
      user_id: userId,
      pair_key: match.pairKey,
      primary_conversation_ref: match.primary.conversationId,
      secondary_conversation_ref: match.secondary.conversationId,
      snapshot: snapshot(match),
      status: previous?.status || "pending",
      provider: "openai",
      model: match.model,
      created_at: previous?.created_at || match.createdAt,
      updated_at: new Date().toISOString(),
    };
  });
  const { data, error } = await client
    .from("relay_matches")
    .upsert(rows, { onConflict: "user_id,pair_key" })
    .select("id,pair_key,snapshot,status,provider,model,created_at");
  if (error || !data) throw new Error("Relay matches could not be saved.");
  return data.map((row) => fromRow(row as RelayRow));
}

export async function updateRelayMatchStatus(
  client: SupabaseClient,
  userId: string,
  id: string,
  status: RelayMatch["status"],
) {
  const { data, error } = await client
    .from("relay_matches")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id,pair_key,snapshot,status,provider,model,created_at")
    .maybeSingle();
  if (error) throw new Error("The Relay proposal could not be updated.");
  return data ? fromRow(data as RelayRow) : null;
}
