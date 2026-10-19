import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { migratedDatabase } from "./helpers/database";

test("the deliverable SQL upgrades schema 012 to the complete new schema", {timeout:60_000}, async()=>{
  const db=await migratedDatabase(12);
  try {
    assert.equal((await db.query<{name:string|null}>("select to_regclass('public.recording_audio_sources')::text as name")).rows[0].name,null);
    await db.exec(await readFile("output/quipus-upgrade/upgrade-013-019.sql","utf8"));
    const tables=["quipus_processing_capacity","contact_research_candidates","recording_audio_deletions","meeting_preparations","recording_audio_sources","recording_audio_derivatives","device_transfers"];
    for (const name of tables) {
      const result=await db.query<{name:string|null}>("select to_regclass($1)::text as name",["public."+name]);
      assert.ok(result.rows[0].name,name);
    }
  } finally { await db.close(); }
});
