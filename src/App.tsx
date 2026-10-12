import type {PersonalState} from './components/PersonalMemory';
import { useCallback, useEffect, useState } from 'react';
import {startBrowserWorkspaces} from './browser-workspace';
import { X, AlertCircle } from 'lucide-react';
import { api, ApiError } from './api';
import { Brand, GoogleMark } from './components/Brand';
import { Shell } from './components/Shell';
import { Spinner, ErrorBox } from './components/Ui';
import { Home } from './pages/Home';
import { Composer } from './components/Composer';
import { Tasks } from './pages/Tasks';
import { Workspace } from './pages/Workspace';
import { Connections } from './pages/Connections';
import { Agents } from './pages/Agents';
import { Admin } from './pages/Admin';
import { Settings } from './pages/Settings';
import {Library} from './pages/Library';
import {Skills} from './pages/Skills';
import {Flows} from './pages/Flows';
import {MediaStudio} from './pages/MediaStudio';
import {VideoStitch} from './pages/VideoStitch';
import {queueMontageAsset} from './montage-transfer';
import {Projects} from './pages/Projects';
import {Computer} from './pages/Computer';
import {CreativeStudio} from './pages/CreativeStudio';
import {isTextModel} from './model-capabilities';
import {DocumentCenter} from './components/DocumentCenter';
import {Dashboard} from './pages/Dashboard';
import {bindDestination,hasChosenFolder,deliver,deliveryFor} from './delivery';
import type { Agent, Attachment, AuthConfig, Node, Page, Project, Provider, Run, Selection, User } from './types';

function route() {
  const [page, id] = window.location.hash.replace(/^#\/?/, '').split('/');
  const allowed = ['home', 'personal', 'tasks', 'workspace', 'agents', 'connections', 'admin', 'settings', 'library', 'flows', 'media', 'montage', 'projects', 'computer', 'dashboard', 'creative', 'documents', 'skills'];
  return { page: (allowed.includes(page) ? page : 'home') as Page, id: id || '' };
}
function initialSelection(): Selection {
  try { const saved = JSON.parse(localStorage.getItem('opensi.preferences') || '{}'); return { model: typeof saved.model === 'string' ? saved.model : '', agent: saved.agent || 'developer', environment: saved.environment === 'local' ? 'local' : 'cloud', node: saved.node || '', autonomy:saved.autonomy==='guided'?'guided':'automatic',destination:['cloud','download','folder'].includes(saved.destination)?saved.destination:'cloud' }; }
  catch { return { model: '', agent: 'developer', environment: 'cloud', node: '' }; }
}

export default function App() {
  const [location, setLocation] = useState(route); const [user, setUser] = useState<User | null>(null); const [auth, setAuth] = useState<AuthConfig | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]); const [agents, setAgents] = useState<Agent[]>([]); const [projects, setProjects] = useState<Project[]>([]); const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [notification, setNotification] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false); const [collapsed, setCollapsed] = useState(false); const [selection, setSelection] = useState<Selection>(initialSelection);
  const [personal,setPersonal]=useState<PersonalState|null>(null);
  const [draft, setDraft] = useState(''); const [busy, setBusy] = useState(false); const [resolvedRun, setResolvedRun] = useState('');
  const [projectOpenError,setProjectOpenError]=useState(''),[projectEmpty,setProjectEmpty]=useState(false),[projectOpenAttempt,setProjectOpenAttempt]=useState(0);
  const toast = useCallback((text: string) => setNotification(text), []);
  useEffect(()=>{if(user&&location.page==='personal')void api<PersonalState>('/personal').then(setPersonal).catch(e=>toast(e.message));},[user?.id,location.page,toast]);
  const refresh = useCallback(async () => {
    const [me, p, a, projects, nodes] = await Promise.all([api<{ user: User; auth: AuthConfig }>('/me'), api<Provider[]>('/providers'), api<Agent[]>('/agents'), api<Project[]>('/projects'), api<Node[]>('/nodes')]);
    setUser(me.user); setAuth(me.auth); setProviders(p); setAgents(a); setProjects(projects); setNodes(nodes);
    setSelection(current => {
      const valid = p.some(provider => provider.enabled && provider.models.some(model => isTextModel(provider,model) && JSON.stringify([provider.id, model]) === current.model));
      const chosen=p.find(provider=>provider.enabled&&provider.models.some(m=>JSON.stringify([provider.id,m])===current.model));
      const native=chosen?.protocol==='antigravity-cli'?{environment:chosen.hosted?'cloud' as const:'local' as const,node:chosen.hosted?'':chosen.node_id||''}:{};
      const first = p.find(provider => provider.enabled && provider.models.some(m=>isTextModel(provider,m)));
      return { ...current,...native,userId:me.user.id, model: valid ? current.model : first ? JSON.stringify([first.id, first.models.find(m=>isTextModel(first,m))]) : '', agent: a.some(agent => agent.id === current.agent) ? current.agent : 'developer' };
    });
  }, []);
  useEffect(()=>{if(user)return startBrowserWorkspaces(user.id);},[user?.id]);
  const go = useCallback((page: Page, id?: string) => { window.location.hash = `/${page}${id ? '/' + id : ''}`; }, []);
  const newTask = () => { setDraft(''); go('home'); };
  useEffect(() => { const change = () => setLocation(route()); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  useEffect(() => {
    let mounted = true;
    void refresh().catch(async error => { if (!mounted) return; if (error instanceof ApiError && error.status === 401) { setAuth(await api<AuthConfig>('/auth/config')); setUser(null); } else setError(error.message); }).finally(() => { if (mounted) setLoading(false); });
    const signInError = new URLSearchParams(window.location.search).get('signin_error'); if (signInError) toast(signInError);
    return () => { mounted = false; };
  }, [refresh, toast]);
  useEffect(() => { if (!notification) return; const timer = setTimeout(() => setNotification(''), 6500); return () => clearTimeout(timer); }, [notification]);
  useEffect(() => { localStorage.setItem('opensi.preferences', JSON.stringify(selection)); }, [selection]);
  useEffect(() => { if (!user) return; const timer = setInterval(() => { void Promise.all([api<Node[]>('/nodes'),api<Provider[]>('/providers')]).then(([n,p])=>{setNodes(n);setProviders(p);}).catch(()=>{}); }, 12000); return () => clearInterval(timer); }, [user?.id]);
  useEffect(() => {
    if (!user) return;
    let last = 0;
    const focus = () => { if (document.visibilityState === 'visible' && Date.now() - last > 5000) { last = Date.now(); void refresh().catch(() => {}); } };
    window.addEventListener('focus', focus);document.addEventListener('visibilitychange',focus);
    return () => window.removeEventListener('focus', focus);document.removeEventListener('visibilitychange',focus);
  }, [user?.id, refresh]);
  useEffect(() => {
    setResolvedRun('');setProjectOpenError('');setProjectEmpty(false);
    if (!user?.id||location.page !== 'workspace' || !location.id.startsWith('project:')) return;
    const projectId = location.id.slice(8);
    let live=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    void api<{id:string}>(`/projects/${projectId}/latest-run`,{signal:controller.signal}).then(run=>{if(live)setResolvedRun(run.id);}).catch(error=>{if(live){if(error instanceof ApiError&&error.status===404)setProjectEmpty(true);else setProjectOpenError(controller.signal.aborted?'Loyiha javobini kutish vaqti tugadi. Qayta oching.':error.message);}}).finally(()=>clearTimeout(timer));
    return()=>{live=false;clearTimeout(timer);controller.abort();};
  }, [location.page, location.id, user?.id, projectOpenAttempt]);

  async function submit(prompt: string, attachments: Attachment[], projectId?: string, personalChat=false) {
    // An explicit path on the first line is human intent to link a folder, not a model tool.
    const lines=prompt.trim().split(/\r?\n/),first=lines[0].trim().replace(/^"(.*)"$/,'$1');
    if(!projectId&&!personalChat&&(/^[a-zA-Z]:[\\/]/.test(first)||/^\/(?!\/)[^\s]/.test(first))){
      const linked=await api<{project:Project}>('/projects/link-path',{method:'POST',body:{path:first,nodeId:selection.environment==='local'&&selection.node?selection.node:undefined}});
      projectId=linked.project.id;
      setSelection({...selection,environment:'local',node:linked.project.node_id||''});
      prompt=lines.slice(1).join('\n').trim();
      if(!prompt&&!attachments.length){setDraft('');await refresh();go('workspace','project:'+projectId);return;}
      prompt||='Mavjud loyiha va biriktirilgan fayllarni tekshiring. Avval joriy holatni aniqlang.';
    }
    if (!selection.model) { go('connections'); throw new Error('Avval API ulang va model tanlang.'); }
    const [providerId, model] = JSON.parse(selection.model);
    if(!projectId&&selection.environment==='cloud'&&selection.destination==='folder'&&!hasChosenFolder(user!.id))throw new Error('Natijalar saqlanadigan papkani tanlang.');
    const result = await api<{ run: Run; project: Project }>('/runs', { method: 'POST', body: { prompt:prompt.trim()||'Biriktirilgan fayllarni tekshiring va tarkibini tushuntiring.', providerId, model, agentId: selection.agent,autonomy:projectId?undefined:(selection.autonomy||'automatic'),
      personal:personalChat,environment: selection.environment, nodeId: selection.node || null, projectId: projectId || null, attachmentIds: attachments.map(file => file.id) } });
    if(!projectId&&result.project.environment==='cloud')try{await bindDestination(user!.id,result.project.id,selection.destination||'cloud');}catch(e){toast((e as Error).message);}
    setDraft(''); await refresh(); go('workspace', result.run.id);
  }
  async function submitDotPrompt(prompt: string, projectId?: string) {
    const result=await api<{run:Run}>('/runs',{method:'POST',body:{prompt:prompt.trim(),providerId:'auto',model:'auto',agentId:'developer',autonomy:'automatic',environment:'cloud',nodeId:null,projectId:projectId||null,attachmentIds:[]}});
    await refresh();go('workspace',result.run.id);
  }
  useEffect(()=>{if(!user)return;let stopped=false,running=false;const scan=async()=>{if(running||stopped)return;running=true;try{const runs=await api<Run[]>('/runs');const seen=new Set<string>();for(const run of runs){if(stopped)break;if(run.status!=='completed'||run.environment!=='cloud'||seen.has(run.project_id))continue;seen.add(run.project_id);const dest=await deliveryFor(user.id,run.project_id);if(!dest||dest.done===run.id||dest.error||new Date(run.created_at).getTime()<dest.after)continue;try{const message=await deliver(user.id,run.project_id,run.id);if(message)toast(message);}catch(e){toast((e as Error).message);}}}catch{/* Manual download stays available. */}finally{running=false;}};void scan();const timer=setInterval(()=>void scan(),10000);return()=>{stopped=true;clearInterval(timer);};},[user?.id,toast]);
  function login() { if (!auth?.configured) { toast('Google OAuth hali sozlanmagan. Google Client ID va Client Secretni kiriting.'); go('settings'); } else window.location.href = '/api/auth/google'; }
  async function logout() { try { await api('/auth/logout', { method: 'POST', body: {} }); window.location.href = '/'; } catch (error) { toast((error as Error).message); } }
  const composer = { draft, setDraft, selection, setSelection, providers, agents, nodes, busy, onConnect: () => go('connections'), toast,
    onSubmit: async (attachments: Attachment[]) => { setBusy(true); try { await submit(draft, attachments); } finally { setBusy(false); } } };
  const runId = location.id.startsWith('project:') ? resolvedRun : location.id;

  if (loading) return <div className="boot-screen"><Brand size={40}/><Spinner label="OpenSI ochilmoqda..."/></div>;
  if (error && !user) return <div className="boot-screen"><Brand size={40}/><ErrorBox message={error}/><button className="button" onClick={() => window.location.reload()}>Qayta urinish</button></div>;
  return <>{!user ? <main className="login-screen"><div className="login-brand"><Brand size={34}/><strong>OpenSI</strong></div><div><h1>Sizning ish maydoningiz.</h1><p>Agentlar, modellar va loyihalar. Har qanday qurilmadan.</p><button className="button button-primary login-button" disabled={!auth?.configured} onClick={() => window.location.href = '/api/auth/google'}><GoogleMark/>Google bilan kirish</button>{!auth?.configured && <p className="small muted">Administrator Google OAuth ulanishini sozlashi kerak.</p>}</div></main> : <Shell page={location.page} user={user} auth={auth!} projects={projects} open={sidebarOpen} setOpen={setSidebarOpen} collapsed={collapsed} setCollapsed={setCollapsed} go={go} newTask={newTask} onLogin={login} onLogout={() => void logout()}>
    {location.page === 'home' && <Home composer={composer} connected={providers.some(provider => provider.enabled)} onConnect={() => go('connections')}/>}
    {location.page === 'personal' && <><div className="page"><h1>Davomiy suhbat</h1><p className="muted">Bitta suhbat, saqlangan kontekst va shaxsiy xotira. Modelni almashtirsangiz ham loyiha tarixi qoladi.</p><div className="suggestions">{personal?.lastRun&&<button className="button button-primary" onClick={()=>go('workspace',personal.lastRun!.id)}>Suhbatni davom ettirish</button>}<button className="button" onClick={()=>go('settings')}>Xotirani boshqarish</button><button className="button" onClick={()=>go('connections')}>Ulangan hisoblar</button></div>{personal?.projectId&&<p className="small muted">Suhbat mavjud loyiha muhitida davom etadi. Alohida papka yoki yangi loyiha uchun Yangi vazifani tanlang.</p>}</div><Home composer={{...composer,onSubmit:async attachments=>{setBusy(true);try{await submit(draft,attachments,personal?.projectId||undefined,true);}finally{setBusy(false);}}}} connected={providers.some(p=>p.enabled)} onConnect={()=>go('connections')}/></>}
    {location.page === 'tasks' && <Tasks openRun={id => go('workspace', id)} newTask={newTask} projects={projects}/>}
    {location.page === 'workspace' && (runId ? <Workspace key={runId} userId={user.id} runId={runId} providers={providers} agents={agents} nodes={nodes} selection={selection} setSelection={setSelection} onSubmit={submit} refresh={refresh} toast={toast} onConnect={() => go('connections')} onBack={() => go('tasks')}/> : projectEmpty?<section className="page"><h1>{projects.find(project=>project.id===location.id.slice(8))?.title||'Loyiha'}</h1><p className="muted">Bu loyihada hozir ko‘rinadigan vazifa yo‘q. Ishni shu loyiha fayllaridan davom ettiring.</p><Composer {...composer} onSubmit={async attachments=>{setBusy(true);try{await submit(draft,attachments,location.id.slice(8));}finally{setBusy(false);}}}/></section>:projectOpenError?<section className="page"><ErrorBox message={projectOpenError}/><button className="button" onClick={()=>setProjectOpenAttempt(v=>v+1)}>Loyihani qayta ochish</button></section>:<Spinner/>)}
    {location.page === 'library' && <Library projects={projects} toast={toast}/>}
    {location.page === 'skills' && <Skills toast={toast}/>}
    {location.page === 'flows' && <Flows providers={providers} agents={agents} openRun={id=>go('workspace',id)}/>}
    {location.page === 'creative' && <CreativeStudio providers={providers} go={go} openRun={id=>{void refresh();go('workspace',id);}}/>}
    {location.page === 'media' && <MediaStudio openLibrary={()=>go('library')} addToMontage={assetId=>{queueMontageAsset(user.id,assetId);go('montage');}}/>}
    {location.page === 'montage' && <section className="page studio-page"><header className="page-heading"><div><span className="eyebrow">VIDEO TAHRIRI</span><h1>Video montaj</h1><p>Kliplarni tartiblang, kesing va yakuniy MP4ni shu yerda ko‘ring.</p></div><button className="button" onClick={()=>go('media')}>Media studiyaga qaytish</button></header><VideoStitch key={user.id} userId={user.id} initialAssetId={location.id}/></section>}
    {location.page === 'projects' && <Projects projects={projects} refresh={refresh} toast={toast} openProject={id=>go('workspace',`project:${id}`)}/>}
    {location.page === 'computer' && <Computer projects={projects} openProject={id=>go('workspace',`project:${id}`)}/>}
    {location.page === 'documents' && <div className="page"><DocumentCenter/></div>}
    {location.page === 'dashboard' && <Dashboard projects={projects} providers={providers} openRun={id=>{void refresh();go('workspace',id);}} openProject={id=>go('workspace',`project:${id}`)}/>}
    {location.page === 'agents' && <Agents agents={agents} providers={providers} refresh={refresh} toast={toast} startWithAgent={agent => { setSelection({ ...selection, agent }); go('home'); }}/>}
    {location.page === 'connections' && <Connections section={location.id} onSelectNode={nodeId=>{setSelection(current=>({...current,environment:'local',node:nodeId}));go('home');toast('Lokal muhit tanlandi. Fayllar kompyuteringizda ishlatiladi.');}} onDotPrompt={submitDotPrompt} providers={providers} nodes={nodes} projects={projects} user={user} auth={auth!} refresh={refresh} toast={toast} openSettings={() => go('settings')}/>}
    {location.page === 'admin' && (user.role === 'admin' ? <Admin openSettings={() => go('settings')} toast={toast}/> : <section className="page"><ErrorBox message="Admin panel faqat administrator uchun."/></section>)}
    {location.page === 'settings' && <Settings user={user} refresh={refresh} toast={toast} openConnections={() => go('connections')}/>}
  </Shell>}
  {notification && <div className="toast" role="status"><AlertCircle size={17}/><span>{notification}</span><button className="icon-button" aria-label="Bildirishnomani yopish" onClick={() => setNotification('')}><X size={15}/></button></div>}</>;
}
