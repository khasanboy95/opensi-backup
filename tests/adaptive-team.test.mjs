import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fixture,runState,until} from './helpers.mjs';
import {createTeamLoad,compactTeamContext,teamHandoff,recoverableToolFailure,needsTeamBriefing} from '../server/adaptive-team.mjs';
import {canFallback} from '../server/orchestration.mjs';
import {repairToolHistory} from '../server/history.mjs';

async function scenario(handler,run) {
  const f=await fixture(),calls=[];
  const server=http.createServer(async(req,res)=>{try{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);calls.push(body);
    const send=message=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta:message,finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:3}})}\n\ndata: [DONE]\n\n`);};
    await handler(body,res,send,calls);
  }catch(e){res.writeHead(500);res.end(String(e));}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{await f.request('/providers',{method:'POST',body:{label:'Team QA',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:['qa-pro','qa-sol','qa-mini']}});await run(f,calls);}
  finally{server.closeAllConnections();await new Promise(r=>server.close(r));await f.close();}
}
const tool=(id,name,args)=>({tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const start=async(f,prompt='Simple task')=>(await f.request('/runs',{method:'POST',body:{prompt,providerId:'auto',model:'auto',agentId:'developer',environment:'cloud',autonomy:'automatic'}})).value;

test('provider failure after a write hands off intact results, does not replay the write, and skips unnecessary briefing',async()=>{
  let wrote=false,failed=false;
  await scenario((b,res,send)=>{
    if(!wrote){wrote=true;return send(tool('saved','write_file',{path:'result.txt',content:'preserved'}));}
    if(!failed){failed=true;res.writeHead(503);return res.end('overloaded');}
    const saved=b.messages.find(m=>m.role==='tool'&&m.tool_call_id==='saved');assert.ok(JSON.parse(saved.content).saved);
    return send({content:'Existing result preserved.'});
  },async(f,calls)=>{const r=await start(f);const done=await runState(f,r.run.id,'completed');
    assert.equal(done.events.filter(e=>e.type==='tool_start'&&e.data.tool==='write_file').length,1);
    assert.equal(done.events.filter(e=>e.type==='model_handoff').length,1);
    assert.equal(done.events.filter(e=>e.type==='team_start').length,0);
    assert.notEqual(calls[1].model,calls[2].model);
    assert.match(calls[2].messages[0].content,/Shared task state/);
    assert.equal((await f.request(`/projects/${r.project.id}/file?path=result.txt`)).value.content,'preserved');
  });
});

test('repeated tool errors switch models with valid call/output history and finish on the same project',async()=>{
  let attempts=0;
  await scenario((b,res,send)=>{
    let repaired=0;repairToolHistory(b.messages,()=>repaired++);assert.equal(repaired,0);
    if(attempts++<2)return send(tool('bad-'+attempts,'read_file',{path:'missing.txt'}));
    if(!b.messages.some(m=>m.tool_call_id==='repaired'))return send(tool('repaired','write_file',{path:'fixed.txt',content:'done'}));
    return send({content:'Verified file saved.'});
  },async(f,calls)=>{const r=await start(f);const done=await runState(f,r.run.id,'completed');assert.ok(done.events.some(e=>e.type==='model_handoff'));assert.notEqual(calls[1].model,calls[2].model);assert.equal((await f.request(`/projects/${r.project.id}/file?path=fixed.txt`)).value.content,'done');});
});

test('empty model responses recover; exhausted alternatives stop without false completion',async()=>{
  await scenario((b,res,send)=>send({content:''}),async(f,calls)=>{const r=await start(f);const done=await runState(f,r.run.id,'failed');assert.equal(calls.length,3);assert.equal(done.events.filter(e=>e.type==='model_handoff').length,2);});
});

test('permission failures do not trigger provider fallback',async()=>{
  await scenario((b,res)=>{res.writeHead(503);res.end('permission denied');},async(f,calls)=>{const r=await start(f);await runState(f,r.run.id,'failed');assert.equal(calls.length,1);});
});

test('a model can explicitly hand off a technical problem without asking the user to restart',async()=>{
  await scenario((b,res,send,calls)=>send(calls.length===1?tool('handoff','handoff_model',{reason:'Need another model to solve this technical issue.'}):{content:'Continued from the same task.'}),async(f,calls)=>{
    const r=await start(f);const done=await runState(f,r.run.id,'completed');assert.notEqual(calls[0].model,calls[1].model);assert.equal(done.events.filter(e=>e.type==='model_handoff').length,1);
    assert.ok(calls[1].messages.some(m=>m.role==='tool'&&m.tool_call_id==='handoff'));
  });
});

test('user cancellation during a model stream never launches a fallback',async()=>{
  await scenario((b,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.flushHeaders();},async(f,calls)=>{
    const r=await start(f);await until(()=>calls.length===1);await f.request('/runs/'+r.run.id+'/cancel',{method:'POST',body:{}});
    const done=await runState(f,r.run.id,'cancelled');assert.equal(calls.length,1);assert.equal(done.events.filter(e=>e.type==='model_handoff').length,0);
  });
});

test('load balancing accounts for actual usage and inflight work without leaking across accounts',()=>{
  const load=createTeamLoad();const choices=[{providerId:'p',model:'a',score:8},{providerId:'p',model:'b',score:8}];
  const lease=load.start('u1',choices[0]);assert.equal(load.rank('u1',choices)[0].model,'b');assert.equal(load.rank('u2',choices)[0].model,'a');
  lease.usage({prompt_tokens:500,completion_tokens:50});lease.release();lease.release();assert.equal(load.rank('u1',choices)[0].model,'b');
});

test('context compaction retains every tool pair, latest evidence, denial metadata and original history',()=>{
  const history=[{role:'user',content:'Original requirement'}];
  for(let i=0;i<8;i++){history.push({role:'assistant',...tool('t'+i,'read_file',{path:'f'+i})},{role:'tool',tool_call_id:'t'+i,content:JSON.stringify({content:'x'.repeat(8000),denied:i===0})});}
  const compact=compactTeamContext(history);assert.ok(JSON.stringify(compact).length<JSON.stringify(history).length);let repairs=0;repairToolHistory(compact,()=>repairs++);assert.equal(repairs,0);
  assert.equal(history[2].content.length>8000,true);assert.equal(compact.at(-1).content,history.at(-1).content);assert.match(teamHandoff(history),/"denied":true/);
  assert.equal(recoverableToolFailure({denied:true,error:'denied'}),false);assert.equal(recoverableToolFailure({exitCode:1}),true);
  assert.equal(canFallback(Error('Model bo‘sh javob qaytardi.')),true);assert.equal(canFallback(Error('content_policy 503')),false);
  assert.equal(needsTeamBriefing('Build a button',[]),false);
});

test('a pinned model repairs a technical tool failure instead of prematurely finishing or asking for a restart',async()=>{
 await scenario((b,res,send,calls)=>{
  const n=calls.length;
  if(n===1)return send(tool('saved','write_file',{path:'keep.txt',content:'original'}));
  if(n===2)return send(tool('missing','read_file',{path:'missing.txt'}));
  if(n===3)return send({content:'All done.'});
  if(n===4){assert.ok(b.messages.some(m=>m.role==='user'&&String(m.content).includes('OpenSI avtomatik tuzatish')));assert.ok(b.messages.some(m=>m.tool_call_id==='missing'&&JSON.parse(m.content).recovery.kind==='missing_resource'));return send(tool('fixed','edit_file',{path:'keep.txt',search:'original',replace:'preserved and repaired'}));}
  return send({content:'Existing result repaired.'});
 },async(f,calls)=>{
  const provider=f.store.one('SELECT id FROM providers');const r=(await f.request('/runs',{method:'POST',body:{prompt:'Repair the existing project',providerId:provider.id,model:'qa-pro',agentId:'developer',environment:'cloud',autonomy:'automatic'}})).value;
  const done=await runState(f,r.run.id,'completed');assert.equal(calls.length,5);assert.ok(calls.every(c=>c.model==='qa-pro'));
  assert.equal(done.events.filter(e=>e.type==='tool_start'&&e.data.tool==='write_file').length,1);assert.ok(done.events.some(e=>e.type==='agent_recovery'&&e.data.kind==='model_repair'));
  assert.equal((await f.request(`/projects/${r.project.id}/file?path=keep.txt`)).value.content,'preserved and repaired');assert.equal(done.approvals.length,0);
 });
});
test('bounded same-model repair stops honestly on persistent errors and preserves completed files',async()=>{
 await scenario((b,res,send,calls)=>send(calls.length===1?tool('saved','write_file',{path:'keep.txt',content:'preserved'}):tool('bad-'+calls.length,'read_file',{path:'missing.txt'})),async(f,calls)=>{
  const provider=f.store.one('SELECT id FROM providers');const r=(await f.request('/runs',{method:'POST',body:{prompt:'Repair project',providerId:provider.id,model:'qa-pro',agentId:'developer',environment:'cloud',autonomy:'automatic'}})).value;
  const done=await runState(f,r.run.id,'failed');assert.equal(calls.length,5);assert.match(done.run.error,/texnik xato/);assert.equal(done.events.filter(e=>e.type==='model_handoff').length,0);
  assert.equal((await f.request(`/projects/${r.project.id}/file?path=keep.txt`)).value.content,'preserved');
 });
});

test('new saved files keep a multi-step repair alive while checks still fail',async()=>{
 await scenario((b,res,send,calls)=>{
  const n=calls.length;
  if(n<=4)return send({tool_calls:[
   {id:'progress-'+n,type:'function',function:{name:'write_file',arguments:JSON.stringify({path:`part-${n}.txt`,content:`saved-${n}`})}},
   {id:'failure-'+n,type:'function',function:{name:'read_file',arguments:JSON.stringify({path:`missing-${n}.txt`})}},
  ]});
  if(n===5)return send(tool('verified','read_file',{path:'part-4.txt'}));
  return send({content:'Saved changes inspected; missing references remain explicit.'});
 },async(f,calls)=>{
  const provider=f.store.one('SELECT id FROM providers');const r=(await f.request('/runs',{method:'POST',body:{prompt:'Repair project incrementally',providerId:provider.id,model:'qa-pro',agentId:'developer',environment:'cloud',autonomy:'automatic'}})).value;
  const done=await runState(f,r.run.id,'completed');assert.equal(calls.length,6);
  for(let n=1;n<=4;n++)assert.equal((await f.request(`/projects/${r.project.id}/file?path=part-${n}.txt`)).value.content,`saved-${n}`);
  assert.equal(done.events.filter(e=>e.type==='tool_result'&&e.data.tool==='write_file').length,4);
 });
});
