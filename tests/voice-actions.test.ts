import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { voiceApprovalDecision } from "../lib/voice-approval";
import { answerVoicePrompt } from "../lib/device-dialogue";
import { emailActionSchema, encodeEmail, sendApprovedEmail } from "../lib/email-action";
import type { AuthenticatedLantern } from "../lib/lantern-device-auth";

const device: AuthenticatedLantern = { id: "device-a", userId: "owner-a", name: "Lantern", state: "ready", stateVersion: 1 };
const token = "e53b28c1-8888-4444-8888-111111111111";
type Row = Record<string, unknown>;
type QueryResult = { data: Row | null; error: null };
type Query = {
  select: () => Query;
  update: (values: Row) => Query;
  eq: (key: string, value: unknown) => Query;
  in: (key: string, values: unknown[]) => Query;
  maybeSingle: () => Promise<QueryResult>;
  single: () => Promise<QueryResult>;
  then: (resolve: (value: QueryResult) => unknown) => Promise<unknown>;
};
/** In-memory query boundary: filters and conditional writes run atomically. No network calls. */
function database(tables: Record<string, Row[]>) {
  let writes = 0;
  const client = { from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let changes: Row | undefined;
    const execute = () => {
      const rows = (tables[table] || []).filter(row => filters.every(filter => filter(row)));
      if (changes) for (const row of rows) { Object.assign(row, changes); writes++; }
      return { data: structuredClone(rows[0] || null), error: null };
    };
    const query: Query = {
      select: () => query, update: (values: Row) => { changes = values; return query; },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      maybeSingle: async () => execute(), single: async () => execute(),
      then: (resolve: (value: QueryResult) => unknown) => Promise.resolve(execute()).then(resolve),
    };
    return query;
  } } as unknown as SupabaseClient;
  return { client, writes: () => writes };
}
function prompt(values: Row = {}) {
  return { id: token, user_id: device.userId, device_id: device.id, kind: "review", status: "pending",
    expires_at: new Date(Date.now() + 60000).toISOString(), remaining_ids: [], payload: {}, ...values };
}

test("voice approval rejects incidental and conditional yes while accepting Malay confirmations", () => {
  for (const text of ["yes", "Yes, please.", "ya", "boleh"]) assert.equal(voiceApprovalDecision(text), "yes");
  for (const text of ["no", "tak", "tidak", "yes no", "cancel"]) assert.equal(voiceApprovalDecision(text), "no");
  for (const text of ["yesterday", "she said yes", "yes but change the time", "maybe", ""]) assert.equal(voiceApprovalDecision(text), "unknown");
});
test("another device, another account, expired prompts, and recording state cannot approve actions", async () => {
  for (const fields of [{ user_id: "other" }, { device_id: "other" }, { expires_at: "2000-01-01T00:00:00Z" }]) {
    const db = database({ device_voice_prompts: [prompt(fields)] });
    const reply = await answerVoicePrompt(db.client, device, token, "yes");
    assert.equal(reply.token, undefined); assert.equal(db.writes(), 0);
  }
  const db = database({ device_voice_prompts: [prompt()] });
  await answerVoicePrompt(db.client, { ...device, state: "recording" }, token, "yes");
  assert.equal(db.writes(), 0);
});
test("unclear replies retain the same prompt without executing it", async () => {
  const db = database({ device_voice_prompts: [prompt()] });
  const reply = await answerVoicePrompt(db.client, device, token, "yes but next Friday");
  assert.equal(reply.token, token); assert.equal(db.writes(), 0);
});
test("a completed voice decision replays its result without claiming it again", async () => {
  const db = database({ device_voice_prompts: [prompt()] });
  const first = await answerVoicePrompt(db.client, device, token, "no");
  const writes = db.writes();
  assert.deepEqual(await answerVoicePrompt(db.client, device, token, "yes"), first);
  assert.equal(db.writes(), writes);
  assert.match(first.speech, /cancelled/);
});
test("concurrent voice replies claim a prompt only once", async () => {
  const db = database({ device_voice_prompts: [prompt()] });
  const replies = await Promise.all([answerVoicePrompt(db.client, device, token, "yes"), answerVoicePrompt(db.client, device, token, "yes")]);
  assert.equal(db.writes(), 2); // one claim and one saved result
  assert.ok(replies.some(reply => /already/.test(reply.speech)));
});
test("edited actions need fresh approval before any provider call", async () => {
  const original = { id: "task-a", user_id: device.userId, status: "pending", description: "Discuss pricing", draft: null, schedule_details: null };
  const db = database({ device_voice_prompts: [prompt({ kind: "calendar", payload: { original } })], follow_ups: [{ ...original, description: "Changed meeting" }] });
  const reply = await answerVoicePrompt(db.client, device, token, "yes");
  assert.match(reply.speech, /changed after it was read/);
});

const email = { followUpId: token, recipient: "client@example.com", subject: "Follow-up: Malaysia", body: "Hello.\nBoleh, let's meet next week.", approved: true as const };
test("Gmail MIME preserves multilingual text and cannot inject recipient headers", () => {
  const raw = Buffer.from(encodeEmail({ ...email, subject: "Follow-up\r\nBcc: attacker@example.com", body: "你好, boleh.\nNext week?" }), "base64url").toString();
  assert.equal(raw.includes("\r\nBcc:"), false);
  assert.match(raw, /^To: client@example.com\r\n/);
  assert.equal(Buffer.from(raw.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString(), "你好, boleh.\nNext week?");
  assert.equal(emailActionSchema.safeParse({ ...email, approved: false }).success, false);
  assert.equal(emailActionSchema.safeParse({ ...email, recipient: "a@example.com\r\nBcc:b@example.com" }).success, false);
});
test("ambiguous email delivery is never automatically submitted again", async () => {
  const db = database({ follow_ups: [{ id: token, user_id: device.userId, type: "email", status: "approved" }],
    actions: [{ id: "action-a", user_id: device.userId, follow_up_id: token, type: "send_email", status: "executing", idempotency_key: "old" }] });
  await assert.rejects(sendApprovedEmail(db.client, device.userId, email), /Check Gmail Sent/);
  assert.equal(db.writes(), 0);
});
test("a confirmed email repairs a missed task update without sending again", async () => {
  const key = `email:${createHash("sha256").update(`${device.userId}\0${token}\0${email.recipient}\0${email.subject}\0${email.body}`).digest("hex")}`;
  const task = { id: token, user_id: device.userId, type: "email", status: "approved" };
  const db = database({ follow_ups: [task], actions: [{ id: "action-a", user_id: device.userId, follow_up_id: token, type: "send_email", status: "completed", idempotency_key: key, external_id: "gmail-123" }] });
  assert.deepEqual(await sendApprovedEmail(db.client, device.userId, email), { id: "gmail-123", duplicate: true });
  assert.equal(task.status, "completed");
});
