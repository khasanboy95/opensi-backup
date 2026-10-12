import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile,mkdir} from 'node:fs/promises';
import {serviceManager} from '../connector/services.mjs';
import {startConnector} from '../connector/index.mjs';
import {fixture,tempDir,removeTemp,until,mockProvider,addProvider,createRun,runState} from './helpers.mjs';
import {id,now} from '../server/security.mjs';
import {fileReference} from '../src/file-reference.ts';

test('workspace file references resolve exact lines, reject ambiguous or external targets',()=>{
 const files=['bot.mjs','src/main.py','a/index.ts','b/index.ts'];
 assert.deepEqual(fileReference('bot.mjs:24',files),{path:'bot.mjs',line:24});
 assert.deepEqual(fileReference('./src/main.py#L9',files),{path:'src/main.py',line:9});
 assert.equal(fileReference('index.ts',files),null);assert.equal(fileReference('https://example.com/bot.mjs',files),null);assert.equal(fileReference('../bot.mjs',files),null);
});
test('managed local process starts, serves HTTP, survives calls, masks logs and stops',async()=>{
 const root=await tempDir(),manager=serviceManager(),secret='QA_ONLY_SERVICE_SECRET_123456';
 try{
  await writeFile(path.join(root,'bot.mjs'),`import http from 'node:http';console.log(process.env.TELEGRAM_BOT_TOKEN);const s=http.createServer((q,r)=>r.end('healthy'));s.listen(0,'127.0.0.1',()=>console.log('PORT='+s.address().port));`);
  const args={operation:'start',name:'bot',runtime:'node',entry:'bot.mjs',args:[],environment:{TELEGRAM_BOT_TOKEN:secret}};
  const started=await manager.execute(root,args);assert.equal(started.status,'running');assert.ok(!started.output.includes(secret));
  const port=started.output.match(/PORT=(\d+)/)[1];assert.equal(await (await fetch('http://127.0.0.1:'+port)).text(),'healthy');
  const repeated=await manager.execute(root,args);assert.equal(repeated.pid,started.pid);assert.equal(repeated.alreadyRunning,true);
  await assert.rejects(()=>manager.execute(root,{...args,name:'other'}),/ishlayapti/);
  const status=await manager.execute(root,{operation:'status',name:'bot'});assert.equal(status.status,'running');assert.ok(!status.output.includes(secret));
  const stopped=await manager.execute(root,{operation:'stop',name:'bot'});assert.equal(stopped.status,'stopped');await assert.rejects(()=>fetch('http://127.0.0.1:'+port));
  await assert.rejects(()=>manager.execute(root,{...args,entry:'../outside.mjs'}));
 }finally{await manager.close();await removeTemp(root);}
});
test('Telegram prompt tokens are encrypted, replaced before storage/model, and validated',async()=>{
 const token='123456789:qa_secret_for_prompt_12345678901234567890';
 const f=await fixture({automationFetch:async()=>new Response(JSON.stringify({ok:true,result:{id:123456789,username:'qa_bot',is_bot:true}}))}),mock=await mockProvider();
 try{const provider=await addProvider(f,mock);const created=await createRun(f,provider,'Bot yarat @qa_bot '+token,{autonomy:'automatic'});await runState(f,created.run.id,'completed');
  assert.ok(!JSON.stringify(created).includes(token));assert.ok(created.run.prompt.includes('int_'));assert.ok(!JSON.stringify(mock.requests).includes(token));
  const row=f.store.one("SELECT * FROM integrations WHERE kind='telegram'");assert.notEqual(row.secret,token);assert.equal(row.automatic,1);assert.equal(JSON.parse(row.config).username,'qa_bot');
  await f.automation.captureTelegramTokens('local-owner',token,true);assert.equal(f.store.one('SELECT COUNT(*) n FROM integrations').n,1);
 }finally{await f.close();await mock.close();}
});
test('connector receives scoped environment only at poll; command storage and results hide it',async()=>{
 const token='987654321:qa_connector_secret_12345678901234567890';
 const f=await fixture({automationFetch:async()=>new Response(JSON.stringify({ok:true,result:{id:987654321,username:'connector_bot',is_bot:true}}))});
 const workspace=await tempDir(),stateDir=await tempDir(),stop=new AbortController();let connector;
 try{
  const paired=(await f.request('/nodes/pair-code',{method:'POST',body:{}})).value;
  connector=startConnector({server:f.base,code:paired.code,workspace,stateDir,signal:stop.signal,quiet:true});
  const node=await until(()=>f.store.one('SELECT * FROM nodes'));
  await until(()=>f.store.setting('node-capabilities:'+node.id)?.includes('project_service_v1'));
  const p={id:id('prj_'),user_id:'local-owner',title:'Local service QA',environment:'local',node_id:node.id};
  f.store.exec('INSERT INTO projects VALUES(?,?,?,?,?,?,?)',p.id,p.user_id,p.title,p.environment,p.node_id,now(),now());f.store.exec('INSERT INTO project_execution VALUES(?,?)',p.id,'automatic');
  const root=path.join(workspace,p.id);await mkdir(root,{recursive:true});await writeFile(path.join(root,'bot.mjs'),"console.log(process.env.TELEGRAM_BOT_TOKEN);setInterval(()=>{},1000);");
  const c=(await f.request('/integrations',{method:'POST',body:{kind:'telegram',label:'QA',token,automatic:true}})).value;
  const run={id:id('run_'),user_id:'local-owner'};f.store.exec("INSERT INTO runs(id,user_id,project_id,status,created_at,updated_at) VALUES(?,?,?,'running',?,?)",run.id,run.user_id,p.id,now(),now());const signal=new AbortController().signal;
  const started=await f.automation.tool('project_service',{operation:'start',name:'bot',requestId:'start',envRefs:{TELEGRAM_BOT_TOKEN:c.id}},run,p,signal);assert.equal(started.status,'running');assert.ok(!JSON.stringify(started).includes(token));
  assert.ok(!JSON.stringify(f.store.all('SELECT args,result FROM commands')).includes(token));
  const status=await f.automation.tool('project_service',{operation:'status',name:'bot'},run,p,signal);assert.equal(status.status,'running');
  const other={...p,user_id:'somebody-else'};await assert.rejects(()=>f.automation.tool('project_service',{operation:'status',name:'bot'},run,other,signal),/topilmadi/);
  const ended=await f.automation.tool('project_service',{operation:'stop',name:'bot',requestId:'stop'},run,p,signal);assert.equal(ended.status,'stopped');
 }finally{stop.abort();await connector?.catch(()=>{});await f.close();await removeTemp(workspace);await removeTemp(stateDir);}
});
