import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test(
  "PostgreSQL enforces fleet/user limits, recovers expired leases, isolates optional research",
  { timeout: 60000 },
  async () => {
    const db = new PGlite();
    try {
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
      for (const name of (await readdir(directory))
        .filter((name) => name.endsWith(".sql") && name <= "013_dedicated_processing_worker.sql")
        .sort()) {
        await db.exec(
          (await readFile(path.join(directory, name), "utf8")).replace(
            "create extension if not exists pgcrypto;",
            "",
          ),
        );
      }
      const users = [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ];
      for (const [index, user] of users.entries()) {
        await db.query("insert into auth.users(id,email) values($1,$2)", [
          user,
          `owner${index}@example.com`,
        ]);
        const device = (
          await db.query<{ id: string }>(
            "insert into devices(user_id,name,device_state,state_version) values($1,'Test board','ready',0) returning id",
            [user],
          )
        ).rows[0].id;
        for (let session = 0; session < (index === 0 ? 2 : 1); session++) {
          const id = (
            await db.query<{ id: string }>(
              "insert into lantern_sessions(id,user_id,device_id,mode,state,state_version,machine,started_at,ended_at) values(gen_random_uuid(),$1,$2,'quick','ready',0,'{}',now(),now()) returning id",
              [user, device],
            )
          ).rows[0].id;
          await db.query("insert into lantern_processing_jobs(session_id,user_id) values($1,$2)", [
            id,
            user,
          ]);
        }
      }
      const claim = async (user?: string) =>
        (
          await db.query<{ session_id: string; lease_token: string; attempts: number }>(
            "select * from claim_lantern_processing($1,null)",
            [user || null],
          )
        ).rows;
      const first = (await claim(users[0]))[0];
      assert.equal((await claim(users[0])).length, 0, "one owner cannot occupy both slots");
      const second = (await claim(users[1]))[0];
      assert.equal(
        (await claim(users[2])).length,
        0,
        "fleet capacity applies even to another owner",
      );
      await db.query(
        "update lantern_processing_jobs set lease_until=now()-interval '1 minute' where session_id=$1",
        [first.session_id],
      );
      const third = (await claim(users[2]))[0];
      assert.ok(third);
      assert.equal((await claim(users[0])).length, 0, "expired work cannot bypass a full pool");
      await db.query(
        "update lantern_processing_jobs set state='ready',lease_until=null where session_id=$1",
        [second.session_id],
      );
      const recovered = (await claim(users[0]))[0];
      // Either of this owner's queued sessions may be selected; make the expired job oldest explicitly.
      if (recovered.session_id === first.session_id) {
        assert.equal(recovered.attempts, 2);
        assert.notEqual(recovered.lease_token, first.lease_token);
      }
      await db.exec("update lantern_processing_jobs set state='ready',lease_until=null");
      await db.query(
        "update lantern_processing_jobs set state='running',lease_until=now()-interval '1 minute',available_at=now()-interval '1 day' where session_id=$1",
        [first.session_id],
      );
      const retry = (await claim(users[0]))[0];
      assert.equal(retry.session_id, first.session_id);
      assert.notEqual(retry.lease_token, first.lease_token);

      for (const user of [users[0], users[0], users[1]]) {
        await db.query(
          "insert into meetings(user_id,title,start_at,end_at,status) values($1,'Ready meeting',now(),now(),'ready')",
          [user],
        );
      }
      assert.equal((await db.query("select * from quipus_meeting_enrichment_jobs")).rows.length, 3);
      const research1 = (
        await db.query<{ meeting_id: string; user_id: string }>(
          "select * from claim_quipus_meeting_enrichment()",
        )
      ).rows[0];
      const research2 = (
        await db.query<{ meeting_id: string; user_id: string }>(
          "select * from claim_quipus_meeting_enrichment()",
        )
      ).rows[0];
      assert.notEqual(research1.user_id, research2.user_id);
      assert.equal(
        (await db.query("select * from claim_quipus_meeting_enrichment()")).rows.length,
        0,
      );
      await db.exec("update meetings set status='ready'");
      assert.equal(
        (await db.query("select * from quipus_meeting_enrichment_jobs")).rows.length,
        3,
        "ready writes do not duplicate research",
      );
      await db.exec("set role authenticated");
      await assert.rejects(
        db.query("select * from quipus_processing_capacity"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select * from quipus_meeting_enrichment_jobs"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select * from claim_quipus_meeting_enrichment()"),
        /permission denied/,
      );
    } finally {
      await db.close();
    }
  },
);
