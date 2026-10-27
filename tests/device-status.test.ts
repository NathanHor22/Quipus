import assert from 'node:assert/strict';
import test from 'node:test';
import { isActiveDevice, selectActiveDevice } from '../lib/device-status';
import { isRecorderOnline } from '../lib/recorder-bluetooth';

test('revoked history ahead of an active recorder never completes account setup', () => {
 const active={id:'new',revoked_at:null,reset:null,status:'offline'};
 const revoked={id:'old',revoked_at:'2026-10-27T00:00:00Z',reset:null,status:'offline'};
 assert.equal(selectActiveDevice([revoked,active]),active);
 assert.equal(selectActiveDevice([revoked]),null);
});

test('reset states are excluded even when an inconsistent payload omits revocation', () => {
 for(const state of ['pending','completed','recovery_required'])
   assert.equal(isActiveDevice({reset:{state}}),false);
 assert.equal(isActiveDevice({}),true,'Older active-device payloads remain compatible');
 assert.equal(selectActiveDevice([]),null);
});

test('a fresh Bluetooth heartbeat from revoked hardware is not pairing success', () => {
 const started=Date.now();
 const heartbeat={hardware_id:'esp32s3:80456b35b7dc',status:'online',last_seen_at:new Date(started).toISOString()};
 assert.equal(isRecorderOnline(heartbeat,heartbeat.hardware_id,started),true);
 assert.equal(isRecorderOnline({...heartbeat,revoked_at:new Date(started).toISOString()},heartbeat.hardware_id,started),false);
 assert.equal(isRecorderOnline({...heartbeat,reset:{state:'pending'}},heartbeat.hardware_id,started),false);
});
