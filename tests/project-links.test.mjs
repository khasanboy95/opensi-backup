import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {fixture,tempDir,removeTemp,until,mockProvider,addProvider,createRun,runState} from './helpers.mjs';
import {startConnector} from '../connector/index.mjs';
import {commandRoot,registerFolder,localFolders,browseFolders} from '../connector/folders.mjs';
import {projectRoot} from '../server/files.mjs';
import {hash,token,now} from '../server/security.mjs';

test('folder navigation uses heartbeat during busy terminal work and rejects foreign results',async()=>{
 const f=await fixture();try{
  const code=(await f.request('/nodes/pair-code',{method:'POST',body:{}})).value.code;
  const pair=f.nodes.pair({code,name:'PC',platform:process.platform,workspace:'QA'}),node=f.store.one('SELECT * FROM nodes WHERE id=?',pair.nodeId);
  f.nodes.heartbeat(node,['folder_browse_v1']);
  const pending=f.nodes.browseFolders(node.user_id,node.id,{path:'',offset:0});
  const command=f.nodes.heartbeat(node,['folder_browse_v1']).folderCommand;assert.equal(command.tool,'browse_folders');
  assert.equal(f.nodes.poll(node).command,null,'same request must not be delivered twice');
  assert.throws(()=>f.nodes.result({...node,id:'foreign'},command.id,{path:'',entries:[]}));
  f.nodes.result(node,command.id,{path:'',entries:[],markers:[],more:false});assert.deepEqual((await pending).entries,[]);
  assert.equal(f.store.one('SELECT count(*) AS n FROM commands').n,0);
 }finally{await f.close();}
});

test('linked folder reads/writes existing sources, continues agent work and never mirrors files or command payloads',async()=>{
 const f=await fixture(),tmp=await tempDir(),mock=await mockProvider(),stop=new AbortController();let connector;
 try{
  const source=path.join(tmp,'original'),stateDir=path.join(tmp,'state'),workspace=path.join(tmp,'new-projects');await mkdir(source);await mkdir(stateDir);
  await writeFile(path.join(source,'existing.txt'),'SOURCE_ALREADY_EXISTS');await writeFile(path.join(stateDir,'folders.json'),JSON.stringify([{id:'source-1',label:'Original project',path:source}]));
  const pair=(await f.request('/nodes/pair-code',{method:'POST',body:{}})).value;
  connector=startConnector({server:f.base,code:pair.code,workspace,stateDir,signal:stop.signal,quiet:true});
  const node=await until(()=>f.store.one('SELECT * FROM nodes'));await until(()=>f.store.setting('node-folders:'+node.id)?.length);
  await until(()=>f.store.setting('node-capabilities:'+node.id)?.includes('folder_path_v1'));
  const browsed=await f.request('/projects/browse-folders',{method:'POST',body:{nodeId:node.id,path:tmp}});assert.equal(browsed.status,200,JSON.stringify(browsed.value));assert.ok(browsed.value.entries.some(e=>e.path===source));
  assert.equal((await f.request('/projects/browse-folders',{method:'POST',body:{nodeId:node.id,path:tmp,offset:-1}})).status,400);
  assert.equal(f.store.one("SELECT count(*) AS n FROM commands WHERE tool='browse_folders'").n,0,'folder listings remain transient');
  const linked=await f.request('/projects/link-path',{method:'POST',body:{path:source,title:'Original'}});assert.equal(linked.status,201,JSON.stringify(linked.value));const p=linked.value.project;
  assert.equal((await f.request('/projects/link-path',{method:'POST',body:{nodeId:node.id,path:source+path.sep}})).value.project.id,p.id);
  assert.equal((await f.request('/projects/link-path',{method:'POST',body:{nodeId:node.id,path:path.join(tmp,'missing')}})).status,400);
  assert.equal((await f.request('/projects/link-path',{method:'POST',body:{nodeId:node.id,path:path.join(source,'existing.txt')}})).status,400);
  assert.equal(f.store.one('SELECT count(*) AS n FROM projects').n,1,'invalid folders must not create empty projects');
  const fresh=path.join(tmp,'Yangi mavjud loyiha');await mkdir(fresh);await writeFile(path.join(fresh,'proof.txt'),'FRESH_LOCAL_ONLY');
  const freshLink=await f.request('/projects/link-path',{method:'POST',body:{nodeId:node.id,path:fresh}});assert.equal(freshLink.status,201,JSON.stringify(freshLink.value));
  assert.equal((await f.request(`/projects/${freshLink.value.project.id}/file?path=proof.txt`)).value.content,'FRESH_LOCAL_ONLY');
  assert.equal((await localFolders(stateDir)).length,2,'old and newly registered folders survive together');
  for(let i=0;i<205;i++)f.store.exec("INSERT INTO runs(id,user_id,project_id,agent_id,prompt,status,environment,node_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",'history-'+i,p.user_id,freshLink.value.project.id,'developer','History pagination QA','completed','local',node.id,'2099-01-01','2099-01-01');
  assert.ok(!(await f.request('/runs')).value.some(r=>r.project_id===p.id),'old project is outside the global recent feed');
  const latest=await f.request(`/projects/${p.id}/latest-run`);assert.equal(latest.status,200);assert.equal(latest.value.id,linked.value.run.id,'opening old projects must not rely on the recent feed');
  assert.equal((await f.request(`/projects/${p.id}/file?path=existing.txt`)).value.content,'SOURCE_ALREADY_EXISTS');
  assert.equal((await f.request(`/projects/${p.id}/file`,{method:'PUT',body:{path:'existing.txt',content:'CHANGED_IN_PLACE'}})).status,200);
  assert.equal(await readFile(path.join(source,'existing.txt'),'utf8'),'CHANGED_IN_PLACE');
  assert.equal((await f.request('/projects/link',{method:'POST',body:{nodeId:node.id,sourceId:'source-1',title:'Duplicate'}})).value.project.id,p.id);
  assert.equal((await f.request('/projects/link',{method:'POST',body:{nodeId:node.id,sourceId:'unapproved',title:'No'}})).status,404);
  await assert.rejects(commandRoot(workspace,stateDir,{projectId:p.id,sourceId:'unapproved'}));
  const foreign=token();f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)','other-link','Other','user',now());f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(foreign),'other-link',Date.now()+60000);
  assert.equal((await f.request('/projects/link',{method:'POST',headers:{cookie:`opensi_session=${foreign}`},body:{nodeId:node.id,sourceId:'source-1',title:'No'}})).status,409);
  assert.equal((await f.request('/projects/link-path',{method:'POST',headers:{cookie:`opensi_session=${foreign}`},body:{nodeId:node.id,path:source}})).status,409);
  assert.equal((await f.request('/projects/browse-folders',{method:'POST',headers:{cookie:`opensi_session=${foreign}`},body:{nodeId:node.id,path:tmp}})).status,409);
  assert.equal((await f.request(`/projects/${p.id}/latest-run`,{headers:{cookie:`opensi_session=${foreign}`}})).status,404);
  const upload=await fetch(f.base+'/api/uploads',{method:'POST',headers:{'x-opensi-client':'web','x-file-name':'local.bin','content-type':'application/octet-stream'},body:Buffer.from([0,255,128,42])});assert.equal(upload.status,201);const attachment=await upload.json();
  const provider=await addProvider(f,mock);const r=await createRun(f,provider,'_STATIC_', {projectId:p.id,environment:'local',nodeId:node.id,autonomy:'automatic',attachmentIds:[attachment.id]});
  await runState(f,r.run.id,'completed');
  assert.deepEqual(await readFile(path.join(source,'inputs',attachment.id,'local.bin')),Buffer.from([0,255,128,42]));
  assert.deepEqual(await readdir(path.join(f.dataDir,'linked-inputs')),[]);
  assert.ok((await readdir(source)).length>1,'agent must write into original folder');
  const onServer=await readdir(projectRoot(f.config,p)).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e));assert.deepEqual(onServer,[]);
  assert.equal(f.store.one('SELECT count(*) AS n FROM file_versions WHERE project_id=?',p.id).n,0);
  assert.equal(f.store.one("SELECT count(*) AS n FROM commands WHERE project_id=? AND (args!='{}' OR result IS NOT NULL)",p.id).n,0);
  assert.equal((await f.request(`/projects/${p.id}/file?path=existing.txt`)).value.content,'CHANGED_IN_PLACE');
  stop.abort();await connector;connector=null;f.store.exec('UPDATE nodes SET last_seen=? WHERE id=?','2000-01-01',node.id);
  assert.equal((await f.request('/projects/link-path',{method:'POST',body:{nodeId:node.id,path:source}})).status,409);
  assert.equal((await f.request(`/projects/${p.id}/file?path=existing.txt`)).status,409);
 }finally{stop.abort();await connector?.catch(()=>{});await mock.close();await f.close();await removeTemp(tmp);}
});

test('folder browser lists real directories, pages all results, detects project markers and omits missing shortcuts',async()=>{
 const tmp=await tempDir();try{
  const state=path.join(tmp,'state'),workspace=path.join(tmp,'projects');await mkdir(state);await mkdir(workspace);
  await writeFile(path.join(state,'folders.json'),JSON.stringify([{id:'stale',label:'Moved',path:path.join(tmp,'missing')}]));
  await writeFile(path.join(workspace,'package.json'),'{}');await writeFile(path.join(workspace,'private.txt'),'NOT_A_DIRECTORY');
  await Promise.all(Array.from({length:205},(_,i)=>mkdir(path.join(workspace,'Papka '+String(i).padStart(3,'0')))));
  const roots=await browseFolders(state,workspace,{});assert.ok(roots.entries.some(e=>e.path===workspace));assert.ok(!roots.entries.some(e=>e.label==='Moved'));
  const first=await browseFolders(state,workspace,{path:workspace});assert.equal(first.entries.length,200);assert.equal(first.more,true);assert.equal(first.parent,tmp);assert.deepEqual(first.markers,['package.json']);assert.ok(first.entries.every(e=>!e.path.endsWith('private.txt')));
  const next=await browseFolders(state,workspace,{path:workspace,offset:first.nextOffset});assert.equal(next.entries.length,5);assert.equal(next.more,false);assert.equal(new Set([...first.entries,...next.entries].map(e=>e.path)).size,205);
  const empty=await browseFolders(state,workspace,{path:first.entries[0].path});assert.equal(empty.entries.length,0);assert.equal(empty.parent,workspace);
  await assert.rejects(browseFolders(state,workspace,{path:path.join(tmp,'missing')}));
  await assert.rejects(browseFolders(state,workspace,{path:'relative'}));
  await assert.rejects(browseFolders(state,workspace,{path:workspace,offset:-1}));
 }finally{await removeTemp(tmp);}
});

test('folder path registration preserves catalogs, supports spaces and Unicode, and resolves the same directory once',async()=>{
 const tmp=await tempDir();try{
  const source=path.join(tmp,'O‘zbek loyiha 14'),state=path.join(tmp,'state');await mkdir(source);await mkdir(state);
  await writeFile(path.join(source,'keep.txt'),'original');
  const a=await registerFolder(state,'"'+source+'"'),b=await registerFolder(state,source+path.sep);
  assert.equal(a.id,b.id);assert.deepEqual(Object.keys(a).sort(),['id','kind','label']);
  assert.equal((await localFolders(state)).length,1);
  assert.equal(await commandRoot(tmp,state,{sourceId:a.id}),source);
  assert.equal(await readFile(path.join(source,'keep.txt'),'utf8'),'original');
  await assert.rejects(registerFolder(state,'relative/path'));
  await assert.rejects(registerFolder(state,'\\\\server\\share'));
  await assert.rejects(registerFolder(state,source+'\n'));
  const second=path.join(tmp,'second');await mkdir(second);await registerFolder(state,second);
  assert.equal((await localFolders(state)).length,2);
 }finally{await removeTemp(tmp);}
});

