import {z} from 'zod';
import {timingSafeEqual} from 'node:crypto';
import {HttpError,id,now} from './security.mjs';
import {cloudCommand} from './commands.mjs';
import {projectRoot} from './files.mjs';

const entry=z.string().min(1).max(240).default('api/telegram.mjs');
const runtime=z.enum(['node','python','python3']).default('node');
const mode=z.enum(['handler','server']).default('handler');
const webhookPath=z.string().regex(/^\/[a-zA-Z0-9/_-]+$/).default('/api/telegram');
export const webhookSchemas={
 webhook_test:z.object({entry,runtime,mode,webhookPath,update:z.record(z.string(),z.unknown()).optional()}).strict(),
 webhook_preview:z.object({operation:z.enum(['open','status','close']),connectionId:z.string().regex(/^int_[a-f0-9]{24}$/),sessionId:z.string().regex(/^wh_[a-f0-9]{24}$/).optional(),requestId:z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),entry,runtime,mode,webhookPath,minutes:z.number().int().min(5).max(120).default(30),persistent:z.boolean().default(false),replaceExisting:z.boolean().default(false)}).strict(),
};
export const webhookDescriptions={
 webhook_test:'Run the actual project HTTP handler. Check invalid secret and a valid synthetic update; also test the real feature, e.g. update.message.text=/news, not only /start. Node default(req,res) handler or Node/Python server on PORT with GET /api/health. Use TELEGRAM_WEBHOOK_SECRET. Cloud supports public HTTPS via Node global fetch or Python requests/urllib through a bounded broker; direct sockets and other HTTP clients are unsupported. No real bot token is injected: return Telegram webhook reply JSON. This tests code, not Telegram delivery. Local connector needs webhook_v1.',
 webhook_preview:'Open/status/close this actual project bot webhook. Do not substitute a demo/echo project for the requested bot. Requires a saved Telegram connection and successful feature tests. Default duration 5-120 minutes; persistent=true hosts until explicitly closed when the user asks to keep the bot running. Existing webhook preserved unless replacement explicitly requested. Node fetch and Python requests/urllib support public HTTPS. Return webhook reply JSON; real bot tokens are not exposed to the runtime. Cloud works while PC is off and from phone; local needs online connector. Inspect received messages and errors, and verify actual Telegram delivery. open/close need unique requestId; status needs sessionId.',
};
const sample=()=>({update_id:-1,message:{message_id:1,date:Math.floor(Date.now()/1000),chat:{id:1,type:'private'},from:{id:1,is_bot:false,first_name:'OpenSI test'},text:'/start'}});
export function webhookService({store,config,vault,nodes,owned,telegram,clean,executeOverride}){
 store.db.exec(`CREATE TABLE IF NOT EXISTS webhook_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,project_id TEXT NOT NULL,connection_id TEXT NOT NULL,bot_key TEXT NOT NULL,entry TEXT NOT NULL,runtime TEXT NOT NULL,mode TEXT NOT NULL,webhook_path TEXT NOT NULL,state TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at TEXT NOT NULL,error TEXT);
 CREATE TABLE IF NOT EXISTS webhook_updates(session_id TEXT NOT NULL,update_id INTEGER NOT NULL,state TEXT NOT NULL,status INTEGER,reply_method TEXT,created_at TEXT NOT NULL,PRIMARY KEY(session_id,update_id));`);
 store.exec("UPDATE webhook_updates SET state='failed' WHERE state='running'");
 const locks=new Set(),active=new Map();let timer,busy=false,stopping=false;
 const url=s=>config.appUrl+'/api/webhooks/telegram/'+s.id;
 const secret=s=>vault.sign('preview-webhook:'+s.id);
 function get(user,project,session){const s=store.one('SELECT * FROM webhook_sessions WHERE id=? AND user_id=? AND project_id=?',session,user,project);if(!s)throw new HttpError(404,'Webhook sinovi topilmadi.');return s;}
 function publicSession(s){return {sessionId:s.id,projectId:s.project_id,state:s.state,url:url(s),persistent:s.expires_at===0,expiresAt:s.expires_at?new Date(s.expires_at).toISOString():null,entry:s.entry,error:s.error,updates:store.all('SELECT update_id,state,status,reply_method,created_at FROM webhook_updates WHERE session_id=? ORDER BY created_at DESC LIMIT 20',s.id),received:store.one('SELECT count(*) n FROM webhook_updates WHERE session_id=?',s.id).n,note:'Telegramga qaytarilgan HTTP javobi qayd etiladi; foydalanuvchi olganini Telegramda tekshiring.'};}
 async function execute(project,args,signal){
  if(executeOverride)return executeOverride(project,args,signal);
  if(project.environment==='local'){
   if(!store.setting('node-capabilities:'+project.node_id)?.includes('webhook_v1'))throw new HttpError(409,'Webhook sinovi uchun connectorni yangi paketga yangilang.');
   return nodes.dispatch(project,null,'webhook_request',args,signal);
  }
  if(!config.runnerUrl||!config.runnerToken)throw new HttpError(409,'Webhook uchun yangilangan bulut runner kerak.');
  const result=await cloudCommand(config,projectRoot(config,project),{kind:'webhook',command:'node /opt/toolchain/webhook-worker.mjs',webhook:args,timeout:20},signal);
  if(result.timedOut||result.truncated)throw new HttpError(502,'Webhook terminal sinovi vaqtida tugamadi.');
  try{return JSON.parse(result.output.trim().split('\n').at(-1));}catch{throw new HttpError(502,'Webhook runtime javobi olinmadi.');}
 }
 async function test(project,args,signal){return execute(project,{entry:args.entry,runtime:args.runtime,mode:args.mode,webhookPath:args.webhookPath,update:args.update||sample(),checkSecret:true},signal);}
 async function close(s,signal){
  if(locks.has(s.bot_key))throw new HttpError(409,'Webhook amali bajarilmoqda.');locks.add(s.bot_key);
  try{
  store.exec("UPDATE webhook_sessions SET state='closing' WHERE id=?",s.id);active.get(s.id)?.abort();
  try{const c=owned(s.user_id,s.connection_id),current=await telegram(c,'getWebhookInfo',{},signal);
   if(current.url===url(s))await telegram(c,'deleteWebhook',{drop_pending_updates:false},signal);
   store.exec("UPDATE webhook_sessions SET state='closed',error=NULL WHERE id=?",s.id);
  }catch(e){store.exec('UPDATE webhook_sessions SET error=? WHERE id=?',clean(e.message,s.user_id).slice(0,500),s.id);throw e;}
  return publicSession(get(s.user_id,s.project_id,s.id));
  }finally{locks.delete(s.bot_key);}
 }
 async function tool(name,args,run,project,signal){
  if(name==='webhook_test')return test(project,args,signal);
  const c=owned(run.user_id,args.connectionId);if(c.kind!=='telegram')throw new HttpError(400,'Telegram bot ulanishini tanlang.');
  if(args.operation!=='open'){
   const s=get(run.user_id,project.id,args.sessionId);if(s.connection_id!==c.id)throw new HttpError(404,'Bot ulanishi mos emas.');
   if(args.operation==='status')return publicSession(s);
   if(!args.requestId)throw new HttpError(400,'Yopish uchun requestId kerak.');return close(s,signal);
  }
  if(!args.requestId)throw new HttpError(400,'Ochish uchun requestId kerak.');
  if(new URL(config.appUrl).protocol!=='https:')throw new HttpError(409,'Ochiq webhook uchun HTTPS OpenSI manzili kerak.');
  const botKey=vault.sign('preview-bot:'+vault.decrypt(c.secret));
  if(locks.has(botKey)||store.one("SELECT id FROM webhook_sessions WHERE bot_key=? AND state IN ('active','opening','closing')",botKey))throw new HttpError(409,'Bu botning ochiq sinovi bor. Avval uni yoping.');
  if(store.one("SELECT count(*) n FROM webhook_sessions WHERE user_id=? AND state IN ('active','opening','closing')",run.user_id).n>=5)throw new HttpError(409,'Avval oldingi webhook sinovlarini yoping.');
  locks.add(botKey);let s;
  try{
   const checked=await test(project,args,signal);if(!checked.passed)throw new HttpError(409,'Avval webhook_test xatolarini tuzating: '+JSON.stringify(checked).slice(0,1400));
   const previous=await telegram(c,'getWebhookInfo',{},signal);if(previous.url&&!args.replaceExisting)throw new HttpError(409,'Botda mavjud webhook bor. Almashtirish foydalanuvchi topshirig‘ida aniq tasdiqlanishi kerak.');
   s={id:id('wh_'),user_id:run.user_id,project_id:project.id,connection_id:c.id,bot_key:botKey,entry:args.entry,runtime:args.runtime,mode:args.mode,webhook_path:args.webhookPath,state:'opening',expires_at:args.persistent?0:Date.now()+args.minutes*60000,created_at:now()};
   store.exec('INSERT INTO webhook_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL)',s.id,s.user_id,s.project_id,s.connection_id,s.bot_key,s.entry,s.runtime,s.mode,s.webhook_path,s.state,s.expires_at,s.created_at);
   await telegram(c,'setWebhook',{url:url(s),secret_token:secret(s),max_connections:1,drop_pending_updates:false,allowed_updates:['message','callback_query']},signal);
   store.exec("UPDATE webhook_sessions SET state='active' WHERE id=?",s.id);return {...publicSession(get(run.user_id,project.id,s.id)),preflight:checked,previousWebhookReplaced:!!previous.url};
  }catch(e){if(s)store.exec("UPDATE webhook_sessions SET state='closing',error=? WHERE id=?",clean(e.message,run.user_id).slice(0,500),s.id);throw e;}finally{locks.delete(botKey);}
 }
 async function receive(req,res){
  const s=store.one("SELECT w.* FROM webhook_sessions w JOIN users u ON u.id=w.user_id JOIN integrations i ON i.id=w.connection_id WHERE w.id=? AND w.state='active' AND (w.expires_at=0 OR w.expires_at>?) AND u.disabled=0 AND i.enabled=1",req.params.sessionId,Date.now());
  if(!s||stopping)return res.sendStatus(404);
  const a=Buffer.from(req.get('x-telegram-bot-api-secret-token')||''),b=Buffer.from(secret(s));if(a.length!==b.length||!timingSafeEqual(a,b))return res.sendStatus(403);
  const update=req.body;if(!Number.isSafeInteger(update?.update_id)||update.update_id<0||Buffer.byteLength(JSON.stringify(update))>128000)return res.sendStatus(400);
  const previous=store.one('SELECT state FROM webhook_updates WHERE session_id=? AND update_id=?',s.id,update.update_id);
  if(previous?.state==='completed')return res.json({ok:true});
  if(active.has(s.id))return res.sendStatus(503);
  if(s.expires_at!==0&&store.one('SELECT count(*) n FROM webhook_updates WHERE session_id=?',s.id).n>=500)return res.sendStatus(429);
  const controller=new AbortController();active.set(s.id,controller);const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]);
  store.exec("INSERT INTO webhook_updates VALUES(?,?,'running',NULL,NULL,?) ON CONFLICT(session_id,update_id) DO UPDATE SET state='running'",s.id,update.update_id,now());
  try{
   const project=store.project(s.user_id,s.project_id);if(!project)throw Error('Project missing');
   const result=await execute(project,{entry:s.entry,runtime:s.runtime,mode:s.mode,webhookPath:s.webhook_path,update,checkSecret:false},signal);
   if(!result.passed)throw Error('Handler HTTP sinovi muvaffaqiyatsiz. Status: '+(result.status||'runtime'));
   signal.throwIfAborted();
   store.exec("UPDATE webhook_updates SET state='completed',status=?,reply_method=? WHERE session_id=? AND update_id=?",result.status,typeof result.body?.method==='string'?result.body.method.slice(0,80):null,s.id,update.update_id);
   store.exec('UPDATE webhook_sessions SET error=NULL WHERE id=?',s.id);
   res.json(result.body&&typeof result.body==='object'?result.body:{ok:true});
  }catch(e){store.exec("UPDATE webhook_updates SET state='failed' WHERE session_id=? AND update_id=?",s.id,update.update_id);store.exec('UPDATE webhook_sessions SET error=? WHERE id=?',clean(e.message,s.user_id).slice(0,500),s.id);res.sendStatus(503);}finally{active.delete(s.id);}
 }
 async function sweep(){if(busy||stopping)return;busy=true;try{for(const s of store.all("SELECT * FROM webhook_sessions WHERE (state='active' AND expires_at>0 AND expires_at<?) OR state IN ('closing','opening') LIMIT 10",Date.now()))if(!locks.has(s.bot_key))await close(s,AbortSignal.timeout(10000)).catch(()=>{});}finally{busy=false;}}
 timer=setInterval(()=>void sweep(),15000);timer.unref();
 return {tool,receive,publicSession,list:user=>store.all('SELECT * FROM webhook_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 30',user).map(publicSession),closeOwned:async(user,session)=>{const s=store.one('SELECT * FROM webhook_sessions WHERE id=? AND user_id=?',session,user);if(!s)throw new HttpError(404,'Webhook topilmadi.');return close(s,AbortSignal.timeout(15000));},async shutdown(){stopping=true;clearInterval(timer);for(const c of active.values())c.abort();while(active.size||busy)await new Promise(r=>setTimeout(r,25));},sweep};
}
