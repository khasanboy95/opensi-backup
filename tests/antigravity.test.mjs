import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, until, mockProvider, addProvider, createRun, runState } from './helpers.mjs';
import { runCli, cliTask, nativeCliError, nativeResult, pendingCommand, pendingRead,mergeNativeStep,nativeCommandRequests } from '../connector/antigravity.mjs';
import {modelFailure,withProviderFailure} from '../server/model-health.mjs';
import path from 'node:path';
import http from 'node:http';

test('hosted native model runs pending creative commands in the shared isolated cloud runtime',async()=>{
 const jobs=[];const runner=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;jobs.push(JSON.parse(raw));res.end(JSON.stringify({type:'result',exitCode:0,output:'BLENDER_RENDER_OK'})+'\n');});await new Promise(r=>runner.listen(0,'127.0.0.1',r));
 const f=await fixture({runnerUrl:`http://127.0.0.1:${runner.address().port}`,runnerToken:'qa-cloud'});
 try{const node=await pair(f);f.store.setSetting(`hosted-antigravity:${node.nodeId}`,{owner:'local-owner'});
 const created=await f.request('/runs',{method:'POST',body:{prompt:'Render with Blender',providerId:`agy_${node.nodeId}`,model:'gemini-test',environment:'cloud',agentId:'developer',autonomy:'automatic'}});assert.equal(created.status,201);

 const first=await until(async()=>(await node.call('poll',{})).value.command);assert.equal(first.tool,'antigravity_task');assert.match(first.args.prompt,/Blender CPU/);
 await node.call('result',{commandId:first.id,result:{response:'Run render',files:[{path:'scene.py',base64:Buffer.from('print("render")').toString('base64')}],failure:'Needs shell',pendingCommands:[{command:'blender -b -t 1 --python scene.py',cwd:'',timeout:45}]}});
 const sync=await until(async()=>(await node.call('poll',{})).value.command);assert.equal(sync.tool,'write_file');await node.call('result',{commandId:sync.id,result:{saved:true}});
 const next=await until(async()=>(await node.call('poll',{})).value.command);assert.equal(next.tool,'antigravity_task');assert.match(next.args.prompt,/BLENDER_RENDER_OK/);assert.equal(jobs.length,1);assert.equal(jobs[0].projectId,created.value.project.id);assert.equal(jobs[0].command,'blender -b -t 1 --python scene.py');
 await node.call('result',{commandId:next.id,result:{response:'Rendered',files:[]}});await runState(f,created.value.run.id,'completed');assert.equal(f.store.one('SELECT count(*) n FROM approvals WHERE run_id=?',created.value.run.id).n,0);
 }finally{await f.close();runner.closeAllConnections();await new Promise(r=>runner.close(r));}
});

async function pair(f) {
  const { value: link } = await f.request('/nodes/pair-code', { method: 'POST', body: {} });
  const { value: node } = await f.request('/connector/pair', { method: 'POST', body: { code: link.code, name: 'Test AGY', platform: 'test', workspace: 'test' } });
  const call = (route, body) => f.request('/connector/' + route, { method: 'POST', body, headers: { authorization: `Bearer ${node.token}` } });
  assert.equal((await call('agent-catalog', { models: [{ id: 'gemini-test', label: 'Gemini test' }] })).status, 200);
  return { ...node, call };
}

test('server-hosted Antigravity is owner scoped and creates cloud projects without a personal PC',async()=>{
 const f=await fixture();try{
  const node=await pair(f);
  const owner=f.store.one('SELECT user_id FROM nodes WHERE id=?',node.nodeId).user_id;
  f.store.setSetting(`hosted-antigravity:${node.nodeId}`,{owner});
  let p=(await f.request('/providers')).value.find(p=>p.id===`agy_${node.nodeId}`);
  assert.equal(p.hosted,true);assert.match(p.base_url,/bulut/);
  const response=await f.request('/runs',{method:'POST',body:{prompt:'Server only page',providerId:p.id,model:'gemini-test',environment:'local',agentId:'developer'}});
  assert.equal(response.status,201);assert.equal(response.value.project.environment,'cloud');assert.equal(response.value.project.node_id,null);
  const approval=await until(()=>f.store.one("SELECT id FROM approvals WHERE run_id=? AND status='pending'",response.value.run.id));
  await f.request(`/approvals/${approval.id}`,{method:'POST',body:{approved:true}});
  const command=await until(async()=>(await node.call('poll',{})).value.command);
  assert.equal(command.tool,'antigravity_task');
  await node.call('result',{commandId:command.id,result:{response:'Server page ready',files:[{path:'index.html',base64:Buffer.from('<h1>Server only</h1>').toString('base64')}],usage:{input_tokens:1,output_tokens:1}}});
  await runState(f,response.value.run.id,'completed');
  assert.match((await f.request(`/projects/${response.value.project.id}/file?path=index.html`)).value.content,/Server only/);
  assert.throws(()=>f.runner.providerFor(p.id,'gemini-test','other-user'));
  f.store.setSetting(`hosted-antigravity:${node.nodeId}`,{owner:'other-user'});
  p=(await f.request('/providers')).value.find(item=>item.id===p.id);assert.equal(p.hosted,false);
 }finally{await f.close();}
});

test('mobile can continue an existing cloud project with Antigravity after scoped approval; source sync and result stay owned',async()=>{
 const f=await fixture(),mock=await mockProvider();try{
  const p=await addProvider(f,mock),initial=await createRun(f,p,'_STATIC_');await runState(f,initial.run.id,'completed');const node=await pair(f);
  const response=await f.request('/runs',{method:'POST',body:{prompt:'Improve this cloud project',projectId:initial.project.id,providerId:`agy_${node.nodeId}`,model:'gemini-test',environment:'cloud',agentId:'developer'}});assert.equal(response.status,201);
  const run=response.value.run;const approval=await until(()=>f.store.one("SELECT id FROM approvals WHERE run_id=? AND status='pending'",run.id));assert.equal((await node.call('poll',{})).value.command,null);
  await f.request(`/approvals/${approval.id}`,{method:'POST',body:{approved:true}});
  const copied=[];let native;for(let i=0;i<5;i++){const c=await until(async()=>(await node.call('poll',{})).value.command);if(c.tool==='antigravity_task'){native=c;break;}assert.equal(c.tool,'write_file');copied.push(c.args);await node.call('result',{commandId:c.id,result:{saved:true}});}
  assert.ok(copied.some(f=>f.path==='index.html'&&f.content.includes('QA Portfolio')));assert.ok(native);
  assert.match(native.args.prompt,/Shaxsiy ko‘nikmalar:/);
  await node.call('result',{commandId:native.id,result:{response:'Updated',files:[{path:'index.html',base64:Buffer.from('<h1>Native mobile result</h1>').toString('base64')}],usage:{input_tokens:1,output_tokens:1}}});
  const done=await runState(f,run.id,'completed');assert.equal(done.project.environment,'cloud');assert.match((await f.request(`/projects/${initial.project.id}/file?path=index.html`)).value.content,/Native mobile result/);
 }finally{await f.close();await mock.close();}
});

test('Antigravity catalog is owner scoped, revocable, rejects invalid models and routes fresh mobile requests to the paired PC', async () => {
  const f = await fixture();
  try {
    const node = await pair(f);
    const providers = (await f.request('/providers')).value;
    const agy = providers.find(p => p.protocol === 'antigravity-cli');
    assert.equal(agy.id, `agy_${node.nodeId}`); assert.equal(agy.has_key, false); assert.equal(agy.enabled, true);
    assert.equal(JSON.stringify(agy).includes(node.token), false);
    assert.equal((await node.call('agent-catalog', { models: [{ id: '--dangerously-skip-permissions', label: 'bad' }] })).status, 400);
    const agent = (await f.request('/agents')).value[0];
    const body = { prompt: 'test', providerId: agy.id, model: 'gemini-test', agentId: agent.id, environment: 'cloud' };
    const mobile=await f.request('/runs',{method:'POST',body});assert.equal(mobile.status,201);assert.equal(mobile.value.project.environment,'local');assert.equal(mobile.value.project.node_id,node.nodeId);await f.request(`/runs/${mobile.value.run.id}/cancel`,{method:'POST',body:{}});
    assert.throws(()=>f.runner.providerFor(agy.id,'gemini-test','someone-else'));
    assert.throws(()=>f.runner.providerFor(agy.id,'unknown','local-owner'));
    await f.request(`/nodes/${node.nodeId}/revoke`, { method: 'POST', body: {} });
    assert.equal((await f.request('/providers')).value.some(p=>p.id===agy.id), false);
  } finally { await f.close(); }
});

test('native agent waits for approval, streams events, keeps local files off server and records usage', async () => {
  const f = await fixture();
  try {
    const node = await pair(f); const agent = (await f.request('/agents')).value[0];
    const { value: { run } } = await f.request('/runs', { method:'POST', body:{prompt:'Make page',providerId:`agy_${node.nodeId}`,model:'gemini-test',agentId:agent.id,environment:'local',nodeId:node.nodeId} });
    const approval = await until(()=>f.store.one("SELECT * FROM approvals WHERE run_id=? AND status='pending'",run.id));
    assert.equal((await node.call('poll',{})).value.command, null);
    await f.request(`/approvals/${approval.id}`,{method:'POST',body:{approved:true}});
    const command = await until(async()=>(await node.call('poll',{})).value.command);
    assert.equal(command.tool,'antigravity_task');
    await node.call('progress',{commandId:command.id,output:JSON.stringify({text:'Building…'})+'\n'});
    await node.call('result',{commandId:command.id,result:{response:'Page ready',usage:{input_tokens:12,output_tokens:8},files:[{path:'index.html',base64:Buffer.from('<h1>Native agent</h1>').toString('base64')}]}});
    await until(()=>f.store.one('SELECT status FROM runs WHERE id=?',run.id)?.status==='completed');
    assert.equal(f.store.one('SELECT SUM(input_tokens+output_tokens) AS total FROM usage WHERE run_id=?',run.id).total,20);
    const msg=f.store.all("SELECT data FROM events WHERE run_id=? AND type='message'",run.id).map(r=>JSON.parse(r.data));
    assert.equal(msg.at(-1).message.content,'Page ready');
    assert.equal(f.store.one('SELECT path FROM file_versions WHERE project_id=?',run.project_id),undefined);
    assert.equal(f.store.one("SELECT count(*) n FROM commands WHERE project_id=? AND (args!='{}' OR result IS NOT NULL)",run.project_id).n,0);
  } finally { await f.close(); }
});

test('CLI invocation fails on nonzero exit, timeout and cancellation', async () => {
  await assert.rejects(runCli(process.execPath,['-e','process.exit(2)']),/bajarilmadi/);
  await assert.rejects(runCli(process.execPath,['-e','console.error("private-oauth-token");process.exit(2)']),error=>!error.message.includes('private-oauth-token'));
  await assert.rejects(runCli(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:100}),/vaqti tugadi/);
  const controller=new AbortController(); controller.abort(new Error('Cancelled'));
  await assert.rejects(runCli(process.execPath,['-e','console.log(1)'],{signal:controller.signal}),/Cancelled/);
  const lines=[]; const result=await runCli(process.execPath,['-e','process.stdout.write("salom\\noxir")'],{onLine:l=>lines.push(l)});
  assert.deepEqual(lines,['salom','oxir']); assert.equal(result.output,'salom\noxir');
});

test('CLI SUCCESS with denied actions remains an incomplete result and preserves billed usage', () => {
  const result=nativeResult({status:'SUCCESS',response:'',usage:{input_tokens:10,output_tokens:5},denied_actions:[{action:'write_file'}]});
  assert.match(result.failure,/write_file/);
  assert.deepEqual(result.usage,{input_tokens:10,output_tokens:5});
  assert.equal(nativeResult({response:'Done'}).failure,null);
});

test('real CLI exit 3 quota diagnostics retain reset time without exposing stderr or blaming permissions', async () => {
  const diagnostic={short_error:'RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 2h12m32s.',status:'RESOURCE_EXHAUSTED',error_code:429,retryable:true};
  const stderr='private-oauth-token\nAGY_ERROR: '+JSON.stringify(diagnostic);
  await assert.rejects(runCli(process.execPath,['-e',`console.error(${JSON.stringify(stderr)});process.exit(3)`]),error=>{
    assert.match(error.message,/model limiti tugadi/);assert.doesNotMatch(error.message,/ruxsat|private-oauth-token/);
    assert.deepEqual(error.providerError,{kind:'quota',code:'RESOURCE_EXHAUSTED',status:429,retryAfterMs:7952000});
    assert.equal(modelFailure(withProviderFailure(error,error.providerError)).cooldownMs,7952000);return true;
  });
  for(const [text,kind] of [['You are not logged into Antigravity.','auth'],['PERMISSION_DENIED user denied permission','permission']]){
    const error=nativeCliError(3,text);assert.equal(error.providerError.kind,kind);
    assert.equal(modelFailure(withProviderFailure(error,error.providerError)),null);
  }
  assert.equal(nativeCliError(3,'Unknown failure private-oauth-token').providerError,undefined);
});

test('failed native turn preserves conversation and actual usage for handoff and never bridges denied commands',async()=>{
  const conversationId='12345678-1234-1234-1234-123456789012';
  const result={conversation_id:conversationId,status:'ERROR',response:'Partial work saved',error:'Individual quota reached. Resets in 2h12m32s.',usage:{input_tokens:12,output_tokens:5}};
  const invoke=(executable,args,options)=>runCli(process.execPath,['-e',`console.log(${JSON.stringify(JSON.stringify({event:'result',result}))});console.error('AGY_ERROR: '+JSON.stringify({status:'RESOURCE_EXHAUSTED',error_code:429,short_error:'Individual quota reached. Resets in 2h12m32s.'}));process.exit(3)`],options);
  const value=await cliTask('unused',process.cwd(),{prompt:'Continue existing work',model:'qa',conversationId,cumulativeUsage:{input_tokens:10,output_tokens:3}},undefined,()=>{},invoke);
  assert.equal(value.conversationId,conversationId);assert.deepEqual(value.usage,{input_tokens:2,output_tokens:2});assert.deepEqual(value.cumulativeUsage,result.usage);
  assert.equal(value.providerError.kind,'quota');assert.equal(value.providerError.retryAfterMs,7952000);assert.equal(value.pendingCommands,undefined);
  assert.equal(value.response,'Partial work saved');assert.match(value.failure,/model limiti tugadi/);
});

test('native terminal requests preserve the exact command and reject paths outside the workspace', () => {
  const root=path.resolve('test-native-root');
  const step={tool_name:'run_command',state:'ERROR',tool_info:{parameters:{CommandLine:'Get-ChildItem -Force',Cwd:root},error:{message:'user denied permission to run command: Get-ChildItem -Force'}}};
  assert.deepEqual(pendingCommand(step,root),{command:'Get-ChildItem -Force',cwd:'',timeout:90});
  assert.equal(pendingCommand({...step,tool_info:{...step.tool_info,parameters:{...step.tool_info.parameters,Cwd:path.dirname(root)}}},root),null);
  assert.equal(pendingCommand({...step,state:'DONE'},root),null);
  const softStep={...step,state:'DONE',tool_info:{parameters:step.tool_info.parameters}};
  assert.deepEqual(pendingCommand(softStep,root,true),{command:'Get-ChildItem -Force',cwd:'',timeout:90});
  assert.equal(pendingCommand({...softStep,tool_info:{...softStep.tool_info,output:'already executed'}},root,true),null);
  assert.equal(pendingCommand({...step,tool_info:{...step.tool_info,error:{message:'denied by policy'}}},root),null);
});

test('multiple soft-denied native commands survive partial updates and exclude executed, unsafe and unfinished steps',()=>{
 const root=path.resolve('test-native-root'),step=(index,command,extra={})=>({step_index:index,tool_name:'run_command',state:'DONE',tool_info:{parameters:{CommandLine:command,Cwd:root},...extra}});
 const first=mergeNativeStep(step(1,'node --version'),{step_index:1,state:'DONE',tool_info:{name:'run_command'}});
 const result={denied_actions:[{action:'command',display_name:'RunCommand'}]};
 const requested=nativeCommandRequests(result,[first,step(2,'python --version'),step(3,'already-ran',{output:'done'}),step(4,'node --version'),{...step(5,'pending'),state:'ACTIVE'},step(6,'policy',{error:{message:'denied by policy'}}),step(7,'outside',{parameters:{CommandLine:'outside',Cwd:path.dirname(root)}})],root);
 assert.deepEqual(requested,[{command:'node --version',cwd:'',timeout:90},{command:'python --version',cwd:'',timeout:90}]);
 assert.deepEqual(nativeCommandRequests({denied_actions:[]},[first],root),[]);
});

test('automatic native terminal batch executes exact commands once and resumes the same conversation with real outputs',async()=>{
 const f=await fixture();try{
  const node=await pair(f),conversationId='12345678-1234-1234-1234-123456789012';
  const {value:{run}}=await f.request('/runs',{method:'POST',body:{prompt:'Run existing project tests',providerId:`agy_${node.nodeId}`,model:'gemini-test',agentId:'developer',environment:'local',nodeId:node.nodeId,autonomy:'automatic'}});
  const first=await until(async()=>(await node.call('poll',{})).value.command);assert.equal(first.tool,'antigravity_task');
  const commands=['node --version','python --version','node -e "console.log(12345)"'];
  await node.call('result',{commandId:first.id,result:{conversationId,response:'',files:[],failure:'Antigravity quyidagi amalni tasdiqlay olmadi: command.',pendingCommands:commands.map(command=>({command,cwd:'',timeout:90}))}});
  for(const [index,command] of commands.entries()){
   const next=await until(async()=>(await node.call('poll',{})).value.command);assert.equal(next.tool,'run_command');assert.equal(next.args.command,command);
   await node.call('result',{commandId:next.id,result:{exitCode:0,output:'ACTUAL_OUTPUT_'+index}});
  }
  const resumed=await until(async()=>(await node.call('poll',{})).value.command);assert.equal(resumed.tool,'antigravity_task');assert.equal(resumed.args.conversationId,conversationId);
  for(let i=0;i<commands.length;i++)assert.match(resumed.args.prompt,new RegExp('ACTUAL_OUTPUT_'+i));
  await node.call('result',{commandId:resumed.id,result:{response:'Verified actual commands',files:[]}});
  const done=await runState(f,run.id,'completed');assert.equal(done.approvals.length,0);
  assert.equal(done.events.filter(e=>e.type==='tool_start'&&e.data.tool==='run_command').length,commands.length);
 }finally{await f.close();}
});

test('native read requests recognize only the denied exact HTTPS URL', () => {
  const step={tool_name:'read_url_content',state:'ERROR',tool_info:{parameters:{Url:'https://example.com/'},error:{message:'user denied permission for read_url(example.com)'}}};
  assert.equal(pendingRead(step),'https://example.com/');
  assert.equal(pendingRead({...step,state:'DONE'}),null);
  assert.equal(pendingRead({...step,state:'DONE',tool_info:{parameters:step.tool_info.parameters}},true),'https://example.com/');
  assert.equal(pendingRead({...step,state:'DONE',tool_info:{parameters:step.tool_info.parameters,output:'read already'}},true),null);
  assert.equal(pendingRead({...step,tool_info:{...step.tool_info,parameters:{Url:'file:///secret'}}}),null);
});

test('native clone reuses existing browser evidence once without retrying denied network access', async () => {
  const f=await fixture({computerUrl:'http://127.0.0.1:1',runnerToken:'test'});
  try {
    const captures=[];
    f.computer.ensureAgent=async()=>({});
    f.computer.tool=async(tool,args)=>{assert.ok(['computer_capture','computer_explore'].includes(tool));captures.push(args);return {url:args.url,manifestPath:'inputs/att_test/manifest.json',frames:[],assets:[]};};
    const node=await pair(f);const agent=(await f.request('/agents')).value[0];
    const {value:{run}}=await f.request('/runs',{method:'POST',body:{prompt:'https://example.com/ clone it fully',providerId:`agy_${node.nodeId}`,model:'gemini-test',agentId:agent.id,environment:'local',nodeId:node.nodeId,autonomy:'automatic'}});

    const first=await until(async()=>(await node.call('poll',{})).value.command);
    assert.equal(first.tool,'antigravity_task');
    await node.call('result',{commandId:first.id,result:{response:'',files:[],failure:'read_url',pendingReads:['https://example.com/']}});
    const continued=await until(async()=>(await node.call('poll',{})).value.command);
    assert.equal(continued.tool,'antigravity_task');
    assert.match(continued.args.prompt,/untrusted_existing_browser_capture/);
    assert.equal(captures.length,2);
    assert.equal(f.store.one('SELECT count(*) n FROM approvals WHERE run_id=?',run.id).n,0);
    // A repeated denied request must stop, not loop or access the network.
    await node.call('result',{commandId:continued.id,result:{response:'',files:[],failure:'read_url',pendingReads:['https://example.com/']}});
    await until(()=>f.store.one('SELECT status FROM runs WHERE id=?',run.id)?.status==='failed');
    assert.equal((await node.call('poll',{})).value.command,null);
    assert.equal(captures.length,2);
  } finally {await f.close();}
});

test('native login-only clone captures both public viewports without waiting for account credentials',async()=>{
 const f=await fixture({computerUrl:'http://127.0.0.1:1',runnerToken:'test'});try{
  const captures=[];f.computer.ensureAgent=async()=>({});f.computer.tool=async(tool,args)=>{captures.push({tool,args});assert.equal(args.publicPage,true);return {publicPage:true,url:args.url,manifestPath:args.mobile?'inputs/mobile.json':'inputs/desktop.json',frames:[]};};
  const node=await pair(f);const {value:{run}}=await f.request('/runs',{method:'POST',body:{prompt:'https://example.com/login faqat login pageni clone qil',providerId:`agy_${node.nodeId}`,model:'gemini-test',agentId:'developer',environment:'local',nodeId:node.nodeId,autonomy:'automatic'}});
  const task=await until(async()=>(await node.call('poll',{})).value.command);assert.equal(task.tool,'antigravity_task');assert.deepEqual(captures.map(c=>[c.tool,c.args.mobile]),[['computer_capture',false],['computer_capture',true]]);assert.match(task.args.prompt,/inputs\/desktop.json/);assert.match(task.args.prompt,/inputs\/mobile.json/);
  assert.equal(f.store.one('SELECT COUNT(*) AS n FROM approvals WHERE run_id=?',run.id).n,0);
  await node.call('result',{commandId:task.id,result:{response:'Public login source inspected',files:[]}});await runState(f,run.id,'completed');
 }finally{await f.close();}
});

test('resuming a failed native clone retains reference paths and does not consume more capture slots',async()=>{
 const f=await fixture({computerUrl:'http://127.0.0.1:1',runnerToken:'test'});try{
  let captures=0;f.computer.ensureAgent=async()=>({});f.computer.tool=async(tool,args)=>{captures++;assert.ok(captures<=2,'existing source evidence must be reused after resume');return {publicPage:true,url:args.url,manifestPath:args.mobile?'inputs/mobile.json':'inputs/desktop.json',frames:[]};};
  const node=await pair(f);const {value:{run}}=await f.request('/runs',{method:'POST',body:{prompt:'https://example.com/login faqat login sahifasini clone qil',providerId:`agy_${node.nodeId}`,model:'gemini-test',agentId:'developer',environment:'local',nodeId:node.nodeId,autonomy:'automatic'}});
  const first=await until(async()=>(await node.call('poll',{})).value.command);
  await node.call('result',{commandId:first.id,result:{conversationId:'11111111-2222-3333-4444-555555555555',response:'',failure:'Native format error',files:[]}});await runState(f,run.id,'failed');await until(()=>f.runner.capacity().executing===0);
  assert.equal((await f.request(`/runs/${run.id}/resume`,{method:'POST',body:{}})).status,200);
  const continued=await until(async()=>(await node.call('poll',{})).value.command);assert.equal(continued.tool,'antigravity_task');assert.match(continued.args.prompt,/inputs\/desktop.json/);assert.match(continued.args.prompt,/inputs\/mobile.json/);assert.equal(captures,2);
  await node.call('result',{commandId:continued.id,result:{response:'Continued using saved references',files:[]}});await runState(f,run.id,'completed');assert.equal(captures,2);
 }finally{await f.close();}
});

test('native clone login preflight waits for the user, resumes real evidence and uses the authenticated URL for mobile',async()=>{
 const f=await fixture({computerUrl:'http://127.0.0.1:1',runnerToken:'test'});try{
  const captures=[];let loggedIn=false;
  f.computer.ensureAgent=async()=>({});f.computer.beginHandoff=()=>({});f.computer.finishHandoff=async()=>{assert.ok(loggedIn);};
  f.computer.tool=async(tool,args)=>{captures.push({tool,args});if(captures.length===1)return {handoffRequired:true,resumeCurrentPage:true,reason:'Kirish kerak',url:'https://example.com/login'};if(tool==='computer_explore')return {visited:[{url:'https://example.com/dashboard',manifestPath:'inputs/actual.json'}],complete:true};return {url:args.url,manifestPath:'inputs/mobile.json',frames:[]};};
  const node=await pair(f);const {value:{run}}=await f.request('/runs',{method:'POST',body:{prompt:'https://example.com/login clone fully',providerId:`agy_${node.nodeId}`,model:'gemini-test',agentId:'developer',environment:'local',nodeId:node.nodeId,autonomy:'automatic'}});
  const waiting=await runState(f,run.id,'waiting_input');assert.equal(waiting.approvals[0].tool,'computer_login');assert.equal((await node.call('poll',{})).value.command,null);
  loggedIn=true;await f.request('/approvals/'+waiting.approvals[0].id,{method:'POST',body:{approved:true}});
  const task=await until(async()=>(await node.call('poll',{})).value.command);assert.equal(task.tool,'antigravity_task');assert.match(task.args.prompt,/inputs\/actual.json/);
  assert.equal(captures[1].tool,'computer_explore');assert.equal(captures[1].args.url,undefined);assert.equal(captures[2].args.url,'https://example.com/dashboard');
  await node.call('result',{commandId:task.id,result:{response:'Source inspected',files:[]}});const done=await runState(f,run.id,'completed');assert.ok(done.events.some(e=>e.type==='agent_recovery'&&e.data.kind==='browser_resumed'));
 }finally{await f.close();}
});
test('failed native browser preflight provides repair context but never claims nonexistent evidence can replace a denied read',async()=>{
 const f=await fixture({computerUrl:'http://127.0.0.1:1',runnerToken:'test'});try{
  let captures=0;f.computer.ensureAgent=async()=>({});f.computer.tool=async()=>{captures++;throw Object.assign(Error('Unsupported navigation parameter'),{code:'SITE_CRAWL_BLOCKED'});};
  const node=await pair(f);const {value:{run}}=await f.request('/runs',{method:'POST',body:{prompt:'https://example.com/?unsupported=1 clone fully',providerId:`agy_${node.nodeId}`,model:'gemini-test',agentId:'developer',environment:'local',nodeId:node.nodeId,autonomy:'automatic'}});
  const task=await until(async()=>(await node.call('poll',{})).value.command);assert.equal(task.tool,'antigravity_task');assert.match(task.args.prompt,/Unsupported navigation parameter/);assert.match(task.args.prompt,/recovery/);
  await node.call('result',{commandId:task.id,result:{response:'',files:[],failure:'Denied source read',pendingReads:['https://example.com/?unsupported=1']}});await runState(f,run.id,'failed');assert.equal(captures,1);assert.equal((await node.call('poll',{})).value.command,null);
 }finally{await f.close();}
});

test('native terminal pauses for an exact approval then continues with real command output', async () => {
  const f=await fixture();
  try {
    const node=await pair(f); const agent=(await f.request('/agents')).value[0];
    const {value:{run}}=await f.request('/runs',{method:'POST',body:{prompt:'Make page',providerId:`agy_${node.nodeId}`,model:'gemini-test',agentId:agent.id,environment:'local',nodeId:node.nodeId}});
    const initial=await until(()=>f.store.one("SELECT id FROM approvals WHERE run_id=? AND status='pending'",run.id));
    await f.request(`/approvals/${initial.id}`,{method:'POST',body:{approved:true}});
    const native=await until(async()=>(await node.call('poll',{})).value.command);
    const conversationId='11111111-2222-3333-4444-555555555555';
    await node.call('result',{commandId:native.id,result:{conversationId,cumulativeUsage:{input_tokens:10,output_tokens:5},response:'',usage:{input_tokens:10,output_tokens:5},files:[],failure:'Needs approval',pendingCommands:[{command:'Get-ChildItem -Force',cwd:'',timeout:90}]}});
    const terminal=await until(()=>f.store.one("SELECT * FROM approvals WHERE run_id=? AND tool='run_command' AND status='pending'",run.id));
    assert.equal(JSON.parse(terminal.args).command,'Get-ChildItem -Force');
    assert.equal((await node.call('poll',{})).value.command,null);
    await f.request(`/approvals/${terminal.id}`,{method:'POST',body:{approved:true}});
    const command=await until(async()=>(await node.call('poll',{})).value.command);
    assert.equal(command.tool,'run_command');
    await node.call('result',{commandId:command.id,result:{exitCode:0,output:'Exact approved output'}});
    const resumed=await until(async()=>(await node.call('poll',{})).value.command);
    assert.equal(resumed.tool,'antigravity_task'); assert.match(resumed.args.prompt,/Exact approved output/);
    assert.equal(resumed.args.conversationId,conversationId);
    assert.deepEqual(resumed.args.cumulativeUsage,{input_tokens:10,output_tokens:5});
    await node.call('result',{commandId:resumed.id,result:{response:'Done',usage:{input_tokens:20,output_tokens:7},files:[]}});
    await until(()=>f.store.one('SELECT status FROM runs WHERE id=?',run.id)?.status==='completed');
    assert.equal(f.store.one('SELECT SUM(input_tokens+output_tokens) AS total FROM usage WHERE run_id=?',run.id).total,42);
    assert.equal(f.store.one("SELECT count(*) AS n FROM events WHERE run_id=? AND type='usage'",run.id).n,2);
  } finally {await f.close();}
});

test('denied native terminal never executes or resumes', async () => {
  const f=await fixture();
  try {
    const node=await pair(f); const agent=(await f.request('/agents')).value[0];
    const {value:{run}}=await f.request('/runs',{method:'POST',body:{prompt:'Make page',providerId:`agy_${node.nodeId}`,model:'gemini-test',agentId:agent.id,environment:'local',nodeId:node.nodeId}});
    const initial=await until(()=>f.store.one("SELECT id FROM approvals WHERE run_id=? AND status='pending'",run.id));
    await f.request(`/approvals/${initial.id}`,{method:'POST',body:{approved:true}});
    const native=await until(async()=>(await node.call('poll',{})).value.command);
    await node.call('result',{commandId:native.id,result:{response:'',files:[],failure:'Needs approval',pendingCommands:[{command:'Get-ChildItem -Force',cwd:'',timeout:90}]}});
    const terminal=await until(()=>f.store.one("SELECT id FROM approvals WHERE run_id=? AND tool='run_command' AND status='pending'",run.id));
    await f.request(`/approvals/${terminal.id}`,{method:'POST',body:{approved:false}});
    await until(()=>f.store.one('SELECT status FROM runs WHERE id=?',run.id)?.status==='failed');
    assert.equal(f.store.one('SELECT count(*) AS n FROM commands WHERE run_id=?',run.id).n,1);
  } finally {await f.close();}
});

test('denying the native agent approval never dispatches local work', async () => {
  const f = await fixture();
  try {
    const node = await pair(f); const agent = (await f.request('/agents')).value[0];
    const { value: { run } } = await f.request('/runs', { method: 'POST', body: {prompt:'Do not execute',providerId:`agy_${node.nodeId}`,model:'gemini-test',agentId:agent.id,environment:'local',nodeId:node.nodeId} });
    const approval = await until(()=>f.store.one("SELECT id FROM approvals WHERE run_id=? AND status='pending'",run.id));
    await f.request(`/approvals/${approval.id}`,{method:'POST',body:{approved:false}});
    await until(()=>f.store.one('SELECT status FROM runs WHERE id=?',run.id)?.status==='failed');
    assert.equal((await node.call('poll',{})).value.command,null);
    assert.equal(f.store.one('SELECT count(*) AS total FROM commands WHERE run_id=?',run.id).total,0);
  } finally { await f.close(); }
});
