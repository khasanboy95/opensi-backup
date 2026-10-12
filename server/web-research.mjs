const decode = value => String(value).replace(/&(#(?:x[0-9a-f]+|\d+)|amp|quot|apos|lt|gt|nbsp);/gi,(_match,entity)=>{
  if(entity[0]==='#'){
    const code=entity[1]?.toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);
    return Number.isInteger(code)&&code>0&&code<=0x10ffff?String.fromCodePoint(code):' ';
  }
  return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[entity.toLowerCase()]||' ';
});

export function readableWebPage(html,baseUrl){
  const safe=String(html).replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ');
  const links=[],seen=new Set();
  for(const match of safe.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)){
    const href=match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if(!href)continue;
    let url;try{url=new URL(decode(href[1]??href[2]??href[3]),baseUrl);}
    catch{continue;}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)continue;
    url.hash='';const value=url.toString();if(seen.has(value))continue;
    seen.add(value);
    const title=decode(match[2].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()).slice(0,180);
    links.push({url:value,title});if(links.length>=2000)break;
  }
  const text=decode(safe.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()).slice(0,20000);
  const posts=links.filter(link=>/\/(?:status)\/\d{5,25}(?:\?|$)/.test(link.url));
  return {text,links:[...posts,...links.filter(link=>!posts.includes(link))].slice(0,120)};
}

export function xNewsRequirement(prompt){
  const value=String(prompt||'');
  if(!/(?:\bx\.com\b|\btwitter\b|\bx\s*(?:platform|tarmoq))/i.test(value)||!/(yangili|news|post|xabar|tweet)/i.test(value))return null;
  const quantity=value.match(/\b(\d{1,2})\s*(?:ta\b|(?:(?:AI|suniy|sun'iy|new|latest)\s+){0,3}(?:yangili|news|post|tweet))/i);
  return {count:Math.min(30,Math.max(1,Number(quantity?.[1]||1)))};
}

export function observedXPosts(messages){
  const calls=new Map(messages.flatMap(message=>(message.tool_calls||[]).map(call=>[call.id,call.function?.name])));
  const urls=new Set();
  const add=value=>{
    if(typeof value!=='string')return;
    for(const match of value.matchAll(/https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,30}\/status\/\d{5,25}(?:\?[^\s"'<>]*)?/gi)){
      try{const url=new URL(match[0]);urls.add(url.origin+url.pathname);}catch{/* Ignore malformed external links. */}
    }
  };
  for(const message of messages){
    if(message.role!=='tool'||!['http_get','computer_capture','computer_explore','computer_observe','computer_action'].includes(calls.get(message.tool_call_id)))continue;
    let result;try{result=JSON.parse(message.content);}catch{continue;}
    if(result?.error||result?.loginRequired||result?.handoffRequired)continue;
    add(result?.text);
    for(const link of result?.links||[])add(link?.url||link);
    for(const frame of result?.frames||[])for(const link of frame?.design?.links||[])add(link?.url||link);
  }
  return [...urls];
}
