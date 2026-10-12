import {randomBytes} from 'node:crypto';
import {sensitiveBrowserScreen,safeBrowserUrl} from '../server/browser-workflow.mjs';
const revision=()=>randomBytes(8).toString('hex');
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
export async function navigatePage(page,url){
 const visible=()=>typeof page.evaluate==='function'?page.evaluate(()=>Boolean(document.body?.innerText.trim()||document.querySelector('input,button,textarea,select,canvas,video,iframe')||[...document.images].some(image=>image.complete&&image.naturalWidth>0))).catch(()=>false):Promise.resolve(false);
 for(let attempt=0;attempt<2;attempt++){try{const response=await page.goto(url,{waitUntil:'domcontentloaded'});if([401,403].includes(response?.status()))throw bad('Sayt bulut brauzeridagi so‘rovni rad etdi. Lokal brauzerda qayta ochish kerak.',424);
  // A document-ready single-page app can still be completely white while its
  // module graph loads. Wait for real visible content before reporting success.
  if(typeof page.evaluate==='function'&&typeof page.waitForFunction==='function'&&!await visible()){
   await page.waitForFunction(()=>Boolean(document.body?.innerText.trim()||document.querySelector('input,button,textarea,select,canvas,video,iframe')||[...document.images].some(image=>image.complete&&image.naturalWidth>0)),undefined,{timeout:20000}).catch(()=>{});
   if(!await visible())throw bad('Sahifa ochildi, ammo mazmuni yuklanmadi. Brauzer ulanishini tekshiring yoki boshqa sahifani sinang.',424);
  }
  return response;}catch(error){
  if(error.message.includes('Timeout')){
   if(typeof page.waitForFunction==='function')await page.waitForFunction(()=>Boolean(document.body?.innerText.trim()||document.querySelector('input,button,textarea,select,canvas,video,iframe')||[...document.images].some(image=>image.complete&&image.naturalWidth>0)),undefined,{timeout:8000}).catch(()=>{});
   if(await visible())return;
   if(attempt)throw bad('Sahifa yuklanmadi. Brauzer ulanishini tekshiring yoki lokal brauzerda qayta oching.',424);
   continue;
  }
  if(/ERR_HTTP_RESPONSE_CODE_FAILURE/.test(error.message))throw bad('Sayt bulut brauzeridagi so‘rovni rad etdi. Lokal brauzerda qayta ochish kerak.',424);
  if(attempt||!/ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_(?:RESET|CLOSED)|ERR_TIMED_OUT/.test(error.message))throw error;
 }}
}
export function trackPage(s,page){
 s.pages??=new Map();if(s.pages.size>=5){void page.close();return;}
 const tab=(s.nextTab=(s.nextTab||0)+1);s.pages.set(tab,page);s.page=page;
 page.setDefaultTimeout(6000);page.setDefaultNavigationTimeout(15000);
 page.on('close',()=>{s.pages.delete(tab);if(s.page===page)s.page=[...s.pages.values()].at(-1);s.revision=revision();});
 page.on('dialog',d=>void d.dismiss());page.on('download',d=>void d.cancel());
}
export async function observeBrowser(s,{live=false}={}){
 if(live&&s.cached&&(s.capturing||Date.now()-(s.observedAt||0)<1100))return {...s.cached,activity:s.activity};
 if(s.observing)return s.observing;
 s.observing=observe(s);try{return await s.observing;}finally{s.observing=null;}
}
async function observe(s){
 const page=s.page;if(!page||page.isClosed())throw bad('Brauzer oynasi yopilgan.',404);
 const readSnapshot=()=>page.evaluate(()=>{
  const visible=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden';};
  const els=[...document.querySelectorAll('a,button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[contenteditable=true]')].filter(visible).slice(0,300);
  for(const old of document.querySelectorAll('[data-opensi-element]'))old.removeAttribute('data-opensi-element');
  const elements=els.map((el,i)=>{const r=el.getBoundingClientRect();el.setAttribute('data-opensi-element',String(i+1));const labelledBy=(el.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim();const associatedLabels='labels' in el?[...el.labels||[]].map(label=>label.innerText||label.textContent||'').join(' ').trim():'';return {id:i+1,tag:el.tagName.toLowerCase(),type:el.getAttribute('type')||'',autocomplete:el.getAttribute('autocomplete')||'',role:el.getAttribute('role')||'',href:el.tagName==='A'?el.href:undefined,expanded:el.getAttribute('aria-expanded'),selected:el.getAttribute('aria-selected'),disabled:el.matches(':disabled'),required:'required' in el?el.required:false,checked:'checked' in el?el.checked:undefined,inViewport:r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth,rect:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)},label:(el.getAttribute('aria-label')||labelledBy||associatedLabels||el.getAttribute('placeholder')||el.innerText||el.getAttribute('name')||el.getAttribute('title')||el.tagName).trim().slice(0,160),...(el.tagName==='SELECT'?{options:[...el.options].slice(0,80).map(o=>({label:o.label,value:o.value,selected:o.selected}))}:{})};});
  const auth=els.some(el=>el.type==='password'||/one-time-code|cc-number|cc-csc/.test(el.getAttribute('autocomplete')||''))||[...document.querySelectorAll('iframe')].some(el=>visible(el)&&/captcha|challenges.cloudflare.com/.test(el.src));
  return {text:document.body?.innerText.slice(0,14000)||'',elements,scrollX:scrollX,scrollY:scrollY,pageHeight:Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0),...(auth?{authRequired:{reason:'Kirish, parol, kod yoki CAPTCHA bosqichini o‘zingiz yakunlang.'}}:{})};
 });
 let snapshot;
 for(let attempt=0;attempt<3;attempt++){
  try{snapshot=await readSnapshot();break;}
  catch{
   if(attempt===2){snapshot={text:'Sahifa yuklanmoqda.',elements:[]};break;}
   await page.waitForLoadState('domcontentloaded',{timeout:5000}).catch(()=>{});
   await page.waitForTimeout(150).catch(()=>{});
  }
 }
 const signature=JSON.stringify({url:page.url(),elements:snapshot.elements});if(s.signature!==signature){s.signature=signature;s.revision=revision();}
 const title=await page.title().catch(()=>''),url=safeBrowserUrl(page.url());
 const authRequired=sensitiveBrowserScreen({...snapshot,url,title});
 const image=await page.screenshot({type:'jpeg',quality:65,timeout:2500,mask:[page.locator('input[type=password],input[autocomplete=one-time-code],input[autocomplete=cc-number],input[autocomplete=cc-csc]')]}).then(b=>b.toString('base64')).catch(()=>s.cached?.image||'');
 const tabs=await Promise.all([...(s.pages||new Map([[1,page]]))].map(async([id,p])=>({id,url:safeBrowserUrl(p.url()),title:await p.title().catch(()=>''),active:p===page})));
 s.last=Date.now();s.observedAt=Date.now();s.cached={...snapshot,url,title,revision:s.revision,image,...page.viewportSize(),blocked:s.blocked.slice(-6),tabs,authRequired,activity:s.activity};return s.cached;
}
export async function browserAction(s,body){
 if(['click','fill','check','uncheck','submit','press','select','hover'].includes(body.action)){
  if(body.revision!==s.revision)throw bad('Sahifa o‘zgargan. Elementlarni qayta ko‘ring.',409);
  if(!Number.isInteger(body.target)||body.target<1||body.target>300)throw bad('Elementni tanlang.');
 }
 if(body.actor==='agent'){
  const screen=await observeBrowser(s);const auth=sensitiveBrowserScreen(screen);
  if(auth&&!['navigate','new_tab'].includes(body.action))return {handoffRequired:true,reason:auth.reason,url:screen.url};
 }
 const coordinate=(x,y)=>{const size=s.page.viewportSize();if(body.revision!==s.revision||!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=size.width||y>=size.height)throw bad('Ekran koordinatasi eskirgan yoki noto‘g‘ri.',409);return {x,y};};
 const currentRevision=()=>{if(body.revision!==s.revision)throw bad('Sahifa o‘zgargan. Qayta kuzating.',409);};
 const target=s.page.locator(`[data-opensi-element="${Number(body.target)}"]`);
 switch(body.action){
  case 'navigate':{const u=new URL(body.url);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')throw bad('HTTPS kerak.');await navigatePage(s.page,u.href);break;}
  case 'click_at':{const {x,y}=coordinate(body.x,body.y);await s.page.mouse.click(x,y);break;}
  case 'type_text':currentRevision();if(!body.value||body.value.length>2000)throw bad('Yoziladigan matnni kiriting.');await s.page.keyboard.insertText(body.value);break;
  case 'key':currentRevision();if(!['Enter','Tab','Escape','ArrowDown','ArrowUp','ArrowLeft','ArrowRight','PageDown','PageUp','Home','End','Space','Backspace','Delete','ControlOrMeta+A'].includes(body.value))throw bad('Tugma ruxsat etilmagan.');await s.page.keyboard.press(body.value);break;
  case 'wheel':{const size=s.page.viewportSize(),x=body.x??Math.floor(size.width/2),y=body.y??Math.floor(size.height/2);coordinate(x,y);if(!Number.isInteger(body.deltaX)||!Number.isInteger(body.deltaY)||Math.abs(body.deltaX)>1500||Math.abs(body.deltaY)>1500||!body.deltaX&&!body.deltaY)throw bad('Aylantirish qiymati noto‘g‘ri.');await s.page.mouse.move(x,y);await s.page.mouse.wheel(body.deltaX,body.deltaY);break;}
  case 'drag':{const start=coordinate(body.x,body.y),end=coordinate(body.toX,body.toY);await s.page.mouse.move(start.x,start.y);await s.page.mouse.down();try{await s.page.mouse.move(end.x,end.y,{steps:12});}finally{await s.page.mouse.up();}break;}
  case 'hover':await target.hover();break;
  case 'click':await target.click({noWaitAfter:true});break;
  case 'fill':await target.fill(String(body.value||'').slice(0,2000));break;
  case 'check':await target.check();break;
  case 'uncheck':await target.uncheck();break;
  case 'submit':{
   const isSubmit=await target.evaluate(el=>{
    const button=el instanceof HTMLButtonElement||el instanceof HTMLInputElement&&['submit','button','image'].includes(el.type)||el.getAttribute('role')==='button';
    const label=(el.getAttribute('aria-label')||el.innerText||el.getAttribute('value')||'').toLowerCase();
    return button&&!el.matches(':disabled')&&!/(?:delete|remove|pay|purchase|checkout|logout|sign.?out|o['‘’`]?chir|to['‘’`]?la|sotib ol|bekor qil)/i.test(label);
   });
   if(!isSubmit)throw bad('Ma’lumot yuborish tugmasini tanlang.');
   await target.click({noWaitAfter:true});break;
  }
  case 'select':await target.selectOption(String(body.value||''));break;
  case 'press':if(!['Enter','Tab','Escape','ArrowDown','ArrowUp','Space','Backspace','ControlOrMeta+A'].includes(body.value))throw bad('Tugma ruxsat etilmagan.');await target.press(body.value,{noWaitAfter:true});break;
  case 'scroll':await scrollCapture(s.page,body.direction==='up'?'previous':'next');break;
  case 'back':await s.page.goBack({waitUntil:'domcontentloaded'});break;
  case 'reload':await s.page.reload({waitUntil:'domcontentloaded'});break;
  case 'switch_tab':{const page=s.pages?.get(body.tab);if(!page||page.isClosed())throw bad('Brauzer oynasi topilmadi.');s.page=page;await page.bringToFront();break;}
  case 'new_tab':{if((s.pages?.size||0)>=5)throw bad('Bitta sessiyada 5 tadan ortiq tab ochilmaydi.',409);const u=body.url?new URL(body.url):null;if(u&&(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'))throw bad('HTTPS kerak.');const page=await s.context.newPage();if(![...(s.pages?.values()||[])].includes(page))trackPage(s,page);s.page=page;if(u)await navigatePage(page,u.href);break;}
  case 'close_tab':{if((s.pages?.size||0)<=1)throw bad('Oxirgi tabni yopib bo‘lmaydi.',409);const page=body.tab?s.pages?.get(body.tab):s.page;if(!page||page.isClosed())throw bad('Brauzer oynasi topilmadi.');await page.close();break;}
  default:throw bad('Amal qo‘llanmaydi.');
 }
 if(['click','click_at','press','key','fill','check','uncheck','submit','type_text','select','wheel','drag','scroll','hover'].includes(body.action)){await s.page.waitForTimeout(body.action==='submit'?900:220).catch(()=>{});}
 if(body.action==='submit'){
  const deadline=Date.now()+122_000;
  while((s.waitingWrites||0)>0&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
 }
 s.revision=revision();return observeBrowser(s);
}

async function bounded(promise,ms){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(bad('Sahifa kutilmoqda.')),ms);})]);}finally{clearTimeout(timer);}}
async function scrollCapture(page,operation){
  return page.evaluate(operation=>{
    const documentHeight=Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight||0);
    let root=null;
    if(documentHeight<=innerHeight+4)root=[...document.querySelectorAll('main,section,div,[role="main"]')].filter(el=>{const r=el.getBoundingClientRect();return /auto|scroll/.test(getComputedStyle(el).overflowY)&&el.scrollHeight>el.clientHeight+20&&r.width>innerWidth*.4&&r.height>innerHeight*.3&&r.bottom>0&&r.top<innerHeight;}).sort((a,b)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return y.width*y.height-x.width*x.height;})[0];
    const target=root||window;const viewport=root?root.clientHeight:innerHeight;
    if(operation==='reset')target.scrollTo({top:0,behavior:'instant'});
    if(operation==='next'||operation==='previous')target.scrollBy({top:Math.round(viewport*.75)*(operation==='previous'?-1:1),behavior:'instant'});
    return {y:root?root.scrollTop:scrollY,height:root?root.scrollHeight:documentHeight,viewport,root:root?(root.tagName.toLowerCase()+(root.id?`#${root.id}`:'')):'page'};
  },operation);
}
export async function captureBrowser(s,body){
 s.capturing=true;const started=Date.now();try{return await capturePage(s,body);}finally{s.capturing=false;s.activity={phase:'ready',elapsedMs:Date.now()-started};}}
async function capturePage(s,body){
 s.activity={phase:body.url?'navigating':'reading',frame:0};
  const maxScreens=Math.min(12,Math.max(1,Number(body.maxScreens)||8));const mobile=body.mobile===true;
  if(body.url){const url=new URL(body.url);if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')throw bad('HTTPS manzil kerak.');s.assets.clear();s.assetBytes=0;await navigatePage(s.page,url.href);}
  const viewport=mobile?{width:390,height:844}:{width:1280,height:800};const changed=s.page.viewportSize()?.width!==viewport.width;
  const sourceUrl=s.page.url();
  await s.page.setViewportSize(viewport);if(body.reset!==false||changed)await scrollCapture(s.page,'reset');
  const frames=[];let atBottom=false;let priorY=-1;const observed=new Set();
  for(let i=0;i<maxScreens;i++){
    // Let lazy-loaded images/layout settle, without waiting for endless analytics requests.
    s.activity={phase:'capturing',frame:i+1,maxFrames:maxScreens};
    await bounded(s.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))),300).catch(()=>{});
    await bounded(s.page.evaluate(async()=>{await Promise.all([...document.images].filter(img=>{const r=img.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;}).map(img=>img.decode().catch(()=>{})));}),1200).catch(()=>{});
    const screen=await observeBrowser(s);if(screen.authRequired&&!body.publicPage)return {handoffRequired:true,reason:screen.authRequired.reason,url:screen.url};
    if(body.publicPage)screen.image=(await s.page.screenshot({type:'jpeg',quality:65,timeout:2500,style:'input,textarea,[contenteditable=true]{color:transparent!important;-webkit-text-fill-color:transparent!important;-webkit-text-security:none!important;text-shadow:none!important;caret-color:transparent!important}'})).toString('base64');
    const scroll=await scrollCapture(s.page,'read');
    const design=await bounded(s.page.evaluate(redacted=>{
      const inView=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth&&getComputedStyle(el).visibility!=='hidden';};
      const rect=el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};};
      const nodes=[...document.querySelectorAll('header,nav,main,section,footer,h1,h2,h3,p,a,button,input,img,svg,article,[class]')].filter(inView).slice(0,90);
      const safeText=(el,limit)=>{if(!redacted)return (el.innerText||el.getAttribute('alt')||'').slice(0,limit);const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let text='',node;while((node=walker.nextNode())&&text.length<limit){if(!node.parentElement?.closest('input,textarea,[contenteditable],script,style,noscript')&&node.parentElement?.getClientRects().length)text+=node.textContent+'\n';}return text.slice(0,limit);};
      const styles=nodes.map(el=>{const c=getComputedStyle(el);return {tag:el.tagName.toLowerCase(),text:safeText(el,200),rect:rect(el),color:c.color,background:c.backgroundColor,font:c.fontFamily,fontSize:c.fontSize,fontWeight:c.fontWeight,lineHeight:c.lineHeight,padding:c.padding,margin:c.margin,gap:c.gap,border:c.border,borderRadius:c.borderRadius,display:c.display,position:c.position,grid:c.gridTemplateColumns};});
      const images=[...document.images].filter(inView).slice(0,60).map(img=>({url:(img.currentSrc||img.src).slice(0,4000),alt:img.alt,rect:rect(img),naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight}));
      const backgrounds=nodes.flatMap(el=>[...getComputedStyle(el).backgroundImage.matchAll(/url\(["']?(.*?)["']?\)/g)].map(m=>({url:m[1].slice(0,4000),rect:rect(el)}))).slice(0,40);
      const links=[...document.querySelectorAll('a[href]')].filter(a=>inView(a)||a.closest('nav,[role=navigation],aside')).slice(0,150).map(a=>({text:safeText(a,120),url:a.href.slice(0,2000)}));
      return {styles,images,backgrounds,links,...(redacted?{visibleText:safeText(document.body,14000)}:{}),fonts:document.fonts?[...document.fonts].slice(0,30).map(f=>({family:f.family,weight:f.weight,style:f.style,status:f.status})):[]};
    },body.publicPage===true),2000);
    if(body.publicPage){screen.text=design.visibleText;screen.elements=[];}
    for(const a of [...design.images,...design.backgrounds])observed.add(a.url);
    frames.push({...screen,scrollY:scroll.y,scrollContainer:scroll.root,pageHeight:scroll.height,design});
    const bottom=scroll.y+scroll.viewport>=scroll.height-3;
    if(bottom){await s.page.waitForTimeout(300);const next=await scrollCapture(s.page,'read');if(next.height<=scroll.height+3){atBottom=true;break;}}
    if(priorY===scroll.y)break;priorY=scroll.y;
    if(i+1<maxScreens)await scrollCapture(s.page,'next');
  }
  // Read semantic tabs only. Never click generic buttons, submit forms or infer actions from page text.
  if(!body.publicPage&&body.inspectTabs!==false&&frames.length<12){
    const allTabs=s.page.locator('[role=tab]');const tabs=await allTabs.all();
    const activeIndex=await s.page.evaluate(()=>[...document.querySelectorAll('[role=tab]')].findIndex(el=>el.getAttribute('aria-selected')==='true'));const active=activeIndex>=0?allTabs.nth(activeIndex):null;const initialUrl=s.page.url();
    for(const tab of tabs.slice(0,3)){
      if(frames.length>=12)break;
      const safe=await tab.evaluate(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&!el.disabled&&el.getAttribute('aria-selected')!=='true'&&!el.closest('form')&&(!el.getAttribute('href')||el.getAttribute('href').startsWith('#'))&&(el.tagName!=='BUTTON'||el.type==='button')&&!/delete|remove|pay|buy|logout|sign.?out/i.test(el.innerText||'');}).catch(()=>false);if(!safe)continue;
      const label=(await tab.innerText()).slice(0,120);s.activity={phase:'tab',label};
      await tab.click({timeout:2000,noWaitAfter:true});
      const sub=await capturePage(s,{mobile,maxScreens:1,reset:false,collectAssets:false,inspectTabs:false});
      if(sub.handoffRequired)return sub;for(const f of sub.frames){frames.push({...f,stateLabel:label});for(const a of [...f.design.images,...f.design.backgrounds])observed.add(a.url);}
      if(s.page.url()!==initialUrl)break;
    }
    if(s.page.url()===initialUrl&&active&&await active.count()){await active.click({timeout:2000,noWaitAfter:true}).catch(()=>{});await observeBrowser(s);}
  }
  const assets=body.collectAssets===false?[]:[...s.assets.values()].filter(a=>observed.has(a.url)||/font|woff/.test(a.mime)).slice(0,40);
  const savedUrls=new Set(assets.map(a=>a.url));const missingAssets=[...observed].filter(url=>!savedUrls.has(url)).map(url=>({url,reason:'Brauzer keshida mavjud emas yoki format/hajm chegarasi; original screenshotda ko‘rinadi.'}));
  return {url:sourceUrl,mobile,viewport,frames,assets,missingAssets,atBottom,truncated:!atBottom,...(body.publicPage?{publicPage:true}:{}),continuation:!atBottom?{mobile,reset:false,maxScreens,...(body.publicPage?{publicPage:true}:{})}:null};
}
