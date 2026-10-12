import {useState} from 'react';
import {Upload,FolderInput} from 'lucide-react';
import {api} from '../api';
import {Modal,ErrorBox} from './Ui';
export function ProjectImport({onImported}:{onImported:(id:string)=>Promise<void>}){
 const [open,setOpen]=useState(false),[file,setFile]=useState<File|null>(null),[title,setTitle]=useState(''),[notes,setNotes]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[phase,setPhase]=useState('');
 return <><button className="button" onClick={()=>setOpen(true)}><FolderInput size={18}/>ZIP nusxasini bulutga yuklash</button>{open&&<Modal title="Loyihani OpenSI’da davom ettirish" onClose={()=>{if(!busy)setOpen(false);}}><form className="studio-form" onSubmit={async e=>{e.preventDefault();if(!file)return;setBusy(true);setError('');try{setPhase('ZIP yuklanmoqda…');const response=await fetch('/api/uploads',{method:'POST',headers:{'content-type':'application/octet-stream','x-opensi-client':'web','x-file-name':encodeURIComponent(file.name)},body:file});const uploaded=await response.json();if(!response.ok)throw Error(uploaded.error||'ZIP yuklanmadi.');setPhase('Manbalar tekshirilib, loyiha tayyorlanmoqda…');const result=await api<{project:{id:string}}>('/projects/import',{method:'POST',body:{assetId:uploaded.assetId,title,notes}});setOpen(false);await onImported(result.project.id);}catch(e){setError((e as Error).message);}finally{setBusy(false);setPhase('');}}}>
 <p>Kod, hujjat va aktivlarni ZIP qilib tanlang. Import yangi nusxa yaratadi; davom ettirish uchun keyin vazifa yozasiz.</p>
 <label>Loyiha ZIP fayli<input type="file" accept=".zip" disabled={busy} required onChange={e=>{const f=e.target.files?.[0]||null;setFile(f);if(f&&!title)setTitle(f.name.replace(/\.zip$/i,'').slice(0,100));}}/></label>
 <label>Loyiha nomi<input required maxLength={100} value={title} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label>
 <label>Oldingi holat va davom ettirish izohi<textarea rows={5} maxLength={12000} value={notes} disabled={busy} placeholder="Nima tayyor, nima qolgan, qaysi fayl muhim, qanday tekshiriladi…" onChange={e=>setNotes(e.target.value)}/></label>
 <small className="muted">.env, tokenlar, bazalar, node_modules va kesh ko‘chirilmaydi. API ulanishlarini Ulanishlar bo‘limida sozlang. Import: 3000 fayl, jami 500 MB ochilgan manba; build holati keyin tekshiriladi.</small>
 {error&&<ErrorBox message={error}/>}<button className="button button-primary" disabled={busy||!file||!title.trim()}><Upload size={17}/>{phase||'Import qilish'}</button>
 </form></Modal>}</>;
}
