import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { migratedDatabase } from "./helpers/database";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const secretHash = "a".repeat(64);

test("factory reset revokes immediately, fences pairing until wipe acknowledgement and preserves uploaded history", { timeout: 60_000 }, async t => {
  const db = await migratedDatabase(24);
  const query = (sql: string, values?: unknown[]) => db.query<Record<string, unknown>>(sql, values);
  try {
    await query("insert into auth.users(id,email) values($1,'owner@example.test'),($2,'other@example.test')", [owner, other]);
    const deviceId = randomUUID(), hardwareId = "esp32s3:00112233b7dc";
    const recordingId = randomUUID(), meetingId = randomUUID(), sessionId = randomUUID();
    await query("insert into devices(id,user_id,name,hardware_id,credential_hash,device_state,encrypted_archive_key) values($1,$2,'Quipus',$3,$4,'ready','private-backup')", [deviceId, owner, hardwareId, secretHash]);
    await query("insert into recordings(id,user_id,device_id,storage_path,status) values($1,$2,$3,'private/original.wav','ready')", [recordingId, owner, deviceId]);
    await query("insert into transcripts(user_id,recording_id,text) values($1,$2,'Private meeting text')", [owner, recordingId]);
    await query("insert into meetings(id,user_id,title,start_at,end_at,status,source,recording_id) values($1,$2,'Uploaded meeting',now()-interval '2 hours',now()-interval '1 hour','ready','hardware',$3)", [meetingId, owner, recordingId]);
    await query("insert into lantern_sessions(id,user_id,device_id,mode,state,machine,started_at) values($1,$2,$3,'quick','recording','{}',now())", [sessionId, owner, deviceId]);
    const before = {
      recordings: (await query("select * from recordings where id=$1", [recordingId])).rows,
      meetings: (await query("select * from meetings where id=$1", [meetingId])).rows,
      transcripts: (await query("select * from transcripts where recording_id=$1", [recordingId])).rows,
    };
    const request = (user = owner) => db.query<{ reset_id: string; reset_state: string }>("select * from request_quipus_device_reset($1,$2)", [deviceId, user]);
    await t.test("foreign owner cannot revoke and ordinary access is disabled atomically", async () => {
      await assert.rejects(request(other), /Device not found/);
      assert.equal((await query("select credential_hash from devices where id=$1", [deviceId])).rows[0].credential_hash, secretHash);
    });
    const reset = (await request()).rows[0];
    assert.equal(reset.reset_state, "pending");
    assert.deepEqual((await request()).rows, [reset]);
    const revoked = (await query("select user_id,hardware_id,credential_hash,revoked_at from devices where id=$1", [deviceId])).rows[0];
    assert.equal(revoked.user_id, owner);
    assert.equal(revoked.hardware_id, hardwareId);
    assert.equal(revoked.credential_hash, null);
    assert.ok(revoked.revoked_at);
    assert.ok((await query("select ended_at from lantern_sessions where id=$1", [sessionId])).rows[0].ended_at);
    const codeHash = "c".repeat(64), newDeviceId = randomUUID();
    await query("insert into device_pairings(user_id,code_hash,device_name,expires_at) values($1,$2,'Fresh Quipus',now()+interval '10 minutes')", [other, codeHash]);
    const claim = () => query("select * from claim_lantern_pairing($1,$2,$3,'Waveshare','0.14.0',$4)", [codeHash, newDeviceId, hardwareId, "b".repeat(64)]);
    await t.test("pending reset cannot be reclaimed or bypassed by same-owner updates", async () => {
      await assert.rejects(claim(), /reset is pending/);
      await assert.rejects(query("update devices set revoked_at=null,credential_hash=$2 where id=$1", [deviceId, secretHash]), /reset is pending/);
      assert.equal((await query("select claimed_at from device_pairings where code_hash=$1", [codeHash])).rows[0].claimed_at, null);
    });
    const ack = (hash = secretHash, id = deviceId) => query("select acknowledge_quipus_device_reset($1,$2,$3)", [reset.reset_id, id, hash]);
    await t.test("wrong reset credential or device cannot release the hardware", async () => {
      await assert.rejects(ack("b".repeat(64)), /Invalid reset credential/);
      await assert.rejects(ack(secretHash, randomUUID()), /Invalid reset credential/);
      assert.equal((await query("select hardware_id from devices where id=$1", [deviceId])).rows[0].hardware_id, hardwareId);
    });
    await ack();
    await ack(); // A lost HTTP response must not strand the recorder's reset journal.
    await t.test("acknowledgement releases only hardware identity and new pairing gets a new owner-bound UUID", async () => {
      const old = (await query("select user_id,hardware_id,credential_hash,encrypted_archive_key from devices where id=$1", [deviceId])).rows[0];
      assert.deepEqual(old, { user_id: owner, hardware_id: null, credential_hash: null, encrypted_archive_key: null });
      const claimed = (await claim()).rows[0];
      assert.equal(claimed.device_id, newDeviceId);
      assert.equal(claimed.owner_id, other);
      assert.deepEqual((await query("select * from recordings where id=$1", [recordingId])).rows, before.recordings);
      assert.deepEqual((await query("select * from meetings where id=$1", [meetingId])).rows, before.meetings);
      assert.deepEqual((await query("select * from transcripts where recording_id=$1", [recordingId])).rows, before.transcripts);
      await ack(); // Old reset capability still cannot change the replacement row.
      assert.equal((await query("select credential_hash from devices where id=$1", [newDeviceId])).rows[0].credential_hash, "b".repeat(64));
    });
    await t.test("legacy revoked records require recovery and reset verifiers are never readable by browser users", async () => {
      const legacy = randomUUID();
      await query("insert into devices(id,user_id,name,hardware_id,revoked_at,credential_hash,device_state) values($1,$2,'Legacy','esp32s3:legacy',now(),null,'ready')", [legacy, owner]);
      const recovery = await db.query<{ reset_state: string }>("select * from request_quipus_device_reset($1,$2)", [legacy, owner]);
      assert.equal(recovery.rows[0].reset_state, "recovery_required");
      await db.exec("set role authenticated");
      await assert.rejects(query("select * from device_reset_requests"), /permission denied/);
      await assert.rejects(query("select * from request_quipus_device_reset($1,$2)", [legacy, owner]), /permission denied/);
      await db.exec("reset role");
    });
  } finally { await db.close(); }
});
