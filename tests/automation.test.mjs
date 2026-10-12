import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture,until,mockProvider,addProvider,createRun,runState} from './helpers.mjs';
import {apiTarget,automationSchemas} from '../server/automation.mjs';
import {id,now} from '../server/security.mjs';
const VERCEL='qa-only-vercel-token-123456789';
const BOT='123456789:qa_only_bot_token_not_real_123456789';
function external(){
 const calls=[],state={build:'READY',http:200,failUpload:false,unauthorized:false};
 const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
 const fetcher=async(input,options={})=>{const url=new URL(input);let body=options.body;if(typeof body==='string'){try{body=JSON.parse(body);}catch{}}calls.push({url:url.toString(),method:options.method||'GET',headers:options.headers,body});
  if(url.hostname==='qa.vercel.app')return new Response('QA',{status:state.uniqueHttp||state.http,...(state.uniqueHttp===302?{headers:{location:'https://vercel.com/sso-api?url=qa'}}:{})});
  if(/^opensi-[a-f0-9]{24}\.vercel\.app$/.test(url.hostname))return new Response('QA production',{status:state.http});
  if(url.hostname==='example.com')return json({ok:true,echo:body,leaked:options.headers?.Authorization});
  if(url.hostname==='api.vercel.com'&&state.unauthorized)return new Response(JSON.stringify({error:{message:'Unauthorized'}}),{status:401,headers:{'content-type':'application/json'}});
  if(url.pathname.endsWith('/getMe'))return json({ok:true,result:{id:123456789,is_bot:true,username:'qa_bot'}});
  if(url.pathname.includes('/bot'))return json({ok:true,result:true});
  if(url.pathname==='/v9/projects')return json({projects:[]});
  if(url.pathname==='/v11/projects')return json({id:'prj_remote'});
  if(url.pathname.endsWith('/env'))return json({created:body});
  if(url.pathname==='/v2/files'){if(state.failUpload)throw new Error('network failed '+VERCEL);return json({});}
  if(url.pathname==='/v13/deployments')return json({id:'dpl_remote',url:'qa.vercel.app',readyState:'BUILDING'});
  if(url.pathname==='/v13/deployments/dpl_remote')return json({id:'dpl_remote',url:'qa.vercel.app',readyState:state.build,errorMessage:state.build==='ERROR'?'Build failed '+BOT:null});
  if(url.pathname.endsWith('/events'))return json([{text:'build log '+BOT}]);
  throw new Error('Unexpected mock API '+url);
 };return {calls,state,fetcher};
}
async function connection(f,kind='vercel',automatic=true){const r=await f.request('/integrations',{method:'POST',body:{label:'QA '+kind,kind,token:kind==='telegram'?BOT:kind==='vercel'?VERCEL:'qa-http-token-12345678',automatic,...(kind==='http'?{baseUrl:'https://example.com/v1',methods:['GET','POST']}:{})}});assert.equal(r.status,201,JSON.stringify(r.value));return r.value;}
async function context(f,automatic=true){const p={id:id('prj_'),user_id:'local-owner',title:'Deploy QA',environment:'cloud',node_id:null};f.store.exec('INSERT INTO projects VALUES(?,?,?,?,?,?,?)',p.id,p.user_id,p.title,p.environment,null,now(),now());f.store.exec('INSERT INTO project_execution VALUES(?,?)',p.id,automatic?'automatic':'guided');const root=path.join(f.dataDir,'workspaces',p.user_id,p.id);await mkdir(root,{recursive:true});await writeFile(path.join(root,'index.html'),'<h1>Deploy QA</h1>');return {project:p,run:{id:id('run_'),user_id:p.user_id,project_id:p.id},root,signal:AbortSignal.timeout(30000)};}
const invoke=(f,c,name,args,approve)=>f.automation.tool(name,args,c.run,c.project,c.signal,approve);
test('integration credentials are encrypted, never returned; scoped revocation and validation',async()=>{
 const mock=external(),f=await fixture({automationFetch:mock.fetcher});try{
  const c=await connection(f);assert.equal(c.tested_at!==null,true);assert.ok(!JSON.stringify(c).includes(VERCEL));assert.ok(!f.store.one('SELECT secret FROM integrations WHERE id=?',c.id).secret.includes(VERCEL));
  assert.equal((await f.request('/integrations',{method:'POST',body:{kind:'telegram',label:'bad',token:'not-a-bot-token'}})).status,400);
  const ctx=await context(f);await assert.rejects(()=>f.automation.tool('integration_catalog',{}, {...ctx.run,user_id:'other'},ctx.project,ctx.signal),/topilmadi/);
  await f.request('/integrations/'+c.id,{method:'PATCH',body:{enabled:false}});assert.equal(f.store.one('SELECT secret FROM integrations WHERE id=?',c.id).secret,'');await assert.rejects(()=>invoke(f,ctx,'deploy_vercel',{connectionId:c.id,requestId:'disabled'}),/o‘chirilgan/);
 }finally{await f.close();}
});
test('waiting deploy task resumes automatically after its owner connects a team-scoped Vercel account',async()=>{
 const externalApi=external(),f=await fixture({automationFetch:externalApi.fetcher}),model=await mockProvider();
 try{
  const provider=await addProvider(f,model),created=await createRun(f,provider,'_WAIT_INTEGRATION_ deploy after login');
  const pending=await until(()=>f.store.one("SELECT * FROM approvals WHERE run_id=? AND status='pending'",created.run.id));
  assert.equal(pending.tool,'await_integration');assert.equal(JSON.parse(pending.args).kind,'vercel');
  assert.equal(f.store.one('SELECT status FROM runs WHERE id=?',created.run.id).status,'waiting_input');
  f.runner.integrationConnected('other-user','vercel');
  assert.equal(f.store.one('SELECT status FROM approvals WHERE id=?',pending.id).status,'pending');
  const saved=await f.request('/integrations',{method:'POST',body:{kind:'vercel',label:'My Vercel team',token:VERCEL,teamId:'team_123',automatic:true}});
  assert.equal(saved.status,201,JSON.stringify(saved.value));
  assert.equal(saved.value.teamId,'team_123');assert.ok(!JSON.stringify(saved.value).includes(VERCEL));
  assert.ok(externalApi.calls.some(c=>new URL(c.url).searchParams.get('teamId')==='team_123'));
  await runState(f,created.run.id,'completed');
  assert.equal(f.store.one('SELECT status FROM approvals WHERE id=?',pending.id).status,'approved');
  assert.ok(model.requests.some(r=>r.messages.some(m=>m.role==='tool'&&String(m.content).includes(saved.value.id))));
 }finally{await f.close();await model.close();}
});
test('expired Vercel token is marked unavailable and a replacement can resume the same task',async()=>{
 const mock=external(),f=await fixture({automationFetch:mock.fetcher});
 try{
  const stale=await connection(f),ctx=await context(f);
  mock.state.unauthorized=true;
  await assert.rejects(()=>invoke(f,ctx,'deploy_vercel',{connectionId:stale.id,requestId:'expired'}),/muddati tugagan/);
  const invalid=f.store.one('SELECT tested_at,automatic FROM integrations WHERE id=?',stale.id);
  assert.equal(invalid.tested_at,null);assert.equal(invalid.automatic,0);
  mock.state.unauthorized=false;
  const fresh=await connection(f);
  const result=await invoke(f,ctx,'await_integration',{kind:'vercel',excludeConnectionId:stale.id});
  assert.equal(result.connection.id,fresh.id);assert.equal(result.resumed,false);
  assert.ok(!JSON.stringify(result).includes(VERCEL));
 }finally{await f.close();}
});
test('Vercel uploads real binary and source files, injects server env, persists build status and redacts logs',async()=>{
 const mock=external(),f=await fixture({automationFetch:mock.fetcher});try{const c=await connection(f),bot=await connection(f,'telegram'),ctx=await context(f);await writeFile(path.join(ctx.root,'icon.png'),Buffer.from([137,80,78,71,0,255]));await writeFile(path.join(ctx.root,'.env'),'SECRET');await mkdir(path.join(ctx.root,'inputs'));await writeFile(path.join(ctx.root,'inputs','private.txt'),'PRIVATE');
  const args={connectionId:c.id,requestId:'deploy1',framework:'static',target:'production',envRefs:{TELEGRAM_BOT_TOKEN:bot.id}};
  const started=await invoke(f,ctx,'deploy_vercel',args);assert.equal(started.status,'BUILDING');assert.equal(started.files,2);assert.equal(started.productionUrl,`https://opensi-${ctx.project.id.slice(4)}.vercel.app`);
  const uploaded=mock.calls.filter(c=>c.url.includes('/v2/files'));assert.equal(uploaded.length,2);assert.ok(uploaded.some(c=>Buffer.isBuffer(c.body)&&c.body[0]===137));
  const env=mock.calls.find(c=>c.url.includes('/env?')).body;assert.equal(env.find(e=>e.key==='TELEGRAM_BOT_TOKEN').value,BOT);assert.ok(env.some(e=>e.key==='TELEGRAM_WEBHOOK_SECRET'));assert.ok(env.every(e=>e.type==='encrypted'));
  const body=mock.calls.find(c=>c.url.endsWith('/v13/deployments')).body;assert.equal(body.target,'production');assert.equal(body.files.some(f=>f.file==='.env'),false);assert.equal(body.project,'prj_remote');assert.equal(body.projectSettings.framework,null);
  mock.state.uniqueHttp=302;
  const checked=await invoke(f,ctx,'deployment_status',{deploymentId:started.deploymentId});assert.equal(checked.status,'READY');assert.equal(checked.httpStatus,200);assert.equal(checked.productionUrl,started.productionUrl);assert.ok(mock.calls.some(call=>call.url===started.productionUrl+'/'));assert.ok(!JSON.stringify(checked).includes(BOT));
  const hooked=await invoke(f,ctx,'telegram_bot',{connectionId:bot.id,requestId:'webhook1',operation:'setWebhook',deploymentId:started.deploymentId});assert.equal(hooked.result,true);const webhook=mock.calls.find(c=>c.url.endsWith('/setWebhook')).body;assert.equal(webhook.drop_pending_updates,false);assert.equal(webhook.url,started.productionUrl+'/api/telegram');assert.equal(webhook.secret_token,env.find(e=>e.key==='TELEGRAM_WEBHOOK_SECRET').value);
  const replay=await invoke(f,ctx,'deploy_vercel',args);assert.equal(replay.replayed,true);assert.equal(mock.calls.filter(c=>c.url.endsWith('/v13/deployments')).length,1);
  const list=await f.request('/projects/'+ctx.project.id+'/deployments');assert.equal(list.value[0].deploymentId,started.deploymentId);assert.ok(!JSON.stringify(list).includes(BOT));
 }finally{await f.close();}
});
test('Vercel includes only capture assets referenced by deployed HTML and CSS',async()=>{
 const mock=external(),f=await fixture({automationFetch:mock.fetcher});
 try{
  const c=await connection(f),ctx=await context(f);
  const capture=path.join(ctx.root,'inputs','att_capture_abcdef12');await mkdir(capture,{recursive:true});
  await writeFile(path.join(ctx.root,'index.html'),'<img src="inputs/att_capture_abcdef12/asset-1.png"><link rel="stylesheet" href="style.css">');
  await writeFile(path.join(ctx.root,'style.css'),"@font-face{src:url('inputs/att_capture_abcdef12/asset-2.woff2')}");
  await writeFile(path.join(capture,'asset-1.png'),Buffer.from([137,80,78,71]));
  await writeFile(path.join(capture,'asset-2.woff2'),Buffer.from('font'));
  await writeFile(path.join(capture,'private.txt'),'do not publish');
  const result=await invoke(f,ctx,'deploy_vercel',{connectionId:c.id,requestId:'capture-assets',framework:'static'});
  assert.equal(result.files,4);
  const files=mock.calls.find(call=>call.url.endsWith('/v13/deployments')).body.files.map(file=>file.file);
  assert.deepEqual(files.sort(),['index.html','inputs/att_capture_abcdef12/asset-1.png','inputs/att_capture_abcdef12/asset-2.woff2','style.css']);
  const repeated=await f.request(`/projects/${ctx.project.id}/deployments/${result.deploymentId}/redeploy`,{method:'POST',body:{requestKey:randomUUID()}});
  assert.equal(repeated.status,201,JSON.stringify(repeated.value));
  assert.equal(repeated.value.files,4);
  assert.equal(mock.calls.filter(call=>call.url.endsWith('/v13/deployments')).length,2);
 }finally{await f.close();}
});
test('automatic Vercel deployment publishes the same built static entry as OpenSI preview',async()=>{
 const mock=external(),f=await fixture({automationFetch:mock.fetcher});
 try{
  const c=await connection(f),ctx=await context(f),dist=path.join(ctx.root,'dist');await mkdir(path.join(dist,'assets'),{recursive:true});
  await writeFile(path.join(ctx.root,'index.html'),'<h1>old source</h1>');
  await writeFile(path.join(dist,'index.html'),'<h1>current preview</h1><script src="/assets/app.js"></script>');
  await writeFile(path.join(dist,'assets','app.js'),'document.body.dataset.ready="1"');
  const result=await invoke(f,ctx,'deploy_vercel',{connectionId:c.id,requestId:'built-preview'});
  assert.equal(result.files,2);
  const request=mock.calls.find(call=>call.url.endsWith('/v13/deployments')).body;
  assert.deepEqual(request.files.map(file=>file.file).sort(),['assets/app.js','index.html']);
  assert.equal(request.projectSettings.framework,null);
  assert.ok(mock.calls.some(call=>call.url.includes('/v2/files')&&Buffer.isBuffer(call.body)&&call.body.toString().includes('current preview')));
 }finally{await f.close();}
});
test('mutations require both opt-ins or explicit approval; unknown outcome is not repeated',async()=>{
 const mock=external(),f=await fixture({automationFetch:mock.fetcher});try{const c=await connection(f,'vercel',false),ctx=await context(f);const args={connectionId:c.id,requestId:'once'};
  await assert.rejects(()=>invoke(f,ctx,'deploy_vercel',args),/tasdi/);await assert.rejects(()=>invoke(f,ctx,'deploy_vercel',args,async()=>({approved:false})),/rad etdi/);assert.equal(mock.calls.some(c=>c.url.endsWith('/v11/projects')),false);
  mock.state.failUpload=true;await assert.rejects(()=>invoke(f,ctx,'deploy_vercel',args,async()=>({approved:true})),e=>!e.message.includes(VERCEL));const before=mock.calls.length;
  await assert.rejects(()=>invoke(f,ctx,'deploy_vercel',args,async()=>({approved:true})),/unknown/);assert.equal(mock.calls.length,before);
  await assert.rejects(()=>invoke(f,ctx,'deploy_vercel',{...args,target:'production'}),/boshqa argument/);
 }finally{await f.close();}
});
test('deploy rejects traversal, embedded credentials and public secret environment names',async()=>{
 const mock=external(),f=await fixture({automationFetch:mock.fetcher});try{const c=await connection(f),ctx=await context(f);await assert.rejects(()=>invoke(f,ctx,'deploy_vercel',{connectionId:c.id,requestId:'escape',directory:'../outside'}));await writeFile(path.join(ctx.root,'leak.js'),VERCEL);
  await assert.rejects(()=>invoke(f,ctx,'deploy_vercel',{connectionId:c.id,requestId:'leak'}),/Maxfiy kalit/);assert.equal(mock.calls.some(c=>c.url.includes('/v2/files')),false);
  assert.equal(automationSchemas.deploy_vercel.safeParse({connectionId:c.id,requestId:'env',envRefs:{VITE_TOKEN:c.id}}).success,false);
 }finally{await f.close();}
});
test('API is constrained to configured origin, base path and methods; responses redact credentials',async()=>{
 for(const bad of ['https://evil.com','//evil.com','/../outside','/%2e%2e/out','/foo\\bar','/foo#bar'])assert.throws(()=>apiTarget('https://example.com/v1',bad));assert.equal(apiTarget('https://example.com/v1','/items?limit=2'),'https://example.com/v1/items?limit=2');
 const mock=external(),f=await fixture({automationFetch:mock.fetcher});try{const c=await connection(f,'http'),ctx=await context(f);const value=await invoke(f,ctx,'api_request',{connectionId:c.id,requestId:'get1',path:'/items'});assert.equal(value.status,200);assert.ok(!value.body.includes('qa-http-token'));
  await assert.rejects(()=>invoke(f,ctx,'api_request',{connectionId:c.id,requestId:'delete',path:'/items',method:'DELETE'}),/yoqilmagan/);
  await assert.rejects(()=>invoke(f,ctx,'api_request',{connectionId:c.id,requestId:'invalid',path:'/items',method:'POST',body:'no json'}),/JSON/);
 }finally{await f.close();}
});
test('failed builds and protected deploys do not register webhook or claim reachability',async()=>{
 const mock=external(),f=await fixture({automationFetch:mock.fetcher});try{const c=await connection(f),bot=await connection(f,'telegram'),ctx=await context(f);const d=await invoke(f,ctx,'deploy_vercel',{connectionId:c.id,requestId:'deploy',envRefs:{TELEGRAM_BOT_TOKEN:bot.id}});
  mock.state.build='ERROR';const failed=await invoke(f,ctx,'deployment_status',{deploymentId:d.deploymentId});assert.equal(failed.status,'ERROR');assert.ok(!failed.error.includes(BOT));assert.equal(failed.httpStatus,undefined);
  mock.state.build='READY';mock.state.http=401;await assert.rejects(()=>invoke(f,ctx,'telegram_bot',{connectionId:bot.id,requestId:'protected',operation:'setWebhook',deploymentId:d.deploymentId}),/himoyasi/);assert.equal(mock.calls.some(c=>c.url.endsWith('/setWebhook')),false);
  const other=await context(f);await assert.rejects(()=>invoke(f,other,'deployment_status',{deploymentId:d.deploymentId}),/topilmadi/);
 }finally{await f.close();}
});
test('native manifests are run scoped and preserve external-action replay protection',async()=>{
 const mock=external(),f=await fixture({automationFetch:mock.fetcher});try{const c=await connection(f),ctx=await context(f);const manifest={version:1,runId:'old-run',actions:[{tool:'deploy_vercel',args:{connectionId:c.id,requestId:'native',framework:'static'}}]};const file=path.join(ctx.root,'opensi-actions.json');await writeFile(file,JSON.stringify(manifest));const events=[];
  assert.deepEqual(await f.automation.manifest(ctx.run,ctx.project,ctx.signal,null,(...e)=>events.push(e)),[]);manifest.runId=ctx.run.id;await writeFile(file,JSON.stringify(manifest));const first=await f.automation.manifest(ctx.run,ctx.project,ctx.signal,null,(...e)=>events.push(e));assert.equal(first[0].result.status,'BUILDING');const second=await f.automation.manifest(ctx.run,ctx.project,ctx.signal,null,()=>{});assert.equal(second[0].result.replayed,true);assert.equal(events.length,2);
 }finally{await f.close();}
});
test('API model can execute deployment tool after file creation and gets the actual result',async()=>{
 const externalApi=external(),f=await fixture({automationFetch:externalApi.fetcher}),mock=await mockProvider();try{const conn=await connection(f),provider=await addProvider(f,mock);const created=await createRun(f,provider,'_DEPLOY_FLOW_ '+conn.id);const pending=await until(()=>f.store.one("SELECT * FROM approvals WHERE run_id=? AND status='pending'",created.run.id));assert.equal(pending.tool,'deploy_vercel');await f.request('/approvals/'+pending.id,{method:'POST',body:{approved:true}});await runState(f,created.run.id,'completed');const calls=mock.requests.flatMap(r=>r.tools||[]);assert.ok(calls.some(t=>t.function.name==='deploy_vercel'));assert.equal(f.store.one('SELECT COUNT(*) AS n FROM deployments WHERE project_id=?',created.project.id).n,1);
 }finally{await f.close();await mock.close();}
});
test('native CLI receives real deploy results, checks status and completes without repeating an action',async()=>{
 const ext=external(),f=await fixture({automationFetch:ext.fetcher});try{
  const conn=await connection(f);const link=(await f.request('/nodes/pair-code',{method:'POST',body:{}})).value;
  const node=(await f.request('/connector/pair',{method:'POST',body:{code:link.code,name:'Automation native QA',platform:'test',workspace:'test'}})).value;
  const call=(route,body)=>f.request('/connector/'+route,{method:'POST',body,headers:{authorization:'Bearer '+node.token}});
  await call('agent-catalog',{models:[{id:'gemini-test',label:'Gemini QA'}]});f.store.setSetting('hosted-antigravity:'+node.nodeId,{owner:'local-owner'});
  const created=(await f.request('/runs',{method:'POST',body:{prompt:'Deploy a QA page',providerId:'agy_'+node.nodeId,model:'gemini-test',environment:'cloud',agentId:'developer'}})).value;
  f.store.exec('INSERT OR REPLACE INTO project_execution VALUES(?,?)',created.project.id,'automatic');
  const approval=await until(()=>f.store.one("SELECT id FROM approvals WHERE run_id=? AND status='pending'",created.run.id));await f.request('/approvals/'+approval.id,{method:'POST',body:{approved:true}});
  const first=await until(async()=>(await call('poll',{})).value.command);assert.match(first.args.prompt,/DEPLOY \/ BOT \/ API/);
  const manifest={version:1,runId:created.run.id,actions:[{tool:'deploy_vercel',args:{connectionId:conn.id,requestId:'native1',framework:'static'}}]};
  const file=(path,content)=>({path,base64:Buffer.from(content).toString('base64')});
  await call('result',{commandId:first.id,result:{response:'Please deploy',files:[file('index.html','<h1>Native deploy</h1>'),file('opensi-actions.json',JSON.stringify(manifest))]}});
  const second=await until(async()=>(await call('poll',{})).value.command);assert.match(second.args.prompt,/BUILDING/);const dep=f.store.one('SELECT id FROM deployments WHERE project_id=?',created.project.id);
  manifest.actions=[{tool:'deployment_status',args:{deploymentId:dep.id}}];await call('result',{commandId:second.id,result:{response:'Check actual build',files:[file('opensi-actions.json',JSON.stringify(manifest))]}});
  const third=await until(async()=>(await call('poll',{})).value.command);assert.match(third.args.prompt,/READY/);manifest.actions=[];await call('result',{commandId:third.id,result:{response:'Build READY. Bot not tested.',files:[file('opensi-actions.json',JSON.stringify(manifest))]}});
  await runState(f,created.run.id,'completed');assert.equal(ext.calls.filter(c=>c.url.endsWith('/v13/deployments')).length,1);
 }finally{await f.close();}
});
