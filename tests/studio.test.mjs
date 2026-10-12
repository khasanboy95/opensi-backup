import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {fixture,mockProvider,addProvider,createRun,runState,until} from './helpers.mjs';
import {hash,token,now} from '../server/security.mjs';
const post=body=>({method:'POST',body});
function foreign(f){const session=token();f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)','studio-other','Other','user',now());f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(session),'studio-other',Date.now()+60000);return {cookie:`opensi_session=${session}`};}
test('library bytes round-trip, active content downloads, attachment reuse, trash and owner isolation',async()=>{
 const f=await fixture();try{
  const result=await f.request('/library',post({name:'guide.html',content:Buffer.from('<script>alert(1)</script>').toString('base64'),folder:'Brand'}));assert.equal(result.status,201);const a=result.value;
  const download=await fetch(f.base+`/api/library/${a.id}/content?inline=true`);assert.match(download.headers.get('content-disposition'),/^attachment/);assert.equal(await download.text(),'<script>alert(1)</script>');
  assert.equal((await f.request(`/library/${a.id}/attach`,post({}))).status,200);
  const headers=foreign(f);assert.deepEqual((await f.request('/library',{headers})).value,[]);for(const route of [`/library/${a.id}/content`,`/library/${a.id}/attach`])assert.equal((await f.request(route,{headers,...(route.endsWith('attach')?post({}):{})})).status,404);
  assert.equal((await f.request(`/library/${a.id}`,{method:'PATCH',body:{deleted:true}})).status,200);assert.equal((await f.request('/library')).value.length,0);assert.equal((await f.request('/library?trash=true')).value.length,1);assert.equal((await f.request(`/library/${a.id}/attach`,post({}))).status,404);
  await f.request(`/library/${a.id}`,{method:'PATCH',body:{deleted:false}});assert.equal((await f.request('/library')).value.length,1);
  assert.equal((await f.request('/library',post({name:'../../bad',content:'YQ=='}))).status,400);assert.equal((await f.request('/library',post({name:'bad.png',content:'YQ=='}))).status,400);
 }finally{await f.close();}
});
test('project library copy forbids overwrites and escapes; saved context reaches next model',async()=>{
 const f=await fixture(),mock=await mockProvider();try{
 const p=await addProvider(f,mock),{run,project}=await createRun(f,p,'first');await runState(f,run.id,'completed');
 const a=(await f.request('/library',post({name:'readme.md',content:Buffer.from('REUSE_OK').toString('base64')}))).value;
 const route=`/projects/${project.id}/library-import`;assert.equal((await f.request(route,post({assetId:a.id,path:'docs/readme.md'}))).status,200);assert.equal((await f.request(route,post({assetId:a.id,path:'docs/readme.md'}))).status,409);assert.equal((await f.request(route,post({assetId:a.id,path:'../escape'}))).status,400);
 assert.equal((await f.request(`/projects/${project.id}/library-save`,post({path:'docs/readme.md'}))).status,201);
 assert.equal((await f.request(`/projects/${project.id}/context`,{method:'PUT',body:{title:'Updated',instructions:'CONTEXT_TEST_INSTRUCTION',memory:'CONTEXT_TEST_MEMORY'}})).status,200);
 const next=await createRun(f,p,'second',{projectId:project.id});await runState(f,next.run.id,'completed');assert.ok(mock.requests.some(r=>JSON.stringify(r).includes('CONTEXT_TEST_MEMORY')));
 const headers=foreign(f);assert.equal((await f.request(`/projects/${project.id}/context`,{headers})).status,404);
 }finally{await f.close();await mock.close();}
});
test('flows snapshot steps, checkpoint, resume, shared project history and foreign denial',async()=>{
 const f=await fixture(),mock=await mockProvider();try{
 const p=await addProvider(f,mock);const steps=[{title:'First',prompt:'_STATIC_ {{input}}',providerId:p.id,model:'qa-model',agentId:'developer',checkpoint:true},{title:'Second',prompt:'Inspect previous work',providerId:p.id,model:'qa-model',agentId:'developer',checkpoint:false}];
 const flow=(await f.request('/flows',post({name:'Two stage',steps}))).value;const started=await f.request(`/flows/${flow.id}/start`,post({input:'Test brief'}));assert.equal(started.status,201);const row=await until(()=>{const r=f.store.one('SELECT * FROM flow_runs WHERE id=?',started.value.id);return r.status==='paused'?r:null;});assert.equal(row.step_index,1);assert.equal(JSON.parse(row.history).length,1);
 await f.request(`/flows/${flow.id}`,{method:'PUT',body:{name:'Changed',steps:steps.slice(0,1)}});assert.equal(JSON.parse(f.store.one('SELECT steps FROM flow_runs WHERE id=?',row.id).steps).length,2);
 const headers=foreign(f);assert.equal((await f.request(`/flow-runs/${row.id}/resume`,{...post({}),headers})).status,404);assert.equal((await f.request(`/flows/${flow.id}/start`,{...post({}),headers})).status,404);
 assert.equal((await f.request(`/flow-runs/${row.id}/resume`,post({}))).status,200);const done=await until(()=>{const r=f.store.one('SELECT * FROM flow_runs WHERE id=?',row.id);return r.status==='completed'?r:null;});const history=JSON.parse(done.history);assert.equal(history.length,2);assert.equal(f.store.all('SELECT id FROM projects').length,1);assert.ok(mock.requests.some(r=>JSON.stringify(r).includes('Inspect previous work')&&JSON.stringify(r).includes('index.html')));
 }finally{await f.close();await mock.close();}
});
test('failed flow never advances and cancellation stops a waiting approval',async()=>{
 const f=await fixture(),mock=await mockProvider();try{
 const p=await addProvider(f,mock);const step={title:'Fail',prompt:'_BROKEN_STREAM_',providerId:p.id,model:'qa-model',agentId:'developer'};const flow=(await f.request('/flows',post({name:'Fail fast',steps:[step,{...step,title:'Never',prompt:'never'}]}))).value;
 const r=(await f.request(`/flows/${flow.id}/start`,post({}))).value;await until(()=>f.store.one('SELECT status FROM flow_runs WHERE id=?',r.id).status==='failed');assert.equal(JSON.parse(f.store.one('SELECT history FROM flow_runs WHERE id=?',r.id).history).length,1);
 const ask=(await f.request('/flows',post({name:'Ask',steps:[{...step,prompt:'_ASK_'}]}))).value;const a=(await f.request(`/flows/${ask.id}/start`,post({}))).value;await until(()=>f.store.one('SELECT status FROM runs WHERE id=?',f.store.one('SELECT run_id FROM flow_runs WHERE id=?',a.id).run_id)?.status==='waiting_input');await f.request(`/flow-runs/${a.id}/cancel`,post({}));assert.equal(f.store.one('SELECT status FROM flow_runs WHERE id=?',a.id).status,'cancelled');
 }finally{await f.close();await mock.close();}
});
test('media adapter returns real bytes, uses assistant speech, tracks usage and handles idempotency, quota and isolation',async()=>{
 const requests=[];const wav=Buffer.alloc(64);wav.write('RIFF');wav.write('WAVE',8);
 const mock=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);requests.push(body);res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:body.model==='mimo-v2.5-asr'?{content:'Transcribed test.'}:{audio:{data:wav.toString('base64')}}}],usage:{prompt_tokens:12,completion_tokens:7}}));});mock.listen(0,'127.0.0.1');await new Promise(r=>mock.once('listening',r));const f=await fixture();try{
 const p=(await f.request('/providers',post({label:'Audio test',baseUrl:`http://127.0.0.1:${mock.address().port}/v1`,apiKey:'audio-private-key',models:['mimo-v2.5-tts','mimo-v2.5-asr','mimo-v2.5-tts-voiceclone']}))).value;
 const body={requestKey:randomUUID(),providerId:p.id,model:'mimo-v2.5-tts',text:'Hello world',voice:'Mia'};const result=await f.request('/media/jobs',post(body));assert.equal(result.status,201);assert.equal((await f.request('/media/jobs',post(body))).value.id,result.value.id);
 const completed=await until(()=>{const r=f.store.one('SELECT * FROM media_jobs WHERE id=?',result.value.id);return r.status==='completed'?r:null;});assert.equal(requests.length,1);assert.equal(requests[0].messages[1].role,'assistant');assert.equal(requests[0].messages[1].content,'Hello world');assert.equal(f.store.one('SELECT input_tokens FROM usage').input_tokens,12);
 const headers=foreign(f);assert.equal((await f.request(`/media/jobs/${completed.id}/cancel`,{...post({}),headers})).status,404);assert.equal((await f.request('/media/jobs',{headers})).value.length,0);
 const trans=(await f.request('/media/jobs',post({requestKey:randomUUID(),providerId:p.id,model:'mimo-v2.5-asr',assetId:completed.asset_id}))).value;await until(()=>f.store.one('SELECT status FROM media_jobs WHERE id=?',trans.id).status==='completed');assert.match(requests[1].messages[0].content[0].input_audio.data,/^data:audio\/wav;base64,/);
 assert.equal((await f.request('/media/jobs',post({requestKey:randomUUID(),providerId:p.id,model:'mimo-v2.5-tts-voiceclone',text:'Hello',assetId:completed.asset_id}))).status,400);
 f.store.exec("UPDATE users SET token_limit=0 WHERE id='local-owner'");assert.equal((await f.request('/media/jobs',post({...body,requestKey:randomUUID()}))).status,429);
 assert.ok(!JSON.stringify((await f.request('/media/jobs')).value).includes('audio-private-key'));
 }finally{await f.close();mock.closeAllConnections();await new Promise(r=>mock.close(r));}
});
