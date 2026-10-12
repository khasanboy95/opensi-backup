import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fixture} from './helpers.mjs';

test('readiness reports missing PDF or shell runtime instead of hiding it behind app health',async()=>{
  const without=await fixture();try{const response=await without.request('/ready');assert.equal(response.status,503);assert.equal(response.value.documents,false);}finally{await without.close();}
  let documentsReady=false;
  const runner=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,runtimeReady:true,documentsReady}));});
  await new Promise(resolve=>runner.listen(0,'127.0.0.1',resolve));
  const connected=await fixture({runnerUrl:`http://127.0.0.1:${runner.address().port}`,runnerToken:'a'.repeat(64)});
  try{
    const incomplete=await connected.request('/ready');assert.equal(incomplete.status,503);assert.equal(incomplete.value.terminal,true);assert.equal(incomplete.value.documents,false);
    documentsReady=true;const ready=await connected.request('/ready');assert.equal(ready.status,200);assert.deepEqual(ready.value,{ok:true,terminal:true,documents:true});
  }finally{await connected.close();runner.closeAllConnections();await new Promise(resolve=>runner.close(resolve));}
});
