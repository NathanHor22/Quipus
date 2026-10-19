import { PGlite } from "@electric-sql/pglite";
import { readFile,readdir } from "node:fs/promises";
import path from "node:path";

/** A local PostgreSQL instance with only Supabase-managed primitives simulated. */
export async function migratedDatabase(through = Number.POSITIVE_INFINITY) {
  const db=new PGlite();
  try {
    await db.exec(
      "create role anon;create role authenticated;create role service_role bypassrls;" +
      "create schema auth;create schema storage;" +
      "create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');" +
      "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;" +
      "create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;" +
      "create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);" +
      "create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);" +
      "create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;" +
      "grant usage on schema public,auth to authenticated;"
    );
    const directory=path.join(process.cwd(),"supabase/migrations");
    for(const file of (await readdir(directory)).filter(name=>name.endsWith(".sql") && Number.parseInt(name,10) <= through).sort()) {
      const sql=(await readFile(path.join(directory,file),"utf8")).replace(/create extension if not exists pgcrypto;/giu,"");
      await db.exec(sql);
    }
    return db;
  } catch(error) { await db.close();throw error; }
}
