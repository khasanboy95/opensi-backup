import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fixture, mockProvider, addProvider, createRun, runState, until, tempDir, removeTemp } from './helpers.mjs';
import { hash, token, now } from '../server/security.mjs';
import { startConnector } from '../connector/index.mjs';

test('provider discovery, real tool loop, preview isolation, persisted files and exact usage', async () => {
  const f=await fixture(); const mock=await mockProvider();
  try {
    const provider=await addProvider(f,mock); const stored=f.store.one('SELECT secret FROM providers WHERE id=?',provider.id); assert.ok(!stored.secret.includes(mock.secret)); assert.ok(!JSON.stringify((await f.request('/providers')).value).includes(mock.secret));
    const {run,project}=await createRun(f,provider,'_STATIC_ Portfolio sayt'); const result=await runState(f,run.id,'completed');
    assert.equal(result.usage.input,46); assert.equal(result.usage.output,22); assert.equal(result.usage.unknown,0);
    const files=await f.request(`/projects/${project.id}/files`); assert.deepEqual(files.value.files.map(file=>file.path),['index.html','style.css']);
    const content=await f.request(`/projects/${project.id}/file?path=index.html`); assert.ok(content.value.content.includes('Raqamli tajribalar'));
    const preview=await f.request(`/projects/${project.id}/preview`); const response=await fetch(f.base+preview.value.url); assert.equal(response.status,200); assert.ok(response.headers.get('content-security-policy').includes('sandbox allow-scripts')); assert.equal(response.headers.get('access-control-allow-origin'),'*');
    const traversal=await fetch(f.base+preview.value.url.replace(/index.html$/,'.master-key')); assert.ok([400,404].includes(traversal.status));
    const overview=(await f.request('/admin/overview')).value; assert.equal(overview.runsCount,1); assert.equal(overview.usage.input,46); assert.equal(overview.usersCount,0);
    assert.ok(result.messages.some(message=>message.role==='assistant'));
  } finally { await f.close(); await mock.close(); }
});
test('missing usage remains explicitly unknown without fabricated token counts', async () => {
  const f=await fixture(); const mock=await mockProvider(); try { const provider=await addProvider(f,mock); const {run}=await createRun(f,provider,'_MISSING_USAGE_'); const result=await runState(f,run.id,'completed'); assert.deepEqual(result.usage,{input:0,output:0,unknown:1}); } finally { await f.close(); await mock.close(); }
});
test('provider balance failure and truncated stream fail honestly with secrets redacted', async () => {
  const f=await fixture(); const mock=await mockProvider(); try { const provider=await addProvider(f,mock); const first=await createRun(f,provider,'_HTTP_ERROR_'); const failed=await runState(f,first.run.id,'failed'); assert.ok(failed.run.error.includes('402')); assert.ok(!failed.run.error.includes(mock.secret)); const second=await createRun(f,provider,'_BROKEN_STREAM_'); const broken=await runState(f,second.run.id,'failed'); assert.ok(broken.run.error.includes('uzildi')); } finally { await f.close(); await mock.close(); }
});
test('agent questions wait for a real user response and can resume', async () => {
  const f=await fixture(); const mock=await mockProvider(); try { const provider=await addProvider(f,mock); const {run}=await createRun(f,provider,'_ASK_'); const waiting=await runState(f,run.id,'waiting_input'); assert.equal(waiting.approvals.length,1); assert.equal(mock.requests.length,1); await f.request('/approvals/'+waiting.approvals[0].id,{method:'POST',body:{approved:true,answer:'Yashil'}}); await runState(f,run.id,'completed'); assert.ok(mock.requests[1].messages.some(message=>message.role==='tool'&&message.content.includes('Yashil'))); } finally { await f.close(); await mock.close(); }
});
test('cancelling a waiting task expires its approval and prevents resume', async () => {
  const f=await fixture(); const mock=await mockProvider(); try { const provider=await addProvider(f,mock); const {run}=await createRun(f,provider,'_ASK_'); const waiting=await runState(f,run.id,'waiting_input'); await f.request('/runs/'+run.id+'/cancel',{method:'POST',body:{}}); await runState(f,run.id,'cancelled'); const later=await f.request('/approvals/'+waiting.approvals[0].id,{method:'POST',body:{approved:true,answer:'Late'}}); assert.equal(later.status,409); assert.equal(mock.requests.length,1); } finally { await f.close(); await mock.close(); }
});
test('a running stream is aborted when the user cancels', async () => {
  const f=await fixture(); const mock=await mockProvider(); try { const provider=await addProvider(f,mock); const {run}=await createRun(f,provider,'_SLOW_'); await runState(f,run.id,'running'); await f.request('/runs/'+run.id+'/cancel',{method:'POST',body:{}}); await runState(f,run.id,'cancelled'); } finally { await f.close(); await mock.close(); }
});
test('delegated agents execute tools and account for every model call', async () => {
  const f=await fixture(); const mock=await mockProvider(); try { const provider=await addProvider(f,mock); const {run,project}=await createRun(f,provider,'_DELEGATE_'); const result=await runState(f,run.id,'completed'); assert.ok(result.events.some(event=>event.type==='agent_start'&&event.data.agent==='Dizayner')); assert.ok((await f.request(`/projects/${project.id}/file?path=child.css`)).value.content.includes('#223344')); assert.equal(result.usage.input,92); assert.equal(result.usage.output,44); } finally { await f.close(); await mock.close(); }
});
test('models cannot call tools outside their declared permissions', async () => {
  const f=await fixture(); const mock=await mockProvider(); try { const provider=await addProvider(f,mock); const {run}=await createRun(f,provider,'_UNSUPPORTED_'); const result=await runState(f,run.id,'failed'); assert.ok(result.run.error.includes('ruxsat etilmagan')); } finally { await f.close(); await mock.close(); }
});
test('projects and run details are isolated by the authenticated account', async () => {
  const f=await fixture(); const mock=await mockProvider(); try { const provider=await addProvider(f,mock); const {run,project}=await createRun(f,provider,'_STATIC_'); await runState(f,run.id,'completed'); const session=token(); f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)','other-user','Other user','user',now()); f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(session),'other-user',Date.now()+60000); const headers={cookie:`opensi_session=${session}`}; assert.equal((await f.request(`/runs/${run.id}`,{headers})).status,404); assert.equal((await f.request(`/projects/${project.id}/file?path=index.html`,{headers})).status,404); assert.equal((await f.request('/runs',{headers})).value.length,0); assert.equal((await f.request('/providers',{method:'POST',body:{label:'forbidden',baseUrl:mock.base},headers})).status,403); } finally { await f.close(); await mock.close(); }
});
test('pair codes are one use; local connector writes actual files and terminal requires approval', async () => {
  const f=await fixture(); const mock=await mockProvider(); const workspace=await tempDir(); const stateDir=await tempDir(); const stop=new AbortController(); let connector;
  try {
    const provider=await addProvider(f,mock); const paired=(await f.request('/nodes/pair-code',{method:'POST',body:{}})).value;
    connector=startConnector({server:f.base,code:paired.code,workspace,stateDir,name:'QA computer',signal:stop.signal,quiet:true});
    const node=await until(async()=>f.nodes.list('local-owner')[0]); assert.equal(node.online,true);
    const duplicate=await f.request('/connector/pair',{method:'POST',body:{code:paired.code,name:'duplicate',platform:'test',workspace:'test'}}); assert.equal(duplicate.status,401);
    const {run,project}=await createRun(f,provider,'_STATIC_', {environment:'local',nodeId:node.id}); await runState(f,run.id,'completed');
    assert.ok((await readFile(path.join(workspace,project.id,'index.html'),'utf8')).includes('Raqamli tajribalar'));
    const next=await createRun(f,provider,'_COMMAND_', {environment:'local',nodeId:node.id,projectId:project.id}); const waiting=await runState(f,next.run.id,'waiting_approval');
    assert.equal(f.store.one("SELECT count(*) AS n FROM commands WHERE run_id=? AND tool='run_command'",next.run.id).n,0);
    await f.request('/approvals/'+waiting.approvals[0].id,{method:'POST',body:{approved:true}}); const finished=await runState(f,next.run.id,'completed');
    const output=finished.events.find(event=>event.type==='tool_result'&&event.data.tool==='run_command'); assert.equal(output.data.result.exitCode,0); assert.equal(output.data.result.output,undefined); assert.equal(finished.live.terminals.at(-1).output,'LOCAL_COMMAND_OK');
    await f.request('/nodes/'+node.id+'/revoke',{method:'POST',body:{}}); assert.equal(f.nodes.list('local-owner')[0].online,false);
    const tokenFile=JSON.parse(await readFile(path.join(stateDir,'connection.json'),'utf8')); assert.ok(!JSON.stringify((await f.request('/nodes')).value).includes(tokenFile.token));
  } finally { stop.abort(); await connector?.catch(()=>{}); await f.close(); await mock.close(); await removeTemp(workspace); await removeTemp(stateDir); }
});
test('denied terminal commands never reach the connector', async () => {
  const f=await fixture({dockerEnabled:true}); const mock=await mockProvider(); try { const provider=await addProvider(f,mock); const {run}=await createRun(f,provider,'_COMMAND_'); const waiting=await runState(f,run.id,'waiting_approval'); await f.request('/approvals/'+waiting.approvals[0].id,{method:'POST',body:{approved:false}}); const result=await runState(f,run.id,'completed'); assert.ok(result.events.some(event=>event.type==='tool_result'&&event.data.result.denied)); } finally { await f.close(); await mock.close(); }
});
test('token quota prevents a new model call before it is sent', async () => {
  const f=await fixture(); const mock=await mockProvider(); try { const provider=await addProvider(f,mock); f.store.exec("UPDATE users SET token_limit=0 WHERE id='local-owner'"); const {run}=await createRun(f,provider,'quota-test'); const result=await runState(f,run.id,'failed'); assert.ok(result.run.error.includes('token chegarasi')); assert.equal(mock.requests.length,0); } finally { await f.close(); await mock.close(); }
});

test('unlimited quota is explicit, admin-only and keeps counting usage above any finite cap',async()=>{
  const f=await fixture(),mock=await mockProvider();
  try{
    f.store.exec("UPDATE users SET google_sub='quota-test-owner' WHERE id='local-owner'");
    const provider=await addProvider(f,mock);const first=await createRun(f,provider,'Usage baseline');await runState(f,first.run.id,'completed');
    f.store.exec('UPDATE usage SET input_tokens=2000000000 WHERE run_id=?',first.run.id);
    const before=f.store.one("SELECT SUM(input_tokens+output_tokens) AS tokens FROM usage WHERE user_id='local-owner'").tokens;
    assert.equal((await f.request('/admin/users/local-owner',{method:'PATCH',body:{tokenLimit:-2}})).status,400);
    assert.equal((await f.request('/admin/users/local-owner',{method:'PATCH',body:{tokenLimit:-1}})).status,200);
    assert.equal((await f.request('/me')).value.user.token_limit,-1);
    const second=await createRun(f,provider,'Unlimited quota test');await runState(f,second.run.id,'completed');
    assert.equal(mock.requests.length,2);
    assert.equal(f.store.one("SELECT SUM(input_tokens+output_tokens) AS tokens FROM usage WHERE user_id='local-owner'").tokens,before+34);
    const session=token();f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)','quota-other','Other','user',now());f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(session),'quota-other',Date.now()+60000);
    assert.equal((await f.request('/admin/users/local-owner',{method:'PATCH',body:{tokenLimit:0},headers:{cookie:`opensi_session=${session}`}})).status,403);
    assert.equal(f.store.one("SELECT token_limit FROM users WHERE id='quota-other'").token_limit,1000000);
  }finally{await f.close();await mock.close();}
});
