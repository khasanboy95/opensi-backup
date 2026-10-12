import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fixture,tempDir,removeTemp} from './helpers.mjs';
import {fileTool} from '../server/files.mjs';
import {projectZip} from '../server/archive.mjs';
import {importZip,importSkip,containsSecret} from '../server/project-import.mjs';
import {dependencies} from '../deploy/runner/install-node.mjs';
import {packageRequest} from '../server/packages.mjs';
import {validateJob} from '../deploy/runner/broker.mjs';
import {hash,token,now} from '../server/security.mjs';

test('project ZIP imports source and continuation context, scopes owners, and rejects unsafe archives',async()=>{
 const f=await fixture(),tmp=await tempDir();try{
  const src=path.join(tmp,'source');await mkdir(path.join(src,'wrapped','src'),{recursive:true});
  await writeFile(path.join(src,'wrapped','package.json'),JSON.stringify({name:'ielts-course',scripts:{build:'vite build'},dependencies:{react:'19.2.0'},devDependencies:{vite:'7.1.0'}}));
  await writeFile(path.join(src,'wrapped','src','main.tsx'),'export const title="Original curriculum";');
  await writeFile(path.join(src,'wrapped','secret.js'),'const api_key="sk-proj-'+ 'x'.repeat(35)+'";');
  await writeFile(path.join(src,'wrapped','binary.bin'),Buffer.from([0,255,128]));
  const bytes=await projectZip(src);
  const upload=await fetch(f.base+'/api/uploads',{method:'POST',headers:{'x-opensi-client':'web','x-file-name':'course.zip','content-type':'application/octet-stream'},body:bytes});assert.equal(upload.status,201);const asset=await upload.json();
  const imported=await f.request('/projects/import',{method:'POST',body:{assetId:asset.assetId,title:'IELTS course',notes:'Preserve questions. Missing audio must remain ungraded.'}});assert.equal(imported.status,201,JSON.stringify(imported.value));const pid=imported.value.project.id;
  assert.equal(imported.value.report.files,3);assert.equal(imported.value.report.skipped.length,1);
  assert.equal((await f.request(`/projects/${pid}/file?path=src/main.tsx`)).value.content,'export const title="Original curriculum";');
  const inspect=await f.request(`/projects/${pid}/inspect`);assert.deepEqual(inspect.value.stack,['React','Vite']);assert.equal(inspect.value.scripts.build,'vite build');assert.ok(inspect.value.profiles.some(p=>p.id==='education'));
  assert.match((await f.request(`/projects/${pid}/file?path=opensi-handoff.md`)).value.content,/Missing audio/);
  const foreign=token();f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)','foreign-import','Other','user',now());f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(foreign),'foreign-import',Date.now()+60000);
  const headers={cookie:`opensi_session=${foreign}`};assert.equal((await f.request(`/projects/${pid}/inspect`,{headers})).status,404);assert.equal((await f.request('/projects/import',{method:'POST',headers,body:{assetId:asset.assetId,title:'Stolen'}})).status,404);
  const zip=path.join(tmp,'source.zip');await writeFile(zip,bytes);await assert.rejects(importZip(zip,path.join(tmp,'limited'),{maxBytes:2}));
  // Replace an equal-length entry in both local and central headers with traversal.
  const bad=Buffer.from(bytes);let at=0;while((at=bad.indexOf(Buffer.from('wrapped/binary.bin'),at))>=0){bad.write('../evil/binary.bin',at);at+=18;}await writeFile(zip,bad);await assert.rejects(importZip(zip,path.join(tmp,'bad')));
  assert.ok(importSkip('.env'));assert.ok(importSkip('data/app.sqlite3-wal'));assert.ok(containsSecret('const x="sk-proj-'+ 'a'.repeat(40)+'"'));
 }finally{await f.close();await removeTemp(tmp);}
});

test('Node dependencies use only registry versions and fixed broker command',()=>{
 assert.deepEqual(dependencies({dependencies:{react:'^19.2.0'},scripts:{postinstall:'evil'}}),{react:'^19.2.0'});
 for(const version of ['https://evil.test/pkg.tgz','file:../secret','git+ssh://host/a','npm:other@1','--proxy=evil'])assert.throws(()=>dependencies({dependencies:{test:version}}));
 const req=packageRequest('npm install');validateJob({userId:'usr_'+'a'.repeat(24),projectId:'prj_'+'b'.repeat(24),...req});assert.equal(req.kind,'package');assert.equal(packageRequest('npm install; curl evil'),null);
});

test('large project file listing exposes subsequent pages and source prefixes',async()=>{
 const root=await tempDir();try{await mkdir(path.join(root,'src'));await Promise.all(Array.from({length:205},(_,i)=>writeFile(path.join(root,'src',String(i).padStart(3,'0')+'.js'),'// source')));
 const first=await fileTool(root,'list_files',{});assert.equal(first.files.length,200);assert.equal(first.total,205);assert.equal(first.nextOffset,200);
 const next=await fileTool(root,'list_files',{path:'src/',offset:200});assert.equal(next.files.length,5);assert.equal(next.nextOffset,null);
 }finally{await removeTemp(root);}
});

test('preview rebases build assets and supplies isolated storage without granting same-origin',async()=>{
 const {previewSource}=await import('../server/preview-source.mjs');
 const base='/api/previews/signed/dist/';const html=previewSource('<head><script src="/assets/main.js"></script></head><img src="/a.png">','.html',base);
 assert.ok(html.includes('src="'+base+'assets/main.js"'));assert.ok(html.includes('src="'+base+'a.png"'));assert.ok(html.includes('Object.defineProperty(window,name'));assert.ok(!html.includes('allow-same-origin'));
 assert.equal(previewSource('const ratio="/3";','.js',base),'const ratio="/3";');
 assert.equal(previewSource('const audio="/audio/lesson.mp3";const url="https://example.test/a";','.js',base),'const audio="'+base+'audio/lesson.mp3";const url="https://example.test/a";');
});
