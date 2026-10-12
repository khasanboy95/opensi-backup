import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createJevSupervisor,supervisionState} from '../server/jev-supervisor.mjs';
import {fixture,runState} from './helpers.mjs';

const answer=(action='continue',route='c0')=>({model:'jev-test',answers:{action:{type:'choice',choice:action,confidence:.95,probabilities:{[action]:.96}},route:{type:'choice',choice:route,confidence:.94,probabilities:{[route]:.97}}},durationMs:4,usage:{input_tokens:5,output_tokens:2}});
const candidates=[{providerId:'p',model:'qa-pro',priority:6},{providerId:'p',model:'qa-sol',priority:3}];
const input={phase:'plan',candidates,current:'qa-pro'};
const setup=(decide,options={})=>{const events=[],controller=new AbortController();const supervisor=createJevSupervisor({jev:{enabled:true,decide},run:{id:'r',user_id:'u'},signal:controller.signal,emit:(type,data)=>events.push({type,data}),...options});return {supervisor,events,controller};};

test('JEV supervises using metadata only, validates choices and caches identical states',async()=>{
 let calls=0;const f=setup(async args=>{calls++;assert.equal(JSON.stringify(args).includes('private-secret'),false);return answer('repair','c1');});
 const history=[{role:'user',content:'private-secret'},{role:'assistant',tool_calls:[{id:'t',function:{name:'run_command',arguments:'private-secret'}}]},{role:'tool',tool_call_id:'t',content:JSON.stringify({output:'private-secret',error:'private-secret',exitCode:1})}];
 const state={...input,history,failedSteps:1};const d=await f.supervisor.assess(state);assert.equal(d.route,'p:qa-sol');assert.equal(d.action,'repair');await f.supervisor.assess(state);assert.equal(calls,1);assert.equal(f.events.filter(e=>e.type==='usage').length,1);
 assert.equal(supervisionState(state).recent[0].outcome,'failed');
});

test('JEV cannot invent routes, force healthy/native handoffs or act on uncertain answers',async()=>{
 const f=setup(async()=>answer('switch','c99'));
 assert.deepEqual((await f.supervisor.assess(input)).route,null);assert.equal((await f.supervisor.assess(input)).action,'continue');
 assert.equal((await f.supervisor.assess({...input,failedSteps:1,native:true})).action,'continue');
 const g=setup(async()=>{const v=answer('switch');v.answers.action.confidence=.3;v.answers.route.confidence=2;return v;});
 const d=await g.supervisor.assess({...input,failedSteps:2});assert.equal(d.action,'continue');assert.equal(d.route,null);
});

test('healthy progress uses milestone supervision instead of a paid request on every tool step',async()=>{
 let calls=0;const f=setup(async()=>{calls++;return answer();});
 const history=[];await f.supervisor.assess({...input,history});
 for(let i=0;i<3;i++){history.push({role:'tool',content:'{"saved":true}'});await f.supervisor.assess({...input,history});}
 assert.equal(calls,1);
 history.push({role:'tool',content:'{"saved":true}'});await f.supervisor.assess({...input,history});assert.equal(calls,2);
 await f.supervisor.assess({...input,history,failedSteps:1});assert.equal(calls,3);
});

test('timeout is bounded, aborts JEV, and repeated outages disable further supervision for this run',async()=>{
 let calls=0,aborted=0;const f=setup(async(_a,_u,_r,signal)=>{calls++;signal.addEventListener('abort',()=>aborted++);return new Promise(()=>{});},{budgetMs:20});
 const start=Date.now();assert.equal(await f.supervisor.assess(input),null);assert.equal(await f.supervisor.assess({...input,phase:'build'}),null);assert.equal(await f.supervisor.assess({...input,phase:'review'}),null);
 assert.equal(calls,2);assert.equal(aborted,2);assert.ok(Date.now()-start<500);assert.equal(f.events.at(-1).data.status,'unavailable');
});

test('run cancellation is not swallowed and supervision has a per-run call budget',async()=>{
 let calls=0;const f=setup(async()=>{calls++;return answer();},{maxCalls:1});await f.supervisor.assess(input);assert.equal(await f.supervisor.assess({...input,phase:'review'}),null);assert.equal(calls,1);f.controller.abort(Error('cancelled'));await assert.rejects(f.supervisor.assess(input),/cancelled/);
});

test('real JEV wire decision influences eligible automatic routing and records its own usage',async()=>{
 const jevRequests=[],modelRequests=[];
 const jev=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;jevRequests.push(JSON.parse(raw));res.setHeader('content-type','application/json');res.end(JSON.stringify(answer('continue','c1')));});
 const model=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);modelRequests.push(body);res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta:{content:'Done'},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:1}})}\n\ndata: [DONE]\n\n`);});
 await Promise.all([new Promise(r=>jev.listen(0,'127.0.0.1',r)),new Promise(r=>model.listen(0,'127.0.0.1',r))]);
 const f=await fixture({jevKey:'TEST_ONLY',jevEndpoint:`http://127.0.0.1:${jev.address().port}/v1/systemone`});
 try{
  await f.request('/providers',{method:'POST',body:{label:'QA',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,models:['qa-pro','qa-sol']}});
  const r=(await f.request('/runs',{method:'POST',body:{prompt:'Private project instruction: simple reply.',providerId:'auto',model:'auto',agentId:'developer',environment:'cloud'}})).value;
  const done=await runState(f,r.run.id,'completed');assert.equal(modelRequests[0].model,'qa-sol');assert.equal(jevRequests.length,1);assert.equal(JSON.stringify(jevRequests).includes('Private project'),false);
  assert.equal(done.events.filter(e=>e.type==='jev_supervision').length,1);
  const usage=f.store.one("SELECT input_tokens,output_tokens,known FROM usage WHERE run_id=? AND provider_id='jev'",r.run.id);assert.equal(usage.input_tokens,5);assert.equal(usage.output_tokens,2);
  assert.equal((await f.request('/jev')).value.supervisor,true);
  // A manual model choice is not silently replaced by the supervisor.
  const provider=f.store.one('SELECT id FROM providers');
  const manual=(await f.request('/runs',{method:'POST',body:{prompt:'Manual reply.',providerId:provider.id,model:'qa-pro',agentId:'developer',environment:'cloud'}})).value;
  await runState(f,manual.run.id,'completed');assert.equal(modelRequests.at(-1).model,'qa-pro');
  // JEV's billed usage also counts toward the user's quota before the main model call.
  const used=f.store.one("SELECT SUM(input_tokens+output_tokens) n FROM usage WHERE user_id='local-owner'").n;
  f.store.exec("UPDATE users SET token_limit=? WHERE id='local-owner'",used+6);
  const quota=(await f.request('/runs',{method:'POST',body:{prompt:'Quota check.',providerId:'auto',model:'auto',agentId:'developer',environment:'cloud'}})).value;
  await runState(f,quota.run.id,'failed');assert.equal(modelRequests.length,2);
 }finally{await f.close();for(const s of [jev,model]){s.closeAllConnections();await new Promise(r=>s.close(r));}}
});
