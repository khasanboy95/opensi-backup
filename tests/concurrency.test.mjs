import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WorkPool } from '../server/work-pool.mjs';
import { fixture, mockProvider, addProvider, createRun, runState, until } from './helpers.mjs';
import { hash, token, now } from '../server/security.mjs';
import { remoteCommand } from '../server/commands.mjs';
import path from 'node:path';

test('admission rotates owners, enforces limits, cancels queued work and releases once', async () => {
  const pool = new WorkPool(1, 1), first = await pool.acquire('a');
  const order = [];
  const a = pool.acquire('a').then(release => { order.push('a'); release(); release(); });
  const b = pool.acquire('b').then(release => { order.push('b'); release(); });
  const abort = new AbortController();
  const cancelled = pool.acquire('c', abort.signal);
  const rejection = assert.rejects(cancelled); abort.abort(); await rejection;
  first(); await Promise.all([a,b]);
  assert.deepEqual(order,['b','a']); assert.equal(pool.active,0); assert.equal(pool.queue.length,0);
});

test('a user reply releases capacity and resumes through the same cap; cancellation drains queues', async () => {
  const f = await fixture({ maxConcurrent:1 }), mock = await mockProvider();
  try {
    const provider = await addProvider(f,mock);
    const asking = await createRun(f,provider,'_ASK_'); const wait = await runState(f,asking.run.id,'waiting_input');
    assert.equal(f.runner.capacity().executing,0);
    const second = await createRun(f,provider,'_SLOW_'); await runState(f,second.run.id,'running');
    await f.request('/approvals/'+wait.approvals[0].id,{method:'POST',body:{approved:true,answer:'Blue'}});
    await runState(f,asking.run.id,'queued'); assert.equal(f.runner.capacity().executing,1);
    await f.request('/runs/'+second.run.id+'/cancel',{method:'POST',body:{}});
    await runState(f,asking.run.id,'completed');
    await until(()=>f.runner.capacity().executing===0);
    const slow = await createRun(f,provider,'_SLOW_'); await runState(f,slow.run.id,'running');
    const queued = await createRun(f,provider,'never call'); await runState(f,queued.run.id,'queued');
    await f.request('/runs/'+queued.run.id+'/cancel',{method:'POST',body:{}});
    await runState(f,queued.run.id,'cancelled');
    assert.ok(!mock.requests.some(r=>JSON.stringify(r.messages).includes('never call')));
  } finally { await f.close(); await mock.close(); }
});

test('100 authenticated users execute 100 simultaneous model streams with isolated SSE and ownership', {timeout:60000}, async t => {
  const held = []; let peak=0; let active=0;
  const providerServer = http.createServer(async (req,res) => {
    if(req.url.endsWith('/models')) { res.end(JSON.stringify({data:[{id:'qa-model'}]})); return; }
    const chunks=[]; for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks));
    active++; peak=Math.max(peak,active);
    res.writeHead(200,{'content-type':'text/event-stream'}); res.flushHeaders();
    held.push(()=>{res.end(`data: ${JSON.stringify({choices:[{delta:{content:'Completed '+body.messages.at(-1).content},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);active--;});
  });
  await new Promise(r=>providerServer.listen(0,'127.0.0.1',r));
  const f=await fixture(); const streams=[]; const started=Date.now();
  try {
    const provider=await addProvider(f,{base:`http://127.0.0.1:${providerServer.address().port}/v1`,secret:'qa-key'});
    const users=Array.from({length:100},(_,i)=>{
      const user='load-user-'+i,session=token();
      f.store.exec('INSERT INTO users(id,name,google_sub,created_at) VALUES(?,?,?,?)',user,user,user,now());
      f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(session),user,Date.now()+120000);
      return {user,headers:{cookie:`opensi_session=${session}`}};
    });
    const runs=await Promise.all(users.map(async(u,i)=>{
      const result=await f.request('/runs',{method:'POST',headers:u.headers,body:{prompt:'Load user '+i,providerId:provider.id,model:'qa-model',agentId:'developer',environment:'cloud'}});
      assert.equal(result.status,201,JSON.stringify(result.value)); return result.value.run;
    }));
    await until(()=>held.length===100,30000);
    assert.equal(peak,100); assert.equal(f.runner.capacity().executing,100); assert.equal(f.runner.capacity().queued,0);
    await Promise.all(runs.map(async(run,i)=>{
      const stream=await fetch(f.base+'/api/runs/'+run.id+'/events',{headers:users[i].headers});
      assert.equal(stream.status,200); streams.push(stream.body.getReader());
    }));
    assert.equal((await f.request('/runs/'+runs[0].id,{headers:users[1].headers})).status,404);
    const first=await f.request('/me',{headers:users[0].headers});
    const second=await f.request('/me',{headers:users[1].headers});
    // Both users used three authorized endpoints. Their common IP is not their bucket.
    assert.notEqual(first.response.headers.get('ratelimit-policy'),null);
    assert.equal(second.status,200);
    const remaining=response=>Number(response.headers.get('ratelimit').match(/r=(\d+)/)[1]);
    for(let n=0;n<4;n++)await f.request('/me',{headers:users[0].headers});
    const unchanged=await f.request('/me',{headers:users[1].headers});
    assert.equal(remaining(unchanged.response),remaining(second.response)-1);
    held.forEach(finish=>finish());
    await until(()=>f.store.one("SELECT count(*) n FROM runs WHERE status='completed'").n===100,30000);
    await until(()=>f.runner.capacity().executing===0);
    for(let i=0;i<runs.length;i++) {
      const row=f.store.one("SELECT content FROM messages WHERE run_id=? AND role='assistant' ORDER BY id DESC LIMIT 1",runs[i].id);
      assert.ok(JSON.parse(row.content).content.includes('Load user '+i));
    }
    t.diagnostic(JSON.stringify({users:100,simultaneousModelStreams:peak,completed:100,sseStreams:streams.length,elapsedMs:Date.now()-started,rssMB:Math.round(process.memoryUsage().rss/1048576)}));
  } finally {
    await Promise.allSettled(streams.map(reader=>reader.cancel()));
    held.splice(0); await f.close(); providerServer.closeAllConnections(); await new Promise(r=>providerServer.close(r));
  }
});

test('shutdown preserves work that has not acquired an execution slot', async () => {
  const f=await fixture({maxConcurrent:1}),mock=await mockProvider();
  try {
    const provider=await addProvider(f,mock);
    const running=await createRun(f,provider,'_SLOW_');await runState(f,running.run.id,'running');
    const queued=await createRun(f,provider,'run after restart');await runState(f,queued.run.id,'queued');
    await f.runner.close();
    assert.equal(f.store.one('SELECT status FROM runs WHERE id=?',running.run.id).status,'interrupted');
    assert.equal(f.store.one('SELECT status FROM runs WHERE id=?',queued.run.id).status,'queued');
    assert.equal(f.runner.capacity().executing,0);assert.equal(f.runner.capacity().queued,0);
  } finally {await f.close();await mock.close();}
});

test('cloud execution waits in its own pool instead of sending busy jobs to the broker', async () => {
  let active=0,peak=0,total=0;
  const server=http.createServer(async(req,res)=>{
    for await(const _ of req){} active++;peak=Math.max(peak,active);total++;
    setTimeout(()=>{active--;res.end(JSON.stringify({type:'result',exitCode:0,output:'ok'})+'\n');},30);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const config={dataDir:path.resolve('unused-load-fixture'),runnerUrl:`http://127.0.0.1:${server.address().port}`,runnerToken:'qa',maxConcurrentShells:2};
  try {
    const results=await Promise.all(Array.from({length:20},(_,i)=>remoteCommand(config,path.join(config.dataDir,'workspaces','user-'+i,'project-'+i),{command:'test'},undefined)));
    assert.equal(total,20);assert.equal(peak,2);assert.ok(results.every(r=>r.exitCode===0));
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
