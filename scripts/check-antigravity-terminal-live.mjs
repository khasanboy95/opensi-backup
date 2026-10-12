import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fixture,until,tempDir,removeTemp} from '../tests/helpers.mjs';
import {startConnector} from '../connector/index.mjs';
const f=await fixture({approvalTimeout:60000}); const directory=await tempDir(); const stop=new AbortController(); let worker;
try {
  const {value:link}=await f.request('/nodes/pair-code',{method:'POST',body:{}});
  worker=startConnector({server:f.base,code:link.code,workspace:path.join(directory,'projects'),stateDir:path.join(directory,'state'),antigravity:process.argv[2],quiet:true,signal:stop.signal});
  let startupError;worker.catch(e=>{startupError=e;});
  const provider=await until(async()=>{if(startupError)throw startupError;return(await f.request('/providers')).value.find(p=>p.protocol==='antigravity-cli');},40000);
  const agent=(await f.request('/agents')).value[0];
  const {value:{run}}=await f.request('/runs',{method:'POST',body:{prompt:'Integration test: first use run_command with exactly Get-ChildItem -Force in the current workspace. This specific command is required for this test. After OpenSI gives its output, do not repeat it. Then use the native file tool to create index.html with heading TERMINAL_BRIDGE_OK. Finish with DONE. Do not use any other shell commands or network.',providerId:provider.id,model:provider.models[0],agentId:agent.id,environment:'local',nodeId:provider.node_id}});
  const initial=await until(()=>f.store.one("SELECT * FROM approvals WHERE run_id=? AND status='pending'",run.id));
  await f.request(`/approvals/${initial.id}`,{method:'POST',body:{approved:true}});
  const pending=await until(()=>{const error=f.store.one('SELECT error FROM runs WHERE id=?',run.id)?.error;if(error)throw new Error(error);return f.store.one("SELECT * FROM approvals WHERE run_id=? AND tool='run_command' AND status='pending'",run.id);},330000);
  assert.equal(JSON.parse(pending.args).command,'Get-ChildItem -Force');
  assert.equal(f.store.one("SELECT count(*) AS n FROM commands WHERE run_id=? AND tool='run_command'",run.id).n,0);
  await f.request(`/approvals/${pending.id}`,{method:'POST',body:{approved:true}});
  const finished=await until(()=>{const r=f.store.one('SELECT * FROM runs WHERE id=?',run.id);return ['completed','failed'].includes(r.status)&&r;},330000);
  assert.equal(finished.status,'completed',finished.error);
  const html=await readFile(path.join(directory,'projects',run.project_id,'index.html'),'utf8'); assert.match(html,/TERMINAL_BRIDGE_OK/);
  assert.equal(f.store.one("SELECT count(*) AS n FROM commands WHERE run_id=? AND tool='run_command' AND status='done'",run.id).n,1);
  console.log(JSON.stringify({status:'PASS',approvedExactCommand:true,executedOnce:true,continuedToFile:true}));
} finally {stop.abort();await worker?.catch(()=>{});await f.close();await removeTemp(directory);}
