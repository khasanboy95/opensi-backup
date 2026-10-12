import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {fixture} from './helpers.mjs';
import {fileTool,projectRoot} from '../server/files.mjs';
import {hash,token,now} from '../server/security.mjs';
import {publishable} from '../server/publishing.mjs';

function project(f,id='publish-test',environment='cloud'){const p={id,user_id:'local-owner',environment,node_id:environment==='local'?'test-node':null};f.store.exec('INSERT INTO projects VALUES(?,?,?,?,?,?,?)',id,p.user_id,'Publish test',environment,p.node_id,now(),now());return p;}
const put=(f,p,name,content)=>fileTool(projectRoot(f.config,p),'write_file',{path:name,content});
const route=p=>`/projects/${p.id}/publication`;
test('public snapshot: selected assets only, stable updates, rollback, ownership, revocation and isolated active content',async()=>{
 const f=await fixture();try{
  const p=project(f);await put(f,p,'dist/index.html','<head><link rel="stylesheet" href="/style.css"></head><h1>VERSION_ONE</h1>');await put(f,p,'dist/style.css','body{color:red}');await put(f,p,'private.txt','DO_NOT_PUBLISH');await put(f,p,'dist/package.json','{}');
  const options=await f.request(route(p)+'/files');assert.equal(options.value.entries[0],'dist/index.html');assert.ok(!options.value.files.some(x=>x.path.includes('package.json')));
  const body={entry:'dist/index.html',files:['dist/index.html','dist/style.css']};const result=await f.request(route(p),{method:'POST',body});assert.equal(result.status,200,JSON.stringify(result.value));const url=new URL(result.value.url).pathname;
  const page=await fetch(f.base+url);assert.equal(page.status,200);assert.match(await page.text(),/VERSION_ONE/);const csp=page.headers.get('content-security-policy');assert.match(csp,/sandbox allow-scripts allow-downloads/);assert.ok(!csp.includes('allow-same-origin'));assert.match(csp,/connect-src http[^;]+\/p\//);assert.match(csp,/form-action 'none'/);assert.equal(page.headers.get('access-control-allow-origin'),'*');assert.equal(page.headers.get('access-control-allow-credentials'),null);
  assert.equal((await fetch(f.base+url+'style.css')).status,200);assert.equal((await fetch(f.base+url+'private.txt')).status,404);assert.equal((await fetch(f.base+url+'package.json')).status,404);assert.equal((await fetch(f.base+url+'%2e%2e%2fprivate.txt')).status,404);
  await put(f,p,'dist/index.html','<h1>VERSION_TWO</h1>');assert.match(await(await fetch(f.base+url)).text(),/VERSION_ONE/,'source edits must not silently publish');
  const updated=await f.request(route(p),{method:'POST',body});assert.equal(updated.value.url,result.value.url);assert.match(await(await fetch(f.base+url)).text(),/VERSION_TWO/);assert.equal((await readdir(path.join(f.dataDir,'publications'))).length,1);
  await put(f,p,'dist/secret.js',`const api_key="${'sensitive-value-'.repeat(4)}"`);assert.equal((await f.request(route(p),{method:'POST',body:{...body,files:[...body.files,'dist/secret.js']}})).status,400);assert.match(await(await fetch(f.base+url)).text(),/VERSION_TWO/);assert.equal((await readdir(path.join(f.dataDir,'publications'))).length,1);
  const foreign=token();f.store.exec('INSERT INTO users(id,name,created_at) VALUES(?,?,?)','foreign','Other',now());f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(foreign),'foreign',Date.now()+60000);
  for(const method of ['GET','POST','DELETE'])assert.equal((await f.request(route(p),{method,headers:{cookie:`opensi_session=${foreign}`},...(method==='POST'?{body}: {})})).status,404);
  f.config.localAuth=false;assert.equal((await f.request(route(p))).status,401);assert.equal((await fetch(f.base+url)).status,200,'public URL needs no session');f.config.localAuth=true;
  assert.equal((await f.request(route(p),{method:'DELETE'})).status,200);assert.equal((await fetch(f.base+url)).status,404);assert.equal((await readdir(path.join(f.dataDir,'publications'))).length,0);
 }finally{await f.close();}
});
test('local connector snapshot stays accessible offline without project mirroring; failed updates keep old publication',async()=>{
 const f=await fixture();try{
  const p=project(f,'local-publish','local');let offline=false;const calls=[];
  f.nodes.dispatch=async(_p,_run,tool,args)=>{if(offline)throw Error('offline');calls.push(tool);if(tool==='list_files')return {files:[{path:'index.html',size:32},{path:'style.css',size:12}],nextOffset:null};if(tool==='preview_file')return {base64:Buffer.from(args.path==='index.html'?'<h1>LOCAL_PUBLISHED</h1>':'body{}').toString('base64')};throw Error(tool);};
  const body={entry:'index.html',files:['index.html','style.css']};const published=await f.request(route(p),{method:'POST',body});assert.equal(published.status,200,JSON.stringify(published.value));const url=new URL(published.value.url).pathname;
  offline=true;assert.match(await(await fetch(f.base+url)).text(),/LOCAL_PUBLISHED/);assert.equal((await f.request(route(p))).value.publication.url,published.value.url);assert.equal((await f.request(route(p),{method:'POST',body})).status,500);assert.match(await(await fetch(f.base+url)).text(),/LOCAL_PUBLISHED/);
  assert.deepEqual(await readdir(projectRoot(f.config,p)).catch(()=>[]),[]);assert.equal(calls.filter(x=>x==='preview_file').length,2);
 }finally{await f.close();}
});
test('static file selection rejects secrets, source directories and path escapes',()=>{
 for(const name of ['.env','../index.html','api/token.js','server/index.js','src/key.js','credentials.json','package-lock.json','config.js','node_modules/a.js','x.map','x.py'])assert.equal(publishable(name),false,name);
 for(const name of ['index.html','dist/assets/main.js','images/logo.svg','data.json'])assert.equal(publishable(name),true,name);
});
