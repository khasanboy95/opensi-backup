// Scope comes from the human task, never from page text or a model's arguments.
export function vercelDeploymentIntent(prompt){const text=String(prompt||'');if(/(?:do not|don't|never)\s+deploy|deploy\s+(?:qilma|etma)|(?:explain|how to|tushuntir)\b/i.test(text))return false;return /\bvercel(?:ga|da|dan)?\b/i.test(text)&&(/deploy\s+(?:qil|et)|nashr\s+(?:qil|et)|joylashtir/i.test(text)||/^\s*(?:please\s+)?deploy\b/i.test(text)||/vercel(?:ga)?\s+deploy\s*$/i.test(text));}
export function safeBrowserUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.origin+u.pathname:'about:blank';}catch{return 'about:blank';}}
export function browserTelemetry(value){const u=new URL(value);return /(^|\.)(?:sentry\.io|google-analytics\.com|doubleclick\.net)$/.test(u.hostname);}
export function publicLoginCaptureIntent(prompt){const text=String(prompt||'');return !/\bnot\s+only\b|\bfaqat\s+(?:login|kirish)\s+(?:(?:page|sahifa)\S*\s+)?emas\b/i.test(text)&&/(?:\bfaqat|\bonly)\s+(?:the\s+)?(?:login|sign.?in|kirish)\b|(?:login|kirish)\s+(?:page|sahifa)\S*\s+(?:only|faqat)\b/i.test(text);}
export function formSubmissionIntent(prompt){
 const text=String(prompt||'');
 if(/\b(?:do not|don't|never)\s+(?:submit|send|save|post|publish|create|register)|\b(?:read only|view only|only view|only inspect)\b|\b(?:yuborma|jo['‘’`]?natma|saqlama|qo['‘’`]?shma|kiritma|faqat ko['‘’`]?r)\b/i.test(text))return false;
 return /\b(?:submit|send|save|post|publish|create|register|update|add|fill in|fill out)\b|\b(?:yubor|jo['‘’`]?nat|saqla|qo['‘’`]?sh|kirit|to['‘’`]?ldir|joylashtir|ro['‘’`]?yxatdan o['‘’`]?t)\w*/i.test(text);
}
export function sensitiveBrowserScreen(screen){
 if(screen.authRequired)return screen.authRequired;
 if(/security checkpoint|verify (?:that )?you are human|checking your browser/i.test(screen.title||''))return {reason:'Sayt xavfsizlik tekshiruvini o‘zingiz yakunlang.'};
 const url=safeBrowserUrl(screen.url);
 const site=new URL(url==='about:blank'?'https://example.invalid':url);
 if(/(^|\.)(?:x\.com|twitter\.com)$/.test(site.hostname)&&(
  /\/(?:i\/flow\/login|i\/jf\/onboarding\/web)(?:\/|$)/i.test(site.pathname)||
  site.pathname==='/'&&/(?:email or username|continue with phone)/i.test(screen.text||'')&&screen.elements?.some(e=>e.tag==='input'&&['text','email','tel'].includes(e.type||'text'))
 ))return {reason:'X hisobiga kirish kerak. Login, parol va tasdiqlashni o‘zingiz kiriting.'};
 if(/\/(?:login|signin|sign-in|signup|sign-up|oauth|authorize|verify|challenge)(?:\/|$)/i.test(new URL(url==='about:blank'?'https://example.invalid':url).pathname))return {reason:'Hisobga kirish yoki tasdiqlash kerak.'};
 if(screen.elements?.some(e=>e.type==='password'||/one-time-code|cc-number|cc-csc/.test(e.autocomplete||'')))return {reason:'Parol, tasdiqlash kodi yoki shaxsiy ma’lumotni o‘zingiz kiriting.'};
 return null;
}
const protectedPath=/(?:^|\/)(?:billing|payments?|checkout|subscriptions?|tokens?|security|oauth|authorize|password|invitations?|members|transfer|protection|firewall|domains?|delete|remove|destroy|refund|withdraw|payout)(?:\/|$)/i;
// A form submit grants one ordinary write to the page's own origin while that
// exact browser action is running. The grant never follows a cross-site action
// URL or grants account/payment changes.
export function ordinaryFormWriteAllowed({mode,formWrite},request,runActive){
 if(mode!=='agent'||!runActive||!formWrite||formWrite.remaining!==1||Date.now()>formWrite.expiresAt)return false;
 const url=new URL(request.url);
 return url.origin===formWrite.origin&&['POST','PUT','PATCH'].includes(request.method)&&!protectedPath.test(url.pathname);
}
export function browserWriteAllowed({mode,manualUntil,manualOrigin,deploymentRun},request,runActive){
 const u=new URL(request.url),origin=u.origin;
 if(mode==='user'&&Date.now()<manualUntil){
  if(origin===manualOrigin)return true;
  let source='';try{source=new URL(manualOrigin).hostname;}catch{}
  if(source&&(u.hostname.endsWith('.'+source)||source.endsWith('.'+u.hostname)))return true;
  if(['x.com','twitter.com'].includes(source)&&['x.com','twitter.com','api.x.com','api.twitter.com'].includes(u.hostname))return true;
  const loginOrigins=new Set(['https://vercel.com','https://api.vercel.com','https://github.com','https://api.github.com','https://accounts.google.com','https://oauth2.googleapis.com']);
  if(loginOrigins.has(manualOrigin)&&loginOrigins.has(origin))return true;
 }
 if(mode!=='agent'||!deploymentRun||!runActive||!['https://vercel.com','https://api.vercel.com'].includes(origin))return false;
 if(request.method==='DELETE'||protectedPath.test(u.pathname))return false;
 // Known deploy APIs only; unknown mutations still ask the owner once per request.
 return request.method==='POST'&&/^\/(?:api\/)?(?:v\d+\/)?(?:deployments|files|projects)(?:\/|$)/.test(u.pathname);
}
