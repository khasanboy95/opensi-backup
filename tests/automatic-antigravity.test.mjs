import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {projectRoot} from '../server/files.mjs';
import {fixture,mockProvider,addProvider,until,runState} from './helpers.mjs';
import {rankModels} from '../server/orchestration.mjs';
import {nativeCliError} from '../connector/antigravity.mjs';

async function native(f,{hosted=true}={}){
 const code=(await f.request('/nodes/pair-code',{method:'POST',body:{}})).value.code;
 const node=(await f.request('/connector/pair',{method:'POST',body:{code,name:'Native auto QA',platform:'test',workspace:'test'}})).value;
 const call=(route,body)=>f.request('/connector/'+route,{method:'POST',body,headers:{authorization:'Bearer '+node.token}});
 await call('agent-catalog',{models:[{id:'gemini-test',label:'Gemini QA'}]});await call('heartbeat',{});
 if(hosted)f.store.setSetting('hosted-antigravity:'+node.nodeId,{owner:'local-owner'});
 return {...node,call};
}
async function start(f,extra={}){const r=await f.request('/runs',{method:'POST',body:{prompt:'A short answer',providerId:'auto',model:'auto',environment:'cloud',agentId:'developer',autonomy:'automatic',...extra}});assert.equal(r.status,201);return r.value;}
async function handle(f,node,run,reply){
 const commands=[];
 await until(async()=>{
  const state=f.store.one('SELECT status,error FROM runs WHERE id=?',run.id);
  if(['completed','failed','cancelled'].includes(state.status))return state;
  const c=(await node.call('poll',{})).value.command;
  if(c){commands.push(c);await node.call('result',{commandId:c.id,result:c.tool==='antigravity_task'?reply(c):{saved:true,files:[]}});}
  return false;
 },15000);
 return commands;
}

test('automatic hosted Antigravity answers without duplicate review and retains actual usage',async()=>{
 const f=await fixture();try{const n=await native(f);const {run}=await start(f);
  const commands=await handle(f,n,run,()=>({response:'Native complete',files:[],usage:{input_tokens:7,output_tokens:3}}));
  const done=await runState(f,run.id,'completed');assert.equal(commands.filter(c=>c.tool==='antigravity_task').length,1);
  assert.ok(done.events.some(e=>e.type==='model_route'&&e.data.providerId==='agy_'+n.nodeId));
  assert.equal(f.store.one('SELECT count(*) n FROM approvals WHERE run_id=?',run.id).n,0);
  assert.equal(f.store.one('SELECT sum(input_tokens) n FROM usage WHERE run_id=?',run.id).n,7);
 }finally{await f.close();}
});

test('explicit Antigravity model respects automatic execution without a separate approval',async()=>{
 const f=await fixture();try{const n=await native(f);const {run}=await start(f,{providerId:'agy_'+n.nodeId,model:'gemini-test'});
  await handle(f,n,run,()=>({response:'Native selected model complete',files:[]}));
  const done=await runState(f,run.id,'completed');assert.equal(done.approvals.length,0);
 }finally{await f.close();}
});

test('native file changes still receive a final review without repeating unchanged file writes as new work',async()=>{
 const f=await fixture();try{const n=await native(f);const {run,project}=await start(f);let turns=0;
  await handle(f,n,run,()=>{turns++;return {response:'Saved and checked',files:[{path:'native.txt',base64:Buffer.from('native result').toString('base64')}]};});
  await runState(f,run.id,'completed');assert.equal(turns,2);
  assert.equal((await f.request(`/projects/${project.id}/file?path=native.txt`)).value.content,'native result');
 }finally{await f.close();}
});

test('hosted clone shares real evidence with API fallback and reuses it on native review',async()=>{
 const f=await fixture({computerUrl:'http://127.0.0.1:1',runnerToken:'test'});try{
  const n=await native(f),captures=[];f.computer.ensureAgent=async()=>({});
  f.computer.tool=async(tool,args,run,project)=>{
   assert.equal(project.environment,'cloud');assert.equal(args.publicPage,true);captures.push(args.mobile);
   const folder=`inputs/att_capture_${args.mobile?'mobile':'desktop'}`,root=projectRoot(f.config,project);
   await mkdir(`${root}/${folder}`,{recursive:true});await writeFile(`${root}/${folder}/screen-1.png`,Buffer.from([137,80,78,71,13,10,26,10]));
   const result={url:args.url,publicPage:true,mobile:args.mobile,manifestPath:folder+'/manifest.json',frames:[{screenshot:folder+'/screen-1.png'}]};
   await writeFile(`${root}/${result.manifestPath}`,JSON.stringify(result));return result;
  };
  const {run,project}=await start(f,{prompt:'https://example.com/login faqat login sahifasini clone qil'});let turns=0;
  const commands=await handle(f,n,run,c=>{turns++;assert.match(c.args.prompt,/att_capture_desktop\/manifest.json/);assert.match(c.args.prompt,/att_capture_mobile\/manifest.json/);return {response:'Login UI checked',files:[{path:'index.html',base64:Buffer.from('<html>Login</html>').toString('base64')}]};});
  await runState(f,run.id,'completed');assert.equal(turns,2);assert.deepEqual(captures,[false,true]);
  const uploads=commands.filter(c=>c.tool==='upload_chunk');assert.equal(uploads.length,4);assert.equal(new Set(uploads.map(c=>c.args.path)).size,4);
  assert.equal((await readFile(projectRoot(f.config,project)+'/inputs/att_capture_desktop/screen-1.png'))[0],137);
  assert.equal(f.store.one("SELECT COUNT(*) AS n FROM approvals WHERE run_id=?",run.id).n,0);
 }finally{await f.close();}
});

test('a saved native conversation receives newer cloud edits before it resumes',async()=>{
 const f=await fixture();try{
  const n=await native(f),{run,project}=await start(f,{providerId:'agy_'+n.nodeId,model:'gemini-test',prompt:'Design a small UI'});
  await handle(f,n,run,()=>({response:'',failure:'Native format error',conversationId:'11111111-2222-3333-4444-555555555555',files:[{path:'index.html',base64:Buffer.from('old native UI').toString('base64')}]}));await runState(f,run.id,'failed');await until(()=>f.runner.capacity().executing===0);
  // Represents a later API model's successful write in the shared workspace.
  await writeFile(projectRoot(f.config,project)+'/index.html','new cloud UI');
  assert.equal((await f.request(`/runs/${run.id}/resume`,{method:'POST',body:{}})).status,200);
  const commands=await handle(f,n,run,()=>({response:'Continued the new UI',files:[]}));await runState(f,run.id,'completed');
  const sync=commands.find(c=>c.tool==='write_file'&&c.args.path==='index.html');assert.equal(sync?.args.content,'new cloud UI');
  assert.equal(await readFile(projectRoot(f.config,project)+'/index.html','utf8'),'new cloud UI');
 }finally{await f.close();}
});

test('API failure routes to hosted native with existing files and tool evidence intact',async()=>{
 const f=await fixture();let calls=0;
 const server=http.createServer(async(req,res)=>{for await(const c of req){};calls++;if(calls>1){res.writeHead(503);res.end('overloaded');return;}res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'saved',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'before.txt',content:'preserve me'})}}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const n=await native(f);await f.request('/providers',{method:'POST',body:{label:'API QA',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:['qa-pro']}});const {run,project}=await start(f);
  const commands=await handle(f,n,run,c=>{assert.match(c.args.prompt,/Shared task state/);return {response:'Native continued saved work',files:[]};});
  const done=await runState(f,run.id,'completed');assert.ok(done.events.some(e=>e.type==='model_handoff'));assert.equal(calls,2);
  assert.ok(commands.some(c=>c.tool==='write_file'&&c.args.path==='before.txt'&&c.args.content==='preserve me'));
  assert.equal((await f.request(`/projects/${project.id}/file?path=before.txt`)).value.content,'preserve me');
 }finally{await f.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('native technical failure hands saved output to API; guided denial does not fall back',async()=>{
 const f=await fixture(),mock=await mockProvider();try{
  await addProvider(f,mock);const n=await native(f);const {run,project}=await start(f,{prompt:'Design a small UI'});
  await handle(f,n,run,()=>({failure:'503 service unavailable',files:[{path:'partial.txt',base64:Buffer.from('kept').toString('base64')}]}));await runState(f,run.id,'completed');
  assert.equal((await f.request(`/projects/${project.id}/file?path=partial.txt`)).value.content,'kept');assert.match(JSON.stringify(mock.requests.at(-1).messages),/partial changes may already be saved/);
  const before=mock.requests.length;const denied=await start(f,{prompt:'Design another small UI',autonomy:'guided',providerId:'agy_'+n.nodeId,model:'gemini-test'});const waiting=await runState(f,denied.run.id,'waiting_approval');
  assert.equal(waiting.approvals[0].tool,'antigravity_task');await f.request('/approvals/'+waiting.approvals[0].id,{method:'POST',body:{approved:false}});await runState(f,denied.run.id,'failed');assert.equal(mock.requests.length,before);
 }finally{await mock.close();await f.close();}
});

test('exit 3 native quota hands partial files to another model and skips the exhausted model on the next task',async()=>{
 const f=await fixture(),mock=await mockProvider();try{
  await addProvider(f,mock);const n=await native(f);const {run,project}=await start(f,{prompt:'Design a small UI'});
  const error=nativeCliError(3,'AGY_ERROR: '+JSON.stringify({status:'RESOURCE_EXHAUSTED',error_code:429,short_error:'Individual quota reached. Resets in 2h12m32s.'}));
  await handle(f,n,run,()=>({failure:error.message,providerError:error.providerError,conversationId:'12345678-1234-1234-1234-123456789012',files:[{path:'partial.txt',base64:Buffer.from('preserve completed native work').toString('base64')}]}));
  const done=await runState(f,run.id,'completed');assert.equal(done.approvals.length,0);assert.ok(done.events.some(e=>e.type==='model_handoff'));
  const cooldown=done.events.find(e=>e.type==='model_cooldown');assert.equal(cooldown.data.kind,'quota');assert.equal(cooldown.data.retryAfterMs,7952000);
  assert.equal((await f.request(`/projects/${project.id}/file?path=partial.txt`)).value.content,'preserve completed native work');
  assert.match(JSON.stringify(mock.requests.at(-1).messages),/partial changes may already be saved/);
  const next=await start(f,{prompt:'Design another small UI'});await runState(f,next.run.id,'completed');
  assert.equal(f.store.one("SELECT count(*) n FROM commands WHERE run_id=? AND tool='antigravity_task'",next.run.id).n,0);
 }finally{await mock.close();await f.close();}
});

test('cloud automatic routing excludes desktop native accounts; local scope includes only selected node',()=>{
 const rows=[{id:'cloud',enabled:true,protocol:'antigravity-cli',hosted:true,node_id:'server',models:['gemini-pro']},{id:'desktop',enabled:true,protocol:'antigravity-cli',node_id:'pc',models:['gemini-pro']},{id:'offline',enabled:false,protocol:'antigravity-cli',hosted:true,models:['gemini-pro']}];
 assert.deepEqual(rankModels(rows,'design',new Set(),{nativeNode:'hosted'}).map(x=>x.providerId),['cloud']);
 assert.deepEqual(rankModels(rows,'design',new Set(),{nativeNode:'pc'}).map(x=>x.providerId),['desktop']);
});
