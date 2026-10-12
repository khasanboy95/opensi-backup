import {chromeExecutable} from './chrome.mjs';
import {fileURLToPath,pathToFileURL} from 'node:url';
async function driver(){const bundled=path.join(path.dirname(fileURLToPath(import.meta.url)),'browser-runtime/index.mjs');return existsSync(bundled)?import(pathToFileURL(bundled).href):import('playwright-core');}
import {existsSync} from 'node:fs';
import path from 'node:path';
import {observeBrowser,browserAction,trackPage,captureBrowser} from './browser-engine.mjs';
import {guardedFetch} from '../server/security.mjs';
import {browserRequestLimit} from '../server/browser-request-limit.mjs';
import {browserWriteAllowed,ordinaryFormWriteAllowed,browserTelemetry} from '../server/browser-workflow.mjs';

export function localBrowserService({server,approveWrite}){
 const sessions=new Map();const ownHost=new URL(server).hostname;
 async function open(id){
  if(sessions.has(id))return observeBrowser(sessions.get(id));
  if(sessions.size>=2)throw Error('Kompyuterda ikki brauzer sessiyasi ochiq. Avval bittasini yoping.');
  const executablePath=chromeExecutable();
  const s={id,mode:'agent',last:Date.now(),blocked:[],assets:new Map(),assetBytes:0,requestLimit:browserRequestLimit(),opening:true};sessions.set(id,s);
  try{
   const {chromium}=await driver();s.browser=await chromium.launch({executablePath,headless:false,args:['--disable-background-networking','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
   s.context=await s.browser.newContext({viewport:{width:1280,height:800},acceptDownloads:false,serviceWorkers:'block',permissions:[]});
   // Browser cookies stay on this computer. Only screenshots and observed page data
   // go to the owning OpenSI task; the gateway never receives local cookies.
   await s.context.route('**/*',async route=>{
    const writing=!['GET','HEAD','OPTIONS'].includes(route.request().method());if(writing)s.waitingWrites=(s.waitingWrites||0)+1;
    try{
     const r=route.request(),u=new URL(r.url());if(u.protocol!=='https:'||u.username||u.password||u.hostname===ownHost)throw Error('Manzil yopiq.');
     if(browserTelemetry(u.href))throw Error('Fon telemetriyasi bloklandi.');
     const body=r.postDataBuffer();if(body?.length>1_000_000)throw Error('So‘rov 1 MB dan katta.');
     if(!['GET','HEAD','OPTIONS'].includes(r.method())){
      const request={url:u.href,method:r.method()};
      const formWrite=ordinaryFormWriteAllowed(s,request,Date.now()<(s.taskUntil||0)&&body?.length<=20_000);
      if(formWrite)s.formWrite.remaining=0;
      const allowed=formWrite||browserWriteAllowed({...s,manualOrigin:new URL(s.page?.url()||'about:blank').origin,manualUntil:s.mode==='user'?Date.now()+1000:0},request,Date.now()<(s.taskUntil||0));
      if(!allowed){
       if(s.mode==='agent'&&s.activeAction==='submit'&&approveWrite&&(body?.length||0)<=20_000){
        try{await approveWrite({session:s.id,url:u.href,method:r.method(),bytes:body?.length||0});}
        catch{s.writeBlocked='Ma’lumot yuborish tasdiqlanmadi. Natijani tekshiring, avtomatik qayta yubormang.';throw Error('So‘rov rad etildi.');}
       }else{s.writeBlocked='Saytga ma’lumot yuborish bloklandi. Kerakli yuborish tugmasi uchun submit amalini ishlating.';throw Error('So‘rov bloklandi.');}
      }
     }
     const headers=Object.fromEntries(Object.entries(await r.allHeaders()).filter(([k])=>!['host','connection','content-length','accept-encoding','transfer-encoding'].includes(k)));
     const response=await s.requestLimit.run(signal=>guardedFetch(u,{method:r.method(),headers,body:['GET','HEAD'].includes(r.method())?undefined:body,redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])}));
     const chunks=[];let size=0;for await(const chunk of response.body||[]){size+=chunk.length;if(size>5_000_000)throw Error('Resurs 5 MB dan katta.');chunks.push(chunk);}
     const out=Object.fromEntries([...response.headers].filter(([k])=>!['content-encoding','content-length','transfer-encoding','connection','set-cookie'].includes(k)));const cookies=response.headers.getSetCookie();if(cookies.length)out['set-cookie']=cookies.join('\n');
     const bytes=Buffer.concat(chunks),mime=(out['content-type']||'').split(';')[0].trim().toLowerCase();
     if(response.status===200&&/^(image\/(png|jpeg|webp|gif)|font\/(woff2?|ttf|otf)|application\/font-woff)$/.test(mime)&&!s.assets.has(u.href)&&s.assets.size<64&&s.assetBytes+bytes.length<=20_000_000){s.assets.set(u.href,{url:u.href,mime,body:bytes.toString('base64'),size:bytes.length});s.assetBytes+=bytes.length;}
     await route.fulfill({status:response.status,headers:out,body:bytes});
    }catch{if(s.blocked.length>20)s.blocked.shift();try{s.blocked.push(new URL(route.request().url()).origin);await route.abort('blockedbyclient');}catch{}}
    finally{if(writing)s.waitingWrites--;}
   });
   await s.context.routeWebSocket('**/*',ws=>ws.close());s.context.on('page',p=>trackPage(s,p));await s.context.newPage();s.opening=false;
   return observeBrowser(s);
  }catch(e){await close(id);throw e;}
 }
 async function close(id){const s=sessions.get(id);if(s){sessions.delete(id);s.requestLimit.close();await s.browser?.close();}return {ok:true};}
 return {async command({route,body}){
  if(route==='/reconcile'){
   if(!Array.isArray(body?.ids)||body.ids.length>2||body.ids.some(id=>!/^browser_[a-f0-9]{24}$/.test(id)))throw Error('Brauzer sessiyalari noto‘g‘ri.');
   const keep=new Set(body.ids),stale=[...sessions.keys()].filter(id=>!keep.has(id));
   await Promise.allSettled(stale.map(close));return {ok:true,closed:stale.length};
  }
  if(!/^browser_[a-f0-9]{24}$/.test(body?.id))throw Error('Brauzer sessiyasi noto‘g‘ri.');
  if(route==='/open')return open(body.id);if(route==='/close')return close(body.id);
  const s=sessions.get(body.id);if(!s||s.opening)throw Object.assign(Error('Lokal brauzer sessiyasi yopiq.'),{status:404});s.last=Date.now();
  if(route==='/status')return {ready:true};
  if(route==='/mode'){s.mode=body.mode==='user'?'user':'agent';s.writeBlocked=null;return {ok:true};}
  if(route==='/state'){if(body.mode)s.mode=body.mode;return observeBrowser(s,{live:body.live});}
  if(route==='/capture')return captureBrowser(s,body);
  if(route!=='/action')throw Error('Brauzer amali noto‘g‘ri.');
  s.mode=body.actor==='user'?'user':'agent';s.deploymentRun=body.deploymentRun;s.taskUntil=Date.now()+30000;
  s.writeBlocked=null;s.formWrite=body.actor==='agent'&&body.action==='submit'?body.formWrite:null;s.activeAction=body.action;
  try{const screen=await browserAction(s,body);return s.writeBlocked&&body.actor!=='user'?{...screen,writeBlocked:true,writeReason:s.writeBlocked}:screen;}
  finally{s.formWrite=null;s.activeAction=null;}
 },async close(){await Promise.allSettled([...sessions.keys()].map(close));}};
}
