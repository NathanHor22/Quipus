import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { migratedDatabase } from "./helpers/database";

test("the deliverable 021+022 upgrade preserves existing audio, transcript, meeting and storage rows", { timeout: 60_000 }, async () => {
  const db = await migratedDatabase(20);
  const owner = "11111111-1111-4111-8111-111111111111";
  const recording = "22222222-2222-4222-8222-222222222222";
  const meeting = "33333333-3333-4333-8333-333333333333";
  try {
    await db.query("insert into auth.users(id,email) values($1,'upgrade@example.test')", [owner]);
    await db.query("insert into recordings(id,user_id,storage_path,duration_seconds,status) values($1,$2,$3,3,'ready')", [recording, owner, `${owner}/existing.wav`]);
    await db.query("insert into transcripts(user_id,recording_id,text) values($1,$2,'Keep this actual conversation')", [owner, recording]);
    await db.query("insert into meetings(id,user_id,recording_id,title,start_at,end_at,status,source) values($1,$2,$3,'Keep this meeting',now(),now(),'ready','hardware')", [meeting, owner, recording]);
    await db.query("insert into storage.objects(bucket_id,name) values('recordings',$1)", [`${owner}/existing.wav`]);
    const before = {
      recordings: (await db.query("select * from recordings")).rows,
      transcripts: (await db.query("select * from transcripts")).rows,
      meetings: (await db.query("select * from meetings")).rows,
      objects: (await db.query("select * from storage.objects")).rows,
    };
    const sql = await readFile("supabase/setup/quipus-recording-calendar-upgrade.sql", "utf8");
    await db.exec(sql);
    assert.deepEqual((await db.query("select * from recordings")).rows, before.recordings);
    assert.deepEqual((await db.query("select * from transcripts")).rows, before.transcripts);
    assert.deepEqual((await db.query("select * from meetings")).rows, before.meetings);
    assert.deepEqual((await db.query("select * from storage.objects")).rows, before.objects);
    assert.equal((await db.query("select * from recording_discard_decisions")).rows.length, 0);
    assert.equal((await db.query("select * from recording_audio_deletions")).rows.length, 0);
    assert.equal((await db.query("select * from calendar_recording_preferences")).rows.length, 0);
    await assert.rejects(db.exec(sql), /Migration 021 already exists/);
    assert.deepEqual((await db.query("select * from recordings")).rows, before.recordings);
  } finally { await db.close(); }
});
