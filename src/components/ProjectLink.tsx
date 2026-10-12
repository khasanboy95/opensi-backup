import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {FolderOpen,Folder,ChevronRight,ArrowUp,RefreshCw,Monitor} from 'lucide-react';
import {api} from '../api';
import {Modal,ErrorBox} from './Ui';
import {selectBrowserProject,supportsBrowserFolder} from '../browser-workspace';
type Device={id:string;name:string;online:boolean;platform:string;hosted?:boolean;revoked?:number;capabilities:string[]};
type Listing={path:string;parent:string|null;entries:{label:string;path:string}[];more:boolean;nextOffset?:number;markers:string[]};
export function ProjectLink({onLinked}:{onLinked:(id:string)=>Promise<void>}){
 const [open,setOpen]=useState(false),[devices,setDevices]=useState<Device[]>([]),[nodeId,setNodeId]=useState(''),[view,setView]=useState<Listing|null>(null),[folderPath,setFolderPath]=useState(''),[busy,setBusy]=useState(false),[linking,setLinking]=useState(false),[error,setError]=useState('');
 const request=useRef(0),online=devices.find(d=>d.id===nodeId)?.online,available=devices.find(d=>d.id===nodeId)?.capabilities.includes('folder_browse_v1');
 useEffect(()=>{if(!open)return;let live=true;const refresh=async()=>{try{const result=(await api<Device[]>('/nodes')).filter(d=>!d.revoked&&!d.hosted&&d.platform!=='browser');if(!live)return;setDevices(result);setNodeId(old=>result.some(d=>d.id===old)?old:result.find(d=>d.online)?.id||result[0]?.id||'');}catch(e){if(live)setError((e as Error).message);}};void refresh();const timer=setInterval(()=>void refresh(),8000);return()=>{live=false;clearInterval(timer);request.current++;};},[open]);
 useEffect(()=>{if(!open||!nodeId||!online||!available){setView(null);return;}void browse('');},[open,nodeId,online,available]);
 async function browse(target:string,append=false){
  const version=++request.current;setBusy(true);setError('');
  try{const result=await api<Listing>('/projects/browse-folders',{method:'POST',body:{nodeId,path:target,offset:append?view?.nextOffset||0:0}});if(version!==request.current)return;setView(previous=>append&&previous?.path===result.path?{...result,entries:[...previous.entries,...result.entries]}:result);setFolderPath(result.path);}
  catch(e){if(version===request.current){setView(null);setError((e as Error).message);}}
  finally{if(version===request.current)setBusy(false);}
 }
 async function finish(browser=false){setLinking(true);setError('');try{const result=browser?await selectBrowserProject('',''):await api<{project:{id:string}}>('/projects/link-path',{method:'POST',body:{nodeId,path:view!.path}});await onLinked(result.project.id);setOpen(false);}catch(e){setError((e as Error).message);}finally{setLinking(false);}}
 return <><button className="button button-primary" onClick={()=>{setOpen(true);setError('');}}><FolderOpen size={18}/>Mavjud papkani ulash</button>{open&&createPortal(<Modal title="Kompyuterdagi loyihani ochish" onClose={()=>{if(!linking){setOpen(false);setBusy(false);}}}><div className="folder-picker">
  <p>Papkani oching va <strong>Shu loyihani davom ettirish</strong> tugmasini bosing. Fayllar kompyuteringizda qoladi.</p>
  <div className="folder-device"><Monitor size={18}/><select aria-label="Loyiha kompyuteri" value={nodeId} disabled={busy||linking} onChange={e=>{setView(null);setFolderPath('');setNodeId(e.target.value);}}><option value="" disabled>Kompyuterni tanlang</option>{devices.map(d=><option key={d.id} value={d.id}>{d.name} · {d.online?'Online':'Offline'}</option>)}</select><a className="button" href="#/connections/nodes" onClick={()=>setOpen(false)}>Kompyuter ulash</a></div>
  {!nodeId?<p className="muted">Avval kompyuteringizni ulang. Keyin uning disklari va papkalari shu yerda chiqadi.</p>:!online?<p role="status">Kompyuter offline. Unda OpenSI connectorini ishga tushiring — ulanish avtomatik yangilanadi.</p>:!available?<p role="status">Papka ko‘rish uchun kompyuterdagi connectorni yangilang. <a href="#/connections/nodes" onClick={()=>setOpen(false)}>Ulash bo‘limini ochish</a></p>:<>
   <form className="folder-address" onSubmit={e=>{e.preventDefault();if(!busy&&!linking)void browse(folderPath);}}><input aria-label="Mavjud loyiha papkasi yo‘li" value={folderPath} disabled={busy||linking} onChange={e=>setFolderPath(e.target.value)} placeholder={'D:\\Dastur 1\\14'}/><button className="button" disabled={busy||linking}>Ochish</button></form>
   <div className="folder-nav"><button className="button" disabled={busy||linking} onClick={()=>void browse('')}>Disklar va papkalar</button><button className="icon-button" aria-label="Yuqori papka" disabled={busy||linking||!view?.path} onClick={()=>void browse(view?.parent||'')}><ArrowUp size={18}/></button><button className="icon-button" aria-label="Papkalarni yangilash" disabled={busy||linking} onClick={()=>void browse(view?.path||'')}><RefreshCw size={17}/></button></div>
   <div className="folder-location" aria-live="polite">{busy?'Kompyuterdan o‘qilmoqda…':view?.path||'Disklar va mavjud loyihalar'}</div>
   <div className="folder-entries" aria-label="Kompyuterdagi papkalar" aria-busy={busy}>{view?.entries.map(entry=><button type="button" key={entry.path} disabled={busy||linking} title={entry.path} onClick={()=>void browse(entry.path)}><Folder size={19}/><span><strong>{entry.label}</strong>{!view.path&&<small>{entry.path}</small>}</span><ChevronRight size={17}/></button>)}{!busy&&view&&!view.entries.length&&<p className="muted">Ichki papka yo‘q. Shu papkani loyiha sifatida ochishingiz mumkin.</p>}{view?.more&&<button disabled={busy||linking} onClick={()=>void browse(view.path,true)}>Yana papkalarni ko‘rsatish</button>}</div>
   {!!view?.markers.length&&<small className="muted">Loyiha fayllari: {view.markers.join(' · ')}</small>}
   <button className="button button-primary folder-continue" disabled={busy||linking||!view?.path||!online} onClick={()=>void finish()}><FolderOpen size={18}/>{linking?'Loyiha ochilmoqda…':'Shu loyihani davom ettirish'}</button>
  </>}
  {error&&<ErrorBox message={error}/>}
  <details><summary>Connectorsiz brauzer papkasi</summary><p className="muted">Fayllarni tahrirlash mumkin. Terminal va dastur ishga tushirish uchun kompyuter ulanishi kerak.</p><button className="button" disabled={busy||linking||!supportsBrowserFolder()} onClick={()=>void finish(true)}>Brauzerda papka tanlash</button></details>
  <small className="muted">Telefondan ham shu online kompyuterda davom etasiz. Model vazifa uchun kerakli fayl qismlarini o‘qiydi.</small>
 </div></Modal>,document.body)}</>;
}
