import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fixture, until, tempDir, removeTemp } from '../tests/helpers.mjs';
import { startConnector } from '../connector/index.mjs';

const executable = process.argv[2];
if (!executable || !path.isAbsolute(executable)) throw new Error('Pass the absolute official agy executable path.');
const f = await fixture({ approvalTimeout: 60000 }); const directory = await tempDir(); const stop = new AbortController(); let worker;
try {
  const {value:link}=await f.request('/nodes/pair-code',{method:'POST',body:{}});
  worker=startConnector({server:f.base,code:link.code,workspace:path.join(directory,'projects'),stateDir:path.join(directory,'state'),antigravity:executable,quiet:true,signal:stop.signal});
  // Record any startup failure immediately rather than leaving an unhandled rejection.
  let startupError; worker.catch(error=>{startupError=error;});
  const provider=await until(async()=>{if(startupError)throw startupError;return (await f.request('/providers')).value.find(p=>p.protocol==='antigravity-cli');},40000);
  const agent=(await f.request('/agents')).value[0];
  const {value:{run}}=await f.request('/runs',{method:'POST',body:{prompt:'Create index.html containing a complete tiny HTML page with heading OPENSI_AGENT_OK and a button that increments a visible counter. Use only the file editing tool, no shell or other tools. Then reply OPENSI_FILE_OK.',providerId:provider.id,model:provider.models[0],agentId:agent.id,environment:'local',nodeId:provider.node_id}});
  const approval=await until(()=>f.store.one("SELECT id FROM approvals WHERE run_id=? AND status='pending'",run.id));
  await f.request(`/approvals/${approval.id}`,{method:'POST',body:{approved:true}});
  const finished=await until(()=>{const value=f.store.one('SELECT * FROM runs WHERE id=?',run.id);return ['completed','failed','cancelled'].includes(value.status)&&value;},330000);
  assert.equal(finished.status,'completed',finished.error);
  const html=await readFile(path.join(directory,'projects',run.project_id,'index.html'),'utf8');
  assert.match(html,/OPENSI_AGENT_OK/);
  assert.equal(await readFile(path.join(f.dataDir,'workspaces','local-owner',run.project_id,'index.html'),'utf8'),html);
  const usage=f.store.one('SELECT SUM(input_tokens+output_tokens) AS tokens FROM usage WHERE run_id=?',run.id);
  assert.ok(usage.tokens>0);
  console.log(JSON.stringify({status:'PASS',models:provider.models.length,localFile:true,serverFile:true,usageTokens:usage.tokens,progressEvents:f.store.one("SELECT count(*) AS n FROM events WHERE run_id=? AND type='agent_progress'",run.id).n}));
} finally {stop.abort();await worker?.catch(()=>{});await f.close();await removeTemp(directory);}
