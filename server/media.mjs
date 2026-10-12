import {z} from 'zod';
import {HttpError,id,now,guardedFetch,redact} from './security.mjs';
import {imageModels,imageRequest,imageOutput,supportsMedia} from './image-media.mjs';
import {videoModels,videoRequest,videoOutput,retrieveVideo} from './gemini-video.mjs';
import {mediaRetryAt} from './media-retry.mjs';
export const mediaModels = {...Object.fromEntries(imageModels.map(m=>[m,'image'])),...Object.fromEntries(videoModels.map(m=>[m,'video'])),'mimo-v2.5-tts':'speech','mimo-v2.5-tts-voicedesign':'voice-design','mimo-v2.5-tts-voiceclone':'voice-clone','mimo-v2.5-asr':'transcription'};
export function mediaPayload(value,asset) {
  const {model,text,style,voice,language}=value;
  const payload={model,stream:false,messages:[]};
  if(model==='mimo-v2.5-asr') {payload.messages=[{role:'user',content:[{type:'input_audio',input_audio:{data:`data:${asset.mime};base64,${asset.bytes.toString('base64')}`}}]}];payload.asr_options={language};}
  else {payload.messages=[{role:'user',content:style||''},{role:'assistant',content:text}];payload.audio={format:'wav'};if(model==='mimo-v2.5-tts')payload.audio.voice=voice;if(model==='mimo-v2.5-tts-voiceclone')payload.audio.voice=`data:${asset.mime};base64,${asset.bytes.toString('base64')}`;}
  return payload;
}
export async function boundedBody(response,max) { const reader=response.body?.getReader();if(!reader)throw new Error('Provider bo‘sh javob qaytardi.');const chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new Error('Media javobi hajm chegarasidan oshdi.');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}return Buffer.concat(chunks).toString('utf8');}
export function mediaService(app,{store,runner,library,config,parse}) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS media_jobs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,provider_id TEXT NOT NULL,model TEXT NOT NULL,prompt TEXT NOT NULL,status TEXT NOT NULL,asset_id TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,request_key));`);
  if(!store.all('PRAGMA table_info(media_jobs)').some(column=>column.name==='interaction_id'))store.db.exec('ALTER TABLE media_jobs ADD COLUMN interaction_id TEXT');
  if(!store.all('PRAGMA table_info(media_jobs)').some(column=>column.name==='phase'))store.db.exec('ALTER TABLE media_jobs ADD COLUMN phase TEXT');
  if(!store.all('PRAGMA table_info(media_jobs)').some(column=>column.name==='deleted_at'))store.db.exec('ALTER TABLE media_jobs ADD COLUMN deleted_at TEXT');
  if(!store.all('PRAGMA table_info(media_jobs)').some(column=>column.name==='request_json'))store.db.exec('ALTER TABLE media_jobs ADD COLUMN request_json TEXT');
  if(!store.all('PRAGMA table_info(media_jobs)').some(column=>column.name==='retry_at'))store.db.exec('ALTER TABLE media_jobs ADD COLUMN retry_at TEXT');
  if(!store.all('PRAGMA table_info(media_jobs)').some(column=>column.name==='attempts'))store.db.exec('ALTER TABLE media_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
  store.db.exec('CREATE TABLE IF NOT EXISTS media_cooldowns(provider_id TEXT NOT NULL,model TEXT NOT NULL,retry_at TEXT NOT NULL,PRIMARY KEY(provider_id,model))');
  store.exec("UPDATE media_jobs SET status='interrupted',error='Server qayta ishga tushdi. Avtomatik qayta so‘rov yuborilmadi.' WHERE status='running'");
  // Recover a provider's most recent quota deadline, including a 429 from the previous release.
  for(const row of store.all("SELECT provider_id,model,error,updated_at FROM media_jobs WHERE status='failed' AND error LIKE 'Media API HTTP 429:%' ORDER BY updated_at DESC LIMIT 20")) {
    if(!videoModels.includes(row.model))continue;
    const retryAt=mediaRetryAt(row.error,null,Date.parse(row.updated_at));
    if(Date.parse(retryAt)>Date.now())store.exec('INSERT INTO media_cooldowns(provider_id,model,retry_at) VALUES(?,?,?) ON CONFLICT(provider_id,model) DO UPDATE SET retry_at=MAX(retry_at,excluded.retry_at)',row.provider_id,row.model,retryAt);
  }
  const active=new Map();const pending=new Set();
  const schema=z.object({requestKey:z.string().uuid(),providerId:z.string().min(1).max(80),model:z.enum(Object.keys(mediaModels)),text:z.string().trim().max(4000).default(''),style:z.string().trim().max(1200).default(''),voice:z.enum(['mimo_default','Mia','Chloe','Milo','Dean','冰糖','茉莉','苏打','白桦']).default('mimo_default'),language:z.enum(['auto','en','zh']).default('auto'),assetId:z.string().max(80).optional(),previousJobId:z.string().max(80).optional(),operation:z.enum(['auto','edit','extend']).default('auto'),aspectRatio:z.enum(['1:1','16:9','9:16','4:3','3:4']).default('1:1'),resolution:z.enum(['360p','720p','1080p','4k']).default('720p'),consent:z.boolean().default(false)});
  function execute(jobId,userId,v,runId=null,queueOnRateLimit=false) {
    const controller=new AbortController();active.set(jobId,controller);
    const task=(async()=>{let provider;try{
      const job=store.one('SELECT status FROM media_jobs WHERE id=?',jobId);if(job?.status!=='running')return;
      const user=store.one('SELECT * FROM users WHERE id=? AND disabled=0',userId);if(!user)throw new Error('Hisob faol emas.');
      provider=runner.providerFor(v.providerId,v.model,userId);
      const isImage=imageModels.includes(v.model),isVideo=videoModels.includes(v.model);
      const asset=v.assetId?library.get(userId,v.assetId):undefined;
      const previous=v.previousJobId?store.one("SELECT interaction_id FROM media_jobs WHERE id=? AND user_id=? AND provider_id=? AND model=? AND status='completed' AND deleted_at IS NULL",v.previousJobId,userId,provider.id,v.model):undefined;
      if(v.previousJobId&&!previous?.interaction_id)throw new Error('Oldingi video davom ettirish ma’lumoti topilmadi.');
      store.exec('UPDATE media_jobs SET attempts=attempts+1,retry_at=NULL,phase=?,error=NULL,updated_at=? WHERE id=?',isVideo?'requesting':null,now(),jobId);
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(isVideo?900_000:180_000)]);
      const response=await guardedFetch(isImage?`${provider.base_url}/models/${encodeURIComponent(v.model)}:generateContent`:isVideo?`${provider.base_url}/interactions`:`${provider.base_url}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',...(provider.key?(isImage||isVideo?{'x-goog-api-key':provider.key}:{Authorization:`Bearer ${provider.key}`}):{})},body:JSON.stringify(isImage?imageRequest(v,asset):isVideo?videoRequest(v,asset,previous?.interaction_id):mediaPayload(v,asset)),signal,redirect:'error'},{allowLocal:config.localAuth});
      const raw=await boundedBody(response,response.ok?(isVideo?65_000_000:14_000_000):16000);
      if(!response.ok) {
        if(isVideo&&response.status===429&&queueOnRateLimit&&!controller.signal.aborted&&store.one('SELECT attempts FROM media_jobs WHERE id=?',jobId).attempts<3){
          const retryAt=mediaRetryAt(raw,response.headers.get('retry-after'));
          store.exec('INSERT INTO media_cooldowns(provider_id,model,retry_at) VALUES(?,?,?) ON CONFLICT(provider_id,model) DO UPDATE SET retry_at=MAX(retry_at,excluded.retry_at)',provider.id,v.model,retryAt);
          store.exec("UPDATE media_jobs SET status='queued',retry_at=?,phase=NULL,error='Google kunlik video limiti tugadi. Belgilangan vaqtda avtomatik davom ettiriladi.',updated_at=? WHERE id=? AND status='running'",retryAt,now(),jobId);
          return;
        }
        throw new Error(`Media API HTTP ${response.status}: ${redact(raw,[provider.key])}`);
      }
      const body=JSON.parse(raw);store.usage({id:runId,user_id:userId},provider,v.model,'media_studio',isImage?{prompt_tokens:body.usageMetadata?.promptTokenCount,completion_tokens:body.usageMetadata?.candidatesTokenCount}:isVideo?{prompt_tokens:body.usage?.input_tokens,completion_tokens:body.usage?.output_tokens}:body.usage);
      controller.signal.throwIfAborted();if(!store.one('SELECT id FROM users WHERE id=? AND disabled=0',userId))throw new Error('Hisob faol emas.');
      const message=body.choices?.[0]?.message;let bytes,name;
      if(isImage){const output=imageOutput(body);bytes=output.bytes;name=`rasm-${jobId.slice(-8)}.${output.extension}`;}
      else if(isVideo){const output=videoOutput(body);store.exec('UPDATE media_jobs SET phase=? WHERE id=?','processing',jobId);bytes=await retrieveVideo(provider,output,signal,{allowLocal:config.localAuth,onPhase:phase=>store.exec('UPDATE media_jobs SET phase=? WHERE id=?',phase,jobId)});name=`video-${jobId.slice(-8)}.mp4`;store.exec('UPDATE media_jobs SET interaction_id=? WHERE id=?',output.interactionId,jobId);}
      else if(v.model==='mimo-v2.5-asr'){if(typeof message?.content!=='string'||!message.content.trim())throw new Error('Transkripsiya bo‘sh qaytdi.');bytes=Buffer.from(message.content);name=`transkript-${jobId.slice(-8)}.txt`;}
      else{const data=message?.audio?.data;if(typeof data!=='string'||data.length>13_333_336)throw new Error('Provider audio fayl qaytarmadi.');bytes=Buffer.from(data,'base64');if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw new Error('Provider haqiqiy WAV audio qaytarmadi.');name=`ovoz-${jobId.slice(-8)}.wav`;}
      const saved=library.add(userId,name,bytes,'Media',`media:${jobId}`);
      store.exec("UPDATE media_jobs SET status='completed',asset_id=?,updated_at=? WHERE id=?",saved.id,now(),jobId);
    }catch(e){store.exec("UPDATE media_jobs SET status=?,error=?,updated_at=? WHERE id=? AND status='running'",controller.signal.aborted?'cancelled':'failed',redact(e.message,[provider?.key]),now(),jobId);}finally{active.delete(jobId);}})();pending.add(task);void task.finally(()=>pending.delete(task));
  }
  app.get('/api/media/models',(req,res)=>res.json(store.all('SELECT id,label,models,protocol FROM providers WHERE enabled=1').flatMap(p=>JSON.parse(p.models).filter(m=>supportsMedia(p,m,mediaModels)&&(config.videoApiEnabled||mediaModels[m]!=='video')).map(model=>({providerId:p.id,provider:p.label,model,kind:mediaModels[model]})))));
  app.get('/api/media/jobs',(req,res)=>res.json(store.all('SELECT * FROM media_jobs WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100',req.user.id)));
  function start(user,body,runId=null,queueOnRateLimit=false) {
    const v=parse(schema,body);
    if(videoModels.includes(v.model)&&!config.videoApiEnabled)throw new HttpError(403,'Video API o‘chirilgan. Google Flow hisobingizda video yarating; Gemini API balansi ishlatilmaydi.');
    const prior=store.one('SELECT * FROM media_jobs WHERE user_id=? AND request_key=?',user.id,v.requestKey);if(prior)return prior;
    const provider=runner.providerFor(v.providerId,v.model,user.id);if(provider.protocol==='chatgpt-plan')throw new HttpError(400,'ChatGPT plan media API bermaydi.');
    const isImage=imageModels.includes(v.model),isVideo=videoModels.includes(v.model);if(!supportsMedia(provider,v.model,mediaModels))throw new HttpError(400,'Model uchun mos media protokoli ulanmagan.');
    if(isVideo&&!provider.key)throw new HttpError(400,'Gemini video uchun Google API kaliti kerak.');
    if(isVideo&&!['16:9','9:16'].includes(v.aspectRatio))throw new HttpError(400,'Video uchun 16:9 yoki 9:16 nisbatini tanlang.');
    if(v.previousJobId){if(!isVideo||(v.assetId&&v.operation!=='extend'))throw new HttpError(400,'Tahrirlashda alohida manba fayl tanlamang.');const previous=store.one("SELECT * FROM media_jobs WHERE id=? AND user_id=? AND provider_id=? AND model=? AND status='completed' AND deleted_at IS NULL",v.previousJobId,user.id,provider.id,v.model);if(!previous?.interaction_id)throw new HttpError(400,'Bu videoni davom ettirish ma’lumoti topilmadi.');}
    const used=store.one("SELECT COALESCE(SUM(input_tokens+output_tokens),0) n FROM usage WHERE user_id=? AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now')",user.id).n;
    if(user.token_limit!==-1 && used>=user.token_limit)throw new HttpError(429,'Oylik token chegarasiga yetildi.');
    if(active.size>=2 || store.one("SELECT id FROM media_jobs WHERE user_id=? AND status='running'",user.id))throw new HttpError(429,'Faol media vazifasi tugashini kuting.');
    let asset; if(['mimo-v2.5-asr','mimo-v2.5-tts-voiceclone'].includes(v.model)){asset=library.get(user.id,v.assetId);if(!['audio/mpeg','audio/wav'].includes(asset.mime)||asset.size>7_000_000)throw new HttpError(400,'7 MB gacha WAV yoki MP3 tanlang.');}
    if(isImage && v.assetId){asset=library.get(user.id,v.assetId);if(!['image/png','image/jpeg','image/webp'].includes(asset.mime)||asset.size>4_000_000)throw new HttpError(400,'4 MB gacha PNG, JPEG yoki WebP tanlang.');}
    if(isVideo && v.assetId){asset=library.get(user.id,v.assetId);if(!['image/png','image/jpeg','image/webp','video/mp4'].includes(asset.mime)||asset.size>(asset.mime==='video/mp4'?10_000_000:4_000_000))throw new HttpError(400,'Video uchun 10 MB gacha MP4 yoki 4 MB gacha rasm tanlang.');if(asset.mime==='video/mp4'&&(asset.bytes.length<12||asset.bytes.toString('ascii',4,8)!=='ftyp'))throw new HttpError(400,'Manba MP4 fayl formati mos emas.');}
    if(v.previousJobId&&asset?.mime==='video/mp4')throw new HttpError(400,'Oldingi video bilan yana MP4 yuklamang; bitta video va ixtiyoriy reference rasm tanlang.');
    if(v.operation==='extend'&&!v.previousJobId&&asset?.mime!=='video/mp4')throw new HttpError(400,'Davom ettirish uchun tayyor video yoki MP4 manba tanlang.');
    if(v.model!=='mimo-v2.5-asr' && !v.text)throw new HttpError(400,'O‘qiladigan matnni kiriting.');
    if(v.model==='mimo-v2.5-tts-voicedesign' && !v.style)throw new HttpError(400,'Yangi ovoz tavsifini kiriting.');
    if(v.model==='mimo-v2.5-tts-voiceclone' && !v.consent)throw new HttpError(400,'Ovoz egasining roziligi kerak.');
    const cooldown=queueOnRateLimit&&isVideo?store.one('SELECT retry_at FROM media_cooldowns WHERE provider_id=? AND model=?',provider.id,v.model):null;
    const retryAt=cooldown&&Date.parse(cooldown.retry_at)>Date.now()?cooldown.retry_at:null;
    const jobId=id('media_');
    store.exec("INSERT INTO media_jobs(id,user_id,request_key,provider_id,model,prompt,status,asset_id,error,created_at,updated_at,request_json,retry_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",jobId,user.id,v.requestKey,provider.id,v.model,v.text||'Audio transkripsiyasi',retryAt?'queued':'running',null,retryAt?'Google kunlik video limiti tugadi. Belgilangan vaqtda avtomatik davom ettiriladi.':null,now(),now(),queueOnRateLimit?JSON.stringify(v):null,retryAt);
    if(!retryAt)execute(jobId,user.id,v,runId,queueOnRateLimit);
    return store.one('SELECT * FROM media_jobs WHERE id=?',jobId);
  }
  app.post('/api/media/jobs',(req,res)=>res.status(201).json(start(req.user,req.body,null,true)));
  const resumeQueued=()=>{
    if(!config.videoApiEnabled||active.size>=2)return;
    const rows=store.all("SELECT id,user_id,provider_id,model,request_json,retry_at FROM media_jobs WHERE status='queued' AND deleted_at IS NULL AND retry_at<=? ORDER BY retry_at LIMIT 2",now());
    for(const row of rows){
      if(active.size>=2)break;
      if(store.one("SELECT id FROM media_jobs WHERE user_id=? AND status='running'",row.user_id))continue;
      const cooldown=store.one('SELECT retry_at FROM media_cooldowns WHERE provider_id=? AND model=?',row.provider_id,row.model);
      if(cooldown&&Date.parse(cooldown.retry_at)>Date.now()){store.exec('UPDATE media_jobs SET retry_at=? WHERE id=?',cooldown.retry_at,row.id);continue;}
      const claimed=store.exec("UPDATE media_jobs SET status='running',updated_at=? WHERE id=? AND status='queued'",now(),row.id);
      if(claimed.changes)execute(row.id,row.user_id,JSON.parse(row.request_json),null,true);
    }
  };
  const retryTimer=setInterval(resumeQueued,config.mediaRetryIntervalMs||30_000);retryTimer.unref();

  app.post('/api/media/jobs/:jobId/cancel',(req,res)=>{const job=store.one('SELECT * FROM media_jobs WHERE id=? AND user_id=?',req.params.jobId,req.user.id);if(!job)throw new HttpError(404,'Media vazifasi topilmadi.');if(job.status==='running'||job.status==='queued'){store.exec("UPDATE media_jobs SET status='cancelled',retry_at=NULL,updated_at=? WHERE id=?",now(),job.id);active.get(job.id)?.abort();}res.json({ok:true});});
  app.delete('/api/media/jobs/:jobId',(req,res)=>{
    const job=store.one('SELECT * FROM media_jobs WHERE id=? AND user_id=? AND deleted_at IS NULL',req.params.jobId,req.user.id);
    if(!job)throw new HttpError(404,'Media vazifasi topilmadi.');
    if(job.status==='running'||active.has(job.id))throw new HttpError(409,'Avval yaratilayotgan mediani to‘xtating.');
    const stories=store.all('SELECT media_job_id,media_job_ids FROM video_story_jobs WHERE user_id=? AND deleted_at IS NULL',req.user.id);
    if(stories.some(row=>row.media_job_id===job.id||JSON.parse(row.media_job_ids||'[]').includes(job.id)))throw new HttpError(409,'Bu video avtomatik loyiha tarkibida. Avval o‘sha videoni o‘chiring.');
    store.db.exec('BEGIN IMMEDIATE');
    try{store.exec('UPDATE media_jobs SET deleted_at=? WHERE id=?',now(),job.id);library.trash(req.user.id,job.asset_id);store.db.exec('COMMIT');}
    catch(error){store.db.exec('ROLLBACK');throw error;}
    res.json({ok:true});
  });
  return {start, async wait(jobId,signal) {
    const abort=()=>active.get(jobId)?.abort();signal?.addEventListener('abort',abort,{once:true});
    try {while(true){signal?.throwIfAborted();const job=store.one('SELECT * FROM media_jobs WHERE id=?',jobId);if(job.status!=='running'){if(job.status!=='completed')throw new Error(job.error||'Media vazifasi tugallanmadi.');const asset=library.get(job.user_id,job.asset_id);return {jobId,assetId:asset.id,name:asset.name,mime:asset.mime,download:`/api/library/${asset.id}/content`};}await new Promise(resolve=>setTimeout(resolve,200));}}finally{signal?.removeEventListener('abort',abort);}
  }, async close(){clearInterval(retryTimer);for(const controller of active.values())controller.abort();await Promise.allSettled([...pending]);}};
}
