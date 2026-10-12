import test from 'node:test';
import assert from 'node:assert/strict';
import {progressSender} from '../connector/progress.mjs';

test('connector preserves stream order while batching tiny chunks and draining before the result', async()=>{
  const sent=[];const sender=progressSender(async text=>{await new Promise(r=>setTimeout(r,2));sent.push(text);});
  const chunks=Array.from({length:1000},(_,i)=>JSON.stringify({text:`part-${i}`})+'\n');
  chunks.forEach(text=>sender.push(text));
  await sender.flush();
  assert.equal(sent.join(''),chunks.join(''));
  assert.ok(sent.length<10);
  assert.ok(sent.every(text=>text.length<=8192));
  sender.push('last');await sender.flush();assert.equal(sent.at(-1),'last');
});
