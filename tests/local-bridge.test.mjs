import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {fixture,tempDir,removeTemp,until,mockProvider,addProvider,createRun,runState} from './helpers.mjs';
import {startConnector} from '../connector/index.mjs';
import {hash,token,now} from '../server/security.mjs';
import {visibleProviders} from '../server/model-access.mjs';

test('local bridge transfers binary only to the device and rejects wrong origins, users and environments',async()=>{
 const f=await fixture(),tmp=await tempDir(),mock=await mockProvider(),stop=new AbortController();let connector;
 try{
  const source=path.join(tmp,'source'),stateDir=path.join(tmp,'state');await mkdir(source);await mkdir(stateDir);
  await writeFile(path.join(stateDir,'folders.json'),JSON.stringify([{id:'source',label:'Source',path:source}]));
  const policy=(await fetch(f.base+'/api/health')).headers.get('content-security-policy');assert.ok(policy.includes('http://127.0.0.1:*'));assert.match(policy,/media-src 'self' blob:/);assert.ok(!policy.includes('upgrade-insecure-requests'));
  const pair=(await f.request('/nodes/pair-code',{method:'POST',body:{}})).value;
  connector=startConnector({server:f.base,code:pair.code,workspace:path.join(tmp,'workspace'),stateDir,signal:stop.signal,quiet:true});
  const node=await until(()=>f.store.one('SELECT * FROM nodes'));await until(()=>f.store.setting('node-local-port:'+node.id));
  const p=(await f.request('/projects/link',{method:'POST',body:{nodeId:node.id,sourceId:'source',title:'Local'}})).value.project;
  const access=(await f.request('/nodes/'+node.id+'/local-access',{method:'POST',body:{}})).value;
  const headers={Origin:f.base,'x-opensi-local-ticket':access.ticket,'x-file-name':'input.bin','x-file-type':'application/octet-stream','content-type':'application/octet-stream'};
  assert.equal((await fetch(access.url+'/status',{method:'POST',headers:{...headers,Origin:'https://other.invalid'}})).status,403);
  assert.equal((await fetch(access.url+'/status',{method:'POST',headers:{...headers,'x-opensi-local-ticket':'invalid'}})).status,400);
  const bytes=Buffer.from([0,255,129,42]);const result=await fetch(access.url+'/files',{method:'POST',headers,body:bytes});assert.equal(result.status,201);const att=await result.json();
  assert.equal(att.storage,'local');assert.equal(att.nodeId,node.id);
  assert.equal(f.store.one('SELECT count(*) n FROM library_assets').n,0);
  assert.equal(f.store.one('SELECT content FROM attachments WHERE id=?',att.id).content,'');
  assert.deepEqual(await readFile(path.join(stateDir,'local-inputs',att.id+'.bin')),bytes);
  const other=token();f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)','local-other','Other','user',now());f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(other),'local-other',Date.now()+60000);
  assert.equal((await f.request('/nodes/'+node.id+'/local-access',{method:'POST',headers:{cookie:'opensi_session='+other},body:{}})).status,409);
  // A second account can independently install and pair its own computer.
  const otherPair=await f.request('/nodes/pair-code',{method:'POST',headers:{cookie:'opensi_session='+other},body:{}});assert.equal(otherPair.status,200);
  const paired=await f.request('/connector/pair',{method:'POST',body:{code:otherPair.value.code,name:'Other PC',platform:'win32',workspace:'Projects'}});assert.equal(paired.status,200);
  const crossTicket=await f.request('/connector/local-ticket',{method:'POST',headers:{authorization:'Bearer '+paired.value.token},body:{ticket:access.ticket}});assert.equal(crossTicket.status,403);
  const provider=await addProvider(f,mock);
  assert.equal((await f.request('/runs',{method:'POST',body:{prompt:'test',providerId:provider.id,model:'qa-model',agentId:'developer',environment:'cloud',attachmentIds:[att.id]}})).status,409);
  const r=await createRun(f,provider,'_STATIC_',{projectId:p.id,environment:'local',nodeId:node.id,autonomy:'automatic',attachmentIds:[att.id]});await runState(f,r.run.id,'completed');
  assert.deepEqual(await readFile(path.join(source,'inputs',att.id,'input.bin')),bytes);
  assert.equal(f.store.one("SELECT count(*) n FROM commands WHERE tool='prepare_local_attachment' AND (args!='{}' OR result IS NOT NULL)").n,0);
  assert.deepEqual(await readdir(path.join(f.dataDir,'upload-temp')).catch(()=>[]),[]);
  f.store.exec('UPDATE nodes SET revoked=1 WHERE id=?',node.id);assert.equal((await fetch(access.url+'/status',{method:'POST',headers})).status,400);
 }finally{stop.abort();await connector?.catch(()=>{});await mock.close();await f.close();await removeTemp(tmp);}
});

test('Astra is owner-only in catalogs, direct execution and automatic candidate filtering',async()=>{
 const f=await fixture(),mock=await mockProvider();try{
  const user=(await f.request('/me')).value.user;f.store.exec('UPDATE users SET email=? WHERE id=?','khasandjemilov@gmail.com',user.id);
  const p=await addProvider(f,mock);f.store.exec('UPDATE providers SET models=? WHERE id=?',JSON.stringify(['qa-model','gpt-6-astra','gpt-6-sol']),p.id);
  assert.ok((await f.request('/providers')).value.find(v=>v.id===p.id).models.includes('gpt-6-astra'));
  const s=token();f.store.exec('INSERT INTO users(id,name,email,role,created_at) VALUES(?,?,?,?,?)','ordinary','User','other@example.test','admin',now());f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(s),'ordinary',Date.now()+60000);
  const headers={cookie:'opensi_session='+s};const visible=(await f.request('/providers',{headers})).value.find(v=>v.id===p.id);assert.deepEqual(visible.models,['qa-model','gpt-6-sol']);
  assert.equal((await f.request('/runs',{method:'POST',headers,body:{providerId:p.id,model:'gpt-6-astra',agentId:'developer',environment:'cloud',prompt:'No'}})).status,403);
  assert.deepEqual(visibleProviders(f.store,f.config,'ordinary',[{models:['gpt-6-astra','gpt-6.1-astra','qa-model'],model_labels:{'gpt-6-astra':'Astra','qa-model':'QA'}}])[0],{models:['qa-model'],model_labels:{'qa-model':'QA'}});
  const installer=await f.request('/nodes/installer/windows',{method:'POST',headers,body:{}});assert.equal(installer.status,200);assert.match(installer.value.filename,/\.zip$/);const download=await fetch(f.base+installer.value.url,{headers});assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/zip');assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0,2).toString(),'PK');
 }finally{await mock.close();await f.close();}
});
