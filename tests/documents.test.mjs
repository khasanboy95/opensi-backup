import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fixture,until} from './helpers.mjs';
import {id,now} from '../server/security.mjs';
import {documentFormats,documentService,documentFailure} from '../server/documents.mjs';
import {validateJob,jobArguments} from '../deploy/runner/broker.mjs';
function project(f,userId){const p={id:id('prj_'),user_id:userId,title:'Document QA',environment:'cloud',node_id:null};f.store.exec('INSERT INTO projects VALUES(?,?,?,?,?,?,?)',p.id,userId,p.title,'cloud',null,now(),now());return p;}
test('document formats are truthful and document runner rejects shell injection',()=>{
 assert.deepEqual(documentFormats('report.DOCX'),['pdf','odt','rtf','txt']);assert.deepEqual(documentFormats('book.xlsx'),['pdf','ods','csv']);assert.deepEqual(documentFormats('archive.zip'),[]);assert.deepEqual(documentFormats('already.pdf'),[]);
 const job={userId:id('usr_'),projectId:id('prj_'),command:'node /opt/toolchain/documents.mjs e30',kind:'document',timeout:110};assert.equal(validateJob(job),job);assert.throws(()=>validateJob({...job,command:job.command+'; id'}));assert.throws(()=>validateJob({...job,kind:'privileged'}));const args=jobArguments(job,'/srv/workspaces','qa','opensi-documents:0.1.0');assert.ok(args.includes('none'));assert.ok(args.includes('--read-only'));assert.ok(args.includes('no-new-privileges'));assert.ok(!args.some(v=>v.includes('docker.sock')));
});
test('missing document runner image is reported as infrastructure failure',()=>{
 const error=documentFailure({exitCode:125,output:"Unable to find image 'opensi-documents:0.1.0' locally\ndocker: pull access denied for opensi-documents"});
 assert.equal(error.status,503);assert.match(error.message,/serverda ishga tayyor emas/);
});
test('owned document conversion persists jobs, downloads real output and isolates other users',async()=>{
 let f;const calls=[];const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);calls.push(body);const args=JSON.parse(Buffer.from(body.command.split(' ').at(-1),'base64url').toString());const root=path.join(f.dataDir,'workspaces',body.userId,body.projectId);await mkdir(path.join(root,'exports'),{recursive:true});await writeFile(path.join(root,args.output),'%PDF-1.7\nQA actual bytes\n%%EOF');res.end(JSON.stringify({type:'result',exitCode:0,output:'',timedOut:false})+'\n');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 f=await fixture({runnerUrl:`http://127.0.0.1:${server.address().port}`,runnerToken:'a'.repeat(64)});
 try{
  const user=(await f.request('/me')).value.user,p=project(f,user.id),other=project(f,null);const root=path.join(f.dataDir,'workspaces',user.id,p.id);await mkdir(root,{recursive:true});await writeFile(path.join(root,'report.html'),'<h1>Hujjat</h1>');
  assert.equal((await f.request(`/documents?projectId=${other.id}`)).status,404);
  assert.equal((await f.request('/documents/convert',{method:'POST',body:{projectId:other.id,path:'report.html',format:'pdf'}})).status,404);
  assert.equal((await f.request('/documents/convert',{method:'POST',body:{projectId:p.id,path:'../report.html',format:'pdf'}})).status,400);
  assert.equal((await f.request('/documents/convert',{method:'POST',body:{projectId:p.id,path:'archive.zip',format:'pdf'}})).status,400);
  const start=await f.request('/documents/convert',{method:'POST',body:{projectId:p.id,path:'report.html',format:'pdf'}});assert.equal(start.status,202);
  const done=await until(async()=>{const j=(await f.request(`/documents/jobs/${start.value.id}`)).value;return j.status!=='running'&&j;});assert.equal(done.status,'completed',done.error);assert.equal(calls[0].kind,'document');assert.equal(calls[0].userId,user.id);assert.equal(calls[0].projectId,p.id);
  const download=await fetch(f.base+done.result.downloadUrl);assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);assert.match(await download.text(),/^%PDF-/);assert.equal(await readFile(path.join(root,'report.html'),'utf8'),'<h1>Hujjat</h1>');
  const listing=(await f.request(`/documents?projectId=${p.id}`)).value;assert.ok(listing.files.some(d=>d.path===done.result.path));assert.equal((await f.request('/documents/jobs/doc_missing')).status,404);
  const asset=(await f.request('/library',{method:'POST',body:{name:'notes.txt',content:Buffer.from('Hello').toString('base64')}})).value;
  const imported=await f.request('/documents/convert',{method:'POST',body:{assetId:asset.id,format:'pdf'}});assert.equal(imported.status,202);const saved=await until(async()=>{const j=(await f.request(`/documents/jobs/${imported.value.id}`)).value;return j.status!=='running'&&j;});assert.equal(saved.status,'completed');assert.notEqual(saved.project_id,p.id);
 }finally{await f.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('conversion failure remains visible, and missing runtime never claims success',async()=>{const f=await fixture();try{const user=(await f.request('/me')).value.user,p=project(f,user.id);const root=path.join(f.dataDir,'workspaces',user.id,p.id);await mkdir(root,{recursive:true});await writeFile(path.join(root,'report.txt'),'hi');const r=await f.request('/documents/convert',{method:'POST',body:{projectId:p.id,path:'report.txt',format:'pdf'}});const done=await until(async()=>{const j=(await f.request(`/documents/jobs/${r.value.id}`)).value;return j.status==='failed'&&j;});assert.match(done.error,/ulanmagan/);assert.equal(done.result,null);}finally{await f.close();}});
test('native model export manifest runs only for its own turn and validates real PDF bytes',async()=>{
 const f=await fixture();let service;try{const user=(await f.request('/me')).value.user,p=project(f,user.id),root=path.join(f.dataDir,'workspaces',user.id,p.id);await mkdir(root,{recursive:true});await writeFile(path.join(root,'report.html'),'<h1>Complete document</h1>');let calls=0,bad=false;
 service=documentService({get(){},post(){}},{store:f.store,config:{...f.config,runnerUrl:'http://runner',runnerToken:'test'},parse:(s,v)=>s.parse(v),editProject:(_p,op)=>op(),execute:async(_c,_r,args)=>{calls++;const a=JSON.parse(Buffer.from(args.command.split(' ').at(-1),'base64url').toString());await mkdir(path.join(root,'exports'),{recursive:true});await writeFile(path.join(root,a.output),bad?'not a pdf':'%PDF-1.7\nresult');return {exitCode:0};}});
 const run={id:id('run_')};assert.ok(service.instructions(run).includes(run.id));const manifest={version:1,runId:'old-run',requests:[{path:'report.html',format:'pdf'}]};await writeFile(path.join(root,'opensi-export.json'),JSON.stringify(manifest));await service.finalize(run,p,new AbortController().signal,()=>{});assert.equal(calls,0);
 await writeFile(path.join(root,'opensi-export.json'),JSON.stringify({...manifest,runId:run.id}));const events=[];await service.finalize(run,p,new AbortController().signal,(type,value)=>events.push({type,value}));assert.equal(calls,1);assert.ok(events.some(e=>e.type==='tool_result'&&e.value.result.downloadUrl));
 bad=true;await assert.rejects(()=>service.convert(p,{path:'report.html',format:'pdf'}),/PDF natijasi/);
 }finally{await service?.close();await f.close();}
});
