import test from 'node:test';
import assert from 'node:assert/strict';
import {browserRequestLimit} from '../server/browser-request-limit.mjs';

test('browser transport bounds simultaneous requests and drains the queue',async()=>{
  const limit=browserRequestLimit(3);
  let current=0,peak=0;
  const result=await Promise.all(Array.from({length:30},(_,i)=>limit.run(async()=>{
    current++;peak=Math.max(peak,current);
    await new Promise(resolve=>setTimeout(resolve,5));
    current--;return i;
  })));
  assert.equal(peak,3);
  assert.deepEqual(result,Array.from({length:30},(_,i)=>i));
  assert.equal(limit.active,0);
  assert.equal(limit.waiting,0);
});

test('closing a browser transport rejects queued work and aborts active work',async()=>{
  const limit=browserRequestLimit(1);
  let started;
  const first=limit.run(signal=>new Promise((_,reject)=>{
    started=()=>{};
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  }));
  assert.equal(typeof started,'function');
  const second=limit.run(()=>Promise.resolve('unexpected'));
  limit.close();
  await assert.rejects(first,/sessiyasi yopilgan/);
  await assert.rejects(second,/sessiyasi yopilgan/);
  assert.equal(limit.active,0);
  assert.equal(limit.waiting,0);
});
