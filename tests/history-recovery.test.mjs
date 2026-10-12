import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {providerPayload} from '../server/provider.mjs';
import {repairToolHistory} from '../server/history.mjs';
import {fixture,createRun,runState} from './helpers.mjs';

const call = (id, path = `${id}.txt`) => ({id,type:'function',function:{name:'write_file',arguments:JSON.stringify({path,content:'Saved once'})}});
const assistant = calls => ({role:'assistant',content:null,tool_calls:calls});
const result = (id, content='{"saved":true}') => ({role:'tool',tool_call_id:id,content});

test('interrupted multi-call history closes missing results before the next user on every protocol without replay',()=>{
 const messages=[{role:'user',content:'Build'},assistant([call('done'),call('unknown')]),result('done'),{role:'user',content:'Continue'}];
 const original=structuredClone(messages);
 for(const protocol of ['chat-completions','responses','chatgpt-plan']){
  const body=providerPayload(protocol,'test',messages);
  const items=body.messages||body.input;
  const repaired=items.find(m=>(m.tool_call_id||m.call_id)==='unknown'&&(m.role==='tool'||m.type==='function_call_output'));
  assert.equal(JSON.parse(repaired.content||repaired.output).execution_status,'unknown');
  assert.equal(items.at(-1).content,'Continue');
 }
 assert.deepEqual(messages,original);
 assert.deepEqual(repairToolHistory(repairToolHistory(messages)),repairToolHistory(messages));
});

test('truncated history retains output evidence and remaps reused call IDs with their own results',()=>{
 const messages=[result('truncated','actual file evidence'),assistant([call('reused')]),result('reused','first'),{role:'user',content:'Continue'},assistant([call('reused'),call('reused')]),result('reused','second'),result('reused','third')];
 const repaired=repairToolHistory(messages);
 assert.match(repaired[0].content,/actual file evidence/);
 const ids=repaired.flatMap(m=>m.tool_calls||[]).map(c=>c.id);
 assert.equal(new Set(ids).size,3);
 assert.deepEqual(repaired.filter(m=>m.role==='tool').map(m=>m.content),['first','second','third']);
 assert.deepEqual(repaired.filter(m=>m.role==='tool').map(m=>m.tool_call_id),ids);
});

test('completed calls and images remain unchanged',()=>{
 const messages=[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,QA'}}]},assistant([call('valid')]),result('valid'),{role:'assistant',content:'Done'}];
 assert.deepEqual(repairToolHistory(messages),messages);
});

test('16-call batch saves 12 files, records all outputs and lets model finish remaining work without duplicate writes',async()=>{
 const f=await fixture();let step=0;const requests=[];
 const server=http.createServer(async(req,res)=>{
  if(req.url.endsWith('/models')){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'qa-model'}]}));return;}
  let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);requests.push(body);let message;
  if(step++===0)message=assistant(Array.from({length:16},(_,i)=>call(`batch${i}`)));
  else if(step===2)message=assistant(Array.from({length:4},(_,i)=>call(`retry${i+12}`,`batch${i+12}.txt`)));
  else message={role:'assistant',content:'All files saved.'};
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}));
 });
 server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const p=(await f.request('/providers',{method:'POST',body:{label:'batch test',baseUrl:`http://127.0.0.1:${server.address().port}/v1`}})).value;
  const {run,project}=await createRun(f,p,'Create sixteen files');await runState(f,run.id,'completed');
  const outputs=requests[1].messages.filter(m=>m.role==='tool');assert.equal(outputs.length,16);
  assert.equal(outputs.filter(m=>JSON.parse(m.content).saved).length,12);
  for(const m of outputs.slice(12))assert.match(JSON.parse(m.content).error,/NOT executed/);
  for(let i=0;i<16;i++)assert.equal((await f.request(`/projects/${project.id}/file?path=batch${i}.txt`)).value.content,'Saved once');
  const results=f.store.all("SELECT data FROM events WHERE run_id=? AND type='tool_result'",run.id).map(x=>JSON.parse(x.data));
  assert.equal(results.filter(x=>x.result.saved).length,16);
 }finally{await f.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('persisted interrupted history can continue through Responses and preserves original audit rows',async()=>{
 const f=await fixture();const requests=[];
 const server=http.createServer(async(req,res)=>{
  if(req.url.endsWith('/models')){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'qa-model'}]}));return;}
  let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);requests.push(body);
  const output=[{type:'message',role:'assistant',content:[{type:'output_text',text:'Existing state verified; continued.'}]}];
  res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'completed',output}));
 });
 server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const p=(await f.request('/providers',{method:'POST',body:{label:'recovery test',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,protocol:'responses'}})).value;
  const {run,project}=await createRun(f,p,'Start');await runState(f,run.id,'completed');
  const broken=assistant(Array.from({length:16},(_,i)=>call(`interrupted${i}`)));f.store.message(run,'assistant',broken);
  const response=await f.request('/runs',{method:'POST',body:{projectId:project.id,prompt:'Continue safely',providerId:p.id,model:'qa-model',agentId:'developer',environment:'cloud'}});
  assert.equal(response.status,201);await runState(f,response.value.run.id,'completed');
  const input=requests.at(-1).input;const calls=input.filter(x=>x.type==='function_call');const outputs=input.filter(x=>x.type==='function_call_output');
  assert.equal(calls.length,16);assert.deepEqual(outputs.map(x=>x.call_id),calls.map(x=>x.call_id));
  assert.ok(outputs.every(x=>JSON.parse(x.output).execution_status==='unknown'));
  assert.equal(f.store.all("SELECT * FROM messages WHERE project_id=? AND role='tool'",project.id).length,0);
  assert.equal(f.store.all("SELECT * FROM events WHERE run_id=? AND type='tool_start'",response.value.run.id).length,0);
  assert.ok(f.store.one("SELECT id FROM events WHERE run_id=? AND type='warning'",response.value.run.id));
 }finally{await f.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
