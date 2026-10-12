const actionPath=/(?:logout|signout|delete|remove|checkout|purchase|unsubscribe|sign-?in|sign-?up|register|login|oauth|authorize|callback|token|password)/i;
const loginPath=/(?:^|\/)(?:login|signin|sign-in|signup|sign-up|register|oauth|authorize)(?:\/|$)/i;
const invalidUrl=()=>Object.assign(Error('Sayt manzili aniqlanmadi. To‘liq HTTPS manzil yoki sayt domeni kerak.'),{code:'SITE_URL_INVALID'});
// Correct presentation mistakes, never guess another host or downgrade HTTPS.
export function normalizeSiteUrl(value){
 let text=typeof value==='string'?value.trim():'';
 const markdown=/^\[[^\]\r\n]*\]\(([^\s]+)\)$/.exec(text);if(markdown)text=markdown[1];
 if(text.startsWith('<')&&text.endsWith('>'))text=text.slice(1,-1);
 if(text.length>1&&['"',"'",'`'].includes(text[0])&&text.at(-1)===text[0])text=text.slice(1,-1);
 if(!text||/[\u0000-\u0020\u007f\\]/.test(text))throw invalidUrl();
 if(text.startsWith('//'))text='https:'+text;
 else if(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?::(?:80|443))?(?:[/?#]|$)/i.test(text))text='https://'+text;
 let u;try{u=new URL(text);}catch{throw invalidUrl();}
 if(u.protocol==='http:'&&(!u.port||u.port==='80')){u.protocol='https:';u.port='';}
 if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')throw invalidUrl();
 return u.href;
}
// A user-supplied login entry may be opened for a human handoff. It is never
// added to the crawler queue, which still excludes authentication/action links.
export function explorationEntry(value){
 const url=normalizeSiteUrl(value),u=new URL(url);let decoded;
 try{decoded=decodeURIComponent(u.pathname);}catch{throw invalidUrl();}
 if(loginPath.test(decoded)&&!/(?:logout|signout|delete|remove|checkout|purchase|unsubscribe|callback|token|password)/i.test(decoded+u.search+u.hash))return {url,login:true};
 const first=navigationUrl(url,url);
 if(!first)throw Object.assign(Error('Bu manzilni avtomatik kezib bo‘lmaydi: kirish/amal havolasi, yuklama yoki qo‘llanmaydigan parametr. Ommaviy sahifa manzilini tekshiring.'),{code:'SITE_CRAWL_BLOCKED'});
 return {url:first,login:false};
}
export function navigationUrl(origin,value){
 try{const base=new URL(origin),u=new URL(value,base);
  if(u.origin!==base.origin||u.protocol!=='https:'||u.username||u.password||actionPath.test(decodeURIComponent(u.pathname+u.search+u.hash)))return null;
  if(/\.(?:pdf|zip|png|jpg|jpeg|webp|mp4|mp3|svg|exe|dmg)$/i.test(u.pathname))return null;
  for(const key of [...u.searchParams.keys()]){if(/^utm_|^(?:fbclid|gclid)$/i.test(key))u.searchParams.delete(key);else if(!/^(?:page|category|tab|view|section|lang)$/i.test(key))return null;}
  u.searchParams.sort();if(u.hash&&!/^#!?\//.test(u.hash))u.hash='';return u.href;
 }catch{return null;}
}
export function internalLinks(origin,links,seen=new Set()){
 const result=[];for(const link of links||[]){const url=navigationUrl(origin,link.url);if(!url||seen.has(url))continue;seen.add(url);result.push({url,label:String(link.text||link.label||'').slice(0,120)});}return result;
}
export function explorationPlan(url,{maxPages=12,maxDepth=3}={}){
 const entry=explorationEntry(url);if(entry.login)throw Object.assign(Error('Avval saytga kirishni yakunlang; keyin ochilgan sahifadan o‘rganish davom etadi.'),{code:'SITE_LOGIN_REQUIRED'});const first=entry.url;
 const seen=new Set([first]),queue=[{url:first,label:'Boshlang‘ich sahifa',depth:0}],visited=[],errors=[];let depthLimited=0;
 return {queue,visited,errors,get depthLimited(){return depthLimited;},next(){return visited.length+errors.length<maxPages?queue.shift():null;},discover(parent,links){const found=internalLinks(first,links,seen);if(parent.depth>=maxDepth){depthLimited+=found.length;return;}for(const link of found.slice(0,Math.max(0,200-queue.length)))queue.push({...link,depth:parent.depth+1});},snapshot(){return {visited:visited.length,failed:errors.length,remaining:queue.length,depthLimited,maxPages,maxDepth,pages:visited.map(p=>({url:p.url,label:p.label,depth:p.depth,screens:p.screens})),queue:queue.slice(0,24)};}};
}
