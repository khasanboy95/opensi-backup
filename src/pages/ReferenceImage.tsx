import {useEffect,useState} from 'react';
import {Download,ImagePlus,Upload} from 'lucide-react';
import {api} from '../api';
import {ErrorBox} from '../components/Ui';
import type {Asset} from './Library';

type MediaModel={providerId:string;provider:string;model:string;kind:string};
type Job={id:string;status:string;asset_id:string|null;error:string|null};

export function ReferenceImage({models,assets,jobs,assetId,onPick,description,onDescription,apiGenerationEnabled}:{models:MediaModel[];assets:Asset[];jobs:Job[];assetId:string;onPick:(id:string)=>void;description:string;onDescription:(value:string)=>void;apiGenerationEnabled:boolean}){
 const imageModels=models.filter(model=>model.kind==='image');
 const [model,setModel]=useState(''),[source,setSource]=useState(''),[ratio,setRatio]=useState('16:9');
 const [jobId,setJobId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const picked=imageModels.find(item=>JSON.stringify([item.providerId,item.model])===model)||imageModels[0];
 const reference=assets.find(asset=>asset.id===assetId);
 const job=jobs.find(item=>item.id===jobId);
 useEffect(()=>{if(job?.status==='completed'&&job.asset_id){onPick(job.asset_id);setJobId('');}},[job?.status,job?.asset_id,jobId,onPick]);
 const generate=async()=>{
  if(!picked||!description.trim()||busy)return;
  setBusy(true);setError('');
  try{
   const created=await api<Job>('/media/jobs',{method:'POST',body:{requestKey:crypto.randomUUID(),providerId:picked.providerId,model:picked.model,text:description.trim(),aspectRatio:ratio,assetId:source||undefined}});
   setJobId(created.id);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };
 const upload=async(file?:File)=>{
  if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size<1||file.size>4_000_000){setError('4 MB gacha PNG, JPEG yoki WebP tanlang.');return;}
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/uploads',{method:'POST',headers:{'content-type':'application/octet-stream','x-opensi-client':'web','x-file-name':encodeURIComponent(file.name)},body:file});
   const value=await response.json() as {assetId?:string;error?:string};
   if(!response.ok||!value.assetId)throw new Error(value.error||'Reference rasm yuklanmadi.');
   onPick(value.assetId);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };
 return <section className="studio-panel studio-form reference-workspace">
  <div className="studio-actions"><ImagePlus size={21}/><h2>Doimiy reference kadr</h2></div>
  <p>Qahramon, mahsulot, kiyim, rang va fonni bir marta tavsiflang. Yaratilgan yoki yuklangan rasmni keyingi videolarda qayta ishlatish vizual izchillikni oshiradi; aynan bir xil natija kafolatlanmaydi.</p>
  <div className="reference-layout"><div className="studio-form">
   <label>{apiGenerationEnabled?'Rasm uchun prompt':'Reference tavsifi'}<textarea rows={3} maxLength={3500} value={description} onChange={event=>onDescription(event.target.value)} placeholder="Qahramonning yuzi, kiyimi, joy, ranglar va kadr kompozitsiyasini aniq yozing…"/></label>
   {apiGenerationEnabled&&<><div className="reference-controls"><label>Rasm modeli<select value={picked?JSON.stringify([picked.providerId,picked.model]):''} onChange={event=>setModel(event.target.value)} disabled={!imageModels.length}>{imageModels.length?imageModels.map(item=><option key={JSON.stringify([item.providerId,item.model])} value={JSON.stringify([item.providerId,item.model])}>{item.model} · {item.provider}</option>):<option value="">Rasm API ulanmagan</option>}</select></label><label>Nisbat<select value={ratio} onChange={event=>setRatio(event.target.value)}>{['16:9','9:16','1:1','4:3','3:4'].map(item=><option key={item}>{item}</option>)}</select></label></div><label>Avvalgi rasmni tahrirlash (ixtiyoriy)<select value={source} onChange={event=>setSource(event.target.value)}><option value="">Promptdan yangi rasm</option>{assets.filter(item=>item.mime.startsWith('image/')&&item.size<=4_000_000).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label></>}
   <div className="studio-actions">{apiGenerationEnabled&&<button type="button" className="button button-primary" onClick={()=>void generate()} disabled={!picked||!description.trim()||busy||job?.status==='running'||jobs.some(item=>item.status==='running')}><ImagePlus size={16}/>{job?.status==='running'?'Rasm yaratilmoqda…':'Promptdan rasm yaratish'}</button>}<label className="button reference-upload"><Upload size={16}/>Rasm yuklash<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event=>{void upload(event.target.files?.[0]);event.target.value='';}}/></label></div>
   <small className="muted">{apiGenerationEnabled?'Promptdan rasm yaratish ulangan Gemini API hisobidan sarflanadi.':'Rasmni tanlangan video xizmatida yaratib, keyin shu yerga yuklang. Bu yuklash API kreditini sarflamaydi.'}</small>
   {job?.status==='failed'&&<ErrorBox message={job.error||'Rasm yaratilishi muvaffaqiyatsiz.'}/>} {error&&<ErrorBox message={error}/>}
  </div><div className="reference-preview"><label>Tanlangan reference<select value={assetId} onChange={event=>onPick(event.target.value)}><option value="">Reference tanlanmagan</option>{assets.filter(item=>item.mime.startsWith('image/')).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{assetId&&<><img src={`/api/library/${assetId}/content?inline=true`} alt={reference?.name||'Tanlangan reference rasm'}/><a className="button" href={`/api/library/${assetId}/content`}><Download size={15}/>Reference rasmni yuklab olish</a></>}{!assetId&&<p className="muted">Yaratilgan rasm shu yerda paydo bo‘ladi.</p>}</div></div>
 </section>;
}
