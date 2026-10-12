import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {stat,readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import http from 'node:http';
import {fixture,mockProvider,addProvider,runState,tempDir,removeTemp} from './helpers.mjs';
import {rankModels,canFallback} from '../server/orchestration.mjs';
import {internalLinks} from '../server/site-exploration.mjs';
import {projectZipStream} from '../server/archive.mjs';
import {id,now} from '../server/security.mjs';
import {projectRoot} from '../server/files.mjs';

test('automatic overload fallback calls another provider model without replaying tool effects',async()=>{
 const f=await fixture(),called=[];const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);called.push(body.model);if(body.model==='qa-pro'){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'server overloaded'}));return;}res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta:{content:'Recovered through second model'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}})}\n\ndata: [DONE]\n\n`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const p=await f.request('/providers',{method:'POST',body:{label:'Fallback test',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:['qa-pro','qa-sol']}});assert.equal(p.status,200);const created=await f.request('/runs',{method:'POST',body:{prompt:'Simple reply',providerId:'auto',model:'auto',agentId:'developer',environment:'cloud'}});const result=await runState(f,created.value.run.id,'completed');assert.deepEqual(called,['qa-pro','qa-sol']);assert.ok(result.events.some(e=>e.type==='warning'&&e.data.message.includes('Boshqa mos model')));assert.equal(result.messages.at(-1).message.content,'Recovered through second model');}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await f.close();}
});

test('automatic team changes models by phase, preserves files and records actual usage',async()=>{
 const f=await fixture(),mock=await mockProvider();try{
  const p=await addProvider(f,mock);f.store.exec('UPDATE providers SET models=? WHERE id=?',JSON.stringify(['qa-pro','qa-sol']),p.id);
  const created=await f.request('/runs',{method:'POST',body:{prompt:'_STATIC_ Build a page',providerId:'auto',model:'auto',agentId:'developer',environment:'cloud',autonomy:'automatic'}});assert.equal(created.status,201);
  const result=await runState(f,created.value.run.id,'completed');const routes=result.events.filter(e=>e.type==='model_route').map(e=>e.data);
  assert.ok(routes.some(r=>r.model==='qa-pro'&&r.stage==='plan'));assert.ok(routes.some(r=>r.model==='qa-sol'&&r.stage==='build'));assert.ok(routes.some(r=>r.stage==='review'));
  assert.match((await f.request(`/projects/${created.value.project.id}/file?path=index.html`)).value.content,/QA Portfolio/);
  assert.deepEqual(new Set(f.store.all('SELECT model FROM usage WHERE run_id=?',created.value.run.id).map(r=>r.model)),new Set(['qa-pro','qa-sol']));
 }finally{await f.close();await mock.close();}
});

test('agent builder creates an owned restricted agent that is available for later delegation',async()=>{
 const f=await fixture(),mock=await mockProvider();try{const p=await addProvider(f,mock);const created=await f.request('/runs',{method:'POST',body:{prompt:'_CREATE_AGENT_',providerId:p.id,model:'qa-model',agentId:'agent-builder',environment:'cloud'}});await runState(f,created.value.run.id,'completed');const agent=(await f.request('/agents')).value.find(a=>a.name==='QA Helper');assert.ok(agent);assert.deepEqual(agent.tools,['read_file','list_files']);assert.equal(agent.user_id,'local-owner');assert.equal(agent.provider_id,null);}finally{await f.close();await mock.close();}
});

test('automatic candidates never include image-only, disabled or foreign native runtimes; denials never trigger fallback',()=>{
 const providers=[{id:'p',enabled:true,protocol:'responses',models:['gpt-sol','gemini-image','mimo-v2.5-tts']},{id:'off',enabled:false,models:['gpt-sol']},{id:'native',enabled:true,protocol:'antigravity-cli',node_id:'mine',models:['gemini-pro']}];
 assert.deepEqual(rankModels(providers,'build').map(p=>p.model),['gpt-sol']);assert.equal(rankModels(providers,'design',new Set(),{nativeNode:'mine'}).length,2);
 assert.equal(canFallback(new Error('API 503 server is overloaded')),true);assert.equal(canFallback(new Error('permission denied 503')),false);assert.equal(canFallback(new Error('User cancelled')),false);assert.equal(canFallback(new Error('API 402 balance exhausted')),true);
});

test('navigation discovery deduplicates same-origin public categories and excludes action/login/external URLs',()=>{
 const links=['/catalog','/catalog#x','/products/a','/logout','/delete/1','/login','/items?token=x','https://elsewhere.test/a','javascript:alert(1)','/file.zip'].map(url=>({url,text:'category'}));
 assert.deepEqual(internalLinks('https://example.com/',links).map(l=>l.url),['https://example.com/catalog','https://example.com/products/a']);
});

test('site exploration visits discovered category pages and saves real screenshot manifests',async()=>{
 const visited=[];const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0e8AAAAASUVORK5CYII=';
 const browser=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);res.setHeader('content-type','application/json');if(req.url==='/capture'){visited.push(body.url);res.end(JSON.stringify({url:body.url,atBottom:true,frames:[{image:png,title:'Observed category',design:{links:body.url.endsWith('/')?[{url:'https://example.com/category',text:'Category'},{url:'https://example.com/logout',text:'Logout'}]:[]}}],assets:[]}));}else res.end('{}');});await new Promise(r=>browser.listen(0,'127.0.0.1',r));
 const f=await fixture({computerUrl:`http://127.0.0.1:${browser.address().port}`,runnerToken:'test-crawl'});
 try{await f.request('/me');const p={id:id('prj_'),user_id:'local-owner',environment:'cloud'};f.store.exec('INSERT INTO projects(id,user_id,title,environment,created_at,updated_at) VALUES(?,?,?,?,?,?)',p.id,p.user_id,'Crawl QA','cloud',now(),now());const signal=new AbortController().signal;await f.computer.ensureAgent(p.user_id,p.id,signal);const result=await f.computer.tool('computer_explore',{url:'https://example.com/',maxPages:3,maxScreens:1},{id:'qa',user_id:p.user_id},p,signal);assert.deepEqual(visited,['https://example.com/','https://example.com/category']);assert.equal(result.complete,true);assert.equal(result.visited.length,2);const index=JSON.parse(await readFile(path.join(projectRoot(f.config,p),result.index),'utf8'));assert.equal(index.pages.length,2);const screenshot=await readFile(path.join(projectRoot(f.config,p),index.pages[1].frames[0].screenshot));assert.equal(screenshot.toString('base64'),png);}finally{await f.close();browser.closeAllConnections();await new Promise(r=>browser.close(r));}
});

test('large uploads stream to disk, bypass SQLite blobs, download intact and enforce 1 GB metadata limit',async()=>{
 const f=await fixture();try{
  const size=process.env.OPENSI_TEST_GIGABYTE==='1'?1_000_000_000:51_000_001;const block=Buffer.alloc(1_000_000,65);
  async function* chunks(){for(let n=0;n<size;n+=block.length)yield block.subarray(0,Math.min(block.length,size-n));}
  const response=await fetch(f.base+'/api/uploads',{method:'POST',headers:{'content-type':'application/octet-stream','x-opensi-client':'web','x-file-name':'large.bin','content-length':String(size)},body:Readable.from(chunks()),duplex:'half'});
  const result=await response.json();assert.equal(response.status,201,JSON.stringify(result));assert.equal(result.size,size);
  const row=f.store.one('SELECT file_path,length(bytes) blobBytes FROM library_assets WHERE id=?',result.assetId);assert.equal(row.blobBytes,0);assert.equal((await stat(row.file_path)).size,size);
  const download=await fetch(f.base+`/api/library/${result.assetId}/content`);let total=0;for await(const chunk of download.body){total+=chunk.length;assert.equal(chunk[0],65);assert.equal(chunk.at(-1),65);}assert.equal(total,size);
  assert.deepEqual(await readdir(path.join(f.dataDir,'upload-temp')),[]);assert.equal((await f.request('/uploads/limits')).value.maxFileBytes,1_000_000_000);
 }finally{await f.close();}
});

test('streamed project ZIP preserves files, unicode paths and empty files',async()=>{
 const root=await tempDir();try{await mkdir(path.join(root,'nested'));await writeFile(path.join(root,'nested','o‘zbek.txt'),'salom');await writeFile(path.join(root,'empty.txt'),'');const chunks=[];for await(const chunk of projectZipStream(root))chunks.push(chunk);const zip=await JSZip.loadAsync(Buffer.concat(chunks));assert.equal(await zip.file('nested/o‘zbek.txt').async('string'),'salom');assert.equal(await zip.file('empty.txt').async('string'),'');}finally{await removeTemp(root);}
});
