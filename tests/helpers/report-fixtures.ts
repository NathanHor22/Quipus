import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedLantern } from "../../lib/lantern-device-auth";

export type Row = Record<string, unknown>;
type QueryResult = { data: Row | Row[] | null; error: null };
type Query = {
  select: () => Query;
  order: (key: string) => Query;
  limit: (count: number) => Query;
  eq: (key: string, value: unknown) => Query;
  neq: (key: string, value: unknown) => Query;
  is: (key: string, value: unknown) => Query;
  in: (key: string, values: unknown[]) => Query;
  gt: (key: string, value: string | number) => Query;
  gte: (key: string, value: string | number) => Query;
  lt: (key: string, value: string | number) => Query;
  insert: (row: Row) => Query;
  upsert: (row: Row) => Query;
  update: (row: Row) => Query;
  single: () => Promise<QueryResult>;
  maybeSingle: () => Promise<QueryResult>;
  then: (resolve: (value: QueryResult) => unknown) => Promise<unknown>;
};
export function reportSpeech(tables: Record<string, Row[]>, reportId: string | undefined) {
  const pages = tables.device_reports.find(row => row.id === reportId)?.pages;
  assert.ok(Array.isArray(pages) && pages.every((page: unknown) => typeof page === "string"));
  return pages.join(" ");
}
function columnValue(row: Row, key: string) {
  const [column, field] = key.split("->>");
  if (!field) return row[column];
  const value = row[column];
  return value && typeof value === "object" ? (value as Row)[field] ?? null : null;
}
export function database(tables: Record<string, Row[]>, options: { beforeQuery?: (table: string) => Promise<void> } = {}) {
  return { from(table: string) {
    const filters: ((row: Row) => boolean)[] = []; let changes: Row | undefined; let inserted: Row | undefined;
    let upsert = false; const orders: string[] = []; let maximum = Infinity;
    const execute = (single = false) => {
      tables[table] ||= [];
      if (inserted) {
        const existing = upsert && tables[table].find(row => row.id === inserted!.id);
        if (existing) Object.assign(existing, structuredClone(inserted));
        else tables[table].push({ id: randomUUID(), expires_at: new Date(Date.now()+7200000).toISOString(), status: "pending", ...structuredClone(inserted) });
      }
      let rows = tables[table].filter(row => filters.every(filter => filter(row)));
      if (inserted) rows = rows.filter(row => row.id === inserted!.id || (!inserted!.id && row === tables[table].at(-1)));
      for (const row of rows) if (changes) Object.assign(row, changes);
      rows.sort((a,b) => { for (const key of orders) { const diff = String(a[key]).localeCompare(String(b[key])); if (diff) return diff; } return 0; });
      rows = rows.slice(0, maximum);
      return { data: structuredClone(single ? rows[0] || null : rows), error: null };
    };
    const q: Query = {
      limit: (count: number) => { maximum = count; return q; },
      select: () => q, order: (key: string) => { orders.push(key); return q; },
      eq: (key: string, value: unknown) => { filters.push(row => columnValue(row, key) === value); return q; },
      neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return q; },
      is: (key: string, value: unknown) => { filters.push(row => columnValue(row, key) === value); return q; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q; },
      gt: (key: string, value: string | number) => { filters.push(row => typeof row[key] === "number" && typeof value === "number" ? row[key] > value : typeof row[key] === "string" && typeof value === "string" && row[key] > value); return q; },
      gte: (key: string, value: string | number) => { filters.push(row => typeof row[key] === "number" && typeof value === "number" ? row[key] >= value : typeof row[key] === "string" && typeof value === "string" && row[key] >= value); return q; },
      lt: (key: string, value: string | number) => { filters.push(row => typeof row[key] === "number" && typeof value === "number" ? row[key] < value : typeof row[key] === "string" && typeof value === "string" && row[key] < value); return q; },
      insert: (row: Row) => { inserted = row; return q; }, upsert: (row: Row) => { inserted = row; upsert = true; return q; },
      update: (row: Row) => { changes = row; return q; },
      single: async () => execute(true), maybeSingle: async () => execute(true),
      then: (resolve: (value: QueryResult) => unknown) => Promise.resolve(options.beforeQuery?.(table)).then(() => execute()).then(resolve),
    }; return q;
  } } as unknown as SupabaseClient;
}
export const device: AuthenticatedLantern = { id: "board-a", userId: "owner-a", name: "Quipus", state: "ready", stateVersion: 1 };
export function fixtures() {
  const tables: Record<string, Row[]> = { profiles: [{ id: device.userId, timezone: "Asia/Kuala_Lumpur" }], meetings: [], meeting_insights: [], transcripts: [], device_voice_prompts: [] };
  for (let i = 0; i < 3; i++) {
    tables.meetings.push({ id: `m${i}`, user_id: device.userId, title: `Client ${i+1}`, start_at: `2026-09-21T0${i+1}:00:00Z`, status: "ready", recording_id: `r${i}`, source: "hardware" });
    tables.meeting_insights.push({ user_id: device.userId, meeting_id: `m${i}`, key_points: ["Point one.", "Point two.", `Final detail ${i+1}.`], promised: "A proposal." });
    tables.transcripts.push({ user_id: device.userId, recording_id: `r${i}` });
  }
  return { tables, client: database(tables) };
}
