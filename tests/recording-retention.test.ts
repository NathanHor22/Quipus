import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { purgeExpiredRecordingAudio,validateRetentionPaths } from "../lib/recording-retention";

const owner="11111111-1111-4111-8111-111111111111";
const object=`${owner}/device/session/audio.wav`;
function mockRetention(options: { path?:string; removalFailure?:boolean; finishFailure?:boolean } = {}) {
  const removed:string[][]=[]; const finished:string[]=[]; const deferred:unknown[]=[];
  const query={ update:(value:unknown)=>{ deferred.push(value);return query; },eq:()=>query,then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({ error:null }).then(resolve) };
  const client={
    rpc:async(name:string,args:Record<string,unknown>)=> name==="claim_recording_audio_deletions"
      ? { data:[{ recording_id:"recording-a",user_id:owner,lease_token:"lease-a",object_paths:[options.path||object] }],error:null }
      : (finished.push(String(args.p_recording_id)),{ data:!options.finishFailure,error:null }),
    from:()=>query,
    storage:{ from:()=>({ remove:async(paths:string[])=>{ removed.push(paths);return { error:options.removalFailure?{}:null }; } }) },
  } as unknown as SupabaseClient;
  return { client,removed,finished,deferred };
}

test("retention validates every object belongs to the original account before deleting", () => {
  assert.deepEqual(validateRetentionPaths([object,object],owner),[object]);
  for (const paths of [["other-owner/audio.wav"],[`${owner}/../other/audio.wav`],[`${owner}/%2e%2e/audio.wav`],[`${owner}\\other.wav`],null]) {
    assert.throws(()=>validateRetentionPaths(paths,owner));
  }
});

test("retention confirms storage deletion before finishing SQL and preserves an auditable ledger", async () => {
  const mock=mockRetention();
  assert.deepEqual(await purgeExpiredRecordingAudio(mock.client),{ deleted:1,deferred:0 });
  assert.deepEqual(mock.removed,[[object]]);assert.deepEqual(mock.finished,["recording-a"]);
  assert.deepEqual(mock.deferred,[]);
});

test("foreign paths, failed storage and lost leases remain retryable instead of reporting success", async () => {
  for (const options of [{path:"foreign/audio.wav"},{removalFailure:true},{finishFailure:true}]) {
    const mock=mockRetention(options);
    assert.deepEqual(await purgeExpiredRecordingAudio(mock.client),{ deleted:0,deferred:1 });
    assert.equal(mock.deferred.length,1);
    if (options.path) assert.deepEqual(mock.removed,[]);
    if (!options.finishFailure) assert.deepEqual(mock.finished,[]);
  }
});
