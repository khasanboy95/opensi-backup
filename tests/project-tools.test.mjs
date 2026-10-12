import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {mkdir,symlink} from 'node:fs/promises';
import {fixture,mockProvider,addProvider,createRun,runState,tempDir,removeTemp} from './helpers.mjs';
import {hash,token,now} from '../server/security.mjs';
import {fileTool} from '../server/files.mjs';
import {validateJob,jobPath,jobArguments,createBroker} from '../deploy/runner/broker.mjs';
import {remoteCommand} from '../server/commands.mjs';

test('agent plans persist with actual incomplete statuses and replay in snapshots',async()=>{
  const f=await fixture(),mock=await mockProvider();try{
    const provider=await addProvider(f,mock),{run}=await createRun(f,provider,'_PLAN_FLOW_');const done=await runState(f,run.id,'completed');
    assert.deepEqual(done.live.plan.map(step=>step.status),['completed','in_progress']);
    assert.equal(done.events.filter(event=>event.type==='tool_result'&&event.data.tool==='update_plan').length,2);
    assert.deepEqual(JSON.parse(f.store.one('SELECT data FROM live_runs WHERE run_id=?',run.id).data).plan,done.live.plan);
  }finally{await f.close();await mock.close();}
});

test('versions preserve originals, restore exact bytes, isolate owners and export a valid UTF-8 ZIP',async()=>{
  const f=await fixture(),mock=await mockProvider();
  try{
    const provider=await addProvider(f,mock),{run,project}=await createRun(f,provider,'_STATIC_');await runState(f,run.id,'completed');
    const original=(await f.request(`/projects/${project.id}/file?path=index.html`)).value.content;
    let versions=(await f.request(`/projects/${project.id}/versions`)).value;const baseline=versions.find(v=>v.path==='index.html');assert.ok(baseline);
    const updated=original.replace('Portfolio.','Yangilangan sahifa');
    assert.equal((await f.request(`/projects/${project.id}/file`,{method:'PUT',body:{path:'index.html',content:updated}})).status,200);
    const comparison=(await f.request(`/projects/${project.id}/versions/${baseline.id}`)).value;assert.equal(comparison.diff.changed,true);assert.ok(comparison.diff.lines.some(line=>line.type==='added'&&line.text.includes('Yangilangan')));
    const session=token();f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)','foreign-history','Foreign','user',now());f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(session),'foreign-history',Date.now()+60000);
    for(const route of ['/versions',`/versions/${baseline.id}`,'/export','/browser-tests','/artifact?path=artifacts/browser-a.png']) assert.equal((await f.request(`/projects/${project.id}${route}`,{headers:{cookie:`opensi_session=${session}`}})).status,404);
    assert.equal((await f.request(`/projects/${project.id}/versions/${baseline.id}/restore`,{method:'POST',body:{}})).status,200);
    assert.equal((await f.request(`/projects/${project.id}/file?path=index.html`)).value.content,original);
    versions=(await f.request(`/projects/${project.id}/versions`)).value;assert.ok(versions.some(v=>v.label==='Oldingi versiya tiklandi'));
    const response=await fetch(f.base+`/api/projects/${project.id}/export`);assert.equal(response.status,200);const zip=Buffer.from(await response.arrayBuffer());assert.equal(zip.readUInt32LE(0),0x04034b50);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);assert.equal(zip.readUInt16LE(zip.length-12),2);
    assert.ok(zip.includes(Buffer.from(original)));assert.ok(zip.includes(Buffer.from('style.css')));
    assert.equal((await f.request(`/projects/${project.id}/artifact?path=../opensi.sqlite`)).status,400);
  }finally{await f.close();await mock.close();}
});

test('cloud file search, rename and delete obey workspace boundaries',async()=>{
  const root=await tempDir();try{
    await fileTool(root,'write_file',{path:'source.ts',content:'first\nneedle here\nlast'});
    assert.deepEqual((await fileTool(root,'search_files',{query:'NEEDLE'})).matches,[{path:'source.ts',line:2,text:'needle here'}]);
    await fileTool(root,'rename_file',{from:'source.ts',path:'src/main.ts'});assert.equal((await fileTool(root,'read_file',{path:'src/main.ts'})).content,'first\nneedle here\nlast');
    await assert.rejects(fileTool(root,'rename_file',{from:'src/main.ts',path:'../outside.ts'}));
    await fileTool(root,'delete_file',{path:'src/main.ts'});assert.equal((await fileTool(root,'list_files',{})).files.length,0);
  }finally{await removeTemp(root);}
});

test('private broker enforces authentication, project paths and restricted sandbox flags',async()=>{
  const root=await tempDir(),outside=await tempDir();const userId='usr_'+'a'.repeat(24),projectId='prj_'+'b'.repeat(24),secret='c'.repeat(64);
  const server=createBroker({token:secret,root,hostRoot:'/safe/workspaces'});server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.equal((await fetch(base+'/health')).status,401);assert.equal((await fetch(base+'/health',{headers:{authorization:'Bearer '+secret}})).status,200);
    assert.throws(()=>validateJob({userId,projectId:'../../data',command:'true',timeout:1}));
    const body=validateJob({userId,projectId,command:'node --version',timeout:10});
    await mkdir(path.join(root,userId));await symlink(outside,path.join(root,userId,projectId),process.platform==='win32'?'junction':'dir');await assert.rejects(jobPath(root,userId,projectId));
    const args=jobArguments(body,'/safe/workspaces','test-job','opensi-runtime:test');assert.ok(args.includes('none'));assert.ok(args.includes('--read-only'));assert.ok(args.includes('1000:1000'));assert.ok(args.includes('--cap-drop'));assert.equal(args.filter(arg=>arg==='--mount').length,1);assert.ok(!args.some(arg=>arg.includes('docker.sock')));assert.ok(!args.some(arg=>arg.includes(secret)));
    assert.equal((await fetch(base+'/execute',{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify(body)})).status,400);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await removeTemp(root);await removeTemp(outside);}
});

test('remote terminal streams before completion and rejects a missing final result',async()=>{
  let complete;const gate=new Promise(resolve=>complete=resolve);let received=false;let broken=false;
  const server=http.createServer(async(req,res)=>{for await(const _ of req){}res.writeHead(200,{'content-type':'application/x-ndjson'});res.write(JSON.stringify({type:'output',text:'FIRST'})+'\n');await gate;if(!broken)res.write(JSON.stringify({type:'result',exitCode:0,output:'FIRSTLAST',timedOut:false})+'\n');res.end();});
  server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const config={dataDir:process.cwd(),runnerUrl:`http://127.0.0.1:${server.address().port}`,runnerToken:'test'};
  try{
    const running=remoteCommand(config,path.join(config.dataDir,'workspaces','usr_a','prj_b'),{command:'test',timeout:1},undefined,text=>{received=text==='FIRST';complete();});
    assert.equal((await running).exitCode,0);assert.equal(received,true);broken=true;
    await assert.rejects(remoteCommand(config,path.join(config.dataDir,'workspaces','usr_a','prj_b'),{command:'test',timeout:1}),/yakuniy/);
  }finally{complete();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
