import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {modelFailure,createModelHealth,withProviderFailure} from '../server/model-health.mjs';
import {modelScore,rankModels} from '../server/orchestration.mjs';
import {fixture,runState} from './helpers.mjs';
import {responseAccumulator} from '../server/responses.mjs';

test('provider quotas, per-model limits and real retry windows are distinguished from permission/account stops',()=>{
 for(const message of ['API HTTP 402 balance exhausted','insufficient_quota','credits depleted'])assert.equal(modelFailure(Error(message)).scope,'provider');
 for(const message of ['429 rate_limit','RESOURCE_EXHAUSTED','usage_limit_reached','token limit exceeded'])assert.equal(modelFailure(Error(message)).scope,'model');
 for(const message of ['permission denied 429','content_policy 503','Hisob faol emas yoki token limiti tugagan.','Oylik token chegarasiga yetildi.','cancelled'])assert.equal(modelFailure(Error(message)),null);
 assert.equal(modelFailure(Object.assign(Error('Busy'),{providerStatus:429,retryAfterMs:123000})).cooldownMs,123000);
 assert.ok(modelScore('gemini-flash','plan')>modelScore('gemini-pro','plan'));
 assert.ok(modelScore('qa-pro','repair')>modelScore('qa-mini','repair'));
 const ranked=rankModels([{id:'chatgpt',enabled:true,protocol:'chatgpt-plan',models:['gpt-5.6-luna']},{id:'native',enabled:true,protocol:'antigravity-cli',hosted:true,models:['gemini-3.1-pro-low','gemini-3.6-flash-high']}],'plan',new Set(),{nativeNode:'hosted'});
 assert.equal(ranked[0].model,'gpt-5.6-luna');
});

test('cooldowns isolate accounts, block siblings only for account quota and expire',()=>{
 let clock=0;const health=createModelHealth(()=>clock),a={providerId:'a',model:'mini'},b={providerId:'a',model:'pro'},c={providerId:'b',model:'pro'},all=[a,b,c];
 health.fail('u',a,Error('429 rate limit'));assert.deepEqual(health.available('u',all),[b,c]);assert.deepEqual(health.available('other',all),all);
 clock=60001;assert.deepEqual(health.available('u',all),all);
 health.fail('u',a,Error('402 balance exhausted'));assert.deepEqual(health.available('u',all),[c]);
 clock+=300001;assert.deepEqual(health.available('u',all),all);
});

test('native quota metadata survives translation and respects a reset beyond one hour',()=>{
 let clock=0;const health=createModelHealth(()=>clock),limited={providerId:'native',model:'sonnet'},healthy={providerId:'native',model:'gemini'},all=[limited,healthy];
 const error=withProviderFailure(Error('Model limiti tugadi.'),{kind:'quota',code:'RESOURCE_EXHAUSTED',status:429,retryAfterMs:7952000});
 assert.equal(health.fail('owner',limited,error).cooldownMs,7952000);clock=3600001;assert.deepEqual(health.available('owner',all),[healthy]);assert.deepEqual(health.available('other',all),all);
 clock=7952001;assert.deepEqual(health.available('owner',all),all);
 for(const kind of ['auth','permission'])assert.equal(modelFailure(withProviderFailure(Error('Stopped'),{kind,status:kind==='auth'?401:403})),null);
 assert.equal(modelFailure(withProviderFailure(Error('permission denied'),{kind:'quota',status:429})),null);
});

test('Responses quota codes survive generic error messages and API prompts omit redundant native schemas',async()=>{
 const accumulator=responseAccumulator(()=>{});
 assert.throws(()=>accumulator.ingest({type:'response.failed',response:{status:'failed',error:{code:'usage_limit_reached',message:'Please try again later.'}}}),e=>modelFailure(e)?.kind==='quota');
 const f=await fixture();try{
   const regular=f.automation.instructions({id:'run_qa',user_id:'local-owner'}),native=f.automation.nativeInstructions({id:'run_qa'});
   assert.ok(!regular.includes('"$schema"'));assert.ok(native.includes('"$schema"'));
   assert.match(native,/run_qa/);assert.match(regular,/integration_catalog/);
   assert.ok(native.length>3000);
 }finally{await f.close();}
});

test('real HTTP quota after a saved write skips exhausted provider siblings across runs and preserves tool results',async()=>{
 const f=await fixture(),calls=[];let wrote=false;
 const server=http.createServer(async(req,res)=>{
   let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);calls.push({url:req.url,body});
   const send=delta=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta,finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:1}})}\n\ndata: [DONE]\n\n`);};
   if(req.url.startsWith('/exhausted')){
     if(!wrote){wrote=true;send({tool_calls:[{index:0,id:'saved',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'saved.txt',content:'keep'})}}]});return;}
     res.writeHead(402,{'retry-after':'120'});res.end('{"error":{"code":"insufficient_quota"}}');return;
   }
   send({content:'Continued existing work'});
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
   for(const [name,models] of [['exhausted',['qa-mini','qa-flash']],['healthy',['qa-sol']]])assert.equal((await f.request('/providers',{method:'POST',body:{label:name,baseUrl:`http://127.0.0.1:${server.address().port}/${name}`,models}})).status,200);
   const start=async()=> (await f.request('/runs',{method:'POST',body:{prompt:'Save a short result',providerId:'auto',model:'auto',agentId:'developer',environment:'cloud',autonomy:'automatic'}})).value;
   const first=await start(),done=await runState(f,first.run.id,'completed');
   assert.equal(calls.filter(c=>c.url.startsWith('/exhausted')).length,2);
   const handoff=calls.find(c=>c.url.startsWith('/healthy')).body.messages;
   assert.equal(JSON.parse(handoff.find(m=>m.tool_call_id==='saved').content).saved,true);
   assert.equal((await f.request(`/projects/${first.project.id}/file?path=saved.txt`)).value.content,'keep');
   assert.equal(done.events.filter(e=>e.type==='tool_start'&&e.data.tool==='write_file').length,1);
   assert.equal(done.events.find(e=>e.type==='model_cooldown').data.retryAfterMs,120000);
   assert.equal(done.approvals.length,0);
   const second=await start();await runState(f,second.run.id,'completed');
   assert.equal(calls.filter(c=>c.url.startsWith('/exhausted')).length,2);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await f.close();}
});
