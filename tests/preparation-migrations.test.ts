import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test(
  "preparation updates preserve concurrent checklist items and reject cross-account meetings",
  { timeout: 60_000 },
  async () => {
    const db = new PGlite();
    const owner = "11111111-1111-4111-8111-111111111111",
      other = "22222222-2222-4222-8222-222222222222",
      meeting = "33333333-3333-4333-8333-333333333333";
    try {
      await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table provider_connections(id uuid primary key);
      create table profiles(id uuid primary key);create table contacts(id uuid primary key,user_id uuid references profiles(id));
      create table meetings(id uuid primary key,user_id uuid references profiles(id));create table commitments(id uuid primary key,user_id uuid references profiles(id));
      grant usage on schema public,auth to authenticated;grant select on meetings to authenticated;`);
      await db.exec(await readFile("supabase/migrations/014_people_relationships.sql", "utf8"));
      await db.exec(
        await readFile("supabase/migrations/016_calendar_connection_and_preparation.sql", "utf8"),
      );
      await db.query("insert into auth.users values($1),($2)", [owner, other]);
      await db.query("insert into profiles values($1),($2)", [owner, other]);
      await db.query("insert into meetings values($1,$2)", [meeting, owner]);
      const derived = [
        { id: "bring-demo", completed: false, sourceQuote: "Bring demo" },
        { id: "check-supervisor", completed: false, sourceQuote: "Check with supervisor" },
      ];
      await db.query("select toggle_meeting_preparation_requirement($1,$2,'bring-demo',true,$3)", [
        owner,
        meeting,
        JSON.stringify(derived),
      ]);
      const updated = await db.query<{ result: Array<{ id: string; completed: boolean }> }>(
        "select toggle_meeting_preparation_requirement($1,$2,'check-supervisor',true,$3) as result",
        [owner, meeting, JSON.stringify(derived)],
      );
      assert.equal(
        updated.rows[0].result.every((item) => item.completed),
        true,
      );
      await assert.rejects(
        db.query("select toggle_meeting_preparation_requirement($1,$2,'bring-demo',true,$3)", [
          other,
          meeting,
          JSON.stringify(derived),
        ]),
        /not found/i,
      );
      await assert.rejects(
        db.query("insert into meeting_preparations(user_id,meeting_id) values($1,$2)", [
          other,
          meeting,
        ]),
        /foreign key/i,
      );
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
      assert.equal((await db.query("select * from meeting_preparations")).rows.length, 0);
      await assert.rejects(
        db.query("select toggle_meeting_preparation_requirement($1,$2,'bring-demo',true,$3)", [
          owner,
          meeting,
          JSON.stringify(derived),
        ]),
        /permission denied/i,
      );
    } finally {
      await db.close();
    }
  },
);
