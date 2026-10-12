import {setTimeout as delay} from 'node:timers/promises';
import {guardedFetch,redact} from './security.mjs';

export const videoModels=['gemini-omni-1.1-flash'];
const maxVideoBytes=48_000_000;

export function videoRequest(value,asset,previousInteractionId) {
  const extending=value.operation==='extend';
  const prompt=[extending?'Extend the previous video seamlessly by up to 10 seconds. Keep the same characters, faces, clothing, setting, visual style, motion and audio unless the new scene explicitly changes them. If an image is supplied, use <IMAGE_REF_0> as the character and style reference, not as a replacement for the previous video.':null,value.text,value.style].filter(Boolean).join('\n\n');
  let input=prompt;
  if(asset?.mime==='video/mp4')input=[{type:'video',mime_type:asset.mime,data:asset.bytes.toString('base64')},{type:'text',text:prompt}];
  else if(asset)input=[{type:'image',mime_type:asset.mime,data:asset.bytes.toString('base64')},{type:'text',text:prompt}];
  // Gemini Omni infers extension from the prompt and the previous interaction or source video.
  // Explicit video_config.task imposes a different input contract and rejects multi-turn text.
  return {model:value.model,input,store:true,background:false,stream:false,response_format:{type:'video',aspect_ratio:value.aspectRatio==='9:16'?'9:16':'16:9',resolution:value.resolution||'720p',delivery:'uri'},...(previousInteractionId?{previous_interaction_id:previousInteractionId}:{})};
}

export function videoOutput(body) {
  const output=body.output_video||body.steps?.filter(step=>step.type==='model_output').flatMap(step=>step.content||[]).find(item=>item.type==='video'&&item.mime_type==='video/mp4');
  if(body.status==='failed'||!output)throw new Error(`Google video qaytarmadi: ${body.error?.message||body.status||'bo‘sh javob'}`);
  return {data:output.data,uri:output.uri,interactionId:typeof body.id==='string'?body.id:null};
}

async function readBytes(response,max=maxVideoBytes) {
  const reader=response.body?.getReader();if(!reader)throw new Error('Google video fayli bo‘sh qaytdi.');
  const chunks=[];let size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new Error('Google video fayli 48 MB chegaradan oshdi.');chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  return Buffer.concat(chunks);
}

function ensureMp4(bytes) {if(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp')throw new Error('Google haqiqiy MP4 video qaytarmadi.');return bytes;}

export async function retrieveVideo(provider,output,signal,{allowLocal=false,pollInterval=5000,onPhase=()=>{}}={}) {
  if(typeof output.data==='string'){
    if(output.data.length>Math.ceil(maxVideoBytes*4/3)+8||!/^[A-Za-z0-9+/]+={0,2}$/.test(output.data))throw new Error('Google video ma’lumoti noto‘g‘ri yoki juda katta.');
    return ensureMp4(Buffer.from(output.data,'base64'));
  }
  if(typeof output.uri!=='string')throw new Error('Google video manzili qaytmadi.');
  const base=new URL(provider.base_url);
  let filePath;
  if(/^files\/[A-Za-z0-9_-]+$/.test(output.uri))filePath=output.uri;
  else {
    let url;try{url=new URL(output.uri);}catch{throw new Error('Google video manzili noto‘g‘ri.');}
    if((url.protocol!=='https:'&&!allowLocal)||url.origin!==base.origin||!url.pathname.startsWith(`${base.pathname.replace(/\/$/,'')}/files/`))throw new Error('Google video manzili API manziliga mos emas.');
    filePath=url.pathname;
  }
  const match=filePath.match(/(?:^|\/)files\/([A-Za-z0-9_-]+)(?::download)?$/);
  if(!match)throw new Error('Google video fayl identifikatori noto‘g‘ri.');
  const fileId=match[1];const root=provider.base_url.replace(/\/$/,'');
  const headers=provider.key?{'x-goog-api-key':provider.key}:{};
  for(let attempt=0;attempt<120;attempt++){
    signal.throwIfAborted();
    const response=await guardedFetch(`${root}/files/${fileId}`,{headers,signal,redirect:'error'},{allowLocal});
    const raw=await response.text();if(!response.ok)throw new Error(`Google fayl holati HTTP ${response.status}: ${redact(raw,[provider.key])}`);
    const state=JSON.parse(raw).state;
    if(state==='ACTIVE')break;
    if(state==='FAILED')throw new Error('Google video ishlovi muvaffaqiyatsiz tugadi.');
    if(attempt===119)throw new Error('Google video ishlovi 10 daqiqada tugamadi.');
    await delay(pollInterval,undefined,{signal});
  }
  onPhase('downloading');
  let response=await guardedFetch(`${root}/files/${fileId}:download?alt=media`,{headers,signal,redirect:'manual'},{allowLocal});
  if([301,302,303,307,308].includes(response.status)){
    const location=response.headers.get('location');let target;try{target=new URL(location);}catch{throw new Error('Google video yuklab olish yo‘nalishi noto‘g‘ri.');}
    if(target.protocol!=='https:'||!(/(^|\.)googleusercontent\.com$/.test(target.hostname)||target.hostname==='storage.googleapis.com'))throw new Error('Google video boshqa manzilga yo‘naltirildi.');
    response=await guardedFetch(target,{signal,redirect:'error'},{allowLocal:false});
  }
  if(!response.ok){const raw=(await response.text()).slice(0,2000);throw new Error(`Google video yuklab olinmadi (HTTP ${response.status}): ${redact(raw,[provider.key])}`);}
  return ensureMp4(await readBytes(response));
}
