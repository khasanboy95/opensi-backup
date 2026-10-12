import {useEffect,useRef,useState} from 'react';
import {ArrowDown,ArrowLeft,ArrowRight,ArrowUp,Copy,Film,Pause,Play,Plus,Redo2,Scissors,Square,Trash2,Undo2,Volume2,VolumeX,ZoomIn,ZoomOut} from 'lucide-react';
import {api,dateTime} from '../api';
import {ErrorBox} from '../components/Ui';
import {takeMontageAssets} from '../montage-transfer';
import '../video-stitch.css';

type Clip={key:string;name:string;duration:number;start:number;end:number;mute:boolean;overlap:number;file?:File;assetId?:string};
type Asset={id:string;name:string;mime:string;size:number};
type Job={id:string;status:string;phase:string;asset_id:string|null;duration:number|null;error:string|null;created_at:string};
const maxBytes=1_000_000_000,maxClips=16,maxSeconds=480,minSegment=1.5;
const round=(value:number)=>Math.round(value*100)/100;
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
function overlapLimit(clips:Clip[],index:number){
 if(index<1)return 0;
 const previous=clips[index-1],current=clips[index];
 return Math.max(0,round(Math.min(2,previous.end-previous.start-(previous.overlap||0)-.25,current.end-current.start-.25)));
}
function normalizeOverlaps(clips:Clip[]):Clip[]{
 const result:Clip[]=[];
 for(const clip of clips){
  const index=result.length;
  result.push({...clip,overlap:index?round(clamp(Number.isFinite(clip.overlap)?clip.overlap:0,0,overlapLimit([...result,clip],index))):0});
 }
 return result;
}
const drafts=new Map<string,Clip[]>();
const draftKey=(userId:string)=>`opensi.montage.draft.${userId}`;
function draftFor(userId:string):Clip[]{
 const cached=drafts.get(userId);if(cached)return cached;
 let clips:Clip[]=[];
 try{
  const saved=JSON.parse(sessionStorage.getItem(draftKey(userId))||'[]');
  if(Array.isArray(saved))clips=normalizeOverlaps(saved.slice(0,maxClips).filter(row=>row&&typeof row.assetId==='string'&&typeof row.name==='string'&&Number.isFinite(row.duration)&&Number.isFinite(row.start)&&Number.isFinite(row.end)&&row.start>=0&&row.end>row.start&&row.end<=row.duration+.2).map(row=>({key:typeof row.key==='string'?row.key:crypto.randomUUID(),name:row.name,duration:row.duration,start:row.start,end:row.end,mute:row.mute===true,overlap:Number(row.overlap)||0,assetId:row.assetId})));
 }catch{/* A corrupt old draft does not block the editor. */}
 drafts.set(userId,clips);return clips;
}
function saveDraft(userId:string,clips:Clip[]){
 drafts.set(userId,clips);
 try{sessionStorage.setItem(draftKey(userId),JSON.stringify(clips.filter(clip=>clip.assetId).map(({key,name,duration,start,end,mute,overlap,assetId})=>({key,name,duration,start,end,mute,overlap,assetId}))));}catch{/* In-memory draft still survives page navigation. */}
}
function layout(clips:Clip[],mode:'automatic'|'manual',_transition:'fade'|'cut'){
 let at=0;
 return clips.map((clip,index)=>{const start=mode==='manual'?clip.start:0,end=mode==='manual'?clip.end:clip.duration;const overlap=index?(mode==='automatic'?.35:clip.overlap):0;const length=Math.max(0,end-start);at-=overlap;const row={clip,index,at,length,start,end,overlap};at+=length;return row;});
}

function durationOf(url:string):Promise<number>{
 return new Promise((resolve,reject)=>{
  const video=document.createElement('video');video.preload='metadata';
  const cleanup=()=>{video.removeAttribute('src');video.load();};
  video.onloadedmetadata=()=>{const value=video.duration;cleanup();Number.isFinite(value)?resolve(value):reject(new Error('Video davomiyligi aniqlanmadi.'));};
  video.onerror=()=>{cleanup();reject(new Error('MP4 brauzerda ochilmadi.'));};
  video.src=url;
 });
}

function upload(file:File,onProgress:(value:number)=>void):Promise<string>{
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open('POST','/api/uploads');xhr.timeout=30*60_000;
  xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.setRequestHeader('x-opensi-client','web');xhr.setRequestHeader('x-file-name',encodeURIComponent(file.name));
  xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.round(event.loaded/event.total*100));};
  xhr.onerror=()=>reject(new Error('Klipni yuklashda tarmoq uzildi.'));
  xhr.ontimeout=()=>reject(new Error('Klipni yuklash vaqti tugadi.'));
  xhr.onload=()=>{
   let result:{assetId?:string;error?:string}={};try{result=JSON.parse(xhr.responseText);}catch{/* HTTP error below */}
   if(xhr.status>=200&&xhr.status<300&&result.assetId)resolve(result.assetId);
   else reject(new Error(result.error||`MP4 yuklanmadi (${xhr.status}).`));
  };
  xhr.send(file);
 });
}

export function VideoStitch({userId,initialAssetId=''}:{userId:string;initialAssetId?:string}){
 const [clips,setClips]=useState<Clip[]>(()=>draftFor(userId)),[assets,setAssets]=useState<Asset[]>([]),[libraryPick,setLibraryPick]=useState('');
 const [librarySelection,setLibrarySelection]=useState<string[]>([]),[importing,setImporting]=useState(false);
 const [job,setJob]=useState<Job|null>(null),[jobs,setJobs]=useState<Job[]>([]),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState('');
 const [mode,setMode]=useState<'automatic'|'manual'>('manual'),[transition,setTransition]=useState<'fade'|'cut'>('cut'),[selectedKey,setSelectedKey]=useState('');
 const [playhead,setPlayhead]=useState(0),[playing,setPlaying]=useState(false),[zoom,setZoom]=useState(14),[previewUrl,setPreviewUrl]=useState('');
 const player=useRef<HTMLVideoElement>(null),pendingSeek=useRef<{key:string;time:number;autoplay:boolean}|null>(null),dragKey=useRef('');
 const clipsRef=useRef<Clip[]>(draftFor(userId)),history=useRef<{past:Clip[][];future:Clip[][]}>({past:[],future:[]});
 const queuedLibraryIds=useRef<string[]>([]),importingRef=useRef(false);
 const seenRoute=useRef('');
 const trimGesture=useRef<{origin:Clip[];key:string;side:'start'|'end';x:number;zoom:number}|null>(null);
 const overlapGesture=useRef<{origin:Clip[];key:string;x:number;zoom:number}|null>(null);
 const apply=(rows:Clip[])=>{clipsRef.current=rows;drafts.set(userId,rows);setClips(rows);};
 const commit=(rows:Clip[])=>{if(rows===clipsRef.current)return;const clean=normalizeOverlaps(rows);history.current.past.push(clipsRef.current);if(history.current.past.length>40)history.current.past.shift();history.current.future=[];apply(clean);saveDraft(userId,clean);};
 const undo=()=>{const previous=history.current.past.pop();if(!previous)return;history.current.future.push(clipsRef.current);apply(previous);saveDraft(userId,previous);setSelectedKey(key=>previous.some(row=>row.key===key)?key:previous[0]?.key||'');};
 const redo=()=>{const next=history.current.future.pop();if(!next)return;history.current.past.push(clipsRef.current);apply(next);saveDraft(userId,next);setSelectedKey(key=>next.some(row=>row.key===key)?key:next[0]?.key||'');};
 const refreshAssets=async()=>setAssets((await api<Asset[]>('/library')).filter(asset=>asset.mime==='video/mp4'));
 useEffect(()=>{
  let live=true;
  void Promise.all([api<Asset[]>('/library'),api<Job[]>('/video-stitch/jobs')]).then(([rows,items])=>{if(live){setAssets(rows.filter(a=>a.mime==='video/mp4'));setJobs(items);setJob(items.find(item=>item.status==='running')||items[0]||null);const activeIds=new Set(rows.map(row=>row.id));const valid=clipsRef.current.filter(clip=>!clip.assetId||activeIds.has(clip.assetId));if(valid.length!==clipsRef.current.length){apply(valid);saveDraft(userId,valid);}}}).catch(e=>{if(live)setError((e as Error).message);});
  return()=>{live=false;};
 },[]);
 useEffect(()=>{
  if(job?.status!=='running')return;
  const timer=window.setInterval(()=>{void api<Job[]>('/video-stitch/jobs').then(rows=>{setJobs(rows);setJob(rows.find(row=>row.id===job.id)||null);}).catch(e=>setError((e as Error).message));},2000);
  return()=>window.clearInterval(timer);
 },[job?.id,job?.status]);
 useEffect(()=>{if(job?.status==='completed')void refreshAssets();},[job?.id,job?.status]);
 const rows=layout(clips,mode,transition),total=rows.length?rows.at(-1)!.at+rows.at(-1)!.length:0,locked=busy||importing||job?.status==='running';
 const selected=clips.find(clip=>clip.key===selectedKey)||clips[0];
 const selectedIndex=selected?clips.findIndex(clip=>clip.key===selected.key):-1;
 const overlapPreset=clips.slice(1).every(clip=>clip.overlap===0)?'cut':clips.slice(1).every(clip=>Math.abs(clip.overlap-.35)<.01)?'fade':'custom';
 useEffect(()=>{if(!selected){setPreviewUrl('');return;}if(selected.file){const url=URL.createObjectURL(selected.file);setPreviewUrl(url);return()=>URL.revokeObjectURL(url);}setPreviewUrl(selected.assetId?`/api/library/${selected.assetId}/content?inline=true`:'');},[selected?.file,selected?.assetId]);
 useEffect(()=>{player.current?.pause();setPlaying(false);setPlayhead(0);const first=clipsRef.current[0];if(first){setSelectedKey(first.key);pendingSeek.current={key:first.key,time:mode==='manual'?first.start:0,autoplay:false};if(player.current?.readyState)player.current.currentTime=pendingSeek.current.time;}},[mode,transition]);
 const invalidTrim=mode==='manual'&&clips.some(clip=>!Number.isFinite(clip.start)||!Number.isFinite(clip.end)||clip.start<0||clip.end>clip.duration+.1||clip.end-clip.start<minSegment);
 const seenFiles=new Set<File>(),seenIds=new Set<string>();let totalBytes=0;
 for(const clip of clips){if(clip.assetId){if(!seenIds.has(clip.assetId)){seenIds.add(clip.assetId);totalBytes+=assets.find(asset=>asset.id===clip.assetId)?.size||clip.file?.size||0;}}else if(clip.file&&!seenFiles.has(clip.file)){seenFiles.add(clip.file);totalBytes+=clip.file.size;}}
 const addFiles=async(files:FileList|null)=>{
  if(!files?.length)return;
  setError('');
  if(clipsRef.current.length+files.length>maxClips){setError('Ko‘pi bilan 16 ta kesim tanlang.');return;}
  const added:Clip[]=[];
  try{
   for(const file of Array.from(files)){
    if((file.type!=='video/mp4'&&!file.name.toLowerCase().endsWith('.mp4'))||file.size>250_000_000||file.size===0)throw new Error('Har bir manba 250 MB gacha bo‘lgan MP4 bo‘lishi kerak.');
    const url=URL.createObjectURL(file);let duration:number;
    try{duration=await durationOf(url);}finally{URL.revokeObjectURL(url);}
    if(duration<minSegment||duration>maxSeconds+.2)throw new Error('Klip davomiyligi 1.5–480 soniya bo‘lishi kerak.');
    added.push({key:crypto.randomUUID(),name:file.name,duration,start:0,end:duration,mute:false,overlap:transition==='fade'?.35:0,file});
   }
   if(totalBytes+added.reduce((sum,item)=>sum+(item.file?.size||0),0)>maxBytes)throw new Error('Kliplar jami 1 GB dan oshmasligi kerak.');
   commit([...clipsRef.current,...added]);setSelectedKey(key=>key||added[0]?.key||'');
  }catch(e){setError((e as Error).message);}
 };
 const addLibraryAssets=async(ids:string[])=>{
  queuedLibraryIds.current.push(...ids.filter(Boolean));
  if(importingRef.current||busy||job?.status==='running'||!queuedLibraryIds.current.length)return;
  importingRef.current=true;setImporting(true);
  try{
   while(queuedLibraryIds.current.length){
    const batch=queuedLibraryIds.current.splice(0);
    try{
     const list=(await api<Asset[]>('/library')).filter(asset=>asset.mime==='video/mp4');setAssets(list);
     const next=[...clipsRef.current],usedIds=new Set(next.map(clip=>clip.assetId).filter((id):id is string=>Boolean(id))),usedFiles=new Set<File>();
     let bytes=next.reduce((sum,clip)=>{if(clip.assetId)return sum;if(clip.file&&!usedFiles.has(clip.file)){usedFiles.add(clip.file);return sum+clip.file.size;}return sum;},0);
     for(const id of usedIds)bytes+=list.find(asset=>asset.id===id)?.size||0;
     for(const id of batch){
      if(next.length>=maxClips)throw new Error(`Montajda ko‘pi bilan ${maxClips} ta kesim bo‘lishi mumkin.`);
      const asset=list.find(row=>row.id===id);if(!asset)throw new Error('Kutubxonada bu video topilmadi.');
      if(mode==='automatic'&&usedIds.has(id))throw new Error('Avtomatik rejimda bir videoni ikki marta tanlamang.');
      if(asset.size>250_000_000||(!usedIds.has(id)&&bytes+asset.size>maxBytes))throw new Error('Har bir klip 250 MB, jami 1 GB gacha bo‘lishi kerak.');
      const duration=await durationOf(`/api/library/${id}/content?inline=true`);
      if(duration<minSegment||duration>maxSeconds+.2)throw new Error('Klip davomiyligi 1.5–480 soniya bo‘lishi kerak.');
      next.push({key:crypto.randomUUID(),name:asset.name,duration,start:0,end:duration,mute:false,overlap:transition==='fade'?.35:0,assetId:id});
      if(!usedIds.has(id)){usedIds.add(id);bytes+=asset.size;}
     }
     commit(next);setSelectedKey(next.at(-1)?.key||'');setLibraryPick('');setLibrarySelection([]);setError('');
    }catch(e){setError((e as Error).message);}
   }
  }finally{importingRef.current=false;setImporting(false);}
 };
 useEffect(()=>{
  const update=()=>{void refreshAssets().catch(e=>setError((e as Error).message));};
   const add=(event:Event)=>{const id=(event as CustomEvent<{assetId:string}>).detail?.assetId;if(id)void addLibraryAssets([id]);};
  window.addEventListener('opensi:library-updated',update);window.addEventListener('opensi:add-video-clip',add);
  return()=>{window.removeEventListener('opensi:library-updated',update);window.removeEventListener('opensi:add-video-clip',add);};
 });
 useEffect(()=>{const pending=takeMontageAssets(userId);if(pending.length)void addLibraryAssets(pending);else if(initialAssetId&&seenRoute.current!==initialAssetId&&!clipsRef.current.some(clip=>clip.assetId===initialAssetId))void addLibraryAssets([initialAssetId]);seenRoute.current=initialAssetId;},[userId,initialAssetId]);
 useEffect(()=>{if(!busy&&job?.status!=='running'&&queuedLibraryIds.current.length)void addLibraryAssets([]);},[busy,job?.status]);
 const move=(key:string,direction:number)=>{const next=[...clipsRef.current],index=next.findIndex(row=>row.key===key),to=index+direction;if(index<0||to<0||to>=next.length)return;[next[index],next[to]]=[next[to],next[index]];commit(next);setSelectedKey(key);};
 const editClip=(key:string,change:Partial<Pick<Clip,'start'|'end'|'mute'|'overlap'>>)=>commit(clipsRef.current.map(clip=>clip.key===key?{...clip,...change}:clip));
 const seekTo=(value:number,autoplay=false)=>{
  const list=layout(clipsRef.current,mode,transition);if(!list.length)return;
  const end=list.at(-1)!.at+list.at(-1)!.length,target=clamp(value,0,Math.max(0,end-.01));
  const row=list.find(item=>target<item.at+item.length)||list.at(-1)!;
  const time=clamp(row.start+target-row.at,row.start,row.end-.01);
  pendingSeek.current={key:row.clip.key,time,autoplay};setSelectedKey(row.clip.key);setPlayhead(target);setPlaying(autoplay);
  if(row.clip.key===selectedKey&&player.current?.readyState){player.current.currentTime=time;if(autoplay)void player.current.play().catch(()=>setPlaying(false));else player.current.pause();pendingSeek.current=null;}
 };
 const onPreviewReady=()=>{const video=player.current;if(!video||!selected)return;const item=pendingSeek.current;video.currentTime=item?.key===selected.key?item.time:mode==='manual'?selected.start:0;if(item?.key===selected.key){if(item.autoplay)void video.play().catch(()=>setPlaying(false));pendingSeek.current=null;}};
 const onPreviewTime=()=>{
  const video=player.current;if(!video||!selected)return;const list=layout(clipsRef.current,mode,transition),row=list.find(item=>item.clip.key===selected.key);if(!row)return;
  if(video.currentTime>=row.end-.04){if(playing&&row.index<list.length-1)seekTo(row.at+row.length,true);else{video.pause();setPlaying(false);setPlayhead(row.at+row.length);}return;}
  setPlayhead(clamp(row.at+video.currentTime-row.start,row.at,row.at+row.length));
 };
 const togglePlay=()=>{if(!clips.length)return;if(playing){player.current?.pause();setPlaying(false);}else seekTo(playhead>=total-.04?0:playhead,true);};
 const split=()=>{
  if(mode!=='manual'||locked)return;const list=layout(clipsRef.current,mode,transition),row=list.find(item=>playhead>=item.at&&playhead<item.at+item.length)||list.at(-1);if(!row)return;
  const point=round(clamp(row.start+playhead-row.at,row.start,row.end));
  if(point-row.clip.start<minSegment||row.clip.end-point<minSegment){setError('Bo‘lish nuqtasining ikki tomonida kamida 1.5 soniya qolsin.');return;}
  if(clipsRef.current.length>=maxClips){setError('Ko‘pi bilan 16 ta kesim mumkin.');return;}
  const left={...row.clip,end:point},right={...row.clip,key:crypto.randomUUID(),start:point,overlap:0};
  commit([...clipsRef.current.slice(0,row.index),left,right,...clipsRef.current.slice(row.index+1)]);setSelectedKey(right.key);setError('');
 };
 const deleteSide=(side:'left'|'right')=>{
  if(!selected||locked||mode!=='manual')return;const row=layout(clipsRef.current,mode,transition).find(item=>item.clip.key===selected.key);if(!row)return;
  const point=round(clamp(row.start+playhead-row.at,row.start,row.end));
  if((side==='left'?selected.end-point:point-selected.start)<minSegment){setError('Qoladigan kesim kamida 1.5 soniya bo‘lsin.');return;}
  editClip(selected.key,side==='left'?{start:point}:{end:point});setError('');
 };
 const startTrim=(event:React.PointerEvent<HTMLButtonElement>,clip:Clip,side:'start'|'end')=>{
  if(locked||mode!=='manual')return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
  trimGesture.current={origin:clipsRef.current,key:clip.key,side,x:event.clientX,zoom};setSelectedKey(clip.key);
 };
 const moveTrim=(event:React.PointerEvent<HTMLButtonElement>)=>{
  const gesture=trimGesture.current;if(!gesture)return;const original=gesture.origin.find(row=>row.key===gesture.key);if(!original)return;
  const delta=(event.clientX-gesture.x)/gesture.zoom;
  const value=gesture.side==='start'?clamp(round(original.start+delta),0,original.end-minSegment):clamp(round(original.end+delta),original.start+minSegment,original.duration);
  apply(normalizeOverlaps(gesture.origin.map(row=>row.key===gesture.key?{...row,[gesture.side]:value}:row)));
 };
 const finishTrim=()=>{const gesture=trimGesture.current;if(!gesture)return;trimGesture.current=null;if(clipsRef.current!==gesture.origin){history.current.past.push(gesture.origin);if(history.current.past.length>40)history.current.past.shift();history.current.future=[];saveDraft(userId,clipsRef.current);}};
 const startOverlap=(event:React.PointerEvent<HTMLButtonElement>,clip:Clip)=>{
  if(locked||mode!=='manual')return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
  overlapGesture.current={origin:clipsRef.current,key:clip.key,x:event.clientX,zoom};setSelectedKey(clip.key);
 };
 const moveOverlap=(event:React.PointerEvent<HTMLButtonElement>)=>{
  const gesture=overlapGesture.current;if(!gesture)return;
  const index=gesture.origin.findIndex(row=>row.key===gesture.key);if(index<1)return;
  const value=round(clamp(gesture.origin[index].overlap+(gesture.x-event.clientX)/gesture.zoom,0,overlapLimit(gesture.origin,index)));
  apply(normalizeOverlaps(gesture.origin.map(row=>row.key===gesture.key?{...row,overlap:value}:row)));
 };
 const finishOverlap=()=>{const gesture=overlapGesture.current;if(!gesture)return;overlapGesture.current=null;if(clipsRef.current!==gesture.origin){history.current.past.push(gesture.origin);if(history.current.past.length>40)history.current.past.shift();history.current.future=[];saveDraft(userId,clipsRef.current);}};
 const create=async()=>{
  if(clips.length<(mode==='manual'?1:2)||busy||job?.status==='running')return;
  setBusy(true);setError('');
  try{
   if(invalidTrim)throw new Error('Har bir kesim kamida 1.5 soniya bo‘lsin va manba video davomiyligidan oshmasin.');
   if(total>maxSeconds)throw new Error('Kliplar 480 soniyadan oshdi. Kesimlarni qisqartiring.');
   if(mode==='automatic'&&new Set(clips.map(clip=>clip.assetId||clip.file)).size!==clips.length)throw new Error('Avtomatik rejimda bir manbani takror ishlatmang.');
   const ids:string[]=[],uploaded=new Map<File,string>();
   for(let i=0;i<clips.length;i++){
    const clip=clips[i];let assetId=clip.assetId;
     if(!assetId&&clip.file){assetId=uploaded.get(clip.file);if(!assetId){setProgress(`${i+1}/${clips.length} yuklanmoqda · 0%`);assetId=await upload(clip.file,value=>setProgress(`${i+1}/${clips.length} yuklanmoqda · ${value}%`));uploaded.set(clip.file,assetId);}apply(clipsRef.current.map(row=>row.file===clip.file?{...row,assetId}:row));saveDraft(userId,clipsRef.current);}
    if(!assetId)throw new Error('Manba MP4 topilmadi.');ids.push(assetId);
   }
   setAssets((await api<Asset[]>('/library')).filter(asset=>asset.mime==='video/mp4'));
   setProgress('Kliplar tekshirilmoqda…');
   const created=await api<Job>('/video-stitch/jobs',{method:'POST',body:{requestKey:crypto.randomUUID(),assetIds:ids,maxSeconds,mode,...(mode==='manual'?{transition,edits:clips.map(clip=>({start:clip.start,end:clip.end,mute:clip.mute,overlap:clip.overlap}))}:{})}});
   setJob(created);setJobs(items=>[created,...items.filter(item=>item.id!==created.id)]);setProgress('');
  }catch(e){setError((e as Error).message);setProgress('');}
  finally{setBusy(false);}
 };
 const cancel=async()=>{if(!job)return;try{await api(`/video-stitch/jobs/${job.id}/cancel`,{method:'POST',body:{}});setJob({...job,status:'cancelled'});setJobs(items=>items.map(item=>item.id===job.id?{...item,status:'cancelled'}:item));}catch(e){setError((e as Error).message);}};
 const removeJob=async(item:Job)=>{
  if(!window.confirm('Montaj natijasini o‘chirasizmi? Yakuniy MP4 kutubxona chiqindisiga ko‘chadi; manba kliplar saqlanadi.'))return;
  setBusy(true);setError('');
  try{await api(`/video-stitch/jobs/${item.id}`,{method:'DELETE'});const remaining=await api<Job[]>('/video-stitch/jobs');setJobs(remaining);if(job?.id===item.id)setJob(remaining[0]||null);await refreshAssets();window.dispatchEvent(new Event('opensi:library-updated'));}
  catch(cause){setError((cause as Error).message);}
  finally{setBusy(false);}
 };
 const removeSource=async(clip:Clip)=>{
  if(!window.confirm(clip.assetId?'Bu manba videoni OpenSI kutubxonasidan o‘chirasizmi? U ishlatilgan barcha montaj kesimlaridan ham olib tashlanadi.':'Bu mahalliy videoni montajdan olib tashlaysizmi?'))return;
  setBusy(true);setError('');
  try{
   if(clip.assetId){if(job?.asset_id===clip.assetId)await api(`/video-stitch/jobs/${job.id}`,{method:'DELETE'});else await api(`/library/${clip.assetId}`,{method:'PATCH',body:{deleted:true}});await refreshAssets();window.dispatchEvent(new Event('opensi:library-updated'));}
   const next=clipsRef.current.filter(row=>clip.assetId?row.assetId!==clip.assetId:row.key!==clip.key);commit(next);setSelectedKey(next[0]?.key||'');setPlaying(false);setPlayhead(0);
   if(job?.asset_id===clip.assetId){const remaining=await api<Job[]>('/video-stitch/jobs');setJobs(remaining);setJob(remaining[0]||null);}
  }catch(cause){setError((cause as Error).message);}
  finally{setBusy(false);}
 };
 const reedit=async()=>{
  if(!job?.asset_id)return;
  try{
   const list=(await api<Asset[]>('/library')).filter(asset=>asset.mime==='video/mp4');setAssets(list);
   const asset=list.find(item=>item.id===job.asset_id);if(!asset)throw new Error('Tayyor video kutubxonada topilmadi.');
   const duration=await durationOf(`/api/library/${asset.id}/content?inline=true`);
   const clip={key:crypto.randomUUID(),name:asset.name,duration,start:0,end:duration,mute:false,overlap:0,assetId:asset.id};
   commit([clip]);setSelectedKey(clip.key);setMode('manual');setPlayhead(0);setError('');
  }catch(e){setError((e as Error).message);}
 };
 return <section className="studio-panel video-stitch">
  <header className="stitch-header"><div><span className="eyebrow">VIDEO MONTAJ</span><h2>Qo‘lda tahrirlash studiyasi</h2><p>Media, ko‘rish oynasi va vaqt chizig‘i: klipni bo‘ling, chetidan kesing, tartiblang va yakuniy MP4ni oling.</p></div><div className="studio-actions stitch-modes" role="group" aria-label="Montaj rejimi"><button type="button" className={`button ${mode==='manual'?'button-primary':''}`} aria-pressed={mode==='manual'} onClick={()=>{setMode('manual');setPlayhead(0);}}>Qo‘lda</button><button type="button" className={`button ${mode==='automatic'?'button-primary':''}`} aria-pressed={mode==='automatic'} onClick={()=>{setMode('automatic');setPlayhead(0);}}>Avtomatik</button></div></header>
  <div className="stitch-workspace">
   <aside className="stitch-media">
    <h3>Media</h3>
    <label className="button stitch-import"><Plus size={15}/>Bir nechta MP4 qo‘shish<input type="file" accept="video/mp4,.mp4" multiple disabled={locked} onChange={event=>{void addFiles(event.target.files);event.target.value='';}}/></label>
    <small className="stitch-import-help">Bir nechta faylni tanlang — hammasi tartib bilan vaqt chizig‘iga tushadi.</small>
    <div className="stitch-library-pick"><select aria-label="Kutubxonadagi MP4" value={libraryPick} disabled={locked} onChange={event=>setLibraryPick(event.target.value)}><option value="">Kutubxonadan tanlang</option>{assets.filter(a=>a.size<=250_000_000).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select><button className="button" type="button" disabled={!libraryPick||locked} onClick={()=>void addLibraryAssets([libraryPick])}>Qo‘shish</button></div>
    <details className="stitch-library-multi"><summary>Kutubxonadan bir nechta tanlash</summary><div className="stitch-library-options">{assets.filter(a=>a.size<=250_000_000).map(asset=><label key={asset.id}><input type="checkbox" disabled={locked} checked={librarySelection.includes(asset.id)} onChange={event=>setLibrarySelection(current=>event.target.checked?[...current,asset.id]:current.filter(id=>id!==asset.id))}/><span title={asset.name}>{asset.name}</span></label>)}</div><button type="button" className="button" disabled={!librarySelection.length||locked} onClick={()=>void addLibraryAssets(librarySelection)}>Tanlangan {librarySelection.length} ta videoni qo‘shish</button></details>
    <button type="button" className="stitch-refresh" onClick={()=>void refreshAssets().catch(e=>setError((e as Error).message))}>Kutubxonani yangilash</button>
    {importing&&<small role="status">Videolar qo‘shilmoqda…</small>}
    <div className="stitch-media-list">{!clips.length&&<small>Montaj uchun MP4 tanlang.</small>}{clips.map((clip,index)=><button type="button" key={clip.key} className={`stitch-media-row ${selected?.key===clip.key?'is-selected':''}`} onClick={()=>seekTo(rows[index]?.at||0)}><Film size={16}/><span><strong>{clip.name}</strong><small>{round(clip.end-clip.start)} s · {index+1}-kesim</small></span></button>)}</div>
   </aside>
   <div className="stitch-monitor"><div className="stitch-monitor-screen">{previewUrl?<video key={selected?.key} ref={player} src={previewUrl} playsInline preload="metadata" aria-label="Montajni ko‘rish" onLoadedMetadata={onPreviewReady} onTimeUpdate={onPreviewTime} onEnded={onPreviewTime}/>:<div className="stitch-monitor-empty"><Film size={36}/><span>Video ko‘rish oynasi</span></div>}</div><div className="stitch-transport"><button type="button" className="button" aria-label={playing?'Pauza':'Ijro'} disabled={!clips.length} onClick={togglePlay}>{playing?<Pause size={16}/>:<Play size={16}/>}</button><span>{playhead.toFixed(1)} / {total.toFixed(1)} s</span><input type="range" aria-label="Video bo‘ylab yurish" min={0} max={Math.max(total,.01)} step={.05} value={clamp(playhead,0,total)} disabled={!clips.length} onChange={event=>seekTo(Number(event.target.value))}/></div>{mode==='manual'&&clips.some(clip=>clip.overlap>0)&&<small className="muted">Ustma-ust qismlar ko‘rish oynasida navbat bilan, yakuniy MP4da silliq aralashib ko‘rinadi.</small>}</div>
   <aside className="stitch-inspector">
    <h3>Kesim sozlamalari</h3>
    {selected?<>
     <strong className="stitch-inspector-name">{selected.name}</strong>
     <small className="muted">Manba: {selected.duration.toFixed(1)} s · Tanlangan: {(selected.end-selected.start).toFixed(1)} s</small>
     <div className="stitch-inspector-fields"><label>Boshlanish (s)<input type="number" min={0} max={Math.max(0,selected.end-minSegment)} step="0.1" value={selected.start} disabled={locked||mode!=='manual'} onChange={event=>editClip(selected.key,{start:Number(event.target.value)})}/></label><label>Tugash (s)<input type="number" min={selected.start+minSegment} max={selected.duration} step="0.1" value={selected.end} disabled={locked||mode!=='manual'} onChange={event=>editClip(selected.key,{end:Number(event.target.value)})}/></label></div>
     {selectedIndex>0&&mode==='manual'&&<div className="stitch-overlap-controls"><label htmlFor="stitch-overlap-range">Oldingi klip bilan ustma-ust · {selected.overlap.toFixed(2)} s</label><input id="stitch-overlap-range" type="range" min={0} max={overlapLimit(clips,selectedIndex)} step={.05} value={selected.overlap} disabled={locked} onChange={event=>editClip(selected.key,{overlap:Number(event.target.value)})}/><button type="button" className="button" disabled={locked||selected.overlap===0} onClick={()=>editClip(selected.key,{overlap:0})}>Jipslashtirish · 0 s</button></div>}
     <button type="button" className="button" disabled={locked||mode!=='manual'} onClick={()=>editClip(selected.key,{mute:!selected.mute})}>{selected.mute?<VolumeX size={15}/>:<Volume2 size={15}/>} {selected.mute?'Ovozni yoqish':'Ovozni o‘chirish'}</button>
     <div className="stitch-inspector-actions"><button type="button" className="button" disabled={locked||mode!=='manual'||clips.length>=maxClips} onClick={()=>{const index=clipsRef.current.findIndex(row=>row.key===selected.key),copy={...selected,key:crypto.randomUUID(),overlap:0};commit([...clipsRef.current.slice(0,index+1),copy,...clipsRef.current.slice(index+1)]);setSelectedKey(copy.key);}}><Copy size={14}/>Nusxa</button><button type="button" className="button" disabled={locked} onClick={()=>{const next=clipsRef.current.filter(row=>row.key!==selected.key);commit(next);setSelectedKey(next[0]?.key||'');setPlaying(false);setPlayhead(0);}}>Faqat kesimni olib tashlash</button><button type="button" className="button" disabled={locked} onClick={()=>void removeSource(selected)}><Trash2 size={14}/>OpenSI’dan o‘chirish</button></div>
    </>:<p className="muted">Vaqt chizig‘ida klip tanlang.</p>}
   </aside>
  </div>
  <div className="stitch-timeline-toolbar"><div className="studio-actions"><strong>Vaqt chizig‘i</strong><button type="button" className="button" disabled={locked||!history.current.past.length} onClick={undo} aria-label="Ortga qaytarish" title="Ortga qaytarish"><Undo2 size={16}/></button><button type="button" className="button" disabled={locked||!history.current.future.length} onClick={redo} aria-label="Qayta qo‘llash" title="Qayta qo‘llash"><Redo2 size={16}/></button><button type="button" className="button" disabled={locked||mode!=='manual'||!clips.length} onClick={split}><Scissors size={15}/>Playheadda bo‘lish</button><button type="button" className="button" disabled={locked||mode!=='manual'||!selected} onClick={()=>deleteSide('left')}><ArrowLeft size={14}/>Chapni olib tashlash</button><button type="button" className="button" disabled={locked||mode!=='manual'||!selected} onClick={()=>deleteSide('right')}>O‘ngni olib tashlash<ArrowRight size={14}/></button></div><div className="studio-actions"><button type="button" className="button" aria-label="Vaqt chizig‘ini kichraytirish" disabled={zoom<=6} onClick={()=>setZoom(value=>Math.max(6,value-4))}><ZoomOut size={16}/></button><span>{zoom} px/s</span><button type="button" className="button" aria-label="Vaqt chizig‘ini kattalashtirish" disabled={zoom>=40} onClick={()=>setZoom(value=>Math.min(40,value+4))}><ZoomIn size={16}/></button></div></div>
  <div className="stitch-timeline-scroll"><div className="stitch-timeline-canvas" style={{width:Math.max(600,Math.ceil(total*zoom)+24)}}>
   <div className="stitch-ruler">{Array.from({length:Math.floor(total/5)+1},(_,index)=><span key={index} style={{left:index*5*zoom}}>{index*5}s</span>)}</div>
   <div className="stitch-track-label">VIDEO 1</div>
   <div className="stitch-track">
    {rows.map(row=><div key={row.clip.key} draggable={!locked} className={`stitch-timeline-clip ${selected?.key===row.clip.key?'is-selected':''}`} style={{width:Math.max(8,row.length*zoom),marginLeft:row.index?-row.overlap*zoom:0,zIndex:row.index+1}} onDragStart={event=>{dragKey.current=row.clip.key;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',row.clip.key);}} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const from=clipsRef.current.findIndex(item=>item.key===(event.dataTransfer.getData('text/plain')||dragKey.current)),to=clipsRef.current.findIndex(item=>item.key===row.clip.key);if(from<0||to<0||from===to)return;const next=[...clipsRef.current];next.splice(to,0,next.splice(from,1)[0]);commit(next);setSelectedKey(next[to].key);}}>
     {row.overlap>0&&<span className="stitch-overlap-zone" style={{width:row.overlap*zoom}} aria-hidden="true"/>}
     <button type="button" className="stitch-trim-handle" aria-label={`${row.clip.name} chap chetini kesish`} disabled={locked||mode!=='manual'} onPointerDown={event=>startTrim(event,row.clip,'start')} onPointerMove={moveTrim} onPointerUp={finishTrim} onPointerCancel={finishTrim}/>
     <button type="button" className="stitch-clip-body" title={`${row.clip.name} · ${round(row.clip.end-row.clip.start)} s`} onClick={event=>{const rect=event.currentTarget.parentElement!.getBoundingClientRect();seekTo(row.at+clamp((event.clientX-rect.left)/zoom,0,row.length-.01));}}><Film size={13}/><span>{row.clip.name}</span><small>{round(row.clip.end-row.clip.start)}s</small></button>
     <button type="button" className="stitch-trim-handle" aria-label={`${row.clip.name} o‘ng chetini kesish`} disabled={locked||mode!=='manual'} onPointerDown={event=>startTrim(event,row.clip,'end')} onPointerMove={moveTrim} onPointerUp={finishTrim} onPointerCancel={finishTrim}/>
    </div>)}
    {mode==='manual'&&rows.slice(1).map(row=><button key={`join-${row.clip.key}`} type="button" className="stitch-overlap-grip" style={{left:row.at*zoom}} title={`${row.clip.name}: chapga tortib ustma-ust qo‘ying, o‘ngga tortib jipslashtiring (${row.overlap.toFixed(2)} s)`} aria-label={`${row.clip.name} bilan oldingi klip orasidagi ustma-ust qism: ${row.overlap.toFixed(2)} soniya. Chapga yoki o‘ngga torting.`} disabled={locked} onPointerDown={event=>startOverlap(event,row.clip)} onPointerMove={moveOverlap} onPointerUp={finishOverlap} onPointerCancel={finishOverlap}>⇄</button>)}
   </div>
   <div className="stitch-playhead" style={{left:playhead*zoom}} aria-hidden="true"/>
  </div></div>
  <div className="stitch-timeline-footer"><small>⇄ chegarani chapga tortib videolarni ustma-ust qo‘ying, o‘ngga tortib jipslashtiring. Klipni sudrab tartiblang; telefonda pastdagi tartib tugmalaridan foydalaning.</small><div className="studio-actions">{selected&&<><button type="button" className="button" aria-label="Tanlangan klipni oldinga ko‘chirish" disabled={locked||clips[0]?.key===selected.key} onClick={()=>move(selected.key,-1)}><ArrowUp size={14}/>Oldinga</button><button type="button" className="button" aria-label="Tanlangan klipni keyinga ko‘chirish" disabled={locked||clips.at(-1)?.key===selected.key} onClick={()=>move(selected.key,1)}><ArrowDown size={14}/>Keyinga</button></>}</div></div>
  <div className="stitch-export"><label>Barcha chegaralar<select value={overlapPreset} disabled={locked||mode!=='manual'} onChange={event=>{const next=event.target.value as 'fade'|'cut';setTransition(next);commit(clipsRef.current.map((clip,index)=>({...clip,overlap:index&&next==='fade'?.35:0})));setPlayhead(0);}}><option value="cut">Jips · kesib ulash</option><option value="fade">Ustma-ust · 0.35 s</option><option value="custom" disabled>Har birida turlicha</option></select></label><span>{Math.max(0,total).toFixed(1)} / {maxSeconds} s · {clips.length}/{maxClips} kesim · {Math.round(totalBytes/1_000_000)} MB manba</span><button className="button button-primary" type="button" disabled={clips.length<(mode==='manual'?1:2)||locked||totalBytes>maxBytes||invalidTrim||total>maxSeconds} onClick={()=>void create()}><Scissors size={16}/>{busy?progress:'MP4ni tayyorlash'}</button></div>
  {job?.status==='running'&&<div role="status" className="studio-actions"><strong>{job.phase==='checking'?'Kliplar tekshirilmoqda':job.phase==='rendering'?'Video montaj qilinmoqda':'MP4 saqlanmoqda'}</strong><button type="button" className="button" onClick={()=>void cancel()}><Square size={13}/>To‘xtatish</button></div>}
  {job?.status==='completed'&&job.asset_id&&<div className="flow-video-saved" role="status"><strong>Tayyor · {job.duration?.toFixed(1)} soniya</strong><video controls preload="metadata" src={`/api/library/${job.asset_id}/content?inline=true`} aria-label="Birlashtirilgan video"/><div className="studio-actions"><a className="button" href={`/api/library/${job.asset_id}/content`}>Yakuniy MP4ni yuklab olish</a><button type="button" className="button" onClick={()=>void reedit()}>Natijani yana tahrirlash</button><button type="button" className="button" disabled={busy} onClick={()=>void removeJob(job)}><Trash2 size={14}/>Montajni o‘chirish</button></div></div>}
  {jobs.length>1&&<div className="studio-panel"><h3>Avvalgi montajlar</h3><ul className="stitch-clips">{jobs.filter(item=>item.id!==job?.id).map(item=><li key={item.id}><span><strong>{item.status==='completed'?'Tayyor montaj':item.status==='running'?'Jarayonda':'Tugallanmagan montaj'}</strong><small>{dateTime(item.created_at)} · {item.duration?.toFixed(1)||'—'} s</small></span><button type="button" className="button" onClick={()=>setJob(item)}>Ko‘rish</button><button type="button" className="button" disabled={busy||item.status==='running'} onClick={()=>void removeJob(item)}><Trash2 size={14}/>O‘chirish</button></li>)}</ul></div>}
  {job?.status==='failed'&&<ErrorBox message={job.error||'Video tayyorlanmadi.'}/>} {job?.status==='interrupted'&&<ErrorBox message={job.error||'Server yangilandi. Manbalar kutubxonada saqlangan.'}/>}
  {job&&job.status!=='running'&&job.status!=='completed'&&<button type="button" className="button" disabled={busy} onClick={()=>void removeJob(job)}><Trash2 size={14}/>Bu montajni o‘chirish</button>}
  {error&&<ErrorBox message={error}/>}
  <small className="muted">Manba kliplar hisobingiz kutubxonasida qoladi. Bir-biriga aloqasiz sahnalar orasidagi sakrashni silliq montaj butunlay yo‘qota olmaydi.</small>
 </section>;
}
