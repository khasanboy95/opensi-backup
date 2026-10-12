import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {createHash,createCipheriv,randomBytes} from 'node:crypto';
import {platform,userInfo} from 'node:os';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixture,tempDir,removeTemp,runState,mockProvider,addProvider,until} from './helpers.mjs';
import {zcodeService} from '../server/zcode.mjs';
import {ZcodeGateway,zcodeEnvironment,zcodeFailure,zcodeMessages,zcodeReply} from '../server/zcode-runtime.mjs';
import {complete} from '../server/provider.mjs';
import {modelFailure} from '../server/model-health.mjs';
import {rankModels} from '../server/orchestration.mjs';

const fixtureKey='QA_ONLY_NOT_A_REAL_ZCODE_KEY',channelId='account:zai-individual-coding-plan';
async function installFixture(dataDir){
 const runtime=path.join(dataDir,'zcode/runtime/zcode.cjs'),home=path.join(dataDir,'zcode/account');
 await mkdir(path.join(path.dirname(runtime),'provider'),{recursive:true});await mkdir(path.join(home,'.zcode/v2'),{recursive:true});await writeFile(runtime,'// fixture only');
 const channel=(providerId,accountType,mode,builtinModelIds)=>({providerId,config:{access:{type:'zhipu-account',accountType,mode},builtinModelIds}});
 await writeFile(path.join(path.dirname(runtime),'provider/zcode-builtin.json'),JSON.stringify({config:{providerConfigRules:{providerRules:[channel(channelId,'zai','individual-coding-plan',['GLM-5.3','GLM-5.3-Flash']),channel('account:start','zai','start-plan',['desktop-only']),channel('account:bigmodel','bigmodel','individual-coding-plan',['another-account-only'])]}}}));
 const encrypt=value=>{const iv=randomBytes(12),secret=`zcode-credential-fallback:${platform()}:${home}:${userInfo().username}`,cipher=createCipheriv('aes-256-gcm',createHash('sha256').update(secret).digest(),iv),data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return`enc:v1:${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;};
 await writeFile(path.join(home,'.zcode/v2/credentials.json'),JSON.stringify({[`account-provider:${channelId}:identity`]:encrypt('fixture@example.com'),[`account-provider:coding-plan:${channelId}:account:fixture%40example.com:api-key`]:encrypt(fixtureKey)}));
 return{runtime,home,workspace:path.join(dataDir,'zcode/gateway')};
}
async function mockZcode(){
 const requests=[];let cancelled=false;
 const server=http.createServer(async(req,res)=>{
  assert.equal(req.url,'/coding/chat/completions');assert.equal(req.headers.authorization,`Bearer ${fixtureKey}`);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
  const text=body.messages.filter(m=>m.role==='user').map(m=>m.content).join('\n');
  if(text==='slow'){res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();res.on('close',()=>{cancelled=true;});return;}
  const hasWrite=body.messages.some(m=>m.tool_call_id==='zc-write');
  if(hasWrite&&text.includes('_QUOTA_HANDOFF_')){res.writeHead(429,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'1113',message:'Insufficient balance or no resource package SECRET_NATIVE_TOKEN'}}));return;}
  let message;
  if(text.includes('OPENSI_CONNECTED'))message={content:'OPENSI_CONNECTED'};
  else if(hasWrite)message={content:'Created and checked.'};
  else message={tool_calls:[{index:0,id:'zc-write',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'index.html',content:text==='Hello'?'Hello':'<h1>ZCode agent file</h1>'})}}]};
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.end(`data: ${JSON.stringify({choices:[{delta:message,finish_reason:message.tool_calls?'tool_calls':'stop'}]})}\n\ndata: ${JSON.stringify({choices:[],usage:{prompt_tokens:12,completion_tokens:4}})}\n\ndata: [DONE]\n\n`);
 });server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 return{base:`http://127.0.0.1:${server.address().port}/coding`,requests,get cancelled(){return cancelled;},async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

test('ZCode adapter retains exact tool identities, results and structured arguments',()=>{
 const input=[{role:'system',content:'Work in the assigned project.'},{role:'user',content:'Build a page'},{role:'assistant',content:null,tool_calls:[{id:'write-1',type:'function',function:{name:'write_file',arguments:'{"path":"index.html","content":"Hello"}'}}]},{role:'tool',tool_call_id:'write-1',content:'{"saved":true}'}];
 const result=zcodeMessages(input);assert.deepEqual(result[2].toolCalls,[{id:'write-1',name:'write_file',input:{path:'index.html',content:'Hello'}}]);assert.equal(result[3].toolName,'write_file');assert.equal(result[3].toolCallId,'write-1');
 const reply=zcodeReply({text:'',toolCalls:[{id:'test-2',name:'run_command',input:{command:'node --check index.js'}}]});assert.equal(reply.tool_calls[0].function.arguments,'{"command":"node --check index.js"}');
 assert.throws(()=>zcodeReply({text:'cut off',finishReason:'length'}));assert.throws(()=>zcodeReply({text:'',toolCalls:[{name:'bad'}]}));
 assert.throws(()=>zcodeMessages([{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,AA'}}]}]));
});

test('ZCode failures expose fixed diagnostics and respect quota/auth boundaries',()=>{
 const secret='PRIVATE_ACCESS_TOKEN_DO_NOT_DISPLAY';const quota=zcodeFailure({message:'1113 Insufficient balance or no resource package '+secret});assert.doesNotMatch(quota.message,new RegExp(secret));assert.equal(modelFailure(quota).scope,'provider');
 assert.equal(modelFailure(zcodeFailure({message:'429 rate limit'})).kind,'rate');assert.equal(modelFailure(zcodeFailure({message:'401 unauthorized'})),null);assert.equal(modelFailure(zcodeFailure({message:'3101 not entitled'})),null);
 assert.equal(modelFailure(zcodeFailure({message:'503 temporary overload trace abc1113def'})).kind,'transient');
 const env=zcodeEnvironment('C:/private/zcode','C:/runtime/zcode.cjs');assert.equal(env.ZCODE_DATA_BASE_DIR,'C:/private/zcode');assert.equal(env.USERPROFILE,'C:/private/zcode');assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.OPENSI_ENCRYPTION_KEY,undefined);
});

test('Coding API bridge uses the official account channel, preserves tools and cancels HTTP',async()=>{
 const dir=await tempDir(),mock=await mockZcode();let gateway;
 try{
  gateway=new ZcodeGateway({...await installFixture(dir),apiBase:mock.base,allowLocal:true});assert.deepEqual((await gateway.catalog()).map(m=>m.id),['glm-5.3','glm-5.3-flash']);
  const tools=[{type:'function',function:{name:'write_file',parameters:{type:'object',properties:{}}}}];
  const result=await gateway.generate('glm-5.3',[{role:'user',content:'Hello'}],tools,undefined,10000);assert.equal(result.toolCalls[0].input.content,'Hello');assert.equal(result.usage.outputTokens,4);assert.deepEqual(mock.requests[0].tools,tools);
  let streamed='';const messages=[{role:'user',content:'Hello'},zcodeReply(result),{role:'tool',tool_call_id:'zc-write',content:'Saved'}];
  const reply=await gateway.generate('glm-5.3',messages,tools,undefined,10000,{onText:v=>streamed+=v});assert.equal(reply.text,'Created and checked.');assert.equal(streamed,reply.text);assert.equal(mock.requests[1].messages.at(-1).tool_call_id,'zc-write');
  const controller=new AbortController();const pending=gateway.generate('glm-5.3',[{role:'user',content:'slow'}],[],controller.signal,10000);await until(()=>mock.requests.length===3);controller.abort(new Error('stop at checkpoint'));await assert.rejects(pending,/stop at checkpoint/);await until(()=>mock.cancelled);
  await assert.rejects(gateway.generate('desktop-only',[],[],undefined,10000),/ruxsat bermadi/);assert.equal(mock.requests.length,3);
 }finally{await gateway?.close();await mock.close();await removeTemp(dir);}
});

async function serviceFixture(){
 const f=await fixture(),native=await installFixture(f.dataDir);
 f.store.exec("INSERT INTO users(id,google_sub,email,name,role,created_at) VALUES('google-user','google-user-sub','qa@example.com','QA','user','2026-10-10')");f.store.exec("INSERT INTO users(id,email,name,role,created_at) VALUES('other-user','other@example.com','Other','user','2026-10-10')");
 f.store.setSetting('zcode-account',{id:'zc_qa',owner:'local-owner',authenticated:true,connected:true,shared:true,models:[{id:'glm-5.3',label:'GLM 5.3'},{id:'glm-5.3-flash',label:'GLM Flash'}],email:'owner@example.com'});
 const calls=[];let failure;const gateway={async catalog(){return[{id:'glm-5.3',label:'GLM 5.3'}];},async generate(model,messages,tools){calls.push({model,messages,tools});if(failure)throw failure;return{text:'OPENSI_CONNECTED',usage:{inputTokens:8,outputTokens:2}};},close(){}};
 const service=zcodeService({...f.config,zcodeRuntime:native.runtime},f.store,{gatewayFactory:()=>gateway});return{f,service,calls,setFailure:value=>{failure=value;},async close(){await service.close();await f.close();}};
}

test('ZCode shared account exposes models to Google users without identity or login URL leakage',async()=>{
 const t=await serviceFixture();try{
  assert.equal(t.service.list('google-user').length,1);assert.equal(t.service.list('other-user').length,0);assert.equal(t.service.list('missing').length,0);
  const status=t.service.status('google-user');assert.equal(status.email,undefined);assert.equal(status.authorizeUrl,undefined);assert.equal(status.can_manage,false);
  assert.throws(()=>t.service.share('google-user',true),/faqat OpenSI egasi/);assert.throws(()=>t.service.provider('other-user','zc_qa','glm-5.3'));
  const provider=t.service.provider('google-user','zc_qa','glm-5.3');let text='',usage;const reply=await complete({provider,model:'glm-5.3',messages:[{role:'user',content:'Test'}],config:t.f.config,onText:value=>text+=value,onUsage:value=>usage=value});assert.equal(reply.content,'OPENSI_CONNECTED');assert.equal(text,reply.content);assert.deepEqual(usage,{prompt_tokens:8,completion_tokens:2});
  assert.ok(rankModels(t.service.list('google-user'),'build').some(m=>m.model==='glm-5.3'));
  t.service.share('local-owner',false);assert.equal(t.service.list('google-user').length,0);await assert.rejects(complete({provider,model:'glm-5.3',messages:[],config:t.f.config}),/ruxsat yopilgan/);assert.equal(t.service.list('local-owner').length,1);
 }finally{await t.close();}
});

test('shared Z.ai account exhaustion cools all sibling models for every user',async()=>{
 const t=await serviceFixture();try{t.setFailure(zcodeFailure({message:'1113 Insufficient balance or no resource package'}));const provider=t.service.provider('google-user','zc_qa','glm-5.3');await assert.rejects(complete({provider,model:'glm-5.3',messages:[],config:t.f.config}),/model kvotasi/);assert.equal(t.service.list('google-user').length,0);assert.equal(t.service.list('local-owner').length,0);assert.equal(t.calls.length,1);assert.equal(t.service.status('local-owner').models.length,2);
 }finally{await t.close();}
});

test('saved CLI login is restored but never advertised before a real model reply',async()=>{
 const t=await serviceFixture();try{
  t.f.store.setSetting('zcode-account',{id:'zc_qa',owner:'local-owner',connected:false,shared:true});t.setFailure(zcodeFailure({message:'1113 no resource package'}));
  assert.equal(t.service.status('local-owner').can_restore,true);await assert.rejects(t.service.refresh('local-owner'),/model kvotasi/);
  const status=t.service.status('local-owner');assert.equal(status.authenticated,true);assert.equal(status.connected,false);assert.match(status.error,/Coding Plan/);assert.deepEqual(t.service.list('google-user'),[]);assert.deepEqual(rankModels(t.service.list('local-owner'),'build'),[]);
  await assert.rejects(t.service.test('google-user','glm-5.3'),/faqat OpenSI egasi/);
  t.setFailure(null);const result=await t.service.test('local-owner','glm-5.3');assert.equal(result.ok,true);assert.equal(t.service.status('local-owner').usable,true);assert.deepEqual(t.service.list('google-user')[0].models,['glm-5.3']);assert.equal(t.f.store.all('SELECT * FROM usage WHERE agent_id=?','connection_test').length,1);
 }finally{await t.close();}
});

test('disconnected or missing runtime never advertises imaginary ZCode models',async()=>{
 const f=await fixture();try{const status=(await f.request('/zcode/account')).value;assert.equal(status.configured,false);assert.equal(status.connected,false);assert.equal((await f.request('/zcode/connect',{method:'POST',body:{shared:true}})).status,409);assert.ok(!(await f.request('/providers')).value.some(p=>p.protocol==='zcode-account'));}finally{await f.close();}
});

test('model-specific permission failure leaves only models with successful replies enabled',async()=>{
 const t=await serviceFixture();try{
  t.setFailure(zcodeFailure({status:403,message:'not entitled'}));await assert.rejects(t.service.test('local-owner','glm-5.3'),/ruxsat bermadi/);
  assert.deepEqual(t.service.list('google-user')[0].models,['glm-5.3-flash']);assert.throws(()=>t.service.provider('google-user','zc_qa','glm-5.3'));
  assert.equal(t.service.status('local-owner').models.length,2);assert.deepEqual(t.service.status('google-user').models.map(m=>m.id),['glm-5.3-flash']);
 }finally{await t.close();}
});

test('ZCode official login remains owner-only and activates only after a model response',async()=>{
 const f=await fixture();let service,finishLogin,loggedOut=false;
 try{
  const native=await installFixture(f.dataDir);
  f.store.exec("INSERT INTO users(id,google_sub,email,name,role,created_at) VALUES('google-login','sub-login','qa@example.com','QA','user','2026-10-10')");
  service=zcodeService({...f.config,zcodeRuntime:native.runtime},f.store,{gatewayFactory:()=>({catalog:async()=>[{id:'glm-account-only',label:'Actual model'}],generate:async()=>({text:'OPENSI_CONNECTED'}),close(){}}),login:async({onUrl})=>{onUrl('https://zcode.z.ai/oauth/authorize?state=TEST_ONLY');return new Promise(resolve=>{finishLogin=resolve;});},logout:async()=>{loggedOut=true;}});
  const result=await service.connect('local-owner',{shared:true});assert.match(result.authorizeUrl,/zcode.z.ai/);assert.equal(service.status('local-owner').pending,true);assert.equal(service.status('google-login').authorizeUrl,undefined);assert.deepEqual(service.list('google-login'),[]);
  finishLogin({email:'owner@example.com'});await until(()=>service.status('local-owner').connected);assert.deepEqual(service.list('google-login')[0].models,['glm-account-only']);assert.equal(service.status('local-owner').pending,false);
  await service.disconnect('local-owner');assert.equal(loggedOut,true);assert.deepEqual(service.list('google-login'),[]);assert.equal(service.status('local-owner').email,'');assert.equal(service.status('local-owner').authenticated,false);
 }finally{await service?.close();await f.close();}
});

async function agentRuntime(f){
 await installFixture(f.dataDir);f.store.setSetting('zcode-account',{id:'zc_agent',owner:'local-owner',authenticated:true,connected:true,shared:true,models:[{id:'glm-5.3',label:'GLM 5.3'}]});
}

test('ZCode executes OpenSI file tools and records API usage through the real runner',async()=>{
 const mock=await mockZcode(),f=await fixture({zcodeApiBase:mock.base});try{
  await agentRuntime(f);const created=await f.request('/runs',{method:'POST',body:{prompt:'Write a tiny HTML page',providerId:'zc_agent',model:'glm-5.3',agentId:'developer',environment:'cloud',autonomy:'automatic'}});assert.equal(created.status,201,JSON.stringify(created.value));
  const done=await runState(f,created.value.run.id,'completed');assert.equal(done.events.filter(e=>e.type==='tool_start'&&e.data.tool==='write_file').length,1);assert.equal((await f.request(`/projects/${created.value.project.id}/file?path=index.html`)).value.content,'<h1>ZCode agent file</h1>');assert.ok(f.store.all('SELECT * FROM usage WHERE run_id=?',done.run.id).some(u=>u.model==='glm-5.3'&&u.output_tokens===4));
 }finally{await f.close();await mock.close();}
});

test('automatic team continues from ZCode quota exhaustion without repeating saved tools',async()=>{
 const native=await mockZcode(),f=await fixture({zcodeApiBase:native.base}),mock=await mockProvider();try{
  await agentRuntime(f);await addProvider(f,mock);
  const created=await f.request('/runs',{method:'POST',body:{prompt:'_QUOTA_HANDOFF_ Tiny HTML task',providerId:'auto',model:'auto',agentId:'developer',environment:'cloud',autonomy:'automatic'}});assert.equal(created.status,201,JSON.stringify(created.value));
  const done=await runState(f,created.value.run.id,'completed');assert.ok(done.events.some(e=>e.type==='model_handoff'));assert.equal(done.events.filter(e=>e.type==='tool_start'&&e.data.tool==='write_file').length,1);assert.ok(mock.requests.some(r=>r.messages.some(m=>m.tool_call_id==='zc-write')));assert.doesNotMatch(JSON.stringify(done),/SECRET_NATIVE_TOKEN|QA_ONLY_NOT_A_REAL_ZCODE_KEY/);assert.equal((await f.request('/providers')).value.some(p=>p.protocol==='zcode-account'),false);
 }finally{await f.close();await mock.close();await native.close();}
});
