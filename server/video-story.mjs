import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {HttpError,id,now} from './security.mjs';

const wordsPerScene=20;
const maxScenes=48;
const scenesPerAssembly=12;
const maxStorySeconds=480;
const continuousWordsPerScene=20;
const maxContinuousScenes=3;

export function storyGroups(assetIds){
 if(assetIds.length<=16)return [assetIds];
 const groups=[];
 for(let index=0;index<assetIds.length;index+=scenesPerAssembly)groups.push(assetIds.slice(index,index+scenesPerAssembly));
 return groups;
}

export function storyPlan(script){
 const words=String(script||'').trim().split(/\s+/u).filter(Boolean);
 if(!words.length)throw new HttpError(400,'Video ssenariysini kiriting.');
 if(words.length>wordsPerScene*maxScenes)throw new HttpError(400,`Bir montajda ko‘pi bilan ${wordsPerScene*maxScenes} so‘z (${maxScenes} sahna) mumkin. Uzun matnni qismlarga ajrating.`);
 const scenes=[];
 for(let i=0;i<words.length;i+=wordsPerScene)scenes.push(words.slice(i,i+wordsPerScene).join(' '));
 return {scenes,words:words.length,estimatedSeconds:Number((scenes.length*8-Math.max(0,scenes.length-1)*.35).toFixed(1))};
}

export function continuousPlan(script,editedScenes){
 let scenes;
 if(editedScenes){
  if(!Array.isArray(editedScenes)||editedScenes.length<1||editedScenes.length>maxContinuousScenes||editedScenes.some(scene=>typeof scene!=='string'||!scene.trim()||scene.length>1200))throw new HttpError(400,'Davomiy video uchun 1–3 ta to‘ldirilgan sahna kiriting.');
  scenes=editedScenes.map(scene=>scene.trim());
 }else{
  const words=String(script||'').trim().split(/\s+/u).filter(Boolean);
  if(!words.length)throw new HttpError(400,'Video ssenariysini kiriting.');
  if(words.length>continuousWordsPerScene*maxContinuousScenes)throw new HttpError(400,'30 soniyalik davomiy video uchun 60 tagacha so‘z kiriting yoki uzun montaj rejimini tanlang.');
  const sentences=String(script).trim().split(/(?<=[.!?])\s+|\n+/u).map(item=>item.trim()).filter(Boolean);
  const grouped=[];let current='',count=0;
  for(const sentence of sentences){
   const length=sentence.split(/\s+/u).filter(Boolean).length;
   if(count&&count+length>continuousWordsPerScene){grouped.push(current);current='';count=0;}
   current=[current,sentence].filter(Boolean).join(' ');count+=length;
  }
  if(current)grouped.push(current);
  scenes=grouped.length<=maxContinuousScenes&&grouped.every(scene=>scene.split(/\s+/u).length<=continuousWordsPerScene)?grouped:[];
  if(!scenes.length)for(let index=0;index<words.length;index+=continuousWordsPerScene)scenes.push(words.slice(index,index+continuousWordsPerScene).join(' '));
 }
 return {scenes,words:scenes.join(' ').split(/\s+/u).filter(Boolean).length,estimatedSeconds:scenes.length*10};
}

export function videoStoryService(app,{store,media,stitch,library,config,parse}){
 store.db.exec(`CREATE TABLE IF NOT EXISTS video_story_jobs(
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,
 provider_id TEXT NOT NULL,model TEXT NOT NULL,script TEXT NOT NULL,style TEXT NOT NULL,
 reference_asset_id TEXT,aspect_ratio TEXT NOT NULL,resolution TEXT NOT NULL,
 scenes TEXT NOT NULL,asset_ids TEXT NOT NULL,status TEXT NOT NULL,phase TEXT NOT NULL,
 media_job_id TEXT,stitch_job_id TEXT,asset_id TEXT,error TEXT,assembly_asset_ids TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,request_key));`);
 if(!store.db.prepare('PRAGMA table_info(video_story_jobs)').all().some(column=>column.name==='assembly_asset_ids'))store.db.exec("ALTER TABLE video_story_jobs ADD COLUMN assembly_asset_ids TEXT NOT NULL DEFAULT '[]'");
 if(!store.db.prepare('PRAGMA table_info(video_story_jobs)').all().some(column=>column.name==='mode'))store.db.exec("ALTER TABLE video_story_jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'montage'");
 if(!store.db.prepare('PRAGMA table_info(video_story_jobs)').all().some(column=>column.name==='media_job_ids'))store.db.exec("ALTER TABLE video_story_jobs ADD COLUMN media_job_ids TEXT NOT NULL DEFAULT '[]'");
 if(!store.db.prepare('PRAGMA table_info(video_story_jobs)').all().some(column=>column.name==='deleted_at'))store.db.exec('ALTER TABLE video_story_jobs ADD COLUMN deleted_at TEXT');
 store.exec("UPDATE video_story_jobs SET status='interrupted',phase='interrupted',error='Server yangilandi. Tayyor sahnalar saqlandi; Davom ettirishni bosing.' WHERE status='running'");
 const active=new Map(),pending=new Set();let closing=false;
 const publicJob=row=>row&&({id:row.id,status:row.status,phase:row.phase,mode:row.mode,providerId:row.provider_id,model:row.model,scenes:JSON.parse(row.scenes).length,completedScenes:JSON.parse(row.asset_ids).length,assetIds:JSON.parse(row.asset_ids),mediaJobIds:JSON.parse(row.media_job_ids),assetId:row.asset_id,error:row.error,estimatedSeconds:row.mode==='continuous'?JSON.parse(row.scenes).length*10:storyPlan(row.script).estimatedSeconds,createdAt:row.created_at});
 const get=(userId,jobId)=>{const row=store.one('SELECT * FROM video_story_jobs WHERE id=? AND user_id=? AND deleted_at IS NULL',jobId,userId);if(!row)throw new HttpError(404,'Video vazifasi topilmadi.');return row;};
 async function available(start,signal){
  for(let i=0;i<900;i++){
   signal.throwIfAborted();
   try{return start();}catch(error){if(error.status!==429)throw error;await delay(1000,undefined,{signal});}
  }
  throw new Error('Media xizmatida navbat vaqti tugadi. Tayyor sahnalar saqlandi.');
 }
 function launch(row){
  const controller=new AbortController();active.set(row.id,controller);
  const task=(async()=>{
   const scenes=JSON.parse(row.scenes),assetIds=JSON.parse(row.asset_ids),mediaJobIds=JSON.parse(row.media_job_ids),continuous=row.mode==='continuous',signal=controller.signal;
   try{
    for(let index=assetIds.length;index<scenes.length;index++){
     signal.throwIfAborted();
     const current=store.one('SELECT media_job_id FROM video_story_jobs WHERE id=?',row.id);
     let result=current.media_job_id&&store.one('SELECT * FROM media_jobs WHERE id=? AND user_id=?',current.media_job_id,row.user_id);
     if(result?.status==='completed'&&result.asset_id){library.get(row.user_id,result.asset_id);assetIds.push(result.asset_id);mediaJobIds.push(result.id);store.exec('UPDATE video_story_jobs SET asset_ids=?,media_job_ids=?,media_job_id=NULL,updated_at=? WHERE id=?',JSON.stringify(assetIds),JSON.stringify(mediaJobIds),now(),row.id);continue;}
     const previousJobId=continuous&&index>0?mediaJobIds[index-1]:undefined;
     if(continuous&&index>0&&!previousJobId)throw new Error('Oldingi sahna video zanjiri topilmadi. Saqlangan sahnalarni tekshiring.');
     const prompt=continuous?`${index+1}/${scenes.length}-sahna, taxminan 10 soniya. ${index?'Oldingi videoni davom ettiring. O‘sha qahramonlar, yuz, kiyim, fon, yorug‘lik, kamera harakati va ovozni saqlang. Yangi kadr oldingi video oxiridan tabiiy davom etsin.':'Birinchi kadrni yarating. Qahramon, kiyim va sahna uslubini keyingi qismlar uchun aniq saqlang.'} ${row.reference_asset_id?'Reference rasmdagi ayni qahramon va uslubni saqlang.':''} Voqea va dialog: ${scenes[index]}`:`${index+1}/${scenes.length}-sahna. Quyidagi matn mazmunini video va ovoz bilan aks ettiring; oldingi sahnalar bilan obraz, rang, yoritish va kadr uslubi izchil bo‘lsin. Matn: ${scenes[index]}`;
     result=await available(()=>media.start(store.one('SELECT * FROM users WHERE id=?',row.user_id), {requestKey:randomUUID(),providerId:row.provider_id,model:row.model,text:prompt,style:row.style,assetId:continuous&&index>0?undefined:row.reference_asset_id||undefined,previousJobId,operation:previousJobId?'extend':'auto',aspectRatio:row.aspect_ratio,resolution:row.resolution}),signal);
     store.exec('UPDATE video_story_jobs SET media_job_id=?,phase=?,updated_at=? WHERE id=?',result.id,`scene:${index+1}/${scenes.length}`,now(),row.id);
     const clip=await media.wait(result.id,signal);
     assetIds.push(clip.assetId);mediaJobIds.push(result.id);
     store.exec('UPDATE video_story_jobs SET asset_ids=?,media_job_ids=?,media_job_id=NULL,updated_at=? WHERE id=?',JSON.stringify(assetIds),JSON.stringify(mediaJobIds),now(),row.id);
    }
    if(continuous){store.exec("UPDATE video_story_jobs SET status='completed',phase='ready',asset_id=?,error=NULL,updated_at=? WHERE id=?",assetIds.at(-1),now(),row.id);return;}
    if(assetIds.length===1){store.exec("UPDATE video_story_jobs SET status='completed',phase='ready',asset_id=?,error=NULL,updated_at=? WHERE id=?",assetIds[0],now(),row.id);return;}
    store.exec('UPDATE video_story_jobs SET phase=?,updated_at=? WHERE id=?','stitching',now(),row.id);
    const groups=storyGroups(assetIds);
    const priorFinal=store.one('SELECT stitch_job_id FROM video_story_jobs WHERE id=?',row.id).stitch_job_id;
    if(priorFinal){const completed=store.one('SELECT status,asset_id FROM video_stitch_jobs WHERE id=?',priorFinal);if(completed?.status==='completed'&&completed.asset_id){store.exec("UPDATE video_story_jobs SET status='completed',phase='ready',asset_id=?,error=NULL,updated_at=? WHERE id=?",completed.asset_id,now(),row.id);return;}}
    let finalAssets=assetIds;
    if(groups.length>1){
     const assembled=JSON.parse(store.one('SELECT assembly_asset_ids FROM video_story_jobs WHERE id=?',row.id).assembly_asset_ids);
     for(let groupIndex=assembled.length;groupIndex<groups.length;groupIndex++){
      signal.throwIfAborted();
      const group=groups[groupIndex];
      if(group.length===1){assembled.push(group[0]);}
      else{
       store.exec('UPDATE video_story_jobs SET phase=?,updated_at=? WHERE id=?',`montage:${groupIndex+1}/${groups.length}`,now(),row.id);
       const part=await available(()=>stitch.start({id:row.user_id},{requestKey:randomUUID(),assetIds:group,mode:'automatic',maxSeconds:maxStorySeconds}),signal);
       assembled.push((await stitch.wait(part.id,signal)).assetId);
      }
      store.exec('UPDATE video_story_jobs SET assembly_asset_ids=?,updated_at=? WHERE id=?',JSON.stringify(assembled),now(),row.id);
     }
     finalAssets=assembled;
    }
    let stitched=store.one('SELECT stitch_job_id FROM video_story_jobs WHERE id=?',row.id).stitch_job_id;
    if(!stitched||store.one('SELECT status FROM video_stitch_jobs WHERE id=?',stitched)?.status!=='completed'){
     const job=await available(()=>stitch.start({id:row.user_id},{requestKey:randomUUID(),assetIds:finalAssets,mode:'automatic',maxSeconds:maxStorySeconds}),signal);
     stitched=job.id;store.exec('UPDATE video_story_jobs SET stitch_job_id=?,updated_at=? WHERE id=?',stitched,now(),row.id);
    }
    const output=await stitch.wait(stitched,signal);
    store.exec("UPDATE video_story_jobs SET status='completed',phase='ready',asset_id=?,error=NULL,updated_at=? WHERE id=?",output.assetId,now(),row.id);
   }catch(error){store.exec('UPDATE video_story_jobs SET status=?,phase=?,error=?,updated_at=? WHERE id=?',closing?'interrupted':signal.aborted?'cancelled':'failed',closing?'interrupted':'done',String(error.message||error).slice(0,1500),now(),row.id);}
   finally{active.delete(row.id);}
  })();pending.add(task);void task.finally(()=>pending.delete(task));
 }
 const schema=z.object({requestKey:z.string().uuid(),providerId:z.string().min(1).max(80),model:z.string().min(1).max(100),script:z.string().trim().max(10000).default(''),scenes:z.array(z.string()).max(3).optional(),mode:z.enum(['montage','continuous']).default('montage'),style:z.string().trim().max(1000).default(''),referenceAssetId:z.string().max(80).optional(),aspectRatio:z.enum(['16:9','9:16']).default('16:9'),resolution:z.enum(['360p','720p','1080p','4k']).default('720p')}).strict();
 app.get('/api/video-story/jobs',(req,res)=>res.json(store.all('SELECT * FROM video_story_jobs WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 30',req.user.id).map(publicJob)));
 app.post('/api/video-story/jobs',(req,res)=>{
  if(!config.videoApiEnabled)throw new HttpError(403,'Avtomatik video API o‘chirilgan. Videoni Google Flow hisobida yarating.');
  const value=parse(schema,req.body),plan=value.mode==='continuous'?continuousPlan(value.script,value.scenes):storyPlan(value.script);
  const previous=store.one('SELECT * FROM video_story_jobs WHERE user_id=? AND request_key=?',req.user.id,value.requestKey);if(previous)return res.json(publicJob(previous));
  if(store.one("SELECT id FROM video_story_jobs WHERE user_id=? AND status='running'",req.user.id))throw new HttpError(429,'Avvalgi video ssenariysi hali tayyorlanmoqda.');
  if(value.referenceAssetId){const asset=library.get(req.user.id,value.referenceAssetId);if(!['image/png','image/jpeg','image/webp'].includes(asset.mime)||asset.size>4_000_000)throw new HttpError(400,'Reference rasm PNG/JPEG/WebP va 4 MB gacha bo‘lsin.');}
  const jobId=id('story_'),time=now();
  store.exec("INSERT INTO video_story_jobs(id,user_id,request_key,provider_id,model,script,style,reference_asset_id,aspect_ratio,resolution,scenes,asset_ids,status,phase,media_job_id,stitch_job_id,asset_id,error,assembly_asset_ids,mode,media_job_ids,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'[]','running','starting',NULL,NULL,NULL,NULL,'[]',?,'[]',?,?)",jobId,req.user.id,value.requestKey,value.providerId,value.model,value.script||plan.scenes.join(' '),value.style,value.referenceAssetId||null,value.aspectRatio,value.resolution,JSON.stringify(plan.scenes),value.mode,time,time);
  const row=get(req.user.id,jobId);launch(row);res.status(201).json(publicJob(row));
 });
 app.post('/api/video-story/jobs/:jobId/resume',(req,res)=>{
  if(!config.videoApiEnabled)throw new HttpError(403,'Video API o‘chirilgan; bu vazifani API orqali davom ettirib bo‘lmaydi.');
  const row=get(req.user.id,req.params.jobId);
  if(!['failed','interrupted'].includes(row.status))throw new HttpError(409,'Faqat uzilgan yoki xato video davom ettiriladi.');
  if(store.one("SELECT id FROM video_story_jobs WHERE user_id=? AND status='running'",req.user.id))throw new HttpError(429,'Boshqa video ssenariysi bajarilmoqda.');
  store.exec("UPDATE video_story_jobs SET status='running',phase='resuming',error=NULL,updated_at=? WHERE id=?",now(),row.id);
  launch(get(req.user.id,row.id));res.json(publicJob(get(req.user.id,row.id)));
 });
 app.post('/api/video-story/jobs/:jobId/cancel',(req,res)=>{
  const row=get(req.user.id,req.params.jobId);
  if(row.status==='running'){active.get(row.id)?.abort();store.exec("UPDATE video_story_jobs SET status='cancelled',phase='done',updated_at=? WHERE id=?",now(),row.id);}
  res.json({ok:true});
 });
 app.delete('/api/video-story/jobs/:jobId',(req,res)=>{
  const row=get(req.user.id,req.params.jobId);
  if(row.status==='running'||active.has(row.id))throw new HttpError(409,'Avval yaratilayotgan videoni to‘xtating.');
  const mediaIds=[...new Set([row.media_job_id,...JSON.parse(row.media_job_ids||'[]')].filter(Boolean))];
  const stitchIds=[...new Set([row.stitch_job_id].filter(Boolean))];
  const childJobs=mediaIds.map(jobId=>store.one('SELECT status FROM media_jobs WHERE id=? AND user_id=?',jobId,req.user.id)).filter(Boolean);
  const stitchJobs=stitchIds.map(jobId=>store.one('SELECT status FROM video_stitch_jobs WHERE id=? AND user_id=?',jobId,req.user.id)).filter(Boolean);
  if([...childJobs,...stitchJobs].some(job=>job.status==='running'))throw new HttpError(409,'Video qismlari hali yaratilmoqda. To‘xtab tugashini kuting.');
  const assetIds=new Set([row.asset_id,...JSON.parse(row.asset_ids||'[]'),...JSON.parse(row.assembly_asset_ids||'[]')].filter(Boolean));
  store.db.exec('BEGIN IMMEDIATE');
  try{
   const stamp=now();store.exec('UPDATE video_story_jobs SET deleted_at=? WHERE id=?',stamp,row.id);
   for(const jobId of mediaIds){const child=store.one('SELECT asset_id FROM media_jobs WHERE id=? AND user_id=?',jobId,req.user.id);if(child?.asset_id)assetIds.add(child.asset_id);store.exec('UPDATE media_jobs SET deleted_at=? WHERE id=? AND user_id=?',stamp,jobId,req.user.id);}
   for(const jobId of stitchIds){const child=store.one('SELECT asset_id FROM video_stitch_jobs WHERE id=? AND user_id=?',jobId,req.user.id);if(child?.asset_id)assetIds.add(child.asset_id);store.exec('UPDATE video_stitch_jobs SET deleted_at=? WHERE id=? AND user_id=?',stamp,jobId,req.user.id);}
   for(const assetId of assetIds)library.trash(req.user.id,assetId);
   store.db.exec('COMMIT');
  }catch(error){store.db.exec('ROLLBACK');throw error;}
  res.json({ok:true});
 });
 return {async close(){closing=true;for(const controller of active.values())controller.abort();await Promise.allSettled([...pending]);}};
}
