// Runs inside a disposable sandbox (or the explicitly paired local connector).
import http from 'node:http';
import path from 'node:path';
import {realpath,mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {nodeNetwork,pythonNetwork} from './webhook-network.mjs';
import {pathToFileURL} from 'node:url';

const adapter = `import http from 'node:http';import {pathToFileURL} from 'node:url';
const handler=(await import(pathToFileURL(process.argv[1]).href)).default;
if(typeof handler!=='function')throw Error('Export default(req,res) handler required');
http.createServer(async(req,res)=>{try{
 if(req.url==='/__opensi_ready'){res.end(process.env.OPENSI_TEST_NONCE);return;}
 const chunks=[];for await(const c of req)chunks.push(c);req.body=JSON.parse(Buffer.concat(chunks).toString()||'{}');req.query=Object.fromEntries(new URL(req.url,'http://localhost').searchParams);
 res.status=n=>{res.statusCode=n;return res;};res.json=v=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(v));return res;};res.send=v=>{typeof v==='object'?res.json(v):res.end(String(v));return res;};
 await handler(req,res);
}catch(e){console.error(e.message);if(!res.headersSent)res.statusCode=500;if(!res.writableEnded)res.end('Handler failed');}}).listen(Number(process.env.PORT),'127.0.0.1');`;

export async function webhookWorker(root,args,signal,remoteFetch){
 const base=await realpath(root),entry=await realpath(path.resolve(base,args.entry));
 if(path.isAbsolute(args.entry)||!path.relative(base,entry)||path.relative(base,entry).split(path.sep).includes('..'))throw Error('Webhook entry must be inside this project.');
 if(!['handler','server'].includes(args.mode)||!['node','python','python3'].includes(args.runtime))throw Error('Invalid webhook runtime');
 if(args.mode==='handler'&&args.runtime!=='node')throw Error('Handler mode requires Node; Python uses server mode and PORT.');
 if(!args.update||typeof args.update!=='object'||Buffer.byteLength(JSON.stringify(args.update))>128000)throw Error('Invalid webhook update');
 if(!/^\/[a-zA-Z0-9/_-]+$/.test(args.webhookPath))throw Error('Invalid webhook path');
 const reserved=http.createServer();reserved.listen(0,'127.0.0.1');await new Promise(r=>reserved.once('listening',r));const port=reserved.address().port;await new Promise(r=>reserved.close(r));
 const temporary=await mkdtemp(path.join(os.tmpdir(),'opensi-webhook-')),secret=randomUUID(),nonce=randomUUID();
 const env={};for(const k of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','NODE_PATH'])if(process.env[k])env[k]=process.env[k];
 Object.assign(env,{HOME:temporary,USERPROFILE:temporary,PORT:String(port),HOST:'127.0.0.1',PYTHONUNBUFFERED:'1',OPENSI_TEST_NONCE:nonce,OPENSI_WEBHOOK_PREVIEW:'1',TELEGRAM_WEBHOOK_SECRET:secret,TELEGRAM_BOT_TOKEN:'000000:OPENSI_TEST_ONLY'});
 let output='',child,closed,bridge;const deadline=AbortSignal.timeout(15000),combined=signal?AbortSignal.any([signal,deadline]):deadline;
 const scrub=text=>text.split(secret).join('[test secret]').split(nonce).join('[nonce]');
 try{
  combined.throwIfAborted();
  if(remoteFetch){
   const bridgeNonce=randomUUID();bridge=http.createServer(async(req,res)=>{try{
    if(req.method!=='POST'||req.headers.authorization!==bridgeNonce){res.writeHead(403);res.end();return;}
    let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>200000)throw Error('Request too large');chunks.push(c);}
    const value=await remoteFetch(JSON.parse(Buffer.concat(chunks).toString()));res.setHeader('content-type','application/json');res.end(JSON.stringify(value));
   }catch{res.end(JSON.stringify({error:'Public HTTPS request failed or destination denied'}));}});
   bridge.listen(0,'127.0.0.1');await new Promise(r=>bridge.once('listening',r));
   env.OPENSI_HTTP_BRIDGE='http://127.0.0.1:'+bridge.address().port;env.OPENSI_HTTP_NONCE=bridgeNonce;
   if(args.runtime==='node'){const preload=path.join(temporary,'network.mjs');await writeFile(preload,nodeNetwork);env.NODE_OPTIONS='--import='+pathToFileURL(preload).href;}
   else {await writeFile(path.join(temporary,'sitecustomize.py'),pythonNetwork);env.PYTHONPATH=temporary;}
  }
  child=spawn(args.runtime==='node'?process.execPath:args.runtime,args.mode==='handler'?['--input-type=module','-e',adapter,entry]:[entry],{cwd:base,env,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  closed=new Promise(resolve=>{child.once('error',e=>{output+=e.message;resolve();});child.once('close',resolve);});
  const capture=b=>{output=(output+b.toString()).slice(-8000);};child.stdout.on('data',capture);child.stderr.on('data',capture);
  const origin='http://127.0.0.1:'+port;
  let ready=false;for(let i=0;i<40;i++){
   combined.throwIfAborted();if(child.exitCode!==null)throw Error('Webhook process exited before readiness.');
   try{const r=await fetch(origin+(args.mode==='handler'?'/__opensi_ready':'/api/health'),{signal:AbortSignal.any([combined,AbortSignal.timeout(250)]),redirect:'error'});const text=await r.text();ready=r.ok&&(args.mode!=='handler'||text===nonce);}catch{}
   if(ready)break;await delay(100,undefined,{signal:combined});
  }
  if(!ready)throw Error('Webhook did not become ready. Server mode requires GET /api/health and process.env.PORT.');
  const send=async valid=>{
   const r=await fetch(origin+args.webhookPath,{method:'POST',redirect:'error',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':valid?secret:'opensi-invalid-secret'},body:JSON.stringify(args.update),signal:combined});
   let text='',size=0;for await(const chunk of r.body){size+=chunk.length;if(size>32000)throw Error('Webhook response too large');text+=Buffer.from(chunk).toString();}
   let body;try{body=JSON.parse(scrub(text));}catch{body=scrub(text);}return {status:r.status,body};
  };
  const rejected=args.checkSecret?await send(false):null;
  const response=await send(true);
  const passed=response.status>=200&&response.status<300&&(!rejected||[401,403].includes(rejected.status));
  return {passed,exitCode:passed?0:1,status:response.status,body:response.body,secretRejected:rejected?[401,403].includes(rejected.status):undefined,output:scrub(output)+'\nWebhook POST: HTTP '+response.status+(rejected?'\nInvalid secret: HTTP '+rejected.status:'')+'\n'+(passed?'PASS':'FAIL'),note:'Local HTTP handler checked; Telegram delivery requires a real user message.'};
 }catch(e){if(signal?.aborted)throw signal.reason;return {passed:false,exitCode:1,error:scrub(String(e.message)),output:scrub(output)};}
 finally{
  if(child?.pid){if(process.platform==='win32')await new Promise(r=>{const k=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});k.once('error',r);k.once('close',r);});else try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}
  if(closed)await Promise.race([closed,delay(1000)]);if(bridge){bridge.closeAllConnections();await new Promise(r=>bridge.close(r));}await rm(temporary,{recursive:true,force:true});
 }
}
