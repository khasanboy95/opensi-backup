import {useEffect,useState} from 'react';
import {Copy,ExternalLink,MessageCircle,RefreshCw,Send,Shield,Unplug} from 'lucide-react';
import {api} from '../api';
import {Badge,ErrorBox,Spinner} from './Ui';
import type {Project} from '../types';

type Status={connected:boolean;mcpUrl:string};
export function DotConnection({toast,projects,canRun,onRunPrompt}:{toast:(message:string)=>void;projects:Project[];canRun:boolean;onRunPrompt:(prompt:string,projectId?:string)=>Promise<void>}){
  const [status,setStatus]=useState<Status|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [prompt,setPrompt]=useState('');
  const [projectId,setProjectId]=useState('');
  const [sending,setSending]=useState(false);
  async function load(){try{setStatus(await api<Status>('/dot/connection'));setError('');}catch(e){setError((e as Error).message);}}
  useEffect(()=>{void load();},[]);
  async function copy(){if(!status)return;try{await navigator.clipboard.writeText(status.mcpUrl);toast('OpenSI MCP manzili nusxalandi.');}catch{toast('Manzilni belgilang va nusxalang.');}}
  async function revoke(){setBusy(true);try{await api('/dot/connection',{method:'DELETE'});await load();toast('Dotning OpenSI hisobiga ruxsati bekor qilindi.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function run(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(!prompt.trim()||sending)return;setSending(true);setError('');try{await onRunPrompt(prompt.trim(),projectId||undefined);setPrompt('');}catch(e){setError((e as Error).message);}finally{setSending(false);}}
  return <div className="connection-list">
    <article className="connection-row"><div className="connection-icon"><Shield size={22}/></div><div className="connection-body">
      <h2>ChatGPT’dagi dot → OpenSI loyihalari</h2>
      <p>Dot shu OpenSI hisobingizdagi loyihalarni ko‘radi, vazifa boshlaydi va jarayonini kuzatadi. OpenSI agenti tanlangan loyiha muhitida ishlaydi.</p>
      {status?<><p className="mono">{status.mcpUrl}</p><div className="connection-actions"><button className="button small-button" onClick={()=>void copy()}><Copy size={15}/>MCP manzilini nusxalash</button><a className="button small-button" href="https://chatgpt.com/plugins" target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>ChatGPT Plugins</a><button className="button small-button" onClick={()=>void load()}><RefreshCw size={15}/>Holatni yangilash</button>{status.connected&&<button className="button small-button" disabled={busy} onClick={()=>void revoke()}><Unplug size={15}/>Ulanishni uzish</button>}</div></>:<Spinner/>}
    </div>{status&&<Badge active={status.connected}>{status.connected?'Ulangan':'Ulanmagan'}</Badge>}</article>
    {status?.connected?<article className="connection-row dot-chat-card"><div className="connection-icon"><MessageCircle size={22}/></div><div className="connection-body"><h2>Dot bilan suhbatlashish</h2><p>Telefon yoki kompyuterda shu ChatGPT hisobingizni oching. Suhbatda <strong>@OpenSI Projects</strong> pluginini tanlab, masalan “OpenSI loyihalarimni ko‘rsat” deb yozing. Dot loyihani ochib, vazifani boshlaydi va natijasini tekshiradi.</p><div className="connection-actions"><a className="button button-primary" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>ChatGPT suhbatini ochish</a></div></div></article>:<article className="connection-row"><div className="connection-body"><h2>Dotga ulash</h2><ol><li>ChatGPT Plugins’da <strong>Add custom MCP server</strong> ni tanlang.</li><li>Yuqoridagi MCP manzilini kiriting va <strong>OAuth</strong> autentifikatsiyasini tanlang.</li><li>ChatGPT ochadigan OpenSI oynasida Google hisobingizga kiring va loyiha ruxsatini tasdiqlang.</li><li>Pluginni o‘rnating. So‘ng dotga “OpenSI loyihalarimni ko‘rsat” deb yozing.</li></ol><p className="small muted">Parol yoki API tokenini ChatGPT’ga yozish shart emas. Ulanish faqat kirgan OpenSI hisobingizning loyihalariga amal qiladi.</p></div></article>}
    <article className="connection-row dot-chat-card"><div className="connection-icon"><Send size={22}/></div><div className="connection-body"><h2>OpenSI ichidan vazifa yuborish</h2><p>Shu yerda yozilgan so‘rov OpenSI avtomatik agentiga yuboriladi. Javob va jarayon loyiha suhbatida ochiladi; telefonda ham davom ettirasiz.</p><form className="dot-quick-task" onSubmit={event=>void run(event)}><label htmlFor="dot-project">Loyiha</label><select id="dot-project" value={projectId} onChange={event=>setProjectId(event.target.value)}><option value="">Yangi bulut loyihasi</option>{projects.slice(0,100).map(project=><option key={project.id} value={project.id}>{project.title} · {project.environment==='cloud'?'Bulut':'Kompyuter'}</option>)}</select><label htmlFor="dot-prompt">Vazifa</label><textarea id="dot-prompt" rows={4} maxLength={30000} placeholder="Loyihamni tekshir, xatolarni tuzat va natijani ko‘rsat…" value={prompt} onChange={event=>setPrompt(event.target.value)}/><button className="button button-primary" type="submit" disabled={!canRun||!prompt.trim()||sending}><Send size={15}/>{sending?'Yuborilmoqda…':'Agentga yuborish'}</button>{!canRun&&<p className="small muted">Vazifa uchun online model kerak. Ulanishlarni tekshiring.</p>}</form></div></article>
    {error&&<ErrorBox message={error}/>}
  </div>;
}
