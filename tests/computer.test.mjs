import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fixture,mockProvider,addProvider,createRun,runState,until} from './helpers.mjs';
import {browserUrl,computerToken} from '../server/computer.mjs';
import {HttpError,id,now} from '../server/security.mjs';
async function setup(openDelay=0){
  let runtimeMissing=false,denyNavigation=false;const commands=[];const mock=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks));commands.push({route:req.url,body,auth:req.headers.authorization});if(req.url==='/open'&&openDelay)await new Promise(r=>setTimeout(r,openDelay));if(req.url==='/status'&&runtimeMissing){runtimeMissing=false;res.writeHead(404);res.end(JSON.stringify({error:'Session lost'}));return;}res.setHeader('content-type','application/json');if(req.url==='/action'&&body.action==='navigate'&&denyNavigation){res.writeHead(424);res.end(JSON.stringify({error:'Sayt bulut brauzeridagi so‘rovni rad etdi. Lokal brauzerda qayta ochish kerak.'}));return;}if(req.url==='/capture'){res.end(JSON.stringify({url:'https://example.com/',mobile:true,atBottom:true,frames:[{title:'Example',scrollY:0,width:390,height:844,image:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC0lEQVR42mP8/x8AAwMCAO+a0e8AAAAASUVORK5CYII=',design:{styles:[]}}],assets:[],missingAssets:[]}));return;}res.end(JSON.stringify({url:'https://example.com/',title:'Example',text:'Hello',revision:'rev-1',image:'aW1hZ2U=',elements:[{id:1,tag:'a',label:'More'}],blocked:[]}));});
  mock.listen(0,'127.0.0.1');await new Promise(r=>mock.once('listening',r));
  const f=await fixture({computerUrl:`http://127.0.0.1:${mock.address().port}`,runnerToken:'computer-test-token'});const user=(await f.request('/me')).value.user;
  const project=id('prj_');f.store.exec('INSERT INTO projects(id,user_id,title,environment,created_at,updated_at) VALUES(?,?,?,?,?,?)',project,user.id,'Computer QA','cloud',now(),now());
  return {f,project,commands,user,restartRuntime:()=>{runtimeMissing=true;},denyNavigation:()=>{denyNavigation=true;},close:async()=>{await f.close();mock.closeAllConnections();await new Promise(r=>mock.close(r));}};
}
test('computer URL rejects unsafe protocols, credentials, ports',()=>{for(const value of ['file:///etc/passwd','http://example.com','https://user:pass@example.com','https://example.com:8443'])assert.throws(()=>browserUrl(value));assert.equal(browserUrl('https://example.com/search?q=test').hostname,'example.com');});

test('a denied cloud navigation retries once in an online local Chrome connector',async()=>{
 const x=await setup();try{
  const localNode={id:'node_'+'a'.repeat(24),name:'Owner PC',platform:'win32',online:true,capabilities:['computer_browser_v1']};
  const originalList=x.f.nodes.list;x.f.nodes.list=()=>[localNode];
  const localCalls=[];x.f.nodes.dispatch=async(_project,_run,_tool,{route,body})=>{localCalls.push(route);return {url:route==='/action'?body.url:'about:blank',title:'Local',text:'',revision:'local-rev',elements:[],image:'',blocked:[]};};
  await x.f.computer.ensureAgent(x.user.id,x.project);x.denyNavigation();
  const result=await x.f.computer.action(x.user.id,x.project,{action:'navigate',url:'https://x.com'},'agent');
  assert.equal(result.url,'https://x.com/');
  assert.equal(result.runtime,'local');
  assert.equal((await x.f.request(`/projects/${x.project}/computer`)).value.session.runtime,'local');
  assert.equal(x.commands.filter(c=>c.route==='/action').length,1);
  assert.equal(localCalls.filter(route=>route==='/reconcile').length,1);
  assert.equal(localCalls.filter(route=>route==='/action').length,1);
  x.f.nodes.list=originalList;
 }finally{await x.close();}
});

test('a user-controlled cloud navigation moves to local Chrome without giving control back to the agent',async()=>{
 const x=await setup();try{
  const localNode={id:'node_'+'c'.repeat(24),name:'Owner PC',platform:'win32',online:true,capabilities:['computer_browser_v1']};
  x.f.nodes.list=()=>[localNode];
  const localCalls=[];x.f.nodes.dispatch=async(_project,_run,_tool,{route,body})=>{localCalls.push(route);return {url:route==='/action'?body.url:'about:blank',title:'Local',text:'',revision:'local-rev',elements:[],image:'',blocked:[]};};
  await x.f.computer.ensureAgent(x.user.id,x.project);
  await x.f.request(`/projects/${x.project}/computer/control`,{method:'POST',body:{mode:'user'}});
  x.denyNavigation();
  const response=await x.f.request(`/projects/${x.project}/computer/action`,{method:'POST',body:{action:'navigate',url:'https://x.com/home'}});
  assert.equal(response.status,200);assert.equal(response.value.runtime,'local');assert.equal(response.value.mode,'user');
  assert.equal(response.value.url,'https://x.com/home');
  assert.equal((await x.f.request(`/projects/${x.project}/computer`)).value.session.mode,'user');
  assert.equal(localCalls.filter(route=>route==='/action').length,1);
  await assert.rejects(x.f.computer.ensureAgent(x.user.id,x.project),/to‘xtatgan/);
 }finally{await x.close();}
});

test('cloud rejection during a login handoff keeps the handoff in the local browser',async()=>{
 const x=await setup();try{
  x.f.nodes.list=()=>[{id:'node_'+'d'.repeat(24),name:'Owner PC',platform:'win32',online:true,capabilities:['computer_browser_v1']}];
  x.f.nodes.dispatch=async(_project,_run,_tool,{route,body})=>({url:route==='/action'?body.url:'about:blank',title:'Local',text:'',revision:'local-rev',elements:[],image:'',blocked:[]});
  await x.f.computer.ensureAgent(x.user.id,x.project);
  x.f.computer.beginHandoff(x.user.id,x.project,'Loginni o‘zingiz yakunlang.');
  x.denyNavigation();
  const response=await x.f.request(`/projects/${x.project}/computer/action`,{method:'POST',body:{action:'navigate',url:'https://x.com/home'}});
  assert.equal(response.status,200);assert.equal(response.value.mode,'user');
  assert.equal((await x.f.request(`/projects/${x.project}/computer`)).value.session.handoff.reason,'Loginni o‘zingiz yakunlang.');
 }finally{await x.close();}
});

test('cloud rejection explains an offline local connector without discarding the current session',async()=>{
 const x=await setup();try{
  await x.f.computer.ensureAgent(x.user.id,x.project);
  await x.f.request(`/projects/${x.project}/computer/control`,{method:'POST',body:{mode:'user'}});
  x.denyNavigation();
  const response=await x.f.request(`/projects/${x.project}/computer/action`,{method:'POST',body:{action:'navigate',url:'https://x.com/home'}});
  assert.equal(response.status,503);assert.match(response.value.error,/connector offline/i);
  assert.equal((await x.f.request(`/projects/${x.project}/computer`)).value.session.runtime,'cloud');
 }finally{await x.close();}
});

test('a denied cloud navigation tries another online local connector when the first cannot open',async()=>{
 const x=await setup();try{
  const first={id:'node_'+'a'.repeat(24),name:'Stale PC',platform:'win32',online:true,capabilities:['computer_browser_v1']};
  const second={id:'node_'+'b'.repeat(24),name:'Ready PC',platform:'win32',online:true,capabilities:['computer_browser_v1']};
  x.f.nodes.list=()=>[first,second];
  const attempts=[];
  x.f.nodes.dispatch=async(project,_run,_tool,{route,body})=>{
   attempts.push({nodeId:project.node_id,route});
   if(route==='/open'&&project.node_id===first.id)throw new HttpError(502,'Old connector failed');
   return {url:route==='/action'?body.url:'about:blank',title:'Local',text:'',revision:'local-rev',elements:[],image:'',blocked:[]};
  };
  await x.f.computer.ensureAgent(x.user.id,x.project);x.denyNavigation();
  const result=await x.f.computer.action(x.user.id,x.project,{action:'navigate',url:'https://x.com'},'agent');
  assert.equal(result.url,'https://x.com/');assert.equal(result.runtime,'local');
  assert.deepEqual(attempts.filter(item=>item.route==='/open').map(item=>item.nodeId),[first.id,second.id]);
  assert.equal(x.f.store.setting('computer-runtime:'+x.project).nodeId,second.id);
 }finally{await x.close();}
});

test('agent recreates its missing browser after a runtime restart',async()=>{
 const x=await setup();try{
  await x.f.computer.ensureAgent(x.user.id,x.project);x.restartRuntime();
  await x.f.computer.ensureAgent(x.user.id,x.project);
  assert.equal(x.commands.filter(c=>c.route==='/open').length,2);
  assert.equal((await x.f.request(`/projects/${x.project}/computer`)).value.session.mode,'agent');
 }finally{await x.close();}
});

test('live UI polling cannot close a Chromium session while it is still opening',async()=>{
 const x=await setup(350);try{
  const opening=x.f.computer.ensureAgent(x.user.id,x.project);
  await until(async()=>x.commands.some(c=>c.route==='/open'));
  const pending=await x.f.request(`/projects/${x.project}/computer`);assert.equal(pending.status,200);assert.equal(pending.value.waiting,true);assert.equal(pending.value.session,null);
  assert.equal(x.commands.filter(c=>c.route==='/state'||c.route==='/close').length,0);
  const duplicate=await x.f.request(`/projects/${x.project}/computer`,{method:'POST',body:{mode:'agent'}});assert.equal(duplicate.status,202);assert.equal(duplicate.value.waiting,true);
  await opening;const ready=await x.f.request(`/projects/${x.project}/computer`);assert.ok(ready.value.session);assert.equal(ready.value.waiting,false);
 }finally{await x.close();}
});

test('clone capture persists real evidence and supplies screenshot vision to the next model call without logging image payloads',async()=>{
 const x=await setup(),mock=await mockProvider();try{
  const provider=await addProvider(x.f,mock);const {run}=await createRun(x.f,provider,'_CAPTURE_ source website',{projectId:x.project,autonomy:'automatic'});
  const done=await runState(x.f,run.id,'completed');
  const event=done.events.find(e=>e.type==='tool_result'&&e.data.tool==='computer_capture');assert.ok(event.data.result.manifestPath);assert.equal(event.data.result.frames.length,1);
  assert.equal(event.data.result._images,undefined);assert.ok(!JSON.stringify(done.events).includes('iVBOR'));
  assert.ok(mock.requests.some(r=>r.messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='image_url'&&c.image_url.url.startsWith('data:image/png;base64,')))));
  assert.equal(x.commands.filter(c=>c.route==='/capture').length,1);
  assert.equal(x.f.store.all('SELECT id FROM approvals WHERE run_id=?',run.id).length,0);
 }finally{await mock.close();await x.close();}
});

test('automatic sessions reclaim completed projects, serialize opens and queue without interrupting active work',async()=>{
 const x=await setup();const {f,user,project,commands}=x;
 const makeProject=()=>{const p=id('prj_');f.store.exec('INSERT INTO projects(id,user_id,title,environment,created_at,updated_at) VALUES(?,?,?,?,?,?)',p,user.id,'Session regression','cloud',now(),now());return p;};
 const markActive=p=>{const r=id('run_');f.store.exec("INSERT INTO runs(id,user_id,project_id,status) VALUES(?,?,?,'running')",r,user.id,p);return r;};
 try{
   const second=makeProject(),third=makeProject();
   await Promise.all([f.computer.ensureAgent(user.id,project),f.computer.ensureAgent(user.id,project)]);
   assert.equal(commands.filter(c=>c.route==='/open').length,1);
   assert.equal(commands[0].route,'/reconcile');
   const firstRun=markActive(project);await f.computer.ensureAgent(user.id,second);markActive(second);
   assert.equal(commands.filter(c=>c.route==='/open').length,2,'same account may use both slots');
   const controller=new AbortController();const pending=f.computer.ensureAgent(user.id,third,controller.signal);
   const rejected=assert.rejects(pending,{name:'AbortError'});
   await until(async()=>(await f.request(`/projects/${third}/computer`)).value.waiting);
   assert.equal(commands.filter(c=>c.route==='/close').length,0,'active sessions must not be closed');controller.abort();await rejected;
   assert.equal((await f.request(`/projects/${third}/computer`)).value.waiting,false);
   const queued=await f.request(`/projects/${third}/computer`,{method:'POST',body:{mode:'agent'}});assert.equal(queued.status,202);
   f.store.exec("UPDATE runs SET status='completed' WHERE id=?",firstRun);
   const ready=await until(async()=>{const s=(await f.request(`/projects/${third}/computer`)).value.session;return s||null;});
   assert.equal(ready.mode,'agent');assert.equal(commands.filter(c=>c.route==='/close').length,1);
   assert.equal((await f.request(`/projects/${project}/computer`)).value.session,null);
   assert.ok((await f.request(`/projects/${second}/computer`)).value.session);
   assert.equal(commands.filter(c=>c.route==='/reconcile').length,1);
 }finally{await x.close();}
});

test('manual browser ownership is preserved while a queued opening can be cancelled',async()=>{
 const x=await setup();const {f,user,project,commands}=x;try{
   const others=[id('prj_'),id('prj_')];for(const p of others)f.store.exec('INSERT INTO projects(id,user_id,title,environment,created_at,updated_at) VALUES(?,?,?,?,?,?)',p,user.id,'Manual browser','cloud',now(),now());
   await f.request(`/projects/${project}/computer`,{method:'POST',body:{}});await f.request(`/projects/${others[0]}/computer`,{method:'POST',body:{}});
   assert.equal((await f.request(`/projects/${others[1]}/computer`,{method:'POST',body:{mode:'agent'}})).status,202);
   assert.equal(commands.filter(c=>c.route==='/close').length,0);
   await f.request(`/projects/${others[1]}/computer`,{method:'DELETE'});
   await until(async()=>!(await f.request(`/projects/${others[1]}/computer`)).value.waiting);
   assert.equal(commands.filter(c=>c.route==='/open').length,2);
 }finally{await x.close();}
});

test('automatic browser opens on demand, performs actions without approval, and respects takeover and close',async()=>{
 const x=await setup(),mock=await mockProvider();const {f,project,commands,user}=x;try{
  const provider=await addProvider(f,mock);const {run}=await createRun(f,provider,'_COMPUTER_APPROVAL_',{projectId:project,autonomy:'automatic'});await runState(f,run.id,'completed');
  assert.equal(commands.filter(c=>c.route==='/open').length,1);assert.equal(commands.filter(c=>c.route==='/action').length,1);assert.equal(f.store.all('SELECT * FROM approvals WHERE run_id=?',run.id).length,0);
  await f.request(`/projects/${project}/computer/control`,{method:'POST',body:{mode:'user'}});await assert.rejects(f.computer.ensureAgent(user.id,project),/to‘xtatgan/);
  await f.request(`/projects/${project}/computer/control`,{method:'POST',body:{mode:'agent'}});await f.computer.ensureAgent(user.id,project);
  await f.request(`/projects/${project}/computer`,{method:'DELETE'});await assert.rejects(f.computer.ensureAgent(user.id,project),/to‘xtatgan/);assert.equal(commands.filter(c=>c.route==='/open').length,1);
 }finally{await mock.close();await x.close();}
});

test('active agent submit action carries one short same-site write grant to the browser',async()=>{
 const x=await setup();try{
  await x.f.computer.ensureAgent(x.user.id,x.project);
  const runId=id('run_');x.f.store.exec("INSERT INTO runs(id,user_id,project_id,status) VALUES(?,?,?,'running')",runId,x.user.id,x.project);
  const result=await x.f.computer.tool('computer_action',{action:'submit',target:1,revision:'rev-1'},{id:runId,user_id:x.user.id,prompt:'Submit a form'}, {id:x.project},new AbortController().signal);
  const command=x.commands.find(c=>c.route==='/action');assert.equal(command.body.action,'submit');
  assert.equal(command.body.formWrite.origin,'https://example.com');assert.equal(command.body.formWrite.remaining,1);assert.equal(command.body.formWrite.runId,runId);
  assert.equal(result.source,'untrusted_browser_content');
  await x.f.computer.tool('computer_action',{action:'click',target:1,revision:'rev-1'},{id:runId,user_id:x.user.id,prompt:'Submit a form'}, {id:x.project},new AbortController().signal);
  assert.equal(x.commands.filter(c=>c.route==='/action')[1].body.formWrite,null);
 }finally{await x.close();}
});
test('computer session lifecycle, manual handoff, private audit, and owner boundary',async()=>{
  const x=await setup();const {f,project,commands}=x;try{
    assert.equal((await f.request(`/projects/${project}/computer`,{method:'POST',body:{}})).status,201);
    assert.equal((await f.request(`/projects/${project}/computer`,{method:'POST',body:{}})).status,200);
    assert.equal(commands[0].auth,`Bearer ${computerToken(f.config)}`);
    assert.equal((await f.request(`/projects/${project}/computer/action`,{method:'POST',body:{action:'fill',target:1,revision:'rev-1',value:'PRIVATE_FORM_VALUE'}})).status,200);
    const state=(await f.request(`/projects/${project}/computer`)).value;assert.ok(!JSON.stringify(state.audit).includes('PRIVATE_FORM_VALUE'));
    assert.equal((await f.request(`/projects/${project}/computer/control`,{method:'POST',body:{mode:'agent'}})).status,200);
    assert.equal((await f.request(`/projects/${project}/computer/action`,{method:'POST',body:{action:'scroll',direction:'down'}})).status,409);
    assert.equal((await f.request('/projects/prj_000000000000000000000000/computer')).status,404);
    assert.equal((await f.request(`/projects/${project}/computer`,{method:'DELETE'})).status,200);
    assert.equal((await f.request(`/projects/${project}/computer`)).value.session,null);
    await assert.rejects(()=>f.computer.action(x.user.id,project,{action:'scroll'},'agent'));
  }finally{await x.close();}
});
test('computer gateway requires secret/live session and denies queued write without approval',async()=>{
  const x=await setup();const {f,project,commands}=x;try{
    assert.equal((await f.request('/computer-gateway',{method:'POST',body:{}})).status,401);
    await f.request(`/projects/${project}/computer`,{method:'POST',body:{}});const session=commands.find(c=>c.route==='/open').body.id;
    const headers={authorization:`Bearer ${computerToken(f.config)}`};
    assert.equal((await f.request('/computer-gateway',{method:'POST',headers,body:{session:'unknown',url:'https://example.com',method:'GET',headers:{}}})).status,403);
    assert.equal((await f.request('/computer-gateway',{method:'POST',headers,body:{session,url:'https://10.0.0.1',method:'GET',headers:{}}})).status,400);
    const pending=f.request('/computer-gateway',{method:'POST',headers,body:{session,url:'https://example.com/form',method:'POST',headers:{},body:Buffer.from('message=hello').toString('base64')}});
    const state=await until(async()=>{const r=(await f.request(`/projects/${project}/computer`)).value;return r.session.pending.length?r:null;});
    assert.equal('body' in state.session.pending[0],false);assert.equal(state.session.pending[0].url,'https://example.com/form');
    await f.request(`/projects/${project}/computer/network`,{method:'POST',body:{id:state.session.pending[0].id,approved:false}});
    assert.equal((await pending).status,403);
    assert.equal((await f.request(`/projects/${project}/computer`)).value.session.pending.length,0);
  }finally{await x.close();}
});

test('local connector waits for an owner-approved cross-site write while the live panel stays responsive',async()=>{
 const x=await setup();const {f,project,user}=x;let pumping=true,approvalStatus=null;
 const pair=(await f.request('/nodes/pair-code',{method:'POST',body:{}})).value;
 const paired=(await f.request('/connector/pair',{method:'POST',body:{code:pair.code,name:'Browser approval QA',platform:'win32',workspace:'QA'}})).value;
 const node=f.nodes.authenticate({get:()=>`Bearer ${paired.token}`});f.nodes.heartbeat(node,['computer_browser_v1']);
 f.store.setSetting('computer-runtime:'+project,{kind:'local',nodeId:node.id});
 const screen={url:'https://forms.example/',title:'Form',text:'Ready',revision:'rev-1',image:'aW1hZ2U=',elements:[{id:1,tag:'button',label:'Submit'}],blocked:[]};
 const pump=(async()=>{while(pumping){const command=f.nodes.poll(node).command;if(!command){await new Promise(r=>setTimeout(r,15));continue;}
  if(command.args.route==='/action'){
   const approval=f.request('/connector/computer-network',{method:'POST',headers:{authorization:`Bearer ${paired.token}`},body:{session:command.args.body.id,url:'https://api.forms.example/save',method:'POST',bytes:12}});
   void approval.then(value=>{approvalStatus=value.status;f.nodes.result(node,command.id,screen);}).catch(()=>f.nodes.result(node,command.id,screen));
  }else f.nodes.result(node,command.id,command.args.route==='/reconcile'?{ok:true}:screen);
 }})();
 try{
  await f.computer.ensureAgent(user.id,project);
  const runId=id('run_');f.store.exec("INSERT INTO runs(id,user_id,project_id,status) VALUES(?,?,?,'running')",runId,user.id,project);
  const result=f.computer.tool('computer_action',{action:'submit',target:1,revision:'rev-1'},{id:runId,user_id:user.id,prompt:'Submit the form'},{id:project},new AbortController().signal);void result.catch(()=>{});
  const pending=await until(async()=>{const value=(await f.request(`/projects/${project}/computer`)).value;return value.session?.pending?.length?value.session:null;});
  assert.equal(pending.pending[0].url,'https://api.forms.example/save');assert.equal('body' in pending.pending[0],false);
  assert.equal((await f.request(`/projects/${project}/computer/network`,{method:'POST',body:{id:pending.pending[0].id,approved:true}})).status,200);
  assert.equal((await result).source,'untrusted_browser_content');assert.equal(approvalStatus,200);
 }finally{await f.request(`/projects/${project}/computer`,{method:'DELETE'}).catch(()=>{});pumping=false;await pump;await x.close();}
});
test('closing computer rejects pending network writes and blocks agent in human mode',async()=>{
  const x=await setup();try{const {f,project,commands}=x;await f.request(`/projects/${project}/computer`,{method:'POST',body:{}});
    await assert.rejects(()=>f.computer.action(x.user.id,project,{action:'navigate',url:'https://example.com'},'agent'),/foydalanuvchida/);
    const pending=f.request('/computer-gateway',{method:'POST',headers:{authorization:`Bearer ${computerToken(f.config)}`},body:{session:commands.find(c=>c.route==='/open').body.id,url:'https://example.com',method:'DELETE',headers:{}}});
    await until(async()=> (await f.request(`/projects/${project}/computer`)).value.session.pending.length);
    await f.request(`/projects/${project}/computer`,{method:'DELETE'});assert.equal((await pending).status,403);
  }finally{await x.close();}
});
test('dashboard action persists and starts real runner; panels require owned project',async()=>{
  const x=await setup();const mock=await mockProvider();try{const {f,project}=x;const provider=await addProvider(f,mock);
    assert.equal((await f.request('/dashboard',{method:'POST',body:{title:'Invalid panel',kind:'panel',projectId:'foreign'}})).status,404);
    const card=(await f.request('/dashboard',{method:'POST',body:{title:'Quick report',kind:'action',prompt:'Write a short report',providerId:provider.id,model:'qa-model',projectId:project}})).value;
    assert.ok(card.id);assert.equal((await f.request('/dashboard')).value.length,1);
    const start=await f.request(`/dashboard/${card.id}/run`,{method:'POST',body:{}});assert.equal(start.status,201,JSON.stringify(start.value));await runState(f,start.value.run.id,'completed');
    await f.request(`/dashboard/${card.id}`,{method:'DELETE'});assert.equal((await f.request('/dashboard')).value.length,0);
  }finally{await mock.close();await x.close();}
});
test('agent browser actions require contextual approval; denied action never reaches browser',async()=>{
 const x=await setup();const mock=await mockProvider();try{const {f,project,commands}=x;const provider=await addProvider(f,mock);
   await f.request(`/projects/${project}/computer`,{method:'POST',body:{}});
   await f.request(`/projects/${project}/computer/control`,{method:'POST',body:{mode:'agent'}});
   const {run}=await createRun(f,provider,'_COMPUTER_APPROVAL_',{projectId:project});
   const waiting=await runState(f,run.id,'waiting_approval');assert.equal(waiting.approvals[0].args.element,'More');assert.equal(waiting.approvals[0].args.currentPage,'https://example.com/');
   assert.equal(commands.filter(c=>c.route==='/action').length,0);
   await f.request(`/approvals/${waiting.approvals[0].id}`,{method:'POST',body:{approved:false}});
   await runState(f,run.id,'completed');assert.equal(commands.filter(c=>c.route==='/action').length,0);
   const second=await createRun(f,provider,'_COMPUTER_APPROVAL_',{projectId:project});const ready=await runState(f,second.run.id,'waiting_approval');
   await f.request(`/approvals/${ready.approvals[0].id}`,{method:'POST',body:{approved:true}});
   await runState(f,second.run.id,'completed');assert.equal(commands.filter(c=>c.route==='/action').length,1);
   const third=await createRun(f,provider,'_COMPUTER_APPROVAL_',{projectId:project});const pause=await runState(f,third.run.id,'waiting_approval');
   await f.request(`/projects/${project}/computer/control`,{method:'POST',body:{mode:'user'}});
   await f.request(`/approvals/${pause.approvals[0].id}`,{method:'POST',body:{approved:true}});
   await runState(f,third.run.id,'completed');assert.equal(commands.filter(c=>c.route==='/action').length,1);
 }finally{await mock.close();await x.close();}
});


