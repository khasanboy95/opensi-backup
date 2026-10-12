import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionLifecycle} from '../deploy/computer/lifecycle.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('close during browser launch disposes late process before freeing capacity',async()=>{
 const gate=deferred(),sessions=new Map();let disposed=0,prepared=0;
 const lifecycle=sessionLifecycle({sessions,limit:1,launch:()=>gate.promise,prepare:async()=>{prepared++;},dispose:async()=>{disposed++;}});
 const opening=lifecycle.open('a');const rejected=assert.rejects(opening,/cancelled/);
 const closing=lifecycle.close('a');assert.equal(sessions.size,1);
 await assert.rejects(lifecycle.open('b'),/band/);
 gate.resolve({pid:42});await closing;await rejected;
 assert.equal(disposed,1);assert.equal(prepared,0);assert.equal(sessions.size,0);
});

test('duplicate opens share launch; concurrent closes dispose once',async()=>{
 const gate=deferred(),sessions=new Map();let launches=0,disposed=0;
 const lifecycle=sessionLifecycle({sessions,launch:async()=>{launches++;return {};},prepare:()=>gate.promise,dispose:async()=>{disposed++;}});
 const first=lifecycle.open('a'),second=lifecycle.open('a');
 gate.resolve({title:'ready'});assert.deepEqual(await first,await second);assert.equal(launches,1);
 await Promise.all([lifecycle.close('a'),lifecycle.close('a')]);assert.equal(disposed,1);assert.equal(sessions.size,0);
});

test('failed browser preparation tears down process and permits retry',async()=>{
 const sessions=new Map();let disposed=0;
 const lifecycle=sessionLifecycle({sessions,launch:async()=>({}),prepare:async()=>{throw new Error('newPage stalled');},dispose:async()=>{disposed++;}});
 await assert.rejects(lifecycle.open('a'),/stalled/);await assert.rejects(lifecycle.open('a'),/stalled/);
 assert.equal(disposed,2);assert.equal(sessions.size,0);
});
