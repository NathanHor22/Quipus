import assert from "node:assert/strict";
import test from "node:test";
import { migratedDatabase } from "./helpers/database";
import { prepareOfflineSession, offlineSessionSchema } from "../lib/offline-session";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const device = "33333333-3333-4333-8333-333333333333",
  session = "44444444-4444-4444-8444-444444444444";
const event = "55555555-5555-4555-8555-555555555555",
  phone = "66666666-6666-4666-8666-666666666666";
const audio = "77777777-7777-4777-8777-777777777777",
  complete = "88888888-8888-4888-8888-888888888888";

test(
  "offline imports, dual-source completeness and transfers enforce owner boundaries",
  { timeout: 60000 },
  async () => {
    const db = await migratedDatabase();
    try {
      await db.query(
        "insert into auth.users(id,email) values($1,'owner@example.com'),($2,'other@example.com')",
        [owner, other],
      );
      await db.query(
        "insert into devices(id,user_id,name,hardware_id,credential_hash,device_state) values($1,$2,'Test','test-hardware',$3,'ready')",
        [device, owner, "a".repeat(64)],
      );
      const input = offlineSessionSchema.parse({
        sessionId: session,
        eventId: event,
        ownerId: owner,
        ownerDeviceId: device,
        capturedAt: new Date(Date.now() - 300000).toISOString(),
        timeUncertain: false,
        durationSeconds: 120,
        consentAccepted: true,
        audioSources: ["onboard", "phone"],
      });
      const prepared = prepareOfflineSession(input);
      const importSql =
        "select import_quipus_offline_session($1,$2,$3,$4,$5,$6,$7,false,'Asia/Kuala_Lumpur',$8,array['onboard','phone'])";
      const args = [
        session,
        event,
        owner,
        device,
        prepared.startedAt,
        prepared.captureEndedAt,
        JSON.stringify(prepared.machine),
        prepared.fingerprint,
      ];
      await db.query(importSql, args);
      await db.query(importSql, args);
      assert.equal((await db.query("select * from lantern_sessions")).rows.length, 1);
      await assert.rejects(
        db.query(importSql, [...args.slice(0, 2), other, ...args.slice(3)]),
        /device owner/,
      );
      await assert.rejects(
        db.query(importSql, [...args.slice(0, 7), "b".repeat(64)]),
        /Conflicting/,
      );
      await db.query(
        "insert into lantern_audio_uploads(session_id,event_id,storage_path,total_bytes,sha256) values($1,$2,$3,3840044,$4)",
        [session, audio, owner + "/device/" + session + "/" + audio + ".wav", "a".repeat(64)],
      );
      await db.query("select attach_lantern_direct_audio($1,$2,$3)", [session, owner, device]);
      const ready = JSON.stringify({
        ...prepared.machine,
        state: "ready",
        version: 2,
        mode: null,
        sessionId: null,
        recordingStartedAt: null,
        consentConfirmedAt: null,
      });
      await assert.rejects(
        db.query("select enqueue_lantern_processing($1,$2,$3,$4,1,$5)", [
          session,
          owner,
          device,
          complete,
          ready,
        ]),
        /phone recording/,
      );
      const timing = {
        version: 1,
        sampleRate: 16000,
        channels: 1,
        deviceStartedUs: 0,
        firstPacketDeviceUs: 32000,
        lastPacketDeviceUs: 120000000,
        firstPacketPhoneUs: 0,
        lastPacketPhoneUs: 119968000,
        receivedSamples: 1920000,
        missingSamples: 0,
        droppedPackets: 0,
        disconnects: 0,
      };
      const prepareSql = "select prepare_quipus_phone_audio($1,$2,$3,$4,3840044,$5,$6)";
      const phoneArgs = [session, owner, device, phone, "b".repeat(64), JSON.stringify(timing)];
      await db.query(prepareSql, phoneArgs);
      await db.query(prepareSql, phoneArgs);
      await assert.rejects(
        db.query(prepareSql, [session, other, ...phoneArgs.slice(2)]),
        /not found/,
      );
      await assert.rejects(
        db.query(prepareSql, [...phoneArgs.slice(0, 4), "c".repeat(64), phoneArgs[5]]),
        /Conflicting/,
      );
      await db.query(
        "update recordings set audio_retention_at=now()-interval '91 days' where id=(select recording_id from lantern_sessions where id=$1)",
        [session],
      );
      await assert.rejects(db.query(prepareSql, phoneArgs), /expired/);
      await db.query(
        "update recordings set audio_retention_at=now() where id=(select recording_id from lantern_sessions where id=$1)",
        [session],
      );
      await assert.rejects(
        db.query("select enqueue_lantern_processing($1,$2,$3,$4,1,$5)", [
          session,
          owner,
          device,
          complete,
          ready,
        ]),
        /phone recording/,
      );
      await db.query("select commit_quipus_phone_audio($1,$2,$3,$4)", [
        session,
        owner,
        device,
        phone,
      ]);
      await db.query("select enqueue_lantern_processing($1,$2,$3,$4,1,$5)", [
        session,
        owner,
        device,
        complete,
        ready,
      ]);
      assert.equal((await db.query("select * from lantern_processing_jobs")).rows.length, 1);
      const transfer = (
        await db.query<{ id: string }>("select (request_quipus_transfer($1,$2)).id", [
          device,
          owner,
        ])
      ).rows[0].id;
      await assert.rejects(
        db.query("select acknowledge_quipus_transfer($1,$2,$3)", [transfer, device, owner]),
        /Verify all/,
      );
      await db.exec(
        "update lantern_audio_uploads set verified_at=now();update recording_audio_sources set verified_at=now()",
      );
      await assert.rejects(
        db.query("select acknowledge_quipus_transfer($1,$2,$3)", [transfer, device, other]),
        /Invalid device/,
      );
      await db.query("select acknowledge_quipus_transfer($1,$2,$3)", [transfer, device, owner]);
      const old = (
        await db.query<{
          user_id: string;
          hardware_id: string | null;
          credential_hash: string | null;
        }>("select user_id,hardware_id,credential_hash from devices where id=$1", [device])
      ).rows[0];
      assert.equal(old.user_id, owner);
      assert.equal(old.hardware_id, null);
      assert.equal(old.credential_hash, null);
      assert.equal(
        (await db.query("select * from lantern_sessions where user_id=$1", [owner])).rows.length,
        1,
      );
      await db.exec("grant select on lantern_sessions to authenticated;set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
      assert.equal((await db.query("select * from recording_audio_sources")).rows.length, 0);
      assert.equal((await db.query("select * from device_transfers")).rows.length, 0);
      await assert.rejects(db.query(importSql, args), /permission denied/);
    } finally {
      await db.close();
    }
  },
);
