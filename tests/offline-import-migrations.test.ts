import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { migratedDatabase } from "./helpers/database";
import { offlineSessionSchema, prepareOfflineSession, type OfflineSession } from "../lib/offline-session";
import { advanceLantern, createLanternMachine, lanternMachineSchema } from "../lib/lantern-state";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

test("offline archives queue independently without changing older WAVs or live capture", { timeout: 60_000 }, async t => {
  const db = await migratedDatabase(19);
  try {
    await db.query("insert into auth.users(id,email) values($1,'owner@example.test'),($2,'other@example.test')", [owner, other]);
    async function device() {
      const id = randomUUID();
      await db.query("insert into devices(id,user_id,name,hardware_id,credential_hash,device_state,state_version) values($1,$2,'Test',$3,$4,'ready',9)", [id, owner, id, "a".repeat(64)]);
      return id;
    }
    function input(deviceId: string, secondsAgo = 300): OfflineSession {
      return offlineSessionSchema.parse({
        sessionId: randomUUID(), eventId: randomUUID(), ownerId: owner, ownerDeviceId: deviceId,
        capturedAt: new Date(Date.now() - secondsAgo * 1000).toISOString(),
        timeUncertain: false, durationSeconds: 24, consentAccepted: true,
      });
    }
    async function importArchive(manifest: OfflineSession, fingerprint?: string) {
      const prepared = prepareOfflineSession(manifest);
      await db.query("select import_quipus_offline_session($1,$2,$3,$4,$5,$6,$7,false,'Asia/Kuala_Lumpur',$8,array['onboard'])", [
        manifest.sessionId, manifest.eventId, manifest.ownerId, manifest.ownerDeviceId,
        prepared.startedAt, prepared.captureEndedAt, JSON.stringify(prepared.machine), fingerprint || prepared.fingerprint,
      ]);
      return prepared.machine;
    }
    async function live(deviceId: string, stopped: boolean) {
      const id = randomUUID();
      const startedAt = new Date(Date.now() - 600_000).toISOString();
      const machine = { ...createLanternMachine("ready"), sessionId: id, mode: "quick", version: 9,
        state: stopped ? "finalising" : "recording", recordingStartedAt: startedAt, consentConfirmedAt: startedAt };
      await db.query("insert into lantern_sessions(id,user_id,device_id,mode,state,state_version,machine,started_at,capture_ended_at) values($1,$2,$3,'quick',$4,9,$5,$6,$7)", [
        id, owner, deviceId, machine.state, JSON.stringify(machine), startedAt,
        stopped ? new Date(Date.now() - 500_000).toISOString() : null,
      ]);
      await db.query("update devices set device_state=$2 where id=$1", [deviceId, machine.state]);
      return id;
    }
    async function archive(sessionId: string, deviceId: string) {
      const event = randomUUID();
      await db.query("insert into lantern_audio_uploads(session_id,event_id,storage_path,total_bytes,sha256) values($1,$2,$3,768044,$4)", [
        sessionId, event, `${owner}/device/${sessionId}/${event}.wav`, "a".repeat(64),
      ]);
      await db.query("select attach_lantern_direct_audio($1,$2,$3)", [sessionId, owner, deviceId]);
      return event;
    }
    async function complete(sessionId: string, deviceId: string, eventId: string = randomUUID()) {
      const stored = (await db.query<{ machine: unknown }>("select machine from lantern_sessions where id=$1", [sessionId])).rows[0];
      const machine = lanternMachineSchema.parse(stored.machine);
      const next = advanceLantern(machine, { type: "PROCESSING_QUEUED", at: new Date().toISOString() });
      const sql = "select enqueue_lantern_processing($1,$2,$3,$4,$5,$6)";
      const args = [sessionId, owner, deviceId, eventId, machine.version, JSON.stringify(next)];
      const result = await db.query(sql, args);
      return { result, sql, args };
    }
    async function row(table: string, id: string) {
      assert.ok(["devices", "lantern_sessions", "recordings"].includes(table));
      return (await db.query<Record<string, unknown>>(`select * from ${table} where id=$1`, [id])).rows[0];
    }

    const olderDevice = await device();
    const olderSession = await live(olderDevice, true);
    const olderAudio = await archive(olderSession, olderDevice);
    const newer = input(olderDevice);
    await assert.rejects(importArchive(newer), /lantern_one_open_session_per_device/);
    const previous = { session: await row("lantern_sessions", olderSession), audio: await row("recordings", olderAudio) };
    await db.exec(await readFile("supabase/migrations/020_offline_archive_control_slot.sql", "utf8"));

    await t.test("the proven pre-migration conflict imports once and retains the older complete WAV", async () => {
      await importArchive(newer);
      await importArchive(newer);
      assert.deepEqual(await row("lantern_sessions", olderSession), previous.session);
      assert.deepEqual(await row("recordings", olderAudio), previous.audio);
      assert.equal((await db.query("select * from lantern_sessions where id=$1", [newer.sessionId])).rows.length, 1);
      assert.equal((await db.query("select * from lantern_device_events where session_id=$1", [newer.sessionId])).rows.length, 1);
      await assert.rejects(importArchive(newer, "b".repeat(64)), /Conflicting offline import/);
      await assert.rejects(importArchive({ ...newer, ownerId: other }), /device owner/);
    });

    await t.test("new archive completion is atomic, replayable and preserves old queue completion", async () => {
      const deviceBefore = await row("devices", olderDevice);
      await assert.rejects(complete(newer.sessionId, olderDevice), /not archived/);
      assert.equal((await db.query("select * from lantern_processing_jobs where session_id=$1", [newer.sessionId])).rows.length, 0);
      await archive(newer.sessionId, olderDevice);
      const queued = await complete(newer.sessionId, olderDevice);
      assert.deepEqual((await db.query(queued.sql, queued.args)).rows, queued.result.rows);
      const conflict = [...queued.args]; conflict[3] = randomUUID();
      await assert.rejects(db.query(queued.sql, conflict), /already completed/);
      assert.deepEqual(await row("devices", olderDevice), deviceBefore);
      assert.deepEqual(await row("lantern_sessions", olderSession), previous.session);
      assert.deepEqual(await row("recordings", olderAudio), previous.audio);
      await complete(olderSession, olderDevice);
      assert.equal((await row("devices", olderDevice)).device_state, "ready");
      assert.equal((await db.query("select * from lantern_processing_jobs where session_id in ($1,$2)", [olderSession, newer.sessionId])).rows.length, 2);
      assert.deepEqual(await row("recordings", olderAudio), previous.audio);
    });

    await t.test("overlapping imports and completions cannot reset a real live capture", async () => {
      const activeDevice = await device();
      const active = await live(activeDevice, false);
      const before = { device: await row("devices", activeDevice), session: await row("lantern_sessions", active) };
      const a = input(activeDevice), b = input(activeDevice, 200);
      await Promise.all([importArchive(a), importArchive(b), importArchive(a)]);
      assert.equal((await db.query("select * from lantern_sessions where device_id=$1", [activeDevice])).rows.length, 3);
      await archive(a.sessionId, activeDevice);
      await archive(b.sessionId, activeDevice);
      await Promise.all([complete(a.sessionId, activeDevice), complete(b.sessionId, activeDevice)]);
      assert.deepEqual(await row("devices", activeDevice), before.device);
      assert.deepEqual(await row("lantern_sessions", active), before.session);
      const duplicateId = randomUUID();
      await assert.rejects(db.query("insert into lantern_sessions(id,user_id,device_id,mode,state,state_version,machine,started_at) values($1,$2,$3,'quick','recording',9,$4,now())", [duplicateId, owner, activeDevice, JSON.stringify(before.session.machine)]), /lantern_one_open_session_per_device/);
    });

    await t.test("event collisions roll back archive completion and leave audio available for retry", async () => {
      const faultDevice = await device();
      const a = input(faultDevice), b = input(faultDevice, 200);
      await importArchive(a); await importArchive(b);
      await archive(a.sessionId, faultDevice);
      const before = await row("lantern_sessions", a.sessionId);
      await assert.rejects(complete(a.sessionId, faultDevice, b.eventId), /unique constraint/);
      assert.deepEqual(await row("lantern_sessions", a.sessionId), before);
      assert.equal((await db.query("select * from lantern_processing_jobs where session_id=$1", [a.sessionId])).rows.length, 0);
      assert.equal((await db.query("select * from lantern_audio_uploads where session_id=$1", [a.sessionId])).rows.length, 1);
      await complete(a.sessionId, faultDevice);
    });

    await t.test("owner and credential checks remain enforced on archive completion", async () => {
      const guardedDevice = await device();
      const a = input(guardedDevice);
      await importArchive(a); await archive(a.sessionId, guardedDevice);
      const ready = advanceLantern(prepareOfflineSession(a).machine, { type: "PROCESSING_QUEUED", at: new Date().toISOString() });
      await assert.rejects(db.query("select enqueue_lantern_processing($1,$2,$3,$4,1,$5)", [a.sessionId, other, guardedDevice, randomUUID(), JSON.stringify(ready)]), /not archived/);
      await db.query("update devices set revoked_at=now() where id=$1", [guardedDevice]);
      const before = await row("lantern_sessions", a.sessionId);
      await assert.rejects(complete(a.sessionId, guardedDevice), /unavailable/);
      assert.deepEqual(await row("lantern_sessions", a.sessionId), before);
      assert.equal((await db.query("select * from lantern_processing_jobs where session_id=$1", [a.sessionId])).rows.length, 0);
    });
  } finally { await db.close(); }
});
