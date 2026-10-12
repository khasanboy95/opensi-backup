import {publicFetch} from './security.mjs';
import {XMLParser} from 'fast-xml-parser';

export function captionSegments(raw){
 let rows=[];
 try{const value=JSON.parse(raw);rows=(value.events||[]).map(e=>({seconds:(e.tStartMs||0)/1000,text:(e.segs||[]).map(s=>s.utf8||'').join('')}));}catch{
  if(/^\s*</.test(raw)&&!/<!(?:DOCTYPE|ENTITY)/i.test(raw)){const xml=new XMLParser({ignoreAttributes:false,parseTagValue:false,trimValues:false}).parse(raw);const text=xml.transcript?.text;const parts=Array.isArray(text)?text:text?[text]:[];rows=parts.map(p=>({seconds:Number(p['@_start']||0),text:typeof p==='string'?p:String(p['#text']||'')}));}
  else if(raw.trimStart().startsWith('WEBVTT')){rows=raw.split(/\r?\n\r?\n/).flatMap(block=>{const lines=block.split(/\r?\n/),i=lines.findIndex(l=>l.includes('-->'));if(i<0)return [];const parts=lines[i].split('-->')[0].trim().split(':').map(Number);return [{seconds:parts.reduce((n,p)=>n*60+p,0),text:lines.slice(i+1).join(' ').replace(/<[^>]*>/g,'')}];});}
 }
 let size=0;return rows.flatMap(r=>{const text=r.text.trim().slice(0,Math.min(4000,60000-size));if(!text||size>=60000||!Number.isFinite(r.seconds))return [];size+=text.length;return [{seconds:r.seconds,text}];});
}

export function youtubeId(value){
 const u=new URL(value),host=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('Ochiq HTTPS YouTube manzili kerak.');
 const id=host==='youtu.be'?u.pathname.slice(1).split('/')[0]:['youtube.com','www.youtube.com','m.youtube.com'].includes(host)?u.searchParams.get('v')||u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1]:null;
 if(!/^[\w-]{11}$/.test(id||''))throw Error('YouTube video manzili noto‘g‘ri.');return id;
}
export function playerData(html){
 const marker=/ytInitialPlayerResponse\s*=\s*/g.exec(html);if(!marker)return null;
 const start=marker.index+marker[0].length;let depth=0,quoted=false,escaped=false;
 for(let i=start;i<html.length;i++){const c=html[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{return JSON.parse(html.slice(start,i+1));}catch{return null;}}}return null;
}
async function textResponse(url,signal,fetcher){const r=await fetcher(url,{signal,headers:{'user-agent':'Mozilla/5.0 (compatible; OpenSI/1.0)'}});if(!r.ok)throw Error('Manba HTTP '+r.status);let bytes=0;const chunks=[];for await(const c of r.body){bytes+=c.length;if(bytes>3000000){await r.body?.cancel().catch(()=>{});throw Error('Manba hajmi 3 MB dan katta.');}chunks.push(c);}return Buffer.concat(chunks).toString('utf8');}
export async function youtubeAnalyze({url,language='en'},signal,fetcher=publicFetch){
 const id=youtubeId(url),canonical='https://www.youtube.com/watch?v='+id;
 const bounded=signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000);
 const [embed,watch]=await Promise.allSettled([textResponse('https://www.youtube.com/oembed?format=json&url='+encodeURIComponent(canonical),bounded,fetcher),textResponse(canonical,bounded,fetcher)]);
 signal?.throwIfAborted();
 let info={};try{if(embed.status==='fulfilled')info=JSON.parse(embed.value);}catch{}
 const player=watch.status==='fulfilled'?playerData(watch.value):null,details=player?.videoDetails||{};
 const tracks=player?.captions?.playerCaptionsTracklistRenderer?.captionTracks||[];
 const result={source:'untrusted_youtube_content',url:canonical,videoId:id,title:details.title||info.title||null,author:details.author||info.author_name||null,description:(details.shortDescription||'').slice(0,12000),durationSeconds:details.lengthSeconds?Number(details.lengthSeconds):null,thumbnail:info.thumbnail_url||null,captions:tracks.map(t=>({language:t.languageCode,automatic:t.kind==='asr'})),transcript:[],limitations:[]};
 const selected=tracks.find(t=>t.languageCode===language)||tracks.find(t=>t.languageCode?.split('-')[0]===language.split('-')[0])||tracks[0];
 if(selected){for(const format of ['json3','srv1','vtt']){try{const target=new URL(selected.baseUrl);if(target.protocol!=='https:'||target.username||target.password||!['www.youtube.com','youtube.com'].includes(target.hostname)||target.pathname!=='/api/timedtext')break;target.searchParams.set('fmt',format);result.transcript=captionSegments(await textResponse(target.href,bounded,fetcher));if(result.transcript.length){result.captionFormat=format;break;}}catch{if(bounded.aborted)break;}}}
 signal?.throwIfAborted();
 if(!result.transcript.length)result.nextActions=['Use computer_observe/computer_action to open the public video and its Show transcript panel if offered. Do not bypass login or access restrictions.','If a video/audio file is attached, extract MP3 segments under 7 MB with FFmpeg, library_save each segment, use media_catalog to find a supported transcription model, then create_media and read the returned text. If no ASR model is available, report that capability gap instead of inventing a transcript.','If an SRT/VTT file is attached, parse that file directly. Installing a library does not create captions that the service has not supplied.'];
 if(!result.transcript.length)result.limitations.push('Video mazmuni transkripti olinmadi; faqat mavjud metadata asosida tahlil qiling. Video yoki subtitr faylini biriktirish mumkin.');
 if(!result.title)result.limitations.push('YouTube serveri ochiq ma’lumot bermadi; brauzer vositasi yoki foydalanuvchi bergan fayl kerak.');
 result.limitations.push('Video kadrlarini ko‘rish va audio transkripsiya bu metadata so‘rovida bajarilmagan.');return result;
}
