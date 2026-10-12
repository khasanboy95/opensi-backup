import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {fixture,mockProvider,addProvider,createRun,runState,tempDir,removeTemp} from './helpers.mjs';
import {projectZip} from '../server/archive.mjs';
import {unpackZip} from '../server/document-worker.mjs';
import {needsApproval} from '../server/execution.mjs';
import {hash,token,now} from '../server/security.mjs';
import {startConnector} from '../connector/index.mjs';

async function upload(f,name,bytes){const response=await fetch(f.base+'/api/uploads',{method:'POST',headers:{'Content-Type':'application/octet-stream','x-opensi-client':'web','x-file-name':encodeURIComponent(name)},body:bytes});const value=await response.json();assert.equal(response.status,201,JSON.stringify(value));return value;}
function other(f){const key=token();f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)','other-ext','Other','user',now());f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(key),'other-ext',Date.now()+60000);return {cookie:`opensi_session=${key}`};}

test('arbitrary binary uploads and more than four attachments preserve exact bytes, isolate owners and export all outputs',async()=>{
 const f=await fixture(),mock=await mockProvider();try {
  const files=[];const bytes=Buffer.from([0,255,128,13,10,42]);for(let i=0;i<6;i++)files.push(await upload(f,`file-${i}.unknown`,bytes));files.push(await upload(f,'empty.txt',Buffer.alloc(0)));
  const provider=await addProvider(f,mock);const {run,project}=await createRun(f,provider,'Check attached files',{attachmentIds:files.map(f=>f.id),autonomy:'automatic'});await runState(f,run.id,'completed');
  const inputs=await f.request(`/projects/${project.id}/download-manifest`);assert.equal(inputs.status,200);for(const file of files){const name=`inputs/${file.id}/${file.name}`;const response=await fetch(f.base+`/api/projects/${project.id}/download-file?path=${name}`);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),file.name==='empty.txt'?Buffer.alloc(0):bytes);}
  assert.equal((await f.request(`/projects/${project.id}/execution`)).value.autonomy,'automatic');
  const headers=other(f);assert.equal((await f.request(`/projects/${project.id}/download-manifest`,{headers})).status,404);assert.equal((await f.request(`/projects/${project.id}/execution`,{method:'PUT',headers,body:{autonomy:'automatic'}})).status,404);
  assert.equal((await f.request('/runs',{method:'POST',headers,body:{prompt:'other',providerId:provider.id,model:'qa-model',agentId:'developer',environment:'cloud',attachmentIds:[files[0].id]}})).status,404);
  const bad=await fetch(f.base+'/api/uploads',{method:'POST',headers:{'content-type':'application/octet-stream','x-file-name':'bad.txt'},body:'x'});assert.equal(bad.status,403);
  const traversal=await f.request(`/projects/${project.id}/download-file?path=..%2Fsecret`);assert.equal(traversal.status,400);
 }finally{await f.close();await mock.close();}
});

test('ZIP and office document extraction produce real files/text; traversal archive is rejected',async()=>{
 const f=await fixture(),mock=await mockProvider(),dir=await tempDir(),out=await tempDir();try{
  await mkdir(path.join(dir,'word'));await writeFile(path.join(dir,'word/document.xml'),'<w:document><w:body><w:p><w:r><w:t>Haqiqiy hujjat matni &amp; test</w:t></w:r></w:p></w:body></w:document>');const doc=await projectZip(dir);
  const a=await upload(f,'example.docx',doc),b=await upload(f,'example.zip',doc);const p=await addProvider(f,mock),{run,project}=await createRun(f,p,'Read documents',{attachmentIds:[a.id,b.id]});await runState(f,run.id,'completed');
  const file=await f.request(`/projects/${project.id}/file?path=inputs/${a.id}/extracted.txt`);assert.match(file.value.content,/Haqiqiy hujjat matni & test/);
  const zipFile=await f.request(`/projects/${project.id}/file?path=inputs/${b.id}/unpacked/word/document.xml`);assert.match(zipFile.value.content,/w:document/);
  const altered=Buffer.from(doc);let at=0;while((at=altered.indexOf('word/document.xml',at))>=0){altered.write('../x/document.xml',at);at+=17;}await assert.rejects(unpackZip(altered,out),/invalid relative path|ZIP yo‘li|workspace|yo‘l/);
 }finally{await f.close();await mock.close();await removeTemp(dir);await removeTemp(out);}
});

test('automatic policy runs local shell and connected MCP while retaining user input',()=>{
 for(const autonomy of ['guided','automatic']){assert.equal(needsApproval('ask_user',{environment:'cloud'},{autonomy}),true);assert.equal(needsApproval('mcp_send',{environment:'cloud'},{autonomy}),autonomy==='guided');assert.equal(needsApproval('run_command',{environment:'local'},{autonomy}),autonomy==='guided');}
 assert.equal(needsApproval('run_command',{environment:'cloud'},{autonomy:'automatic'}),false);assert.equal(needsApproval('computer_action',{environment:'cloud'},{autonomy:'automatic'}),false);assert.equal(needsApproval('computer_action',{environment:'cloud'},{autonomy:'guided'}),true);
});

test('PDF extracts actual page text and local connector receives binary chunks without conversion',async()=>{
 const f=await fixture(),mock=await mockProvider(),workspace=await tempDir(),stateDir=await tempDir();const stop=new AbortController();let connector;
 try{
  const text='BT /F1 12 Tf 30 100 Td (OpenSI PDF test 123) Tj ET';
  const pdf=Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n5 0 obj << /Length ${text.length} >> stream\n${text}\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF`);
  const file=await upload(f,'sample.pdf',pdf);const p=await addProvider(f,mock);const first=await createRun(f,p,'Read PDF',{attachmentIds:[file.id]});await runState(f,first.run.id,'completed');const extracted=await f.request(`/projects/${first.project.id}/file?path=inputs/${file.id}/extracted.txt`);assert.match(extracted.value.content,/OpenSI PDF test 123/);
  const pair=(await f.request('/nodes/pair-code',{method:'POST',body:{}})).value;
  connector=startConnector({server:f.base,code:pair.code,workspace,stateDir,signal:stop.signal,quiet:true});
  let nodes=[];for(let i=0;i<30&&!nodes.length;i++){nodes=(await f.request('/nodes')).value;if(!nodes.length)await new Promise(r=>setTimeout(r,50));}assert.equal(nodes.length,1);
  const binary=Buffer.alloc(900001);binary[0]=255;binary[750001]=128;const b=await upload(f,'raw.bin',binary);
  const second=await createRun(f,p,'Inspect local input',{environment:'local',nodeId:nodes[0].id,attachmentIds:[b.id]});await runState(f,second.run.id,'completed');assert.deepEqual(await readFile(path.join(workspace,second.project.id,'inputs',b.id,'raw.bin')),binary);
 }finally{stop.abort();await connector?.catch(()=>{});await f.close();await mock.close();await removeTemp(workspace);await removeTemp(stateDir);}
});

test('JEV uses real wire contract, returns structured decision, never exposes key, and restricts admin testing',async()=>{
 const requests=[];const server=http.createServer(async(req,res)=>{const parts=[];for await(const c of req)parts.push(c);requests.push({body:JSON.parse(Buffer.concat(parts)),auth:req.headers.authorization});res.setHeader('content-type','application/json');res.end(JSON.stringify({model:'jev-test',answers:{connected:{type:'noul',probability:0.99}}}));});server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const f=await fixture({jevKey:'QA_JEV_KEY',jevEndpoint:`http://127.0.0.1:${server.address().port}/v1/systemone`});try{
  assert.equal((await f.request('/jev')).value.enabled,true);const result=await f.request('/jev/test',{method:'POST',body:{}});assert.equal(result.status,200);assert.equal(result.value.model,'jev-test');assert.equal(requests[0].body.model,'jev-latest');assert.equal(requests[0].auth,'Bearer QA_JEV_KEY');assert.equal(JSON.stringify((await f.request('/jev')).value).includes('QA_JEV_KEY'),false);
  assert.equal((await f.request('/jev/test',{method:'POST',body:{},headers:other(f)})).status,403);
 }finally{await f.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
