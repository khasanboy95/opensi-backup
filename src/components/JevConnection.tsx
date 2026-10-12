import {useEffect,useState} from 'react';
import {api} from '../api';
export function JevConnection({admin,toast}:{admin:boolean;toast:(s:string)=>void}) {
 const [state,setState]=useState<{enabled:boolean;model:string;lastTest:{created_at:string;duration_ms:number}|null}|null>(null),[busy,setBusy]=useState(false);
 const load=()=>api<NonNullable<typeof state>>('/jev').then(setState);useEffect(()=>{void load().catch(()=>{});},[]);
 return <article className="connection-row"><div className="connection-body"><h2>TypeSafe JEV <span className="small muted">{state?.enabled?'Ulangan':'Sozlanmagan'}</span></h2><p>Avtomatik nazoratchi: bosqich, texnik xato va model bandligini baholaydi. Mos modelni va keyingi tekshiruvni tavsiya qiladi. JEV javobi 700 ms ichida kelmasa, asosiy agent davom etadi. Kod yozish va haqiqiy testlarni bajarish asosiy modelda qoladi.</p>{state?.lastTest&&<small className="muted">Oxirgi javob: {state.lastTest.duration_ms} ms · {state.model}</small>}{admin&&<button className="button small-button" disabled={busy||!state?.enabled} onClick={async()=>{setBusy(true);try{const r=await api<{durationMs:number}>('/jev/test',{method:'POST',body:{}});await load();toast(`JEV javob berdi: ${r.durationMs} ms`);}catch(e){toast((e as Error).message);}finally{setBusy(false);}}}>{busy?'Tekshirilmoqda…':'JEV test'}</button>}</div></article>;
}
