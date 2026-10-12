// The sandbox stays offline. Only bounded public HTTPS requests cross this broker.
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';

export function blockedAddress(value) {
 const a=value.toLowerCase();
 if(isIP(a)===6)return a.startsWith('::')||/^(fc|fd|fe[89ab]|ff)/.test(a);
 if(isIP(a)!==4)return true;
 const p=a.split('.').map(Number);
 return p[0]===0||p[0]===10||p[0]===127||p[0]>=224||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&(p[1]===168||p[1]===0))||(p[0]===100&&p[1]>=64&&p[1]<=127);
}
export function egressUrl(input) {
 const u=new URL(input);
 if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||u.href.length>8192)throw Error('Only public HTTPS on port 443 is supported');
 const host=u.hostname.replace(/^\[|\]$/g,'');
 if(host==='localhost'||host.endsWith('.local')||host.endsWith('.localhost')||(isIP(host)&&blockedAddress(host)))throw Error('Private network access denied');
 return u;
}
export async function publicRequest(input,signal) {
 let url=egressUrl(input.url),method=String(input.method||'GET').toUpperCase();
 if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(method))throw Error('Unsupported HTTP method');
 let body=Buffer.from(input.body||'','base64');if(body.length>128000)throw Error('Request body too large');
 let headers=Object.fromEntries(Object.entries(input.headers||{}).filter(([k])=>!['host','connection','content-length','transfer-encoding','proxy-authorization','proxy-connection','accept-encoding'].includes(k.toLowerCase())));
 if(Buffer.byteLength(JSON.stringify(headers))>16000)throw Error('Headers too large');
 headers['accept-encoding']='identity';
 const bounded=signal?AbortSignal.any([signal,AbortSignal.timeout(9000)]):AbortSignal.timeout(9000);
 for(let redirects=0;redirects<5;redirects++){
  const result=await new Promise((resolve,reject)=>{
   const req=https.request(url,{method,headers,signal:bounded,lookup(host,options,cb){
    lookup(host,{all:true}).then(list=>{if(!list.length||list.some(a=>blockedAddress(a.address)))throw Error('Private network access denied');const matches=options.family?list.filter(a=>a.family===options.family):list;if(!matches.length)throw Error('Address unavailable');if(options.all)cb(null,matches);else cb(null,matches[0].address,matches[0].family);}).catch(cb);
   }},res=>{
    let size=0;const chunks=[];res.on('data',c=>{size+=c.length;if(size>2000000){res.destroy(Error('Response too large'));return;}chunks.push(c);});
    res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('base64'),url:url.href}));
   });req.on('error',reject);req.end(body.length?body:undefined);
  });
  if(![301,302,303,307,308].includes(result.status)||!result.headers.location)return result;
  if(input.redirect==='error')throw Error('Redirect refused');if(input.redirect==='manual')return result;
  const next=egressUrl(new URL(result.headers.location,url).href);
  if(next.origin!==url.origin)headers=Object.fromEntries(Object.entries(headers).filter(([k])=>!['authorization','cookie'].includes(k.toLowerCase())));
  if(result.status===303||([301,302].includes(result.status)&&method==='POST')){method='GET';body=Buffer.alloc(0);}
  url=next;
 }
 throw Error('Too many redirects');
}
