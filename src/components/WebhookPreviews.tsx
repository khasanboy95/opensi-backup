import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {api} from '../api';
import {ErrorBox,Badge} from './Ui';
interface Preview {sessionId:string;projectId:string;state:string;url:string;persistent:boolean;expiresAt:string|null;entry:string;received:number;error:string|null;updates:{update_id:number;state:string;status:number|null;reply_method:string|null}[]}
export function WebhookPreviews(){
 const [items,setItems]=useState<Preview[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState('');
 async function load(){try{setItems(await api<Preview[]>('/webhook-previews'));setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),10000);return()=>clearInterval(timer);},[]);
 const states:Record<string,string>={active:'Ishlayapti',opening:'Ulanmoqda',closing:'Yopilmoqda',closed:'Yopilgan'};
 return <div className="webhook-previews"><div className="section-heading"><div><h2>Botlar va webhook</h2><p className="muted">Agentga: “Shu loyihadagi botning asosiy vazifasini tekshir va bulutda doimiy ishga tushir” deb yozing.</p></div><button className="button" aria-label="Webhook sinovlarini yangilash" onClick={()=>void load()}><RefreshCw size={16}/></button></div>
 <p className="small muted">Bot bulutda telefoningizdan ham boshqariladi; kompyuter yoqilgan bo‘lishi shart emas. Node.js fetch va Python requests/urllib orqali ochiq HTTPS manbalari va RSS ishlaydi. Bot javobni Telegram webhook orqali qaytaradi.</p>
 {error&&<ErrorBox message={error}/>}
 {!items.length&&<p className="muted">Hali webhook sinovi yo‘q. Agent avval kodni yozib, avtomatik HTTP testdan o‘tkazadi.</p>}
 {items.map(item=><article className="connection-row" key={item.sessionId}><div className="connection-body"><h3>{item.entry}</h3><Badge active={item.state==='active'}>{states[item.state]||item.state}</Badge><p>{item.received} ta xabar · {item.persistent?'Doimiy bulut rejimi':item.expiresAt?'Tugashi: '+new Date(item.expiresAt).toLocaleString('uz-UZ'):'—'}</p><code style={{overflowWrap:'anywhere'}}>{item.url}</code>{item.error&&<ErrorBox message={item.error}/>}<details><summary>Xabarlarni tekshirish</summary>{item.updates.length?<ul>{item.updates.map(u=><li key={u.update_id}>#{u.update_id} · {u.state==='completed'?'Handler javob berdi':u.state==='failed'?'Xatolik':'Bajarilmoqda'} · HTTP {u.status??'—'} {u.reply_method?'· '+u.reply_method:''}</li>)}</ul>:<p>Telegramda botning asosiy buyrug‘ini yuboring. Hali haqiqiy xabar qabul qilinmagan.</p>}<small>HTTP javobi Telegram foydalanuvchisiga yetib borganini alohida tekshiring.</small></details></div>{item.state!=='closed'&&<button className="button" disabled={!!busy} onClick={async()=>{setBusy(item.sessionId);try{await api('/webhook-previews/'+item.sessionId+'/close',{method:'POST',body:{}});await load();}catch(e){setError((e as Error).message);}finally{setBusy('');}}}>{busy===item.sessionId?'Yopilmoqda…':item.persistent?'Botni to‘xtatish':'Sinovni yopish'}</button>}</article>)}
 </div>;
}
