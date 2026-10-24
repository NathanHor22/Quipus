import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { migratedDatabase } from "./helpers/database";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const sha = "a".repeat(64);

test("positive short-silence decisions are atomic, owner-bound, source-complete and idempotent", { timeout: 60_000 }, async t => {
  const db = await migratedDatabase(21);
  try {
    await db.query("insert into auth.users(id,email) values($1,'owner@example.test'),($2,'other@example.test')", [owner, other]);
    async function fixture(phone = false) {
      await db.exec("update lantern_processing_jobs set state='ready',lease_until=null");
      const device = randomUUID(), session = randomUUID(), audio = randomUUID(), event = randomUUID();
      await db.query("insert into devices(id,user_id,name,hardware_id,credential_hash,device_state,state_version) values($1::uuid,$2::uuid,'Test',$1::text,$3,'finalising',3)", [device, owner, sha]);
      await db.query(`insert into lantern_sessions(id,user_id,device_id,mode,state,state_version,machine,started_at,capture_ended_at)
        values($1,$2,$3,'quick','finalising',3,$4,now()-interval '1 second',now())`,
      [session, owner, device, JSON.stringify({ state: "finalising", version: 3, sessionId: session, recordingStartedAt: new Date().toISOString() })]);
      const storage = `${owner}/device/${session}/${audio}.wav`;
      await db.query("insert into lantern_audio_uploads(session_id,event_id,storage_path,total_bytes,sha256) values($1,$2,$3,32044,$4)", [session, audio, storage, sha]);
      await db.query("select attach_lantern_direct_audio($1,$2,$3)", [session, owner, device]);
      await db.query("select enqueue_lantern_processing($1,$2,$3,$4,3,$5)", [session, owner, device, event, JSON.stringify({ state: "ready", version: 4, sessionId: null })]);
      await db.query("update lantern_audio_uploads set verified_at=now() where session_id=$1", [session]);
      const job = (await db.query<{ lease_token: string }>("select * from claim_lantern_processing($1,$2)", [owner, session])).rows[0];
      const onboard = { sourceKind: "onboard", sha256: sha, sampleCount: 16000, totalBytes: 32044, constantSample: 0 };
      const evidence = [onboard];
      if (phone) {
        const phoneId = randomUUID();
        await db.query("update lantern_sessions set expected_audio_sources=array['onboard','phone'] where id=$1", [session]);
        await db.query(`insert into recording_audio_sources(id,user_id,session_id,recording_id,source_kind,storage_path,byte_length,sha256,timing_manifest,committed_at,verified_at)
          values($1,$2,$3,$4,'phone',$5,32044,$6,'{}',now(),now())`,
        [phoneId, owner, session, audio, `${owner}/device/${session}/${phoneId}.wav`, "b".repeat(64)]);
        evidence.push({ ...onboard, sourceKind: "phone", sha256: "b".repeat(64) });
      }
      const args = [session, owner, device, job.lease_token, JSON.stringify(evidence), 2];
      const sql = "select discard_quipus_short_silence($1,$2,$3,$4,$5,$6) as discarded";
      return { device, session, audio, evidence, args, sql };
    }
    async function untouched(session: string) {
      assert.equal((await db.query("select * from recording_discard_decisions where session_id=$1", [session])).rows.length, 0);
      assert.equal((await db.query<{state:string}>("select state from lantern_processing_jobs where session_id=$1", [session])).rows[0].state, "running");
    }
    await t.test("wrong ownership, lost lease, invalid duration, forged source and empty STT alone cannot discard", async () => {
      const f = await fixture();
      for (const changed of [
        { index: 1, value: other }, { index: 2, value: randomUUID() }, { index: 3, value: randomUUID() },
        { index: 5, value: 0 },
        { index: 4, value: JSON.stringify([{ ...f.evidence[0], sampleCount: 80_000, totalBytes: 160_044 }]) },
        { index: 4, value: JSON.stringify([{ ...f.evidence[0], sha256: "b".repeat(64) }]) },
        { index: 4, value: JSON.stringify([{ ...f.evidence[0], sha256: null }]) },
        { index: 4, value: JSON.stringify([]) },
      ]) {
        const args = [...f.args]; args[changed.index] = changed.value;
        await assert.rejects(db.query(f.sql, args));
        await untouched(f.session);
      }
    });
    await t.test("prior speech, incomplete capture, expired lease and unverified source always retain the archive", async () => {
      const f = await fixture();
      for (const [change, restore] of [
        ["update lantern_sessions set transcript_segments='[{\"speaker\":\"Speaker 1\",\"text\":\"Yes\"}]' where id=$1", "update lantern_sessions set transcript_segments=null where id=$1"],
        ["update lantern_sessions set final_transcription='{}' where id=$1", "update lantern_sessions set final_transcription=null where id=$1"],
        ["update lantern_sessions set capture_ended_at=null where id=$1", "update lantern_sessions set capture_ended_at=now() where id=$1"],
        ["update lantern_processing_jobs set lease_until=now()-interval '1 second' where session_id=$1", "update lantern_processing_jobs set lease_until=now()+interval '6 minutes' where session_id=$1"],
        ["update lantern_audio_uploads set verified_at=null where session_id=$1", "update lantern_audio_uploads set verified_at=now() where session_id=$1"],
      ]) {
        await db.query(change, [f.session]);
        await assert.rejects(db.query(f.sql, f.args));
        await untouched(f.session);
        await db.query(restore, [f.session]);
      }
    });
    await t.test("phone track must independently match a complete verified source, not just the consolidated mix", async () => {
      const f = await fixture(true);
      const missing = [...f.args]; missing[4] = JSON.stringify([f.evidence[0]]);
      await assert.rejects(db.query(f.sql, missing), /silence evidence/);
      await db.query("update recording_audio_sources set verified_at=null where session_id=$1", [f.session]);
      await assert.rejects(db.query(f.sql, f.args), /Phone evidence/);
      await untouched(f.session);
      await db.query("update recording_audio_sources set verified_at=now() where session_id=$1", [f.session]);
      assert.deepEqual((await db.query(f.sql, f.args)).rows, [{ discarded: true }]);
      assert.equal((await db.query("select * from recording_discard_decisions where session_id=$1", [f.session])).rows.length, 1);
    });
    await t.test("one positive decision preserves current device state and leaves no meeting; exact-object deletion is retryable", async () => {
      const f = await fixture();
      const deviceBefore = (await db.query("select * from devices where id=$1", [f.device])).rows;
      assert.deepEqual((await db.query(f.sql, f.args)).rows, [{ discarded: true }]);
      assert.deepEqual((await db.query(f.sql, f.args)).rows, [{ discarded: true }]);
      assert.deepEqual((await db.query("select * from devices where id=$1", [f.device])).rows, deviceBefore);
      assert.deepEqual((await db.query("select processing_stage from lantern_sessions where id=$1", [f.session])).rows, [{ processing_stage: "discarded_silence" }]);
      assert.deepEqual((await db.query("select state from lantern_processing_jobs where session_id=$1", [f.session])).rows, [{ state: "ready" }]);
      assert.equal((await db.query("select * from meetings where recording_id=$1", [f.audio])).rows.length, 0);
      assert.equal((await db.query("select * from claim_quipus_silence_cleanup($1,$2)", [f.audio, other])).rows.length, 0);
      const deletion = (await db.query<{ lease_token:string; object_paths:string[] }>("select * from claim_quipus_silence_cleanup($1,$2)", [f.audio, owner])).rows[0];
      assert.equal(deletion.object_paths.length, 1);
      assert.equal((await db.query("select * from claim_quipus_silence_cleanup($1,$2)", [f.audio, owner])).rows.length, 0);
      assert.deepEqual((await db.query("select finish_recording_audio_deletion($1,$2) as finished", [f.audio, randomUUID()])).rows, [{ finished: false }]);
      assert.deepEqual((await db.query("select finish_recording_audio_deletion($1,$2) as finished", [f.audio, deletion.lease_token])).rows, [{ finished: true }]);
      assert.equal((await db.query("select * from lantern_audio_uploads where session_id=$1", [f.session])).rows.length, 0);
      assert.equal((await db.query("select * from recording_discard_decisions where session_id=$1", [f.session])).rows.length, 1);
      assert.deepEqual((await db.query(f.sql, f.args)).rows, [{ discarded: true }]);
    });
    await t.test("ordinary public clients cannot forge evidence or execute cleanup", async () => {
      await db.exec("set role authenticated");
      try {
        await assert.rejects(db.query("select * from recording_discard_decisions"), /permission denied/);
        await assert.rejects(db.query("select * from claim_quipus_silence_cleanup(gen_random_uuid(),$1)", [owner]), /permission denied/);
        await assert.rejects(db.query("select discard_quipus_short_silence(gen_random_uuid(),$1,gen_random_uuid(),gen_random_uuid(),'[]',1)", [owner]), /permission denied/);
      } finally { await db.exec("reset role"); }
    });
  } finally { await db.close(); }
});
