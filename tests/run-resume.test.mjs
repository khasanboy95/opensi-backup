import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,createRun,runState,until,tempDir,removeTemp} from './helpers.mjs';
import {resultDelivery} from '../connector/delivery.mjs';
import {nativeMemory} from '../connector/native-memory.mjs';
import {connectionFailure} from '../server/run-recovery.mjs';
import {token,hash,now} from '../server/security.mjs';
import {createApp} from '../server/app.mjs';

const call=(id,name,args)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
async function provider(f,handle){
 const requests=[];const server=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url.endsWith('/models')){res.end(JSON.stringify({data:[{id:'qa-model'}]}));return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
  const value=await handle(requests.length,body);if(value.status){res.writeHead(value.status);res.end(JSON.stringify({error:value.error||'test error'}));return;}
  res.end(JSON.stringify({choices:[{message:value,finish_reason:value.tool_calls?'tool_calls':'stop'}]}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const added=await f.request('/providers',{method:'POST',body:{label:'Resume QA',baseUrl:`http://127.0.0.1:${server.address().port}/v1`}});assert.equal(added.status,200);
 return {value:added.value,requests,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
const saved=()=>({role:'assistant',content:null,tool_calls:[call('initial','write_file',{path:'progress.txt',content:'START\n'}),call('append','append_file',{path:'progress.txt',content:'ONCE\n'})]});

test('resume reuses the original run, history and files; duplicate clicks and completed writes are not replayed',async()=>{
 const f=await fixture();const p=await provider(f,n=>n===1?saved():n===2?{status:400,error:'invalid_request'}:n===3?{role:'assistant',tool_calls:[call('repeat','append_file',{path:'progress.txt',content:'ONCE\n'}),call('next','write_file',{path:'finished.txt',content:'continued'})]}:{role:'assistant',content:'Done from saved state'});
 try{
  const {run,project}=await createRun(f,p.value,'Continue the multi-step project');await runState(f,run.id,'failed');
  await until(()=>f.runner.capacity().executing===0);
  const responses=await Promise.all([f.request(`/runs/${run.id}/resume`,{method:'POST',body:{}}),f.request(`/runs/${run.id}/resume`,{method:'POST',body:{}})]);
  assert.ok(responses.every(r=>r.status===200&&r.value.run.id===run.id));
  const done=await runState(f,run.id,'completed');assert.equal(f.store.one('SELECT count(*) n FROM runs').n,1);
  assert.equal(f.store.one("SELECT count(*) n FROM messages WHERE run_id=? AND role='user'",run.id).n,1);
  assert.equal((await f.request(`/projects/${project.id}/file?path=progress.txt`)).value.content,'START\nONCE\n');
  assert.equal((await f.request(`/projects/${project.id}/file?path=finished.txt`)).value.content,'continued');
  assert.ok(p.requests[2].messages.some(m=>m.role==='tool'&&JSON.parse(m.content).saved));
  assert.ok(done.events.some(e=>e.type==='tool_result'&&e.data.result?.reused));
  assert.equal((await f.request(`/runs/${run.id}/resume`,{method:'POST',body:{}})).status,409);
  const foreign=token();f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)','resume-other','Other','user',now());f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(foreign),'resume-other',Date.now()+60000);
  assert.equal((await f.request(`/runs/${run.id}/resume`,{method:'POST',body:{},headers:{cookie:'opensi_session='+foreign}})).status,404);
 }finally{await f.close();await p.close();}
});

test('stop then immediate resume is accepted once, waits for the old execution and continues without replaying saved writes',async()=>{
 const f=await fixture();let releaseModel,releaseCleanup,cleanupHeld=false;
 const modelGate=new Promise(resolve=>releaseModel=resolve),cleanupGate=new Promise(resolve=>releaseCleanup=resolve);
 const stopParallel=f.runner.parallel.stop;
 f.runner.parallel.stop=async runId=>{await stopParallel(runId);if(!cleanupHeld){cleanupHeld=true;await cleanupGate;}};
 const p=await provider(f,async n=>{
  if(n===1)return saved();
  if(n===2){await modelGate;return {role:'assistant',content:'Old cancelled response'};}
  if(n===3)return {role:'assistant',tool_calls:[call('repeat-after-stop','append_file',{path:'progress.txt',content:'ONCE\n'}),call('finish-after-stop','write_file',{path:'finished.txt',content:'continued'})]};
  return {role:'assistant',content:'Continued from saved files'};
 });
 try{
  const {run,project}=await createRun(f,p.value,'Stop and continue this project');await until(()=>p.requests.length===2);
  assert.equal((await f.request(`/runs/${run.id}/cancel`,{method:'POST',body:{}})).status,200);await until(()=>cleanupHeld);
  const replies=await Promise.all([f.request(`/runs/${run.id}/resume`,{method:'POST',body:{}}),f.request(`/runs/${run.id}/resume`,{method:'POST',body:{}})]);
  assert.ok(replies.every(r=>r.status===200&&r.value.run.id===run.id),JSON.stringify(replies.map(r=>({status:r.status,value:r.value}))));
  assert.equal((await f.request(`/runs/${run.id}`)).value.run.status,'queued');assert.equal(p.requests.length,2,'new execution must wait until old cleanup completes');
  releaseModel();releaseCleanup();
  const done=await runState(f,run.id,'completed');assert.equal(done.recovery.resumes,1);assert.equal(f.store.one('SELECT count(*) n FROM runs').n,1);
  assert.equal((await f.request(`/projects/${project.id}/file?path=progress.txt`)).value.content,'START\nONCE\n');
  assert.equal((await f.request(`/projects/${project.id}/file?path=finished.txt`)).value.content,'continued');
  assert.ok(p.requests[2].messages.some(m=>m.role==='user'&&String(m.content).includes('SAME task')));
  assert.ok(done.events.some(e=>e.type==='tool_result'&&e.data.result?.reused));
 }finally{releaseModel();releaseCleanup();f.runner.parallel.stop=stopParallel;await f.close();await p.close();}
});

test('a second stop cancels a continuation accepted during cleanup',async()=>{
 const f=await fixture();let releaseModel,releaseCleanup,held=false;
 const modelGate=new Promise(resolve=>releaseModel=resolve),cleanupGate=new Promise(resolve=>releaseCleanup=resolve);
 const stopParallel=f.runner.parallel.stop;
 f.runner.parallel.stop=async runId=>{await stopParallel(runId);if(!held){held=true;await cleanupGate;}};
 const p=await provider(f,async()=>{await modelGate;return {role:'assistant',content:'Cancelled response'};});
 try{
  const {run}=await createRun(f,p.value,'Stop pending continuation');await until(()=>p.requests.length===1);
  await f.request(`/runs/${run.id}/cancel`,{method:'POST',body:{}});await until(()=>held);
  assert.equal((await f.request(`/runs/${run.id}/resume`,{method:'POST',body:{}})).status,200);
  await f.request(`/runs/${run.id}/cancel`,{method:'POST',body:{}});releaseModel();releaseCleanup();
  await until(()=>f.runner.capacity().executing===0);await delay(100);
  assert.equal((await f.request(`/runs/${run.id}`)).value.run.status,'cancelled');assert.equal(p.requests.length,1);assert.equal(f.runner.recovery.row(run.id).state,'stopped');
 }finally{releaseModel();releaseCleanup();f.runner.parallel.stop=stopParallel;await f.close();await p.close();}
});

test('temporary provider disconnection automatically resumes the same run without repeating completed edits',async()=>{
 const f=await fixture({reconnectDelay:30,reconnectPoll:20});const p=await provider(f,n=>n===1?saved():n===2?{status:503,error:'temporarily unavailable'}:n===3?{role:'assistant',tool_calls:[call('again','append_file',{path:'progress.txt',content:'ONCE\n'})]}:{role:'assistant',content:'Recovered'});
 try{const {run,project}=await createRun(f,p.value,'Finish after connection returns');const done=await runState(f,run.id,'completed');assert.equal(done.recovery.resumes,1);assert.ok(done.events.some(e=>e.type==='connection_wait'));assert.equal((await f.request(`/projects/${project.id}/file?path=progress.txt`)).value.content,'START\nONCE\n');assert.equal(f.store.one('SELECT count(*) n FROM runs').n,1);}finally{await f.close();await p.close();}
});

test('user cancellation stops a deferred automatic reconnect and never resumes permission failures',async()=>{
 const f=await fixture({reconnectDelay:800,reconnectPoll:20});const p=await provider(f,()=>({status:503,error:'temporarily unavailable'}));
 try{const {run}=await createRun(f,p.value,'Wait for network');await until(()=>f.runner.recovery.row(run.id)?.state==='reconnecting');await f.request(`/runs/${run.id}/cancel`,{method:'POST',body:{}});await delay(1000);assert.equal((await f.request(`/runs/${run.id}`)).value.run.status,'cancelled');assert.equal(p.requests.length,1);for(const text of ['permission denied','API HTTP 401','API HTTP 403','quota limit','foydalanuvchi rad etdi'])assert.equal(connectionFailure(Error(text)),false);}finally{await f.close();await p.close();}
});

test('connector waits while offline, accepts the original result after reconnect and acknowledges duplicate delivery',async()=>{
 const f=await fixture({connectorTimeout:500,connectorOfflineMs:100});
 try{
  const code=(await f.request('/nodes/pair-code',{method:'POST',body:{}})).value.code;
  const node=(await f.request('/connector/pair',{method:'POST',body:{code,name:'Offline QA',platform:'test',workspace:'test'}})).value;
  const nc=(route,body)=>f.request('/connector/'+route,{method:'POST',body,headers:{authorization:'Bearer '+node.token}});
  await nc('agent-catalog',{models:[{id:'gemini-test',label:'Gemini'}]});
  const response=await f.request('/runs',{method:'POST',body:{prompt:'Perform one command',providerId:'agy_'+node.nodeId,model:'gemini-test',agentId:'developer',environment:'local',nodeId:node.nodeId,autonomy:'automatic'}});const run=response.value.run;
  const first=await until(async()=>(await nc('poll',{})).value.command);assert.equal(first.tool,'antigravity_task');
  await nc('result',{commandId:first.id,result:{response:'',failure:'Needs command',conversationId:'12345678-1234-1234-1234-123456789012',pendingCommands:[{command:'node --version',cwd:'',timeout:90}],files:[]}});
  const command=await until(async()=>(await nc('poll',{})).value.command);assert.equal(command.tool,'run_command');
  f.store.exec('UPDATE nodes SET last_seen=? WHERE id=?','2000-01-01T00:00:00Z',node.nodeId);await delay(700);
  assert.equal((await f.request(`/runs/${run.id}`)).value.run.status,'running');assert.equal(f.runner.recovery.row(run.id).state,'reconnecting');
  await nc('heartbeat',{});const body={commandId:command.id,result:{exitCode:0,output:'ACTUAL_RECONNECTED_OUTPUT'}};
  assert.equal((await nc('result',body)).status,200);assert.equal((await nc('result',body)).value.replayed,true);
  const resumed=await until(async()=>(await nc('poll',{})).value.command);assert.equal(resumed.args.conversationId,'12345678-1234-1234-1234-123456789012');assert.match(resumed.args.prompt,/ACTUAL_RECONNECTED_OUTPUT/);
  await nc('result',{commandId:resumed.id,result:{response:'Continued',files:[]}});await runState(f,run.id,'completed');assert.equal(f.store.one("SELECT count(*) n FROM commands WHERE run_id=? AND tool='run_command'",run.id).n,1);
 }finally{await f.close();}
});

test('durable result delivery retries a lost acknowledgement and restores completed results after connector restart',async()=>{
 const state=await tempDir();const id='cmd_'+'a'.repeat(24),received=[];let fail=true;
 try{
  const outbox=await resultDelivery(state,async body=>{received.push(body);if(fail){fail=false;throw Error('fetch failed');}},{retryMs:5});await outbox.begin({id});await outbox.deliver(id,{exitCode:0,output:'EXECUTED_ONCE'});assert.equal(received.length,2);assert.deepEqual(received[0],received[1]);assert.deepEqual(await readdir(path.join(state,'command-delivery')),[]);
  await writeFile(path.join(state,'command-delivery',id+'.json'),JSON.stringify({id,result:{exitCode:0,output:'SAVED_RESULT'}}));
  await (await resultDelivery(state,async body=>received.push(body))).flush();assert.equal(received.at(-1).result.output,'SAVED_RESULT');
  await outbox.begin({id});await (await resultDelivery(state,async body=>received.push(body))).flush();assert.equal(received.at(-1).result.execution_status,'unknown');assert.deepEqual(await readdir(path.join(state,'command-delivery')),[]);
 }finally{await removeTemp(state);}
});

test('native manual continuation retains its conversation and command evidence without executing a completed command again',async()=>{
 const f=await fixture();try{
  const code=(await f.request('/nodes/pair-code',{method:'POST',body:{}})).value.code;
  const node=(await f.request('/connector/pair',{method:'POST',body:{code,name:'Native resume QA',platform:'test',workspace:'test'}})).value;
  const nc=(route,body)=>f.request('/connector/'+route,{method:'POST',body,headers:{authorization:'Bearer '+node.token}});
  await nc('agent-catalog',{models:[{id:'gemini-test',label:'Gemini'}]});
  const {value:{run}}=await f.request('/runs',{method:'POST',body:{prompt:'Continue native task',providerId:'agy_'+node.nodeId,model:'gemini-test',agentId:'developer',environment:'local',nodeId:node.nodeId,autonomy:'automatic'}});
  const conversationId='12345678-1234-1234-1234-123456789012';
  const native=await until(async()=>(await nc('poll',{})).value.command);const pending={response:'',conversationId,files:[],failure:'Needs command',pendingCommands:[{command:'node --version',cwd:'',timeout:90}]};
  await nc('result',{commandId:native.id,result:pending});const command=await until(async()=>(await nc('poll',{})).value.command);await nc('result',{commandId:command.id,result:{exitCode:0,output:'PRESERVED_NATIVE_OUTPUT'}});
  const next=await until(async()=>(await nc('poll',{})).value.command);await nc('result',{commandId:next.id,result:{error:'invalid native request'}});await runState(f,run.id,'failed');await until(()=>f.runner.capacity().executing===0);
  assert.equal((await f.request(`/runs/${run.id}/resume`,{method:'POST',body:{}})).status,200);
  const resumed=await until(async()=>(await nc('poll',{})).value.command);assert.equal(resumed.tool,'antigravity_task');assert.equal(resumed.args.conversationId,conversationId);assert.equal(resumed.args.restoreLocalContext,true);assert.match(resumed.args.prompt,/execution_status.*completed/);assert.ok(!JSON.stringify(f.runner.recovery.load(run.id)).includes('PRESERVED_NATIVE_OUTPUT'));
  await nc('result',{commandId:resumed.id,result:pending});const last=await until(async()=>(await nc('poll',{})).value.command);assert.equal(last.tool,'antigravity_task');await nc('result',{commandId:last.id,result:{response:'Native continued',files:[]}});await runState(f,run.id,'completed');assert.equal(f.store.one("SELECT count(*) n FROM commands WHERE run_id=? AND tool='run_command'",run.id).n,1);
 }finally{await f.close();}
});

test('native terminal evidence remains private on the connector and is restored only for its own run and model',async()=>{
 const state=await tempDir();try{
  const memory=await nativeMemory(state),runId='run_'+'b'.repeat(24);
  await memory.record({runId,tool:'antigravity_task',args:{model:'gemini-test'}},{conversationId:'12345678-1234-1234-1234-123456789012'});
  await memory.record({runId,tool:'run_command',args:{command:'node --version'}},{exitCode:0,output:'PRIVATE_ACTUAL_OUTPUT'});
  const command={runId,args:{model:'gemini-test',prompt:'Continue',restoreLocalContext:true}};
  assert.match((await (await nativeMemory(state)).restore(command)).prompt,/PRIVATE_ACTUAL_OUTPUT/);
  assert.equal((await memory.restore({...command,runId:'run_'+'c'.repeat(24)})).prompt,'Continue');assert.equal((await memory.restore({...command,args:{...command.args,model:'different'}})).prompt,'Continue');assert.equal((await memory.restore({...command,args:{...command.args,restoreLocalContext:false}})).prompt,'Continue');
 }finally{await removeTemp(state);}
});

test('server restart resumes a saved task automatically and preserves its plan and successful tool results',async()=>{
 const directory=await tempDir();let service,server,base;const requests=[];let step=0;
 const remote=http.createServer(async(req,res)=>{res.setHeader('content-type','application/json');if(req.url.endsWith('/models')){res.end('{"data":[{"id":"qa-model"}]}');return;}let text='';for await(const c of req)text+=c;requests.push(JSON.parse(text));step++;if(step===1){res.end(JSON.stringify({choices:[{message:saved()}]}));return;}if(step===2){res.on('error',()=>{});return;}res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'Finished after server restart'}}]}));});await new Promise(r=>remote.listen(0,'127.0.0.1',r));
 const start=async()=>{service=createApp({dataDir:directory,localAuth:true,production:false,encryptionKey:'',jevKey:'',appUrl:'http://127.0.0.1:4581',reconnectPoll:20});server=service.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;};
 const request=async(route,body)=>{const r=await fetch(base+'/api'+route,{method:body?'POST':'GET',headers:{'x-opensi-client':'web',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return r.json();};
 const stop=async()=>{await service.close();server.closeAllConnections();await new Promise(r=>server.close(r));service=null;};
 try{
  await start();const p=await request('/providers',{label:'Restart QA',baseUrl:`http://127.0.0.1:${remote.address().port}/v1`});const {run,project}=await request('/runs',{prompt:'Persisted task',providerId:p.id,model:'qa-model',agentId:'developer',environment:'cloud'});await until(()=>step===2);
  await stop();await start();const done=await until(async()=>{const v=await request('/runs/'+run.id);return v.run.status==='completed'?v:null;});
  assert.equal(done.run.id,run.id);assert.equal(service.store.one('SELECT count(*) n FROM runs').n,1);assert.equal((await request(`/projects/${project.id}/file?path=progress.txt`)).content,'START\nONCE\n');assert.ok(requests.at(-1).messages.some(m=>m.role==='tool'&&JSON.parse(m.content).saved));
 }finally{if(service)await stop();remote.closeAllConnections();await new Promise(r=>remote.close(r));await removeTemp(directory);}
});
