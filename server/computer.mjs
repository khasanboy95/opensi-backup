import {vercelDeploymentIntent,safeBrowserUrl,sensitiveBrowserScreen,browserWriteAllowed,ordinaryFormWriteAllowed,browserTelemetry} from './browser-workflow.mjs';
import { z } from 'zod';
import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError, id, now, guardedFetch } from './security.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {saveBrowserEvidence} from './browser-evidence.mjs';
import {explorationPlan,explorationEntry,normalizeSiteUrl} from './site-exploration.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
import {projectRoot,safePath} from './files.mjs';

export const computerCapture=z.object({url:z.string().max(2000).optional(),mobile:z.boolean().default(false),maxScreens:z.number().int().min(1).max(12).default(8),reset:z.boolean().default(true),collectAssets:z.boolean().default(true),publicPage:z.boolean().default(false)}).strict();
export const computerExplore=z.object({url:z.string().max(2000).optional(),maxPages:z.number().int().min(1).max(24).default(12),maxDepth:z.number().int().min(0).max(5).default(3),maxScreens:z.number().int().min(1).max(6).default(2),mobile:z.boolean().default(false)}).strict();

export const computerAction = z.object({
  action: z.enum(['navigate','click','fill','check','uncheck','submit','press','scroll','back','reload','select','switch_tab','click_at','hover','type_text','key','wheel','drag','new_tab','close_tab']),
  url: z.string().max(2000).optional(), target: z.number().int().min(1).max(300).optional(),
  value: z.string().max(2000).optional(), direction: z.enum(['up','down']).optional(),
  revision: z.string().max(80).optional(), x:z.number().int().min(0).max(4096).optional(),y:z.number().int().min(0).max(4096).optional(),
  toX:z.number().int().min(0).max(4096).optional(),toY:z.number().int().min(0).max(4096).optional(),
  deltaX:z.number().int().min(-1500).max(1500).optional(),deltaY:z.number().int().min(-1500).max(1500).optional(),
  tab:z.number().int().min(1).max(10).optional(),
}).strict();
export const computerToken = config => createHash('sha256').update(`opensi-computer:${config.runnerToken}`).digest('hex');
export function browserUrl(value) {
  let url; try { url = new URL(value); } catch { throw new HttpError(400,'HTTPS sahifa manzilini kiriting.'); }
  if(url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new HttpError(400,'Faqat parolsiz, standart portdagi HTTPS sahifalar ochiladi.');
  return url;
}

// No page can reach the Internet directly. The isolated browser relays through
// this gateway; DNS is validated again at the actual TCP connection.
export function computerService(app,{store,config,parse,nodes}) {
  const sessions = new Map(); const writes = new Map(); const pendingFetch = new Set();
  const token = computerToken(config); const enabled = Boolean(config.computerUrl && config.runnerToken);
  store.db.exec(`CREATE TABLE IF NOT EXISTS computer_audit(id TEXT PRIMARY KEY,user_id TEXT,project_id TEXT,action TEXT,actor TEXT,detail TEXT,created_at TEXT);`);
  const own = (user,projectId) => { const p=store.project(user,projectId); if(!p) throw new HttpError(404,'Loyiha topilmadi.'); return p; };
  const runtimePreference=(user,projectId)=>{const saved=store.setting('computer-runtime:'+projectId);if(saved)return saved;const p=own(user,projectId);return p.environment==='local'&&nodes.list(user).some(n=>n.id===p.node_id&&n.capabilities.includes('computer_browser_v1'))?{kind:'local',nodeId:p.node_id}:{kind:'cloud'};};
  const audit = (s,action,actor,detail='') => {
    store.exec('INSERT INTO computer_audit VALUES(?,?,?,?,?,?,?)',id('ca_'),s.userId,s.projectId,action,actor,detail.slice(0,300),now());
    store.exec('DELETE FROM computer_audit WHERE project_id=? AND id NOT IN (SELECT id FROM computer_audit WHERE project_id=? ORDER BY created_at DESC LIMIT 100)',s.projectId,s.projectId);
  };
  async function rpc(route,body,signal) {
    const local=body.localNodeId?{nodeId:body.localNodeId,projectId:body.projectId}:[...sessions.values()].find(s=>s.id===body.id&&s.nodeId);
    if(local){const p=store.one('SELECT * FROM projects WHERE id=?',local.projectId);if(!p)throw new HttpError(404,'Loyiha topilmadi.');return nodes.dispatch({...p,environment:'local',node_id:local.nodeId},null,'computer_browser',{route,body:{...body,localNodeId:undefined,projectId:undefined}},signal);}
    if(!enabled) throw new HttpError(503,'Bulut brauzeri hali sozlanmagan.');
    let response; try { response=await fetch(`${config.computerUrl}${route}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([AbortSignal.timeout(route==='/action'?125_000:route==='/capture'?90_000:40_000),...(signal?[signal]:[])]),redirect:'error'}); }
    catch { throw new HttpError(503,'Brauzer xizmati javob bermadi. Qayta urinib ko‘ring.'); }
    const result=await response.json(); if(!response.ok) throw new HttpError(response.status,result.error || 'Brauzer amali bajarilmadi.'); return result;
  }
  const session = (user,projectId) => {own(user,projectId);const s=sessions.get(projectId);if(!s || s.userId!==user) throw new HttpError(404,'Avval Kompyuter sahifasida brauzer sessiyasini oching.');s.last=Date.now();return s;};
  const held=new Set();const waiting=new Map();const opening=new Map();const shutdown=new AbortController();
  let allocation=Promise.resolve();let reconciled=false;const localReconciled=new Set();
  const activeProject=projectId=>Boolean(store.one("SELECT id FROM runs WHERE project_id=? AND status IN ('queued','running','waiting_approval','waiting_input') LIMIT 1",projectId));
  const reclaimable=s=>!s.busy&&!activeProject(s.projectId)&&!publicPending(s).length&&(s.mode==='agent'||Date.now()-s.last>30*60_000);
  async function allocate(user,projectId,mode,signal){
    const previous=allocation;let release;allocation=new Promise(resolve=>{release=resolve;});await previous;
    try{
      signal?.throwIfAborted();
      if(mode==='agent'&&held.has(projectId))throw new HttpError(409,'Foydalanuvchi boshqaruvni to‘xtatgan. Kompyuter bo‘limidan agentga topshirishi kerak.');
      const current=sessions.get(projectId);
      if(current){try{await rpc('/status',{id:current.id},signal);return current;}catch(error){if(error.status!==404)throw error;await stop(current,'system');}}
      // App restarts must not leave orphaned Chromium processes occupying every slot.
      if(!reconciled){await rpc('/reconcile',{ids:[...sessions.values()].map(s=>s.id)},signal);reconciled=true;}
      if(sessions.size>=2){const idle=[...sessions.values()].filter(reclaimable).sort((a,b)=>a.last-b.last)[0];if(idle)await stop(idle,'system');}
      if(sessions.size>=2)return null;
      const preference=runtimePreference(user,projectId);
      const nodeId=preference.kind==='local'?preference.nodeId:null;
      if(nodeId&&!nodes.list(user).some(n=>n.id===nodeId&&n.online&&n.capabilities.includes('computer_browser_v1')))throw new HttpError(409,'Lokal brauzer uchun connectorni yangilang va online qiling.');
      if(nodeId&&!localReconciled.has(nodeId)){
        try{await rpc('/reconcile',{ids:[...sessions.values()].filter(s=>s.nodeId===nodeId).map(s=>s.id),localNodeId:nodeId,projectId},signal);localReconciled.add(nodeId);}catch{/* Older connectors lack reconciliation; opening below returns an actionable error. */}
      }
      const s={id:id('browser_'),projectId,userId:user,nodeId,mode,last:Date.now(),busy:false,initializing:true};sessions.set(projectId,s);
      try{s.lastScreen=await rpc('/open',{id:s.id},signal);s.initializing=false;audit(s,'open',mode==='agent'?'agent':'user','automatic session allocation');return s;}
      catch(e){sessions.delete(projectId);await rpc('/close',{id:s.id,localNodeId:s.nodeId,projectId:s.projectId}).catch(()=>{});if(nodeId&&e.status===502)throw new HttpError(503,'Lokal Chrome ochilmadi. Kompyuterdagi OpenSI connectorini yangilab qayta ishga tushiring.');throw e;}
    }finally{release();}
  }
  async function ensureAgent(user,projectId,signal,mode='agent') {
    own(user,projectId);const combined=AbortSignal.any([shutdown.signal,...(signal?[signal]:[])]);
    const ticket={};waiting.set(projectId,ticket);
    try{while(true){combined.throwIfAborted();const s=await allocate(user,projectId,mode,combined);if(s){if(mode==='agent'&&s.mode!=='agent')throw new HttpError(409,'Brauzer boshqaruvi foydalanuvchida.');s.last=Date.now();return;}await delay(config.computerQueuePollMs||1000,undefined,{signal:combined});}}
    finally{if(waiting.get(projectId)===ticket)waiting.delete(projectId);}
  }
  const publicPending = s => [...writes.values()].filter(w=>w.session===s.id).map(w=>({id:w.id,method:w.method,url:safeBrowserUrl(w.url),createdAt:w.createdAt}));
  async function state(user,projectId,signal,live=false) {const s=session(user,projectId);const result=s.busy&&s.lastScreen?s.lastScreen:await rpc('/state',{id:s.id,mode:s.mode,live},signal);if(!s.busy)s.lastScreen=result;const pending=store.one("SELECT a.id FROM approvals a JOIN runs r ON r.id=a.run_id WHERE r.project_id=? AND r.user_id=? AND a.tool='computer_login' AND a.status='pending' ORDER BY a.created_at DESC LIMIT 1",projectId,user);return {...result,mode:s.mode,pending:publicPending(s),handoff:s.handoff?{...s.handoff,approvalId:pending?.id}:null,workflow:s.deploymentRun?'vercel-deploy':null,runtime:s.nodeId?'local':'cloud',exploration:s.exploration||null};}
  function beginHandoff(user,projectId,reason){const s=session(user,projectId);s.mode='user';for(const w of writes.values())if(w.session===s.id)w.finish(false);void rpc('/mode',{id:s.id,mode:'user'}).catch(()=>{});s.handoff={reason,url:safeBrowserUrl(s.lastUrl)};if(s.handoff.url!=='about:blank'){s.manualOrigin=new URL(s.handoff.url).origin;s.manualUntil=Date.now()+30*60_000;}held.add(projectId);audit(s,'login_handoff','system');return s.handoff;}
  async function checkHandoff(user,projectId,signal){const s=session(user,projectId);const screen=await state(user,projectId,signal);if(sensitiveBrowserScreen(screen))throw new HttpError(409,'Kirish oynasi hali ochiq. Shu jonli brauzerda kirishni yakunlang, so‘ng davom eting.');if(sessions.get(projectId)!==s)throw new HttpError(409,'Brauzer sessiyasi o‘zgardi. Joriy oynani tekshiring.');return s;}
  async function finishHandoff(user,projectId,signal){const s=await checkHandoff(user,projectId,signal);if(s.mode==='agent'&&!s.handoff)return {resumed:true};await rpc('/mode',{id:s.id,mode:'agent'},signal);s.mode='agent';s.handoff=null;held.delete(projectId);audit(s,'login_resumed','user');return {resumed:true};}

  async function useLocalBrowserAfterDenial(user,projectId,signal,mode='agent'){
    const current=session(user,projectId);if(current.nodeId||current.mode!==mode)return false;
    const candidates=nodes.list(user).filter(node=>node.platform==='win32'&&!node.hosted&&node.online&&node.capabilities.includes('computer_browser_v1'));
    if(!candidates.length)throw new HttpError(503,'Sayt bulut brauzerini rad etdi. Lokal connector offline: kompyuteringizda OpenSI connectorini ishga tushiring.');
    const previous=runtimePreference(user,projectId);
    const handoff=mode==='user'?current.handoff:null;
    await stop(current,'system');let lastError;
    for(const local of candidates){
      store.setSetting('computer-runtime:'+projectId,{kind:'local',nodeId:local.id});
      try{await ensureAgent(user,projectId,signal,mode);const opened=session(user,projectId);if(handoff)opened.handoff=handoff;audit(opened,'local_fallback','system','Cloud site access denied; retrying read in local Chrome');return true;}
      catch(error){lastError=error;}
    }
    store.setSetting('computer-runtime:'+projectId,previous);throw lastError;
  }

  async function action(user,projectId,args,actor='user',signal,run) {
    if(actor==='agent'&&(args.action==='navigate'||args.action==='new_tab')&&args.url)args={...args,url:normalizeSiteUrl(args.url)};
    const s=session(user,projectId); if(actor==='agent' && s.mode!=='agent') throw new HttpError(409,'Boshqaruv foydalanuvchida. Agentga topshirish tugmasini kuting.');
    if(s.busy) throw new HttpError(409,'Oldingi brauzer amali hali bajarilmoqda.');
    if(args.action==='navigate'||(args.action==='new_tab'&&args.url)) browserUrl(args.url);
    if(actor==='user'){s.manualOrigin=(args.action==='navigate'||(args.action==='new_tab'&&args.url))?new URL(args.url).origin:new URL((await rpc('/state',{id:s.id},signal)).url).origin;s.manualUntil=Date.now()+30*60_000;}
    s.busy=true;
    let formWrite=null,navigationError=null;
    try {
      if(actor==='agent'&&args.action==='submit'&&run?.id&&store.one("SELECT id FROM runs WHERE id=? AND user_id=? AND project_id=? AND status='running'",run.id,user,projectId)){
        const before=await rpc('/state',{id:s.id},signal);
        const url=browserUrl(before.url);
        formWrite={origin:url.origin,remaining:1,expiresAt:Date.now()+15000,runId:run.id};
        s.formWrite=formWrite;
      }
      const result=await rpc('/action',{id:s.id,...args,actor,deploymentRun:s.deploymentRun||null,formWrite},signal);s.lastUrl=result.url;s.lastScreen=result;audit(s,args.action,actor,(args.action==='navigate'||(args.action==='new_tab'&&args.url))?new URL(args.url).origin:args.target?`element ${args.target}`:'');return {...result,mode:s.mode,runtime:s.nodeId?'local':'cloud',pending:publicPending(s)};
    }catch(error){
      if(!s.nodeId&&['navigate','new_tab'].includes(args.action)&&error.status===424)navigationError=error;
      else throw error;
    }
    finally {if(s.formWrite===formWrite)s.formWrite=null;s.busy=false;}
    if(navigationError){if(await useLocalBrowserAfterDenial(user,projectId,signal,actor))return action(user,projectId,args,actor,signal,run);throw navigationError;}
  }
  async function stop(s,actor='user') {if(sessions.get(s.projectId)===s)sessions.delete(s.projectId);for(const w of writes.values()) if(w.session===s.id) w.finish(false);for(const f of pendingFetch) if(f.session===s.id) f.controller.abort();await rpc('/close',{id:s.id,localNodeId:s.nodeId,projectId:s.projectId}).catch(()=>{});audit(s,'close',actor);}
  async function networkConsent(s,method,url,req){
    if(writes.size>=12)throw new HttpError(429,'Tarmoq tasdiqlari navbati to‘lgan.');
    const approved=await new Promise(resolve=>{const key=id('net_');const timer=setTimeout(()=>finish(false),90_000);const finish=value=>{clearTimeout(timer);writes.delete(key);resolve(value);};
      writes.set(key,{id:key,session:s.id,method,url:url.toString(),createdAt:now(),finish});req.on('close',()=>{if(req.aborted)finish(false);});});
    if(!approved)throw new HttpError(403,'Foydalanuvchi tarmoq so‘rovini tasdiqlamadi.');
  }
  app.post('/api/connector/computer-network',async(req,res)=>{
    const node=nodes.authenticate(req);
    const body=parse(z.object({session:z.string().max(80),url:z.string().max(10000),method:z.enum(['POST','PUT','PATCH','DELETE']),bytes:z.number().int().min(0).max(20_000)}),req.body);
    const s=[...sessions.values()].find(item=>item.id===body.session&&item.nodeId===node.id&&item.userId===node.user_id);
    if(!s||s.mode!=='agent'||!s.busy||s.handoff)throw new HttpError(403,'Brauzer amali faol emas.');
    const url=browserUrl(body.url);if(url.hostname===new URL(config.appUrl).hostname||browserTelemetry(url.href))throw new HttpError(403,'Manzil yopiq.');
    await networkConsent(s,body.method,url,req);
    if(sessions.get(s.projectId)!==s||s.mode!=='agent')throw new HttpError(410,'Brauzer sessiyasi yopildi.');
    res.json({approved:true});
  });
  // Registered BEFORE cookie authentication. Only the private browser service
  // possesses this distinct, derived token. No public proxy without a live session.
  app.post('/api/computer-gateway',async(req,res)=>{
    const actual=Buffer.from(req.get('authorization') || '');const expected=Buffer.from(`Bearer ${token}`);
    if(!enabled || actual.length!==expected.length || !timingSafeEqual(actual,expected)) throw new HttpError(401,'Ruxsat yo‘q.');
    const body=parse(z.object({session:z.string().max(80),url:z.string().max(10000),method:z.enum(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']),headers:z.record(z.string(),z.string().max(16000)),body:z.string().max(1400000).optional()}),req.body);
    const s=[...sessions.values()].find(item=>item.id===body.session);
    if(!s || store.one('SELECT disabled FROM users WHERE id=?',s.userId)?.disabled!==0) throw new HttpError(403,'Sessiya yopilgan.');
    const url=browserUrl(body.url); const ownHost=new URL(config.appUrl).hostname;
    if(browserTelemetry(url.href))throw new HttpError(403,'Fon telemetriyasi bloklandi.');
    if(url.hostname===ownHost) throw new HttpError(403,'OpenSI boshqaruv serverini bu brauzerda ochib bo‘lmaydi.');
    const deploymentActive=Boolean(s.deploymentRun&&store.one("SELECT id FROM runs WHERE id=? AND user_id=? AND project_id=? AND status='running'",s.deploymentRun,s.userId,s.projectId));
    const formActive=Boolean(s.formWrite?.runId&&store.one("SELECT id FROM runs WHERE id=? AND user_id=? AND project_id=? AND status='running'",s.formWrite.runId,s.userId,s.projectId));
    const formWrite=ordinaryFormWriteAllowed(s,body,formActive&&Buffer.from(body.body||'','base64').length<=20_000);
    if(formWrite)s.formWrite.remaining=0;
    const automaticWrite=formWrite||browserWriteAllowed(s,body,deploymentActive);
    // Login pages send background POSTs even before a person clicks anything.
    // Do not turn those into approval spam while the agent has handed control over.
    if(s.handoff&&s.mode!=='user'&&!['GET','HEAD','OPTIONS'].includes(body.method)&&!automaticWrite)throw new HttpError(403,'Kirish oynasi foydalanuvchi amalini kutmoqda.');
    if(!['GET','HEAD','OPTIONS'].includes(body.method)&&!automaticWrite) {
      if(Buffer.from(body.body||'','base64').length>20_000) throw new HttpError(413,'Yuboriladigan ma’lumot 20 KB dan katta.');
      await networkConsent(s,body.method,url,req);
    }
    if(!sessions.has(s.projectId)) throw new HttpError(410,'Sessiya yopildi.');
    if(pendingFetch.size>=80) throw new HttpError(429,'Bir vaqtdagi tarmoq so‘rovlari ko‘p.');
    const controller=new AbortController();const entry={session:s.id,controller};pendingFetch.add(entry);
    try {
      const headers=Object.fromEntries(Object.entries(body.headers).filter(([key])=>!['host','connection','content-length','transfer-encoding','accept-encoding','proxy-authorization','proxy-connection'].includes(key.toLowerCase())));
      const response=await guardedFetch(url,{method:body.method,headers,body:['GET','HEAD'].includes(body.method)?undefined:Buffer.from(body.body||'','base64'),redirect:'manual',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20_000)])});
      const chunks=[];let size=0; const reader=response.body?.getReader();
      if(reader) while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5_000_000){await reader.cancel();throw new HttpError(413,'Brauzer resursi 5 MB dan katta.');}chunks.push(value);}
      const out=Object.fromEntries([...response.headers].filter(([key])=>!['content-encoding','content-length','transfer-encoding','connection','set-cookie'].includes(key)));
      res.setHeader('Cache-Control','no-store');res.json({status:response.status,headers:out,cookies:response.headers.getSetCookie(),body:Buffer.concat(chunks).toString('base64')});
    } finally {pendingFetch.delete(entry);}
  });
  function routes(){
    app.post('/api/projects/:id/computer/resume',async(req,res)=>{await checkHandoff(req.user.id,req.params.id);res.json({ok:true,ready:true});});
    app.get('/api/computer',(req,res)=>res.json({enabled,maxSessions:2,sessionMinutes:30,nodes:nodes.list(req.user.id).filter(n=>n.capabilities.includes('computer_browser_v1')).map(n=>({id:n.id,name:n.name,online:n.online})),sessions:[...sessions.values()].filter(s=>s.userId===req.user.id).map(s=>({projectId:s.projectId,title:store.one('SELECT title FROM projects WHERE id=?',s.projectId)?.title||'Loyiha',runtime:s.nodeId?'local':'cloud',mode:s.mode,active:activeProject(s.projectId)}))}));
    app.put('/api/projects/:id/computer/runtime',async(req,res)=>{own(req.user.id,req.params.id);const value=parse(z.object({kind:z.enum(['local','cloud']),nodeId:z.string().optional()}),req.body);if(sessions.has(req.params.id)||opening.has(req.params.id))throw new HttpError(409,'Muhitni almashtirishdan oldin brauzer sessiyasini yoping.');if(value.kind==='local'&&!nodes.list(req.user.id).some(n=>n.id===value.nodeId&&n.online&&n.capabilities.includes('computer_browser_v1')))throw new HttpError(409,'Yangilangan online connector tanlang.');store.setSetting('computer-runtime:'+req.params.id,value);res.json(value);});
    app.get('/api/projects/:id/computer',async(req,res)=>{own(req.user.id,req.params.id);res.setHeader('Cache-Control','no-store');const s=sessions.get(req.params.id);let screen=null;if(s&&!s.initializing){try{screen=await state(req.user.id,req.params.id,undefined,true);}catch(error){if(error.status!==404)throw error;await stop(s,'system');}}res.json({enabled,runtime:runtimePreference(req.user.id,req.params.id),session:screen,waiting:waiting.has(req.params.id)||Boolean(s?.initializing),audit:store.all('SELECT action,actor,detail,created_at FROM computer_audit WHERE user_id=? AND project_id=? ORDER BY created_at DESC LIMIT 40',req.user.id,req.params.id)});});
    app.post('/api/projects/:id/computer',async(req,res)=>{
      const projectId=req.params.id,user=req.user.id;own(user,projectId);const {mode}=parse(z.object({mode:z.enum(['agent','user']).default('user')}),req.body||{});
      if(sessions.has(projectId)){const existing=sessions.get(projectId);if(existing.initializing){res.status(202).json({waiting:true});return;}try{res.json(await state(user,projectId));return;}catch(error){if(error.status!==404)throw error;await stop(existing,'system');}}
      held.delete(projectId);const s=await allocate(user,projectId,mode,shutdown.signal);
      if(s){res.status(201).json(await state(user,projectId));return;}
      if(!opening.has(projectId)){const controller=new AbortController();const task=ensureAgent(user,projectId,controller.signal,mode).catch(error=>{if(!controller.signal.aborted&&!shutdown.signal.aborted)audit({projectId,userId:user},'open_failed','system',error.message);}).finally(()=>opening.delete(projectId));opening.set(projectId,{controller,task});}
      res.status(202).json({waiting:true});
    });
    app.post('/api/projects/:id/computer/action',async(req,res)=>{const s=session(req.user.id,req.params.id);if(s.mode!=='user')throw new HttpError(409,'Avval boshqaruvni oling.');res.json(await action(req.user.id,req.params.id,parse(computerAction,req.body)));});
    app.post('/api/projects/:id/computer/control',async(req,res)=>{const s=session(req.user.id,req.params.id);const {mode}=parse(z.object({mode:z.enum(['agent','user'])}),req.body);if(s.busy)throw new HttpError(409,'Amal yakunlanishini kuting yoki sessiyani yoping.');if(mode==='agent'&&s.handoff){const pending=store.one("SELECT a.id FROM approvals a JOIN runs r ON r.id=a.run_id WHERE r.project_id=? AND r.user_id=? AND a.tool='computer_login' AND a.status='pending'",s.projectId,s.userId);if(pending)throw new HttpError(409,'Kirish tugadi — agent davom etsin tugmasini bosing.');await finishHandoff(req.user.id,req.params.id);return res.json({mode});}if(mode==='agent'&&s.mode!=='agent')await checkHandoff(req.user.id,req.params.id);await rpc('/mode',{id:s.id,mode});s.mode=mode;if(mode==='user')held.add(s.projectId);else held.delete(s.projectId);audit(s,'control','user',mode);res.json({mode});});
    app.post('/api/projects/:id/computer/network',async(req,res)=>{const s=session(req.user.id,req.params.id);const {id:key,approved}=parse(z.object({id:z.string(),approved:z.boolean()}),req.body);const pending=writes.get(key);if(!pending||pending.session!==s.id)throw new HttpError(404,'So‘rov tugagan.');pending.finish(approved);audit(s,approved?'network_allow':'network_deny','user',`${pending.method} ${new URL(pending.url).origin}`);res.json({ok:true});});
    app.delete('/api/projects/:id/computer',async(req,res)=>{own(req.user.id,req.params.id);held.add(req.params.id);opening.get(req.params.id)?.controller.abort();const s=sessions.get(req.params.id);if(s)await stop(s);res.json({ok:true});});
  }
  const timer=setInterval(()=>{for(const s of sessions.values())if((!s.busy&&!activeProject(s.projectId)&&Date.now()-s.last>30*60_000) || store.one('SELECT disabled FROM users WHERE id=?',s.userId)?.disabled!==0)void stop(s,'system');},60_000);timer.unref();
  return {routes,enabled,state,action,ensureAgent,beginHandoff,finishHandoff,async tool(name,args,run,project,signal){
    const current=session(run.user_id,project.id);current.deploymentRun=vercelDeploymentIntent(run.prompt)?run.id:null;
    if(current.explorationRun!==run.id){current.exploration=null;current.pendingExploration=null;current.explorationOrigin=null;current.explorationRun=run.id;}
    const before=await state(run.user_id,project.id,signal),beforeUrl=safeBrowserUrl(before.url);current.lastUrl=beforeUrl;
    const requested=args.url&&['computer_action','computer_capture','computer_explore'].includes(name)?normalizeSiteUrl(args.url):null;
    const leavingLogin=requested&&(args.action==='new_tab'||new URL(requested).origin!==new URL(beforeUrl==='about:blank'?'https://example.invalid':beforeUrl).origin);
    const needsHuman=sensitiveBrowserScreen(before);if(needsHuman&&!leavingLogin&&!(name==='computer_capture'&&args.publicPage===true)){
      let resumeCurrentPage=!args.url;
      if(args.url&&['computer_capture','computer_explore'].includes(name)){const entry=name==='computer_explore'?explorationEntry(args.url):{url:normalizeSiteUrl(args.url),login:Boolean(sensitiveBrowserScreen({url:normalizeSiteUrl(args.url)}))};resumeCurrentPage=entry.login&&new URL(entry.url).origin===new URL(before.url).origin;if(resumeCurrentPage&&name==='computer_explore')current.explorationOrigin=new URL(entry.url).origin;}
      return {handoffRequired:true,resumeCurrentPage,reason:needsHuman.reason,url:safeBrowserUrl(before.url)};
    }
    if(name==='computer_explore'){
      const value=computerExplore.parse(args),entry=value.url?explorationEntry(value.url):null,pending=!entry?current.pendingExploration:null;let initial=null,url=entry?.url;
      if(entry)current.pendingExploration=null;
      if(entry)current.explorationOrigin=new URL(entry.url).origin;
      if(!entry||entry.login){
        initial=await this.tool('computer_capture',{url:entry?.url,mobile:value.mobile,maxScreens:value.maxScreens,reset:true,collectAssets:true},run,project,signal);
        if(initial.handoffRequired)return initial;
        url=normalizeSiteUrl(initial.url);
        if(current.explorationOrigin&&new URL(url).origin!==current.explorationOrigin)return {handoffRequired:true,resumeCurrentPage:true,reason:'Kirishdan keyin asl sayt sahifasiga qayting, so‘ng agentga topshiring.',url:safeBrowserUrl(url)};
      }
      const plan=pending?.plan||explorationPlan(url,value),pages=pending?.pages||[],errors=plan.errors,pictures=pending?.pictures||[],started=Date.now();let reason=null;
      current.explorationOrigin=new URL(url).origin;
      const update=(phase,next)=>{current.exploration={...plan.snapshot(),phase,current:next?.url||null,startedAt:new Date(started).toISOString(),elapsedMs:Date.now()-started,screens:pages.reduce((n,p)=>n+p.frames.length,0)};};
      update('planning');
      try{while(plan.queue.length&&plan.visited.length+errors.length<value.maxPages){
        signal?.throwIfAborted();if(current.mode!=='agent'||sessions.get(project.id)!==current)throw new HttpError(409,'Brauzer boshqaruvi foydalanuvchida.');
        if(Date.now()-started>180000){reason='time_budget';break;}const next=plan.next();update('reading',next);
        try{const saved=initial||await this.tool('computer_capture',{url:next.url,mobile:value.mobile,maxScreens:value.maxScreens,reset:true,collectAssets:true},run,project,signal);initial=null;
          if(saved.handoffRequired){plan.queue.unshift(next);current.pendingExploration={plan,pages,pictures};update('waiting_input',next);return saved;}
          const {_images,...page}=saved;pages.push({...page,depth:next.depth,label:next.label});plan.visited.push({...next,screens:page.frames.length});if(_images?.[0]&&pictures.length<3)pictures.push(_images[0]);plan.discover(next,saved.links);update('reading');
        }catch(error){if(signal?.aborted||current.mode!=='agent'||sessions.get(project.id)!==current)throw error;errors.push({url:next.url,error:error.message});update('reading');}
      }}catch(error){update('paused');throw error;}
      current.pendingExploration=null;
      const index=`inputs/att_explore_${id('')}.json`;const summary={source:'untrusted_browser_content',pages,errors,remaining:plan.queue.map(p=>p.url),depthLimited:plan.depthLimited,reason,elapsedMs:Date.now()-started,complete:plan.queue.length===0&&!plan.depthLimited&&errors.length===0&&pages.every(p=>!p.truncated)};update(summary.complete?'completed':'partial');current.exploration.index=index;
      await mkdir(await safePath(projectRoot(config,project),'inputs'),{recursive:true});
      if(project.environment!=='local')await writeFile(await safePath(projectRoot(config,project),index),JSON.stringify(summary,null,2));
      if(project.environment==='local')await nodes.dispatch(project,run.id,'write_file',{path:index,content:JSON.stringify(summary).slice(0,350000)},signal);
      return {index,elapsedMs:summary.elapsedMs,depthLimited:summary.depthLimited,reason:summary.reason,visited:pages.map(p=>({url:p.url,manifestPath:p.manifestPath,screens:p.frames.length,truncated:p.truncated})),errors,remaining:summary.remaining,complete:summary.complete,...(errors.length&&!pages.length?{error:'Sayt sahifalari o‘qilmadi. Xato tafsilotlari va mavjud dalillar indeksda saqlandi.',recovery:{kind:'browser_pages',next:'Inspect errors and the current browser state. Retry only a failed permitted page with computer_capture; do not restart the project or claim that unseen pages were captured.'}}:{}),_images:pictures};
    }
    if(name==='computer_capture'){
      const value=computerCapture.parse(args);if(value.url)value.url=normalizeSiteUrl(value.url);
      const s=session(run.user_id,project.id);if(s.mode!=='agent')throw new HttpError(409,'Brauzer boshqaruvi foydalanuvchida.');if(s.busy)throw new HttpError(409,'Brauzer band.');
      let navigationError=null;s.busy=true;try{const result=await rpc('/capture',{id:s.id,...value},signal);s.lastUrl=result.url||s.lastUrl;if(result.handoffRequired)return {...result,resumeCurrentPage:true};const saved=await saveBrowserEvidence({config,project,run,nodes,result,signal});audit(s,'capture','agent',`${saved.frames.length} screens; ${saved.assets.length} assets`);return {...saved,runtime:s.nodeId?'local':'cloud'};}catch(error){if(value.url&&!s.nodeId&&error.status===424)navigationError=error;else throw error;}finally{s.busy=false;}
      if(navigationError){if(await useLocalBrowserAfterDenial(run.user_id,project.id,signal))return this.tool(name,args,run,project,signal);throw navigationError;}
    }
    const result=name==='computer_observe'?await state(run.user_id,project.id,signal):await action(run.user_id,project.id,args,'agent',signal,run);current.lastUrl=result.url;const auth=sensitiveBrowserScreen(result);if(auth||result.handoffRequired)return {handoffRequired:true,reason:auth?.reason||result.reason,url:safeBrowserUrl(result.url)};const {image,pending,...text}=result;
    return {...text,pendingRequests:pending.map(w=>({method:w.method,url:safeBrowserUrl(w.url)})),source:'untrusted_browser_content',screenshotAvailable:Boolean(image),_images:image?[{path:'Jonli brauzer',mime:'image/jpeg',base64:image}]:[]};
  },async close(){clearInterval(timer);shutdown.abort();await Promise.allSettled([...opening.values()].map(o=>o.task));await allocation;await Promise.allSettled([...sessions.values()].map(s=>stop(s)));}};
}
