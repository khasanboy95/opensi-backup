import {useEffect,useState} from 'react';
import {Cloud,ExternalLink,LoaderCircle,RefreshCw,Check} from 'lucide-react';
import {api} from '../api';
import {Badge,ErrorBox} from './Ui';

type Account={configured:boolean;authenticated?:boolean;connected:boolean;usable?:boolean;can_restore?:boolean;can_manage:boolean;shared?:boolean;models:{id:string;label:string}[];email?:string;pending?:boolean;authorizeUrl?:string|null;error?:string|null;tested_at?:string|null};
export function ZcodeConnection({refresh,toast}:{refresh:()=>Promise<void>;toast:(message:string)=>void}){
 const [account,setAccount]=useState<Account|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[model,setModel]=useState('');
 const load=async()=>{const value=await api<Account>('/zcode/account');setAccount(value);return value;};
 useEffect(()=>{void load().catch(e=>setError((e as Error).message));},[]);
 useEffect(()=>{if(model&&!account?.models.some(item=>item.id===model))setModel('');},[account?.models,model]);
 useEffect(()=>{if(!account?.pending)return;const timer=setInterval(()=>{void load().then(value=>{if(!value.pending)void refresh();}).catch(()=>{});},2500);return()=>clearInterval(timer);},[account?.pending,refresh]);
 async function action(name:'connect'|'models'|'test'|'disconnect'|'sharing'){
   setBusy(name);setError('');
   try{const result=await api<{authorizeUrl?:string;message?:string}>('/zcode/'+name,{method:name==='sharing'?'PATCH':'POST',body:name==='connect'?{shared:true}:name==='sharing'?{shared:!account?.shared}:name==='test'?{model:model||account?.models[0]?.id}:{}});await load();await refresh();if(result.message)toast(result.message);}
   catch(e){setError((e as Error).message);await load().catch(()=>{});await refresh().catch(()=>{});}finally{setBusy('');}
 }
 if(!account||!account.can_manage&&!account.connected)return null;
 return <article className="connection-row zcode-connection"><div className="connection-icon"><Cloud size={22}/></div><div className="connection-body">
   <div className="connection-title"><h2>ZCode · Z.ai hisobi</h2><Badge active={account.connected&&account.usable}>{account.pending?'Kirish kutilmoqda':account.connected?account.usable?'Javob tekshirilgan':'Kvota tiklanishi kutilmoqda':account.authenticated?'Hisob kirgan · Model hali ishlamadi':'Ulanmagan'}</Badge></div>
   <p>Hisobdagi GLM modellarini OpenSI agentlari va avtomatik modellar jamoasida ishlating. Bulut ulanishi telefon va kompyuterda ishlaydi.</p>
   <p className="small muted">Rasmiy CLI orqali kiriladi; kodlash modellari Z.ai Coding API orqali ishlaydi. ZCode ilovasi bepul, lekin desktop Start Plan sinovi CLI/API’da avtomatik ochilmaydi. Ushbu ulanish matn va vosita chaqiruvlarini qo‘llaydi.</p>
   {account.email&&<p className="small muted">{account.email}</p>}
   {!!account.models.length&&<div className="model-pills">{account.models.map(item=><span key={item.id}>{item.label}</span>)}</div>}
   {account.connected&&<p className="small muted">{account.shared?'Google orqali kirgan foydalanuvchilar uchun ochiq · Sarf egasining Z.ai hisobidan':'Faqat hisob egasiga ochiq'} · Kvota tugasa avtomatik jamoa boshqa ulangan modelga o‘tadi.</p>}
   {account.can_manage&&<div className="connection-actions">
     <button className="button button-primary" disabled={!!busy||!!account.pending||!account.configured} onClick={()=>void action('connect')}>{busy==='connect'&&<LoaderCircle size={15} className="spin"/>}{account.connected?'Z.ai hisobiga qayta kirish':'Z.ai hisobiga kirish'}</button>
     {account.authorizeUrl&&<a className="button" href={account.authorizeUrl} target="_blank" rel="noreferrer">Z.ai kirish oynasini ochish <ExternalLink size={14}/></a>}
     {account.can_restore&&!account.authenticated&&!account.pending&&<button className="button" disabled={!!busy} onClick={()=>void action('models')}>Saqlangan hisobni tekshirish</button>}
     {account.authenticated&&<><select aria-label="ZCode test modeli" value={model||account.models[0]?.id||''} onChange={e=>setModel(e.target.value)}>{account.models.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select><button className="button small-button" disabled={!!busy||!account.models.length} onClick={()=>void action('test')}><Check size={14}/>Javobni tekshirish</button><button className="button small-button" disabled={!!busy} onClick={()=>void action('models')}><RefreshCw size={14}/>Modellar</button><button className="button small-button" disabled={!!busy} onClick={()=>void action('sharing')}>{account.shared?'Umumiy foydalanishni yopish':'Google foydalanuvchilariga ochish'}</button><button className="text-button" disabled={!!busy} onClick={()=>void action('disconnect')}>Ulanishni uzish</button></>}
   </div>}
   {!account.configured&&account.can_manage&&<p className="small muted">ZCode runtime serverda tayyorlanishi kerak.</p>}
   {account.pending&&<p className="small muted">Yuqoridagi kirish oynasida Z.ai hisobingizga kiring. Parol OpenSI’ga berilmaydi; sahifa ulanishni avtomatik tekshiradi.</p>}
   {account.authenticated&&!account.connected&&<p className="small muted">Hisobga kirilgan, ammo model hali javob bermadi. Z.ai hisobida CLI/Coding Plan ruxsati va kvotani tekshiring, keyin “Javobni tekshirish”ni bosing. Muvaffaqiyatli javobdan keyin modellar umumiy foydalanish va avtomatik jamoaga qo‘shiladi.</p>}
   {(error||account.error)&&<ErrorBox message={error||account.error||''}/>}
   <a className="text-button" href="https://zcode.z.ai/en/docs/configuration" target="_blank" rel="noreferrer">ZCode ulanish va kvota hujjati <ExternalLink size={13}/></a>
 </div></article>;
}
