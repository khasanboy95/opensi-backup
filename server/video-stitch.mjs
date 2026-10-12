import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,rm,writeFile,stat,statfs} from 'node:fs/promises';
import {z} from 'zod';
import {HttpError,id,now} from './security.mjs';

const exec=promisify(execFile);
const overlap=.35;
const maxClips=16;
const maxDuration=480;
const maxInputBytes=1_000_000_000;
const metadata='id,user_id,status,phase,asset_id,error,duration,created_at,updated_at';

function seconds(value){return Number(Number(value).toFixed(3));}
export function timeline(durations,limit=30){
 if(!Number.isFinite(limit)||limit<1.5||limit>maxDuration)throw new HttpError(400,'Video davomiyligi noto‘g‘ri.');
 if(durations.length<2||durations.length>maxClips||durations.some(n=>!Number.isFinite(n)||n<1.5||n>maxDuration+.2))throw new HttpError(400,'2–16 ta, har biri 1.5–480 soniyalik MP4 tanlang.');
 let used=durations.map(seconds);
 let total=used.reduce((sum,n)=>sum+n,0)-overlap*(used.length-1);
 if(total>limit){used[used.length-1]=seconds(used.at(-1)-(total-limit));total=limit;}
 if(used.at(-1)<1.5)throw new HttpError(400,`Tanlangan kliplar ${limit} soniyaga sig‘madi. Oxirgi klip ham ko‘rinishi uchun manbalarni qisqartiring.`);
 return {durations:used,duration:seconds(total),overlap};
}

export function editedTimeline(durations,edits,transition='fade',limit=30){
 if(!Array.isArray(edits)||edits.length!==durations.length||edits.length<1||edits.length>maxClips||!['fade','cut'].includes(transition))throw new HttpError(400,'Montaj kliplari yoki o‘tish turi noto‘g‘ri.');
 const starts=[],used=[];
 for(let i=0;i<edits.length;i++){
  const source=durations[i],start=Number(edits[i]?.start),end=Number(edits[i]?.end);
  if(!Number.isFinite(source)||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>source+.15||end-start<1.5)throw new HttpError(400,`${i+1}-klip kesimi 1.5 soniyadan kam yoki manbadan tashqarida.`);
  starts.push(seconds(start));used.push(seconds(Math.min(end,source)-start));
 }
 const blend=transition==='cut'?0:overlap;
 const overlaps=edits.map((edit,i)=>i===0?0:seconds(edit.overlap===undefined?blend:Number(edit.overlap)));
 if(edits[0]?.overlap!==undefined&&Number(edits[0].overlap)!==0)throw new HttpError(400,'Birinchi klip oldingi klip bilan ustma-ust qo‘yilmaydi.');
 for(let i=1;i<overlaps.length;i++){
  const amount=overlaps[i];
  if(!Number.isFinite(amount)||amount<0||amount>2||amount>used[i]-.25||amount+overlaps[i-1]>used[i-1]-.25)throw new HttpError(400,`${i+1}-klipning ustma-ust qismi haddan tashqari uzun.`);
 }
 const total=seconds(used.reduce((sum,n)=>sum+n,0)-overlaps.reduce((sum,n)=>sum+n,0));
 if(total>limit+.06)throw new HttpError(400,`Qo‘lda tanlangan kesimlar ${limit} soniyadan oshdi. Kesimlarni qisqartiring.`);
 return {starts,durations:used,duration:total,overlap:blend,overlaps,transition};
}

function normalizeSize(width,height){
 const factor=Math.min(1,1280/width,1280/height);
 const w=Math.max(2,Math.round(width*factor/2)*2),h=Math.max(2,Math.round(height*factor/2)*2);
 return {width:w,height:h};
}

export function filterGraph(clips,plan){
 const {width,height}=normalizeSize(clips[0].width,clips[0].height);
 const parts=[];
 clips.forEach((clip,i)=>{
  const duration=plan.durations[i],start=plan.starts?.[i]||0;
  parts.push(`[${i}:v:0]trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS,fps=24,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p,settb=AVTB[v${i}]`);
  parts.push(clip.audio&&!plan.mutes?.[i]?`[${i}:a:0]atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${duration},atrim=duration=${duration}[a${i}]`:`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${i}]`);
 });
 if(clips.length===1)return {graph:parts.join(';'),video:'[v0]',audio:'[a0]',width,height};
 const overlaps=clips.map((_,i)=>i===0?0:(plan.overlaps?.[i]??plan.overlap??0));
 if(overlaps.every(amount=>amount===0)){
  parts.push(`${clips.map((_,i)=>`[v${i}][a${i}]`).join('')}concat=n=${clips.length}:v=1:a=1[vout][aout]`);
  return {graph:parts.join(';'),video:'[vout]',audio:'[aout]',width,height};
 }
 let elapsed=plan.durations[0];
 for(let i=1;i<clips.length;i++){
  const vIn=i===1?'v0':`vx${i-1}`,aIn=i===1?'a0':`ax${i-1}`;
  const amount=overlaps[i];
  if(amount>0){
   parts.push(`[${vIn}][v${i}]xfade=transition=fade:duration=${amount}:offset=${seconds(elapsed-amount)}[vx${i}]`);
   parts.push(`[${aIn}][a${i}]acrossfade=d=${amount}:c1=tri:c2=tri[ax${i}]`);
  }else parts.push(`[${vIn}][${aIn}][v${i}][a${i}]concat=n=2:v=1:a=1[vx${i}][ax${i}]`);
  elapsed+=plan.durations[i]-amount;
 }
 return {graph:parts.join(';'),video:`[vx${clips.length-1}]`,audio:`[ax${clips.length-1}]`,width,height};
}

async function probe(file){
 let result;
 try{result=await exec('ffprobe',['-v','error','-protocol_whitelist','file','-show_entries','format=duration:stream=codec_type,width,height','-of','json',file],{timeout:15_000,maxBuffer:262_144,windowsHide:true});}
 catch{throw new HttpError(400,'MP4 o‘qilmadi. Faylni qayta yuklang.');}
 let info;try{info=JSON.parse(result.stdout);}catch{throw new HttpError(400,'MP4 ma’lumoti o‘qilmadi.');}
 const video=info.streams?.find(stream=>stream.codec_type==='video');
 const duration=Number(info.format?.duration);
 if(!video||!Number.isFinite(duration)||duration<1.5||duration>maxDuration+.2||!video.width||!video.height||video.width>4096||video.height>4096)throw new HttpError(400,'Har bir manbada 1.5–480 soniyalik video bo‘lishi kerak.');
 return {duration,width:video.width,height:video.height,audio:info.streams.some(stream=>stream.codec_type==='audio')};
}

export function videoStitchService(app,{store,library,config,parse}){
 store.db.exec(`CREATE TABLE IF NOT EXISTS video_stitch_jobs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,status TEXT NOT NULL,phase TEXT NOT NULL,asset_id TEXT,error TEXT,duration REAL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,request_key));`);
 if(!store.all('PRAGMA table_info(video_stitch_jobs)').some(column=>column.name==='deleted_at'))store.db.exec('ALTER TABLE video_stitch_jobs ADD COLUMN deleted_at TEXT');
 store.exec("UPDATE video_stitch_jobs SET status='interrupted',error='Server qayta ishga tushdi. Manba videolar kutubxonada saqlangan.' WHERE status='running'");
 const active=new Map(),pending=new Set();
 const publicJob=(user,jobId)=>store.one(`SELECT ${metadata} FROM video_stitch_jobs WHERE id=? AND user_id=?`,jobId,user);
 app.get('/api/video-stitch/jobs',(req,res)=>res.json(store.all(`SELECT ${metadata} FROM video_stitch_jobs WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 30`,req.user.id)));
 function start(user,body){
  const value=parse(z.object({requestKey:z.string().uuid(),assetIds:z.array(z.string().min(1).max(80)).min(1).max(maxClips),mode:z.enum(['automatic','manual']).default('automatic'),transition:z.enum(['fade','cut']).default('fade'),maxSeconds:z.number().finite().min(2).max(maxDuration).default(30),edits:z.array(z.object({start:z.number().finite().min(0),end:z.number().finite().positive(),mute:z.boolean().default(false),overlap:z.number().finite().min(0).max(2).optional()})).max(maxClips).optional()}),body);
  if(value.mode==='automatic'&&value.assetIds.length<2)throw new HttpError(400,'Avtomatik birlashtirish uchun kamida 2 ta klip tanlang.');
  if(value.mode==='manual'&&value.edits?.length!==value.assetIds.length)throw new HttpError(400,'Har bir klip uchun boshlanish va tugash vaqtini kiriting.');
  const previous=store.one('SELECT id FROM video_stitch_jobs WHERE user_id=? AND request_key=?',user.id,value.requestKey);
  if(previous)return publicJob(user.id,previous.id);
  if(value.mode==='automatic'&&new Set(value.assetIds).size!==value.assetIds.length)throw new HttpError(400,'Avtomatik rejimda bir videoni ikki marta tanlamang.');
  if(active.size>=1||store.one("SELECT id FROM video_stitch_jobs WHERE user_id=? AND status='running'",user.id))throw new HttpError(429,'Video birlashtirish tugashini kuting.');
  const assets=value.assetIds.map(assetId=>library.get(user.id,assetId));
  if(assets.some(asset=>asset.mime!=='video/mp4')||[...new Map(assets.map(asset=>[asset.id,asset])).values()].reduce((sum,asset)=>sum+asset.size,0)>maxInputBytes||assets.some(asset=>asset.size>250_000_000))throw new HttpError(413,'16 tagacha MP4 tanlang: jami 1 GB, har biri 250 MB gacha.');
  const jobId=id('stitch_'),controller=new AbortController(),userId=user.id;
  store.exec("INSERT INTO video_stitch_jobs(id,user_id,request_key,status,phase,asset_id,error,duration,created_at,updated_at) VALUES(?,?,?,'running','checking',NULL,NULL,NULL,?,?)",jobId,userId,value.requestKey,now(),now());
  active.set(jobId,controller);
  const task=(async()=>{
   const directory=path.join(config.dataDir,'stitch-temp',jobId),output=path.join(directory,'result.mp4');
   try{
    await mkdir(directory,{recursive:true});
    const free=await statfs(directory);
    if(free.bavail*free.bsize<350_000_000)throw new HttpError(507,'Server diskida video tayyorlash uchun joy yetarli emas.');
    const files=[],copied=new Map();
    for(let i=0;i<assets.length;i++){
     controller.signal.throwIfAborted();
     const target=copied.get(assets[i].id)||assets[i].file_path||path.join(directory,`source-${i}.mp4`);
     if(!copied.has(assets[i].id)&&!assets[i].file_path)await library.copy(assets[i],target);
     copied.set(assets[i].id,target);
     files.push(target);
    }
    const clips=[],probed=new Map();for(const file of files){controller.signal.throwIfAborted();if(!probed.has(file))probed.set(file,await probe(file));clips.push(probed.get(file));}
    const plan=value.mode==='manual'?editedTimeline(clips.map(clip=>clip.duration),value.edits,value.transition,value.maxSeconds):timeline(clips.map(clip=>clip.duration),value.maxSeconds);
    if(value.mode==='manual')plan.mutes=value.edits.map(edit=>edit.mute);
    const filter=filterGraph(clips,plan);
    store.exec('UPDATE video_stitch_jobs SET phase=?,duration=?,updated_at=? WHERE id=?','rendering',plan.duration,now(),jobId);
    const args=['-hide_banner','-nostdin','-loglevel','error','-y','-protocol_whitelist','file','-filter_complex_threads','1'];
    for(const file of files)args.push('-i',file);
    args.push('-filter_complex',filter.graph,'-map',filter.video,'-map',filter.audio,'-t',String(value.maxSeconds),'-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-threads','2','-c:a','aac','-b:a','128k','-movflags','+faststart',output);
    try{await exec('ffmpeg',args,{timeout:600_000,maxBuffer:262_144,windowsHide:true,signal:controller.signal});}
    catch(error){if(controller.signal.aborted)throw error;throw new Error('Video montaji bajarilmadi. Manba MP4larni tekshiring yoki qisqaroq kliplar tanlang.');}
    controller.signal.throwIfAborted();
    const verified=await probe(output),file=await stat(output);
    if(verified.duration>value.maxSeconds+.06||verified.duration<1.5||file.size>250_000_000)throw new Error('Yakuniy video davomiylik yoki 250 MB chegarasidan oshdi.');
    store.exec('UPDATE video_stitch_jobs SET phase=?,updated_at=? WHERE id=?','saving',now(),jobId);
    const saved=await library.addFile(userId,`video-montaj-${jobId.slice(-8)}.mp4`,output,file.size,'Media',`stitch:${jobId}`);
    store.exec("UPDATE video_stitch_jobs SET status='completed',phase='ready',asset_id=?,duration=?,updated_at=? WHERE id=?",saved.id,verified.duration,now(),jobId);
   }catch(error){store.exec("UPDATE video_stitch_jobs SET status=?,phase='done',error=?,updated_at=? WHERE id=? AND status='running'",controller.signal.aborted?'cancelled':'failed',error instanceof HttpError?error.message:controller.signal.aborted?'Video to‘xtatildi.':error.message||'Video tayyorlanmadi.',now(),jobId);}
   finally{active.delete(jobId);await rm(directory,{recursive:true,force:true});}
  })();pending.add(task);void task.finally(()=>pending.delete(task));
  return publicJob(userId,jobId);
 }
 app.post('/api/video-stitch/jobs',(req,res)=>res.status(201).json(start(req.user,req.body)));
 app.post('/api/video-stitch/jobs/:jobId/cancel',(req,res)=>{
  const job=publicJob(req.user.id,req.params.jobId);if(!job)throw new HttpError(404,'Video vazifasi topilmadi.');
  if(job.status==='running'){store.exec("UPDATE video_stitch_jobs SET status='cancelled',phase='done',updated_at=? WHERE id=?",now(),job.id);active.get(job.id)?.abort();}
  res.json({ok:true});
 });
 app.delete('/api/video-stitch/jobs/:jobId',(req,res)=>{
  const job=store.one('SELECT * FROM video_stitch_jobs WHERE id=? AND user_id=? AND deleted_at IS NULL',req.params.jobId,req.user.id);
  if(!job)throw new HttpError(404,'Montaj vazifasi topilmadi.');
  if(job.status==='running'||active.has(job.id))throw new HttpError(409,'Avval ishlayotgan montajni to‘xtating.');
  if(store.one('SELECT id FROM video_story_jobs WHERE user_id=? AND stitch_job_id=? AND deleted_at IS NULL',req.user.id,job.id))throw new HttpError(409,'Bu montaj avtomatik video tarkibida. Avval o‘sha videoni o‘chiring.');
  store.db.exec('BEGIN IMMEDIATE');
  try{store.exec('UPDATE video_stitch_jobs SET deleted_at=? WHERE id=?',now(),job.id);library.trash(req.user.id,job.asset_id);store.db.exec('COMMIT');}
  catch(error){store.db.exec('ROLLBACK');throw error;}
  res.json({ok:true});
 });
 return {start,async wait(jobId,signal){
  const abort=()=>active.get(jobId)?.abort();signal?.addEventListener('abort',abort,{once:true});
  try{while(true){signal?.throwIfAborted();const job=store.one('SELECT * FROM video_stitch_jobs WHERE id=?',jobId);if(!job)throw new Error('Montaj vazifasi topilmadi.');if(job.status!=='running'){if(job.status!=='completed')throw new Error(job.error||'Montaj tugallanmadi.');return {jobId,assetId:job.asset_id,duration:job.duration};}await new Promise(resolve=>setTimeout(resolve,300));}}
  finally{signal?.removeEventListener('abort',abort);}
 },async close(){for(const controller of active.values())controller.abort();await Promise.allSettled([...pending]);}};
}
