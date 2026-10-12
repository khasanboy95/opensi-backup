import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile,mkdir} from 'node:fs/promises';
import {webhookWorker} from '../server/webhook-worker.mjs';
import {webhookSchemas} from '../server/webhooks.mjs';
import {validateJob,jobArguments} from '../deploy/runner/broker.mjs';
import {fixture,tempDir,removeTemp,until,mockProvider,addProvider,createRun,runState} from './helpers.mjs';
import {startConnector} from '../connector/index.mjs';
import {id,now} from '../server/security.mjs';
import {egressUrl,blockedAddress,publicRequest} from '../deploy/runner/egress.mjs';
const handler=`export default function(req,res){if(req.headers['x-telegram-bot-api-secret-token']!==process.env.TELEGRAM_WEBHOOK_SECRET)return res.status(403).json({error:'forbidden'});return res.status(200).json({method:'sendMessage',chat_id:req.body.message.chat.id,text:'Salom, '+req.body.message.text});}`;
const args={entry:'bot.mjs',runtime:'node',mode:'handler',webhookPath:'/api/telegram',update:{update_id:123,message:{chat:{id:123},text:'/start'}},checkSecret:true};
test('real terminal webhook process validates secret, handles update, reports failure and is stopped',async()=>{
 const root=await tempDir();try{
  await writeFile(path.join(root,'bot.mjs'),handler);const r=await webhookWorker(root,args);assert.equal(r.passed,true,JSON.stringify(r));assert.equal(r.body.text,'Salom, /start');assert.equal(r.secretRejected,true);
  await writeFile(path.join(root,'bot.mjs'),`export default(q,r)=>r.status(200).json({ok:true})`);assert.equal((await webhookWorker(root,args)).passed,false);
  await writeFile(path.join(root,'bot.mjs'),`export default()=>{throw Error('bad handler')}`);assert.equal((await webhookWorker(root,args)).status,500);
  await assert.rejects(()=>webhookWorker(root,{...args,entry:'../escape.mjs'}));
  const c=new AbortController();c.abort(Error('cancelled'));await assert.rejects(()=>webhookWorker(root,args,c.signal),/cancelled/);
 }finally{await removeTemp(root);}
});
test('server mode starts actual Node HTTP server and uses PORT and health endpoint',async()=>{
 const root=await tempDir();try{await writeFile(path.join(root,'server.mjs'),`import http from 'node:http';http.createServer(async(q,r)=>{if(q.url==='/api/health')return r.end('ok');for await(const c of q){}r.statusCode=q.headers['x-telegram-bot-api-secret-token']===process.env.TELEGRAM_WEBHOOK_SECRET?200:403;r.end('{}');}).listen(Number(process.env.PORT),'127.0.0.1');`);const r=await webhookWorker(root,{...args,entry:'server.mjs',mode:'server'});assert.equal(r.passed,true,JSON.stringify(r));}finally{await removeTemp(root);}
});
async function setup(){
 const remote={url:'',calls:[],secret:''};
 const fetcher=async(url,opts)=>{const op=url.split('/').at(-1),body=JSON.parse(opts.body||'{}');remote.calls.push({op,body});let result=true;if(op==='getMe')result={id:123,username:'preview_qa_bot',is_bot:true};if(op==='getWebhookInfo')result={url:remote.url};if(op==='setWebhook'){remote.url=body.url;remote.secret=body.secret_token;}if(op==='deleteWebhook')remote.url='';return new Response(JSON.stringify({ok:true,result}));};
 const f=await fixture({automationFetch:fetcher,webhookExecute:(_p,a,s)=>webhookWorker(root,a,s)});
 // HTTPS is needed for Telegram registration; requests still use the isolated HTTP fixture.
 f.config.appUrl='https://opensi.example.com';
 const project={id:id('prj_'),user_id:'local-owner',title:'Webhook QA',environment:'cloud',node_id:null};
 f.store.exec('INSERT INTO projects VALUES(?,?,?,?,?,?,?)',project.id,project.user_id,project.title,project.environment,null,now(),now());f.store.exec('INSERT INTO project_execution VALUES(?,?)',project.id,'automatic');
 const root=path.join(f.dataDir,'workspaces',project.user_id,project.id);await mkdir(root,{recursive:true});await writeFile(path.join(root,'bot.mjs'),handler);
 const connection=(await f.request('/integrations',{method:'POST',body:{kind:'telegram',label:'Webhook QA',token:'123456789:QA_ONLY_TOKEN_12345678901234567890',automatic:true}})).value;
 const run={id:id('run_'),user_id:project.user_id};f.store.exec("INSERT INTO runs(id,user_id,project_id,status,created_at,updated_at) VALUES(?,?,?,'completed',?,?)",run.id,run.user_id,project.id,now(),now());
 const invoke=(name,a,approve)=>f.automation.tool(name,a,run,project,new AbortController().signal,approve);
 return {f,root,project,run,connection,remote,invoke};
}
test('public preview: preflight, setWebhook, authenticated delivery, dedup, owner isolation, close',async()=>{
 const {f,project,run,connection,remote,invoke}=await setup();try{
  const s=await invoke('webhook_preview',{operation:'open',connectionId:connection.id,requestId:'open',entry:'bot.mjs'});assert.equal(s.state,'active');assert.equal(s.preflight.passed,true);
  const route='/webhooks/telegram/'+s.sessionId;
  assert.equal((await f.request(route,{method:'POST',body:args.update})).status,403);
  const post=()=>f.request(route,{method:'POST',body:args.update,headers:{'x-telegram-bot-api-secret-token':remote.secret}});
  const reply=await post();assert.equal(reply.status,200);assert.equal(reply.value.method,'sendMessage');assert.deepEqual((await post()).value,{ok:true});
  const status=await invoke('webhook_preview',{operation:'status',connectionId:connection.id,sessionId:s.sessionId});assert.equal(status.received,1);assert.equal(status.updates[0].state,'completed');assert.equal(status.updates[0].status,200);
  assert.equal(JSON.stringify(status).includes(remote.secret),false);
  await assert.rejects(()=>f.automation.webhooks.closeOwned('another-user',s.sessionId),/topilmadi/);
  await assert.rejects(()=>invoke('webhook_preview',{operation:'open',connectionId:connection.id,requestId:'other',entry:'bot.mjs'}),/ochiq sinovi/);
  await assert.rejects(()=>f.automation.tool('webhook_test',{entry:'bot.mjs'},{...run,user_id:'other'},project,new AbortController().signal),/topilmadi/);
  const replay=await invoke('webhook_preview',{operation:'open',connectionId:connection.id,requestId:'open',entry:'bot.mjs'});assert.equal(replay.replayed,true);assert.equal(remote.calls.filter(c=>c.op==='setWebhook').length,1);
  await invoke('webhook_preview',{operation:'close',connectionId:connection.id,sessionId:s.sessionId,requestId:'close'});assert.equal(remote.url,'');assert.equal((await post()).status,404);assert.equal(remote.calls.at(-1).body.drop_pending_updates,false);
 }finally{await f.close();}
});
test('preview rejects failed tests and existing webhook, respects guided approval and expiry leaves newer webhook intact',async()=>{
 const {f,root,project,connection,remote,invoke}=await setup();try{
  await writeFile(path.join(root,'bot.mjs'),'export default(q,r)=>r.status(500).end()');await assert.rejects(()=>invoke('webhook_preview',{operation:'open',connectionId:connection.id,requestId:'bad',entry:'bot.mjs'}),/webhook_test/);assert.equal(remote.calls.some(c=>c.op==='setWebhook'),false);
  await writeFile(path.join(root,'bot.mjs'),handler);remote.url='https://existing.example.com/hook';await assert.rejects(()=>invoke('webhook_preview',{operation:'open',connectionId:connection.id,requestId:'exists',entry:'bot.mjs'}),/mavjud webhook/);assert.equal(remote.url,'https://existing.example.com/hook');
  f.store.exec('UPDATE project_execution SET autonomy=? WHERE project_id=?','guided',project.id);await assert.rejects(()=>invoke('webhook_test',{entry:'bot.mjs'}),/tasdi/);await assert.rejects(()=>invoke('webhook_test',{entry:'bot.mjs'},async()=>({approved:false})),/rad etdi/);
  f.store.exec('UPDATE project_execution SET autonomy=? WHERE project_id=?','automatic',project.id);
  const s=await invoke('webhook_preview',{operation:'open',connectionId:connection.id,requestId:'replace',entry:'bot.mjs',replaceExisting:true});assert.equal(s.previousWebhookReplaced,true);
  remote.url='https://permanent.example.com/hook';f.store.exec('UPDATE webhook_sessions SET expires_at=? WHERE id=?',Date.now()-1,s.sessionId);await f.automation.webhooks.sweep();assert.equal(remote.url,'https://permanent.example.com/hook');assert.equal(f.store.one('SELECT state FROM webhook_sessions WHERE id=?',s.sessionId).state,'closed');
 }finally{await f.close();}
});
test('paired connector runs webhook HTTP tests without bot secrets',async()=>{
 const f=await fixture(),workspace=await tempDir(),stateDir=await tempDir(),stop=new AbortController();let connector;
 try{const pair=(await f.request('/nodes/pair-code',{method:'POST',body:{}})).value;connector=startConnector({server:f.base,code:pair.code,workspace,stateDir,signal:stop.signal,quiet:true});const node=await until(()=>f.store.one('SELECT * FROM nodes'));await until(()=>f.store.setting('node-capabilities:'+node.id)?.includes('webhook_v1'));
 const p={id:id('prj_'),user_id:'local-owner',title:'Local webhook',environment:'local',node_id:node.id};f.store.exec('INSERT INTO projects VALUES(?,?,?,?,?,?,?)',p.id,p.user_id,p.title,p.environment,p.node_id,now(),now());f.store.exec('INSERT INTO project_execution VALUES(?,?)',p.id,'automatic');const root=path.join(workspace,p.id);await mkdir(root,{recursive:true});await writeFile(path.join(root,'bot.mjs'),handler);
 const r=await f.automation.tool('webhook_test',{entry:'bot.mjs'},{id:id('run_'),user_id:p.user_id},p,new AbortController().signal);assert.equal(r.passed,true);assert.equal(r.secretRejected,true);
 }finally{stop.abort();await connector?.catch(()=>{});await f.close();await removeTemp(workspace);await removeTemp(stateDir);}
});
test('broker webhook jobs stay isolated, stdin bounded, schema rejects arbitrary paths and oversized sessions',()=>{
 const job={userId:'usr_'+'a'.repeat(24),projectId:'prj_'+'b'.repeat(24),command:'node /opt/toolchain/webhook-worker.mjs',kind:'webhook',webhook:args,timeout:20};assert.equal(validateJob(job),job);const command=jobArguments(job,'/workspaces','qa','runtime');assert.ok(command.includes('-i'));assert.equal(command[command.indexOf('--network')+1],'none');assert.throws(()=>validateJob({...job,command:'node other.mjs'}));assert.throws(()=>validateJob({...job,webhook:{a:'a'.repeat(150001)}}));assert.equal(webhookSchemas.webhook_preview.safeParse({operation:'open',connectionId:'int_'+'a'.repeat(24),minutes:1000}).success,false);
});
test('model writes bot, invokes real webhook test and shows terminal result before any deployment',async()=>{
 const f=await fixture({webhookExecute:(p,a,s)=>webhookWorker(path.join(f.dataDir,'workspaces',p.user_id,p.id),a,s)}),mock=await mockProvider();
 try{const provider=await addProvider(f,mock),created=await createRun(f,provider,'_WEBHOOK_FLOW_',{autonomy:'automatic'});const done=await runState(f,created.run.id,'completed');
 assert.ok(done.events.some(e=>e.type==='tool_result'&&e.data.tool==='webhook_test'&&e.data.result.passed));
 assert.ok(done.live.terminals.some(t=>t.output.includes('Webhook POST: HTTP 200')));
 assert.equal(f.store.one('SELECT count(*) n FROM deployments').n,0);
 }finally{await f.close();await mock.close();}
});

test('actual Node handler fetch uses bounded bridge, preserves request and parses response',async()=>{
 const root=await tempDir(),calls=[];
 try{
  await writeFile(path.join(root,'bot.mjs'),`export default async(q,r)=>{if(q.headers['x-telegram-bot-api-secret-token']!==process.env.TELEGRAM_WEBHOOK_SECRET)return r.status(403).json({});const response=await fetch('https://news.example/feed?q=ai',{headers:{accept:'application/rss+xml'}});const xml=await response.text();return r.json({method:'sendMessage',text:xml});}`);
  const result=await webhookWorker(root,args,undefined,async request=>{calls.push(request);return {status:200,headers:{'content-type':'application/rss+xml'},body:Buffer.from('<rss>real data from bridge</rss>').toString('base64'),url:request.url};});
  assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.body.text,'<rss>real data from bridge</rss>');assert.equal(calls.length,1);assert.equal(calls[0].url,'https://news.example/feed?q=ai');assert.equal(calls[0].headers.accept,'application/rss+xml');
 }finally{await removeTemp(root);}
});

test('egress denies internal addresses, credentials, non-HTTPS, ports, and oversized writes',async()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','172.17.0.1','192.168.0.1','100.64.0.1','::ffff:127.0.0.1','::1','fc00::1'])assert.equal(blockedAddress(ip),true,ip);
 assert.equal(blockedAddress('8.8.8.8'),false);
 for(const url of ['http://example.com','https://127.0.0.1','https://[::1]','https://user:pass@example.com','https://example.com:8443','https://localhost','https://server.local'])assert.throws(()=>egressUrl(url),undefined,url);
 assert.equal(egressUrl('https://example.com/feed?q=ai').search,'?q=ai');
 await assert.rejects(()=>publicRequest({url:'https://127.0.0.1'}));
 await assert.rejects(()=>publicRequest({url:'https://example.com',body:Buffer.alloc(128001).toString('base64')}),/too large/);
 // Public DNS name resolving to loopback must be rejected at connection lookup too.
 await assert.rejects(()=>publicRequest({url:'https://127.0.0.1.nip.io'}));
});

test('persistent bot runs until closed and is not expired by sweeper',async()=>{
 const {f,connection,remote,invoke}=await setup();try{
  const s=await invoke('webhook_preview',{operation:'open',connectionId:connection.id,requestId:'host',entry:'bot.mjs',persistent:true});
  assert.equal(s.persistent,true);assert.equal(s.expiresAt,null);await f.automation.webhooks.sweep();
  assert.equal(f.store.one('SELECT state FROM webhook_sessions WHERE id=?',s.sessionId).state,'active');
  const result=await f.request('/webhooks/telegram/'+s.sessionId,{method:'POST',body:args.update,headers:{'x-telegram-bot-api-secret-token':remote.secret}});assert.equal(result.status,200);assert.equal(result.value.text,'Salom, /start');
  await invoke('webhook_preview',{operation:'close',connectionId:connection.id,sessionId:s.sessionId,requestId:'host-close'});assert.equal(remote.url,'');
 }finally{await f.close();}
});
