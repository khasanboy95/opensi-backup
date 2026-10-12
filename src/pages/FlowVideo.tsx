import {useEffect,useRef,useState} from 'react';
import {Copy,ExternalLink,Film,LibraryBig,Plus,Trash2,Upload} from 'lucide-react';
import {api} from '../api';
import {ErrorBox} from '../components/Ui';
import {FLOW_ACCOUNT_KEY,VEOFLOW_ACCOUNT_KEY,rememberVideoSource} from './video-source';

const MAX_VIDEO_BYTES=1_000_000_000;
const videoSources={
 google:{name:'Google Flow',url:'https://flow.google.com/',description:'Video Google Flow’da tanlangan hisobning Flow kreditlari bilan yaratiladi. OpenSI’dagi Gemini API ulanishi boshqa hisob-kitobdan foydalanadi.',note:'Flow’da yangi loyiha oching, Agent rejimini o‘chiring, model sozlamasidan Video va bitta natijani tanlang. Promptni qo‘yib video tayyorlang, MP4ni yuklab olib shu sahifaga kiriting. OpenSI serveri Flow kreditini API orqali sarflamaydi.'},
 veoflow:{name:'VeoFlowAPI Omni Studio',url:'https://veoflowapi.com/omni',description:'Video VeoFlowAPI saytida kirgan hisobingizning kreditlaridan yaratiladi. OpenSI’dagi Google Gemini API kaliti bu bo‘limda ishlatilmaydi; u alohida hisob-kitob yo‘lidir.',note:'Kerakli VeoFlowAPI hisobida faol tarif va kredit borligini tekshiring. OpenSI serveri VeoFlowAPI’ga to‘g‘ridan-to‘g‘ri video so‘rovi yubormaydi: promptni nusxalab Omni Studio’da yarating, keyin MP4ni shu yerga qaytaring.'}
} as const;
type PreviousVideo={assetId:string;name:string;prompt:string;model:string};

export function FlowVideo({source,openLibrary,addToMontage,referenceAssetId,referenceName,referenceDescription,previousVideos,requestedPriorAssetId,lastFailedVideoPrompt}:{source:'flow'|'veoflow';openLibrary:()=>void;addToMontage:(assetId:string)=>void;referenceAssetId:string;referenceName:string;referenceDescription:string;previousVideos:PreviousVideo[];requestedPriorAssetId:string;lastFailedVideoPrompt:string}){
 const provider=videoSources[source==='veoflow'?'veoflow':'google'];
 const accountKey=source==='flow'?FLOW_ACCOUNT_KEY:VEOFLOW_ACCOUNT_KEY;
 const promptKey=`opensi:video-draft:${source}`;
 const [prompt,setPrompt]=useState(()=>{try{return window.localStorage.getItem(promptKey)||'';}catch{return '';}});
 const updatePrompt=(value:string)=>{setPrompt(value);try{window.localStorage.setItem(promptKey,value);}catch{/* Storage may be disabled. */}};
 const [file,setFile]=useState<File|null>(null);
 const [previewUrl,setPreviewUrl]=useState('');
 const [assetId,setAssetId]=useState('');
 const [busy,setBusy]=useState(false);
 const [progress,setProgress]=useState(0);
 const [copied,setCopied]=useState(false);
 const [error,setError]=useState('');
 const [preferredEmail,setPreferredEmail]=useState(()=>{try{return window.localStorage.getItem(accountKey)||'';}catch{return '';}});
 const [accountReady,setAccountReady]=useState(false);
 const [accountSyncError,setAccountSyncError]=useState('');
 const accountEdited=useRef(false);
 const flowEmail=preferredEmail.trim().toLowerCase();
 // AccountChooser silently picked the browser's default account even when a different
 // Flow email was saved. Google's authuser email route opens the matching signed-in account.
 const providerUrl=source==='flow'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(flowEmail)
  ? `https://flow.google.com/?authuser=${encodeURIComponent(flowEmail)}`
  : provider.url;
 const [priorAssetId,setPriorAssetId]=useState(requestedPriorAssetId);
 const priorWasSelected=useRef(Boolean(requestedPriorAssetId));
 const priorVideo=previousVideos.find(item=>item.assetId===priorAssetId);
 useEffect(()=>{if(requestedPriorAssetId){priorWasSelected.current=true;setPriorAssetId(requestedPriorAssetId);}},[requestedPriorAssetId]);
 useEffect(()=>{if(!priorWasSelected.current&&lastFailedVideoPrompt&&previousVideos.length){priorWasSelected.current=true;setPriorAssetId(previousVideos[0].assetId);}},[lastFailedVideoPrompt,previousVideos]);
 const updatePreferredEmail=(value:string)=>{accountEdited.current=true;setPreferredEmail(value);try{window.localStorage.setItem(accountKey,value.trim());}catch{/* Storage may be disabled. */}if(value.trim())rememberVideoSource(source);};

 useEffect(()=>{
  let live=true;
  void api<{flowEmail:string;veoflowEmail:string}>('/video/account-preferences').then(value=>{
   if(!live)return;
   const saved=(source==='flow'?value.flowEmail:value.veoflowEmail).trim();
   if(saved&&!accountEdited.current){setPreferredEmail(saved);try{window.localStorage.setItem(accountKey,saved);}catch{/* Storage may be disabled. */}}
   else if(!saved&&!accountEdited.current&&preferredEmail.trim())accountEdited.current=true;
   setAccountSyncError('');setAccountReady(true);
  }).catch(()=>{if(live){setAccountSyncError('Hisobni server bilan sinxronlab bo‘lmadi; email faqat shu brauzerda qoldi.');setAccountReady(true);}});
  return()=>{live=false;};
 },[source,accountKey]);
 useEffect(()=>{
  const email=preferredEmail.trim();
  if(!accountReady||!accountEdited.current||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))return;
  const timer=window.setTimeout(()=>{void api('/video/account-preferences',{method:'PATCH',body:{source,email}}).then(()=>{setAccountSyncError('');accountEdited.current=false;}).catch(()=>setAccountSyncError('Hisobni server bilan sinxronlab bo‘lmadi; email faqat shu brauzerda qoldi.'));},600);
  return()=>window.clearTimeout(timer);
 },[preferredEmail,accountReady,source]);

 useEffect(()=>{
  if(!file){setPreviewUrl('');return;}
  const url=URL.createObjectURL(file);
  setPreviewUrl(url);
  return()=>URL.revokeObjectURL(url);
 },[file]);

 const chooseFile=(selected?:File)=>{
  setError('');setAssetId('');setProgress(0);
  if(!selected){setFile(null);return;}
  if(selected.size>MAX_VIDEO_BYTES||selected.size===0){setFile(null);setError('MP4 fayl 1 GB gacha va bo‘sh bo‘lmasligi kerak.');return;}
  if(selected.type!=='video/mp4'&&!selected.name.toLowerCase().endsWith('.mp4')){setFile(null);setError('MP4 faylni tanlang.');return;}
  setFile(selected);
 };

 const copyPrompt=async()=>{
  const continuity=referenceAssetId?`Har bir klipga bir xil reference rasmni biriktiring (${referenceName||'reference kadr'}). Undagi qahramon yoki mahsulotning yuzi, kiyimi, ranglari va asosiy ko‘rinishini o‘zgartirmang.${referenceDescription.trim()?` Reference tavsifi: ${referenceDescription.trim()}`:''}`:'';
  const priorContext=priorVideo?'Biriktirilgan oxirgi kadrdan boshlanadigan YANGI klip yarating. Oldingi MP4ning voqeasini davom ettiring; qahramon, kiyim, yorug‘lik, joy, kadr va ovoz uslubi izchil bo‘lsin. Oldingi klipni qayta ishlamang.':'';
  try{await navigator.clipboard.writeText([priorContext,prompt.trim(),continuity].filter(Boolean).join('\n\n'));setCopied(true);setError('');}
  catch{setError('Prompt nusxalanmadi. Matnni belgilab Ctrl+C bilan ko‘chiring.');}
 };
 const downloadLastFrame=async()=>{
  if(!priorVideo)return;
  setError('');
  const video=document.createElement('video');
  video.preload='auto';video.muted=true;video.playsInline=true;
  video.src=`/api/library/${priorVideo.assetId}/content?inline=true`;
  try{
   await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Video kadri vaqtida ochilmadi.')),20000);const done=(failure?:Error)=>{clearTimeout(timer);video.onloadedmetadata=null;video.onseeked=null;video.onerror=null;failure?reject(failure):resolve();};video.onerror=()=>done(new Error('Oldingi video ochilmadi.'));video.onloadedmetadata=()=>{if(!Number.isFinite(video.duration)||!video.videoWidth||!video.videoHeight){done(new Error('Video davomiyligi yoki o‘lchami aniqlanmadi.'));return;}const end=Math.max(0,video.duration-0.08);if(end===0){done();return;}video.onseeked=()=>done();video.currentTime=end;};});
   const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
   const context=canvas.getContext('2d');if(!context)throw new Error('Video kadrini chizib bo‘lmadi.');
   context.drawImage(video,0,0,canvas.width,canvas.height);
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Oxirgi kadr saqlanmadi.')),'image/png'));
   const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`opensi-last-frame-${priorVideo.assetId}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(cause){setError((cause as Error).message);}
  finally{video.removeAttribute('src');video.load();}
 };

 const save=()=>{
  if(!file||busy)return;
  setBusy(true);setProgress(0);setError('');
  const xhr=new XMLHttpRequest();
  xhr.open('POST','/api/uploads');
  xhr.setRequestHeader('Content-Type','application/octet-stream');
  xhr.setRequestHeader('x-opensi-client','web');
  xhr.setRequestHeader('x-file-name',encodeURIComponent(file.name));
  xhr.timeout=30*60*1000;
  xhr.upload.onprogress=event=>{if(event.lengthComputable)setProgress(Math.round(event.loaded/event.total*100));};
  xhr.onerror=()=>{setError('Tarmoq uzildi. Faylni qayta saqlab ko‘ring.');setBusy(false);};
  xhr.ontimeout=()=>{setError('Yuklash vaqti tugadi. Qayta urinib ko‘ring.');setBusy(false);};
  xhr.onload=()=>{
   try{
    const result=JSON.parse(xhr.responseText) as {assetId?:string;error?:string};
    if(xhr.status<200||xhr.status>=300||!result.assetId)throw Error(result.error||'Video saqlanmadi.');
    setAssetId(result.assetId);setProgress(100);window.dispatchEvent(new Event('opensi:library-updated'));
   }catch(e){setError((e as Error).message);}
   finally{setBusy(false);}
  };
  xhr.send(file);
 };
 const removeSaved=async()=>{
  if(!assetId||!window.confirm('Bu videoni OpenSI kutubxonasi chiqindisiga ko‘chirasizmi?'))return;
  setBusy(true);setError('');
  try{await api(`/library/${assetId}`,{method:'PATCH',body:{deleted:true}});setAssetId('');window.dispatchEvent(new Event('opensi:library-updated'));}
  catch(cause){setError((cause as Error).message);}
  finally{setBusy(false);}
 };

 return <div className="flow-video"><div className="studio-split">
  <section className="studio-panel studio-form">
   <div className="studio-actions"><Film size={22}/><h2>{provider.name} · hisob krediti</h2></div>
   <p>{provider.description}</p>
   {source==='flow'&&previousVideos.length>0&&<div id="flow-continuation" className="flow-continuation"><strong>Oldingi videodan keyingi sahna</strong><label>Oldingi MP4<select value={priorAssetId} onChange={event=>{priorWasSelected.current=true;setPriorAssetId(event.target.value);}}><option value="">Yangi videodan boshlash</option>{previousVideos.map(item=><option key={item.assetId} value={item.assetId}>{item.name}{item.prompt?` · ${item.prompt.slice(0,55)}`:''}</option>)}</select></label>{priorVideo&&<><video controls preload="metadata" src={`/api/library/${priorVideo.assetId}/content?inline=true`} aria-label="Oldingi video"/><div className="studio-actions"><button className="button" type="button" onClick={()=>void downloadLastFrame()}>Oxirgi kadrni PNG olish</button><a className="button" href={`/api/library/${priorVideo.assetId}/content`}>Oldingi MP4ni yuklab olish</a><button className="button" type="button" onClick={()=>addToMontage(priorVideo.assetId)}>Oldingi videoni montajga qo‘shish</button></div><p>Flow’da yangi video uchun PNG’ni <strong>start frame</strong> sifatida tanlang. So‘ng keyingi sahnani yarating, MP4ni shu sahifaga olib keling va montajda oldingi klipga ulang. <a href="https://support.google.com/flow/answer/16935718?hl=en" target="_blank" rel="noreferrer">Google qoidasiga</a> ko‘ra “Extend” faqat Veo videosida ishlaydi; Gemini Omni klipi yangi sahna sifatida davom ettiriladi.</p></>}{lastFailedVideoPrompt&&<button className="button" type="button" onClick={()=>updatePrompt(lastFailedVideoPrompt)}>Oxirgi davom ettirish matnini olish</button>}</div>}
   <label>{source==='flow'?'Flow krediti olinadigan Google hisob':'VeoFlowAPI krediti olinadigan hisob'}<input type="email" value={preferredEmail} onChange={event=>updatePreferredEmail(event.target.value)} placeholder="Hisob emaili" autoComplete="email"/><small>Bu email OpenSI profilingizda saqlanadi. Xizmat oynasida aynan shu hisob tanlanganini tekshiring.</small>{accountSyncError&&<small role="alert">{accountSyncError}</small>}</label>
   <label>Video g‘oyasi yoki ssenariy<textarea rows={6} maxLength={4000} value={prompt} onChange={event=>{updatePrompt(event.target.value);setCopied(false);}} placeholder="Sahna, kamera, harakat, ovoz va davomiylikni tasvirlang…"/></label>
   {referenceAssetId&&<div className="reference-usage"><img src={`/api/library/${referenceAssetId}/content?inline=true`} alt={referenceName||'Doimiy reference'}/><div><strong>Har bir klip uchun bir xil reference</strong><p>Rasmni yuklab, {provider.name}’da reference/ingredient sifatida biriktiring. Promptni nusxalash tugmasi izchillik ko‘rsatmasini ham qo‘shadi.</p><a className="button" href={`/api/library/${referenceAssetId}/content`}>Reference rasmni yuklab olish</a></div></div>}
   <div className="studio-actions"><button className="button" type="button" disabled={!prompt.trim()} onClick={()=>void copyPrompt()}><Copy size={16}/>{copied?'Nusxalandi':'Promptni nusxalash'}</button><a className="button button-primary" href={providerUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>{source==='flow'?'Google Flow’da video yaratish':`${provider.name}’da yaratish`}</a></div>
   {preferredEmail.trim()&&<small className="muted" role="status">Video yaratishdan oldin {provider.name} profilida <strong>{preferredEmail.trim()}</strong> hisobini ko‘ring. Boshqa hisob ko‘rinsa, kredit o‘sha hisobdan sarflanadi.</small>}
   <small className="muted">{provider.note}</small>
  </section>
  <section className="studio-panel studio-form">
   <div className="studio-actions"><Upload size={22}/><h2>Videoni OpenSI’da davom ettirish</h2></div>
   <label>{provider.name}’dan yuklangan MP4<input type="file" accept="video/mp4,.mp4" disabled={busy} onChange={event=>{chooseFile(event.target.files?.[0]);event.target.value='';}}/></label>
   {previewUrl&&<div className="flow-video-preview"><video controls preload="metadata" src={previewUrl} aria-label="Tanlangan videoni ko‘rish"/><small className="muted">{file?.name} · mahalliy preview. Kutubxonaga saqlamaguningizcha fayl serverga yuborilmaydi.</small></div>}
   {error&&<ErrorBox message={error}/>}
   {file&&!assetId&&<button className="button button-primary" type="button" disabled={busy} onClick={save}><LibraryBig size={16}/>{busy?`Saqlanmoqda · ${progress}%`:'Kutubxonaga saqlash'}</button>}
   {assetId&&<div className="flow-video-saved" role="status"><strong>Video kutubxonaga saqlandi.</strong><video controls preload="metadata" src={`/api/library/${assetId}/content?inline=true`} aria-label="OpenSI’da saqlangan video"/><div className="studio-actions"><a className="button" href={`/api/library/${assetId}/content`}>MP4 yuklab olish</a><button className="button" type="button" onClick={()=>addToMontage(assetId)}><Plus size={15}/>Video montajga qo‘shish</button>{source==='flow'&&<button className="button" type="button" onClick={()=>{priorWasSelected.current=true;setPriorAssetId(assetId);document.getElementById('flow-continuation')?.scrollIntoView({behavior:'smooth',block:'start'});}}>Shu MP4dan keyingi sahna</button>}<button className="button" type="button" onClick={openLibrary}>Kutubxonani ochish</button><button className="button" type="button" disabled={busy} onClick={()=>void removeSaved()}><Trash2 size={15}/>O‘chirish</button></div></div>}
   <small className="muted">Bir fayl 1 GB gacha; shaxsiy kutubxona sig‘imi 5 GB. Telefon va kompyuterda MP4 tanlash mumkin.</small>
  </section>
 </div></div>;
}
