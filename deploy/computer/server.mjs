import {observeBrowser as observe,browserAction,trackPage,captureBrowser as capture} from './browser-engine.mjs';
import http from 'node:http';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { chromium } from '/opt/toolchain/node_modules/playwright-core/index.mjs';
import {sessionLifecycle} from './lifecycle.mjs';
import {browserRequestLimit} from '../server/browser-request-limit.mjs';

const sessions=new Map();const token=process.env.OPENSI_COMPUTER_TOKEN;
if(!token || token.length<32)throw new Error('Computer token required');
const revision=()=>randomBytes(8).toString('hex');
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
async function bounded(promise,ms){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(bad('Sahifa kutilmoqda.')),ms);})]);}finally{clearTimeout(timer);}}
const lifecycle=sessionLifecycle({sessions,
  launch:()=>chromium.launchServer({host:'127.0.0.1',timeout:20000,executablePath:'/usr/bin/chromium',headless:true,env:{PATH:process.env.PATH,HOME:'/tmp',XDG_CONFIG_HOME:'/tmp/chromium-config',XDG_CACHE_HOME:'/tmp/chromium-cache'},args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']}),
  dispose:async resource=>{try{await bounded(resource.close(),4000);}catch{await resource.kill();}},
  prepare:async s=>{
    const id=s.id;s.revision=revision();s.signature='';s.requestLimit=browserRequestLimit();
    s.browser=await chromium.connect(s.resource.wsEndpoint(),{timeout:5000});
    s.context=await bounded(s.browser.newContext({viewport:{width:1280,height:800},acceptDownloads:false,serviceWorkers:'block',permissions:[]}),5000);
    await s.context.route('**/*',async route=>{
      const writing=!['GET','HEAD','OPTIONS'].includes(route.request().method());if(writing)s.waitingWrites=(s.waitingWrites||0)+1;
      try{
        const r=route.request();const url=new URL(r.url());
        if(url.protocol!=='https:'||url.username||url.password)throw bad('Faqat HTTPS');
        if(/(^|\.)(google-analytics\.com|analytics\.google\.com|doubleclick\.net|googleadservices\.com)$/.test(url.hostname)||url.pathname==='/cdn-cgi/rum'||(url.hostname==='www.google.com'&&/^\/(measurement|rmkt|ccm|g)\//.test(url.pathname))||url.pathname.startsWith('/youtubei/')||((url.hostname.endsWith('youtube.com')||url.hostname.endsWith('youtube-nocookie.com'))&&/^\/(embed|api\/stats)\//.test(url.pathname))||url.hostname==='jnn-pa.googleapis.com'||url.pathname.startsWith('/ingest/'))throw bad('Fon telemetriyasi bloklandi.');
        const body=r.postDataBuffer();if(body?.length>1_000_000)throw bad('So‘rov katta');
        const requestHeaders=await r.allHeaders();
        const response=await s.requestLimit.run(signal=>fetch(process.env.OPENSI_COMPUTER_GATEWAY,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({session:id,url:r.url(),method:r.method(),headers:requestHeaders,body:body?.toString('base64')}),signal:AbortSignal.any([signal,AbortSignal.timeout(115000)]),redirect:'error'}));
        if(!response.ok)throw bad(`Tarmoq HTTP ${response.status}`);
        const value=await response.json(); const headers={...value.headers};if(value.cookies?.length)headers['set-cookie']=value.cookies.join('\n');
        const bytes=Buffer.from(value.body,'base64');const mime=(headers['content-type']||'').split(';')[0].trim().toLowerCase();
        if(value.status===200&&/^(image\/(png|jpeg|webp|gif)|font\/(woff2?|ttf|otf)|application\/font-woff)$/.test(mime)&&!s.assets.has(r.url())&&s.assets.size<64&&s.assetBytes+bytes.length<=20_000_000){s.assets.set(r.url(),{url:r.url(),mime,body:value.body,size:bytes.length});s.assetBytes+=bytes.length;}
        await route.fulfill({status:value.status,headers,body:bytes});
      }catch{if(s.blocked.length>20)s.blocked.shift();try{s.blocked.push(new URL(route.request().url()).origin);await route.abort('blockedbyclient');}catch{}}
      finally{if(writing)s.waitingWrites--;}
    });
    await s.context.routeWebSocket('**/*',ws=>ws.close());
    s.context.on('page',p=>trackPage(s,p));
    await bounded(s.context.newPage(),5000);
    return observe(s);
  }
});
const {open,close:closeSession}=lifecycle;
async function close(id){sessions.get(id)?.requestLimit?.close();return closeSession(id);}
async function command(route,body){
  if(route==='/reconcile'){
    if(!Array.isArray(body.ids)||body.ids.length>2||body.ids.some(id=>!/^browser_[a-f0-9]{24}$/.test(id)))throw bad('Noto‘g‘ri sessiyalar.');
    await Promise.all([...sessions.keys()].filter(id=>!body.ids.includes(id)).map(close));return {ok:true};
  }
  if(!/^browser_[a-f0-9]{24}$/.test(body.id))throw bad('Noto‘g‘ri sessiya.');
  if(route==='/open')return open(body.id);
  if(route==='/close')return close(body.id);
  const s=sessions.get(body.id);if(!s?.page)throw bad('Sessiya tugagan. Yangisini oching.',404);
  if(route==='/mode')return {ok:true};
  if(route==='/status')return {ready:!s.closing};
  if(route==='/interrupt'){await s.page.evaluate(()=>window.stop());s.revision=revision();return {ok:true};}
  if(route==='/state')return s.busy&&s.cached?{...s.cached,activity:s.activity}:observe(s,{live:body.live});
  if(route==='/capture'){if(s.busy)throw bad('Brauzer band.',409);s.busy=true;try{return await capture(s,body);}finally{s.busy=false;}}
  if(route!=='/action')throw bad('Amal topilmadi.',404);
  if(s.busy)throw bad('Brauzer band.',409);
  s.busy=true;
  try {
    return await browserAction(s,body);
  } finally{s.busy=false;}
}
const server=http.createServer(async(req,res)=>{
  const actual=Buffer.from(req.headers.authorization||'');const expected=Buffer.from(`Bearer ${token}`);
  res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
  if(req.method!=='POST'||actual.length!==expected.length||!timingSafeEqual(actual,expected)){res.writeHead(401);res.end('{}');return;}
  try{const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>16000)throw bad('So‘rov katta',413);chunks.push(c);}const body=JSON.parse(Buffer.concat(chunks));res.end(JSON.stringify(await command(req.url,body)));}
  catch(error){console.error(JSON.stringify({route:req.url,error:String(error.message).split('\n')[0].slice(0,240)}));res.writeHead(error.status||400);res.end(JSON.stringify({error:error.status?error.message:'Sahifa amali bajarilmadi. Sahifani yangilang yoki sessiyani qayta oching.'}));}
});
server.listen(4595,'0.0.0.0');
setInterval(()=>{for(const s of sessions.values())if(Date.now()-s.last>31*60_000)void close(s.id);},60000).unref();
process.once('SIGTERM',async()=>{await Promise.allSettled([...sessions.keys()].map(close));server.close();});
