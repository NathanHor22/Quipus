import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("real PostgreSQL migrations preserve archives, isolate queues, and atomically enqueue owner delivery", { timeout: 60000 }, async () => {
  const db = new PGlite();
  try {
    // Supabase-managed schemas/roles are simulated locally. All application
    // migrations run unchanged except pgcrypto (gen_random_uuid is built in).
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
      grant usage on schema public,auth to authenticated;
    `);
    const directory = path.join(process.cwd(), "supabase/migrations");
    for (const filename of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) {
      const sql = (await readFile(path.join(directory, filename), "utf8")).replace("create extension if not exists pgcrypto;", "");
      await db.exec(sql);
    }
    const user = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
    const device = "33333333-3333-4333-8333-333333333333", session = "44444444-4444-4444-8444-444444444444";
    const audio = "55555555-5555-4555-8555-555555555555", complete = "66666666-6666-4666-8666-666666666666";
    assert.deepEqual((await db.query("select file_size_limit from storage.buckets where id='recordings'")).rows, [{ file_size_limit: 268435456 }]);
    await db.query("insert into auth.users(id,email) values($1,'owner@example.com'),($2,'other@example.com')", [user, other]);
    await db.query("insert into devices(id,user_id,name,device_state,state_version) values($1,$2,'Test board','finalising',3)", [device,user]);
    await db.query(`insert into lantern_sessions(id,user_id,device_id,mode,state,state_version,machine,started_at)
      values($1,$2,$3,'quick','finalising',3,$4,now())`, [session,user,device,JSON.stringify({ state:"finalising",version:3,recordingStartedAt:"2026-09-21T01:00:00Z" })]);
    const ready = JSON.stringify({state:"ready",version:4,sessionId:null});
    await assert.rejects(db.query("select enqueue_lantern_processing($1,$2,$3,$4,3,$5)", [session,user,device,complete,ready]), /not archived/);
    await db.query("insert into lantern_audio_uploads(session_id,event_id,storage_path,total_bytes,sha256) values($1,$2,$3,9600044,$4)", [session,audio,`${user}/device/${session}/${audio}.wav`,"a".repeat(64)]);
    await assert.rejects(db.query("select attach_lantern_direct_audio($1,$2,$3)", [session,other,device]), /not found/);
    await db.query("select attach_lantern_direct_audio($1,$2,$3)", [session,user,device]);
    await db.query("select attach_lantern_direct_audio($1,$2,$3)", [session,user,device]);
    assert.deepEqual((await db.query("select duration_seconds from recordings")).rows, [{duration_seconds:300}]);
    await assert.rejects(db.query("select enqueue_lantern_processing($1,$2,$3,$4,99,$5)", [session,user,device,complete,ready]), /state changed/);
    assert.equal((await db.query("select * from lantern_processing_jobs")).rows.length, 0);
    await db.query("select enqueue_lantern_processing($1,$2,$3,$4,3,$5)", [session,user,device,complete,ready]);
    await db.query("select enqueue_lantern_processing($1,$2,$3,$4,3,$5)", [session,user,device,complete,ready]);
    assert.equal((await db.query("select * from lantern_processing_jobs")).rows.length, 1);
    assert.equal((await db.query<{ device_state: string }>("select device_state from devices where id=$1",[device])).rows[0].device_state,"ready");
    assert.equal((await db.query<{ ended: boolean; captured: string }>("select ended_at is not null as ended,recording_started_at::text as captured from lantern_sessions where id=$1",[session])).rows[0].ended,true);
    assert.equal((await db.query("select * from claim_lantern_processing($1,null)",[other])).rows.length,0);
    const claimed = (await db.query<{ attempts: number; lease_token: string }>("select * from claim_lantern_processing()" )).rows[0];
    assert.equal(claimed.attempts,1);
    assert.equal((await db.query("select * from claim_lantern_processing()")).rows.length,0);
    await db.exec("update lantern_processing_jobs set lease_until=now()-interval '1 minute'");
    const reclaimed = (await db.query<{ attempts: number; lease_token: string }>("select * from claim_lantern_processing()")).rows[0];
    assert.equal(reclaimed.attempts,2); assert.notEqual(reclaimed.lease_token,claimed.lease_token);
    await db.query("update devices set device_state='recording',state_version=6 where id=$1",[device]);
    await db.exec("update lantern_processing_jobs set state='ready'");
    assert.equal((await db.query<{ device_state: string }>("select device_state from devices")).rows[0].device_state,"recording");
    await db.exec("update lantern_processing_jobs set state='failed',attempts=3");
    await assert.rejects(db.query("select retry_lantern_processing($1,$2)",[audio,other]), /not found/);
    assert.equal((await db.query<{ id: string | null }>("select retry_lantern_processing($1,$2) as id",[audio,user])).rows[0].id, session);
    assert.deepEqual((await db.query("select state,attempts from lantern_processing_jobs")).rows,[{state:"queued",attempts:0}]);
    assert.equal((await db.query<{ id: string | null }>("select retry_lantern_processing($1,$2) as id",[audio,user])).rows[0].id,null);
    assert.equal((await db.query<{ device_state: string }>("select device_state from devices")).rows[0].device_state,"recording");

    await db.query("insert into meeting_delivery_preferences(user_id,phone,enabled) values($1,'60123456789',true)",[user]);
    const meeting = "77777777-7777-4777-8777-777777777777";
    await db.query("insert into meetings(id,user_id,title,start_at,end_at,status,source,recording_id) values($1,$2,'Test meeting',now(),now(),'processing','hardware',$3)",[meeting,user,audio]);
    await db.query("insert into meeting_evidence(user_id,meeting_id,category,statement,speaker,start_seconds,end_seconds,quote,confidence,importance) values($1,$2,'need','Needs a pilot','Speaker 1',1,2,'We need a pilot',0.95,5)",[user,meeting]);
    await db.query("insert into meeting_research_sources(user_id,meeting_id,company,title,url,snippet) values($1,$2,'Acme','Acme official','https://example.com','Public company context')",[user,meeting]);
    assert.equal((await db.query("select * from meeting_evidence")).rows.length,1);
    assert.equal((await db.query("select * from meeting_research_sources")).rows.length,1);
    assert.equal((await db.query("select * from meeting_deliveries")).rows.length,0);
    await db.query("update meetings set status='ready' where id=$1",[meeting]);
    await db.query("update meetings set status='ready' where id=$1",[meeting]);
    assert.equal((await db.query("select * from meeting_deliveries")).rows.length,1);
    await db.exec("update meeting_delivery_preferences set enabled=false");
    assert.equal((await db.query("select * from claim_meeting_delivery()")).rows.length,0);
    await db.exec("update meeting_delivery_preferences set enabled=true");
    assert.equal((await db.query("select * from claim_meeting_delivery()")).rows.length,1);
    assert.equal((await db.query("select * from claim_meeting_delivery()")).rows.length,0);
    await db.query("insert into meetings(user_id,title,start_at,end_at,status) values($1,'Unsubscribed owner',now(),now(),'ready')",[other]);
    assert.equal((await db.query("select * from meeting_deliveries")).rows.length,1);

    // Retention is a storage-first, lease-protected operation. It keeps meeting
    // history, and the public role cannot operate the privileged deletion queue.
    const phone = "88888888-8888-4888-8888-888888888888";
    const derivedPath = `${user}/device/${session}/99999999-9999-4999-8999-999999999999.wav`;
    const lateDerivedPath = `${user}/device/${session}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.wav`;
    const phonePath = `${user}/device/${session}/${phone}.wav`;
    await db.query(`insert into recording_audio_sources(id,user_id,session_id,recording_id,source_kind,storage_path,byte_length,sha256,timing_manifest,committed_at,verified_at)
      values($1,$2,$3,$4,'phone',$5,32044,$6,'{}',now(),now())`,[phone,user,session,audio,phonePath,"b".repeat(64)]);
    await db.query(`insert into recording_audio_derivatives(user_id,recording_id,version,storage_path,byte_length,sha256)
      values($1,$2,'test-v1',$3,32044,$4)`,[user,audio,derivedPath,"c".repeat(64)]);
    await db.query("update recordings set audio_retention_at=now()-interval '91 days',consolidated_storage_path=$2 where id=$1",[audio,derivedPath]);
    await db.exec("update lantern_processing_jobs set state='running',lease_until=now()+interval '1 minute'");
    assert.equal((await db.query("select * from claim_recording_audio_deletions(20)")).rows.length,0);
    await db.exec("update lantern_processing_jobs set state='queued',lease_until=null");
    const deletion = (await db.query<{ recording_id:string; lease_token:string; object_paths:string[] }>("select * from claim_recording_audio_deletions(20)")).rows[0];
    assert.equal(deletion.recording_id,audio);
    assert.deepEqual(new Set(deletion.object_paths),new Set([`${user}/device/${session}/${audio}.wav`,phonePath,derivedPath]));
    assert.equal((await db.query("select * from claim_recording_audio_deletions(20)")).rows.length,0);
    assert.deepEqual((await db.query("select finish_recording_audio_deletion($1,gen_random_uuid()) as finished",[audio])).rows,[{finished:false}]);
    // A late derivative cannot be forgotten by a previously claimed snapshot.
    await db.query(`insert into recording_audio_derivatives(user_id,recording_id,version,storage_path,byte_length,sha256)
      values($1,$2,'test-v2',$3,32044,$4)`,[user,audio,lateDerivedPath,"d".repeat(64)]);
    await assert.rejects(db.query("select finish_recording_audio_deletion($1,$2)",[audio,deletion.lease_token]), /manifest changed/);
    assert.equal((await db.query<{audio_deleted_at:string|null}>("select audio_deleted_at from recordings where id=$1",[audio])).rows[0].audio_deleted_at,null);
    await db.exec("update recording_audio_deletions set state='pending',lease_until=null,available_at=now()");
    const refreshed = (await db.query<{ lease_token:string; object_paths:string[] }>("select * from claim_recording_audio_deletions(20)")).rows[0];
    assert.ok(refreshed.object_paths.includes(lateDerivedPath));
    assert.deepEqual((await db.query("select finish_recording_audio_deletion($1,$2) as finished",[audio,refreshed.lease_token])).rows,[{finished:true}]);
    assert.equal((await db.query("select * from recording_audio_sources")).rows.length,0);
    assert.equal((await db.query("select * from recording_audio_derivatives")).rows.length,0);
    assert.equal((await db.query("select * from meetings where id=$1",[meeting])).rows.length,1);
    assert.deepEqual((await db.query("select storage_path,audio_deleted_at is not null as deleted from recordings where id=$1",[audio])).rows,[{storage_path:null,deleted:true}]);
    assert.equal((await db.query("select * from security_audit_events where event_type='audio_deleted'")).rows.length,1);

    await db.exec("grant select on lantern_sessions to authenticated; set role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
    assert.equal((await db.query("select * from lantern_sessions")).rows.length,0);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
    assert.equal((await db.query("select * from lantern_sessions")).rows.length,1);
    await assert.rejects(db.query("select * from lantern_audio_uploads"), /permission denied/);
    await assert.rejects(db.query("select * from security_audit_events"), /permission denied/);
    await assert.rejects(db.query("select * from claim_recording_audio_deletions(20)"), /permission denied/);
    await assert.rejects(db.query("select * from device_voice_prompts"), /permission denied/);
    await assert.rejects(db.query("select * from device_report_sessions"), /permission denied/);
    await assert.rejects(db.query("select * from claim_meeting_delivery()"), /permission denied/);
    await assert.rejects(db.query("select * from claim_lantern_processing()"), /permission denied/);
    await assert.rejects(db.query("select retry_lantern_processing($1,$2)",[audio,user]), /permission denied/);
  } finally { await db.close(); }
});
