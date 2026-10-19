import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test(
  "relationship migration isolates private context and serialises profile confirmation",
  { timeout: 60_000 },
  async () => {
    const db = new PGlite();
    const owner = "11111111-1111-4111-8111-111111111111",
      other = "22222222-2222-4222-8222-222222222222";
    const person = "33333333-3333-4333-8333-333333333333",
      foreign = "44444444-4444-4444-8444-444444444444";
    const candidate = "55555555-5555-4555-8555-555555555555",
      second = "66666666-6666-4666-8666-666666666666";
    try {
      await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated;
      create table profiles(id uuid primary key);
      create table contacts(id uuid primary key,user_id uuid references profiles(id));
      create table meetings(id uuid primary key,user_id uuid references profiles(id));
      create table commitments(id uuid primary key,user_id uuid references profiles(id));`);
      await db.exec(await readFile("supabase/migrations/014_people_relationships.sql", "utf8"));
      await db.query("insert into profiles(id) values($1),($2)", [owner, other]);
      await db.query("insert into contacts(id,user_id) values($1,$2),($3,$4)", [
        person,
        owner,
        foreign,
        other,
      ]);
      await assert.rejects(
        db.query(
          "insert into contact_private_notes(contact_id,user_id,body) values($1,$2,'wrong owner')",
          [foreign, owner],
        ),
        /foreign key/i,
      );
      await db.query(
        "insert into contact_private_notes(contact_id,user_id,body) values($1,$2,'private reminder'),($3,$4,'other reminder')",
        [person, owner, foreign, other],
      );
      await db.query(
        "insert into contact_research_candidates(id,user_id,contact_id,url,title,snippet) values($1,$2,$3,'https://www.linkedin.com/in/alex/','Alex','Public role'),($4,$2,$3,'https://www.linkedin.com/in/another/','Another','Public role')",
        [candidate, owner, person, second],
      );
      await assert.rejects(
        db.query("select decide_contact_research($1,$2,$3,'confirmed')", [
          other,
          person,
          candidate,
        ]),
        /not found/i,
      );
      await db.query("select decide_contact_research($1,$2,$3,'confirmed')", [
        owner,
        person,
        candidate,
      ]);
      await db.query("select decide_contact_research($1,$2,$3,'confirmed')", [
        owner,
        person,
        second,
      ]);
      assert.deepEqual(
        (await db.query("select id from contact_research_candidates where status='confirmed'"))
          .rows,
        [{ id: second }],
      );
      await db.exec("set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
      assert.deepEqual((await db.query("select body from contact_private_notes")).rows, [
        { body: "private reminder" },
      ]);
      await assert.rejects(
        db.query("update contact_private_notes set body='tampered'"),
        /permission denied/i,
      );
      await assert.rejects(
        db.query("select decide_contact_research($1,$2,$3,'confirmed')", [
          owner,
          person,
          candidate,
        ]),
        /permission denied/i,
      );
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
      assert.deepEqual((await db.query("select body from contact_private_notes")).rows, [
        { body: "other reminder" },
      ]);
      assert.equal((await db.query("select * from contact_research_candidates")).rows.length, 0);
    } finally {
      await db.close();
    }
  },
);
