import {Publish} from '../components/Publish';
import {DeploymentsPanel} from '../components/AutomationConnections';
import {fileReference} from '../file-reference';
import {DocumentCenter} from '../components/DocumentCenter';
import {ArtifactEditor} from '../components/ArtifactEditor';
import {Computer} from './Computer';
import {DeliveryPanel} from '../components/DeliveryPanel';
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, CheckCircle2, Code2, Download, FileCode2, Maximize2, Monitor, Smartphone, Terminal, Activity, RefreshCw, LoaderCircle, AlertCircle, ArrowRight, Copy, Save, Cloud, ChevronLeft } from 'lucide-react';
import { PlanCard, VersionsPanel, BrowserPanel } from '../components/ProjectTools';
import { Composer } from '../components/Composer';
import {ParallelTasks} from '../components/ParallelTasks';
import {ComposerPanel} from '../components/ComposerPanel';
import { Brand } from '../components/Brand';
import { Badge, Empty, ErrorBox, Spinner } from '../components/Ui';
import { DraftCard, RunProgress, ToolCard, bytesLabel, phaseLabel, toolLabels } from '../components/RunProgress';
import { applyRunEvent, toolActivities } from '../run-stream';
import { api, dateTime, downloadText, number } from '../api';
import { isActive, statusLabels, type Agent, type Approval, type Attachment, type FileInfo, type Node, type Provider, type RunDetail, type RunEvent, type SavedMessage, type Selection } from '../types';

const terminalText = (value: string) => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');

export function Workspace({ userId,runId, providers, agents, nodes, selection, setSelection, onSubmit, refresh, toast, onConnect, onBack }: {
  userId:string;runId: string; providers: Provider[]; agents: Agent[]; nodes: Node[]; selection: Selection; setSelection: (value: Selection) => void;
  onSubmit: (draft: string, attachments: Attachment[], projectId: string) => Promise<void>; refresh: () => Promise<void>;
  toast: (text: string) => void; onConnect: () => void; onBack: () => void;
}) {
  const view = useMemo(() => { try { return JSON.parse(sessionStorage.getItem('opensi.view.' + runId) || '{}') as { tab?: string; file?: string; draft?: string; mobile?: boolean }; } catch { return {}; } }, [runId]);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState(''); const [draft, setDraft] = useState(''); const [busy, setBusy] = useState(false);
  const parallelRequest=useRef<{key:string;id:string}|null>(null);
  const [recovering, setRecovering] = useState('');
  const [tab, setTab] = useState(['deployments', 'documents', 'preview', 'code', 'terminal', 'activity', 'versions', 'browser', 'computer'].includes(view.tab || '') ? view.tab! : 'preview'); const [mobilePanel, setMobilePanel] = useState(view.mobile || false);
  const [files, setFiles] = useState<FileInfo[]>([]); const [filesSource, setFilesSource] = useState('');
  const [selectedFile, setSelectedFile] = useState(view.file || ''); const [draftKey, setDraftKey] = useState(view.draft || '');
  const [code, setCode] = useState(''); const [savedCode, setSavedCode] = useState(''); const [fileLoading, setFileLoading] = useState(false); const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<string | null>(null); const [previewMessage, setPreviewMessage] = useState(''); const [previewWidth, setPreviewWidth] = useState('desktop');
  const [connected, setConnected] = useState(true); const [now, setNow] = useState(Date.now);
  const [split, setSplit] = useState(() => { try { const value=Number(localStorage.getItem('opensi.split.'+userId));return value>=20&&value<=80?value:43; } catch { return 43; } });
  const [resizing,setResizing]=useState(false);
  const [jump, setJump] = useState<{path:string;line:number;key:number}|null>(null);
  const workspaceRef=useRef<HTMLElement>(null);
  const resizeStart=useRef<{id:number;x:number;percent:number}|null>(null);
  useEffect(()=>{try{localStorage.setItem('opensi.split.'+userId,String(split));}catch{/* Layout still works when storage is unavailable. */}},[split,userId]);
  function resizeTo(value:number){const width=(workspaceRef.current?.getBoundingClientRect().width||1000)-8;const min=Math.max(20,Math.min(45,280/width*100));setSplit(Math.max(min,Math.min(100-min,value)));}
  const scrollRef = useRef<HTMLDivElement>(null); const previewRef = useRef<HTMLDivElement>(null); const editorRef = useRef<HTMLTextAreaElement>(null); const gutterRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(view.file || ''); const projectRef = useRef(''); const detailRef = useRef<RunDetail | null>(null); const dirtyRef = useRef(false);
  const versionRef = useRef(''); const mountedRef = useRef(true); const stickToBottom = useRef(true); const initialSelection = useRef(false);
  const fileRequest = useRef(0); const fileListRequest = useRef(0); const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = !!detail && isActive(detail.run.status);
  detailRef.current = detail; dirtyRef.current = code !== savedCode;
  useEffect(() => { try { sessionStorage.setItem('opensi.view.' + runId, JSON.stringify({ tab, file: selectedFile, draft: draftKey, mobile: mobilePanel })); } catch { /* A blocked storage API must not stop the run. */ } }, [runId, tab, selectedFile, draftKey, mobilePanel]);

  const openFile = useCallback(async (projectId: string, name: string, background = false) => {
    if (dirtyRef.current) { if (!background) toast('Avval kodni saqlang yoki o‘zgarishni bekor qiling.'); return; }
    const request = ++fileRequest.current;
    selectedRef.current = name; setSelectedFile(name); setDraftKey(''); if (!background) setFileLoading(true);
    try {
      const result = await api<{ content: string }>(`/projects/${projectId}/file?path=${encodeURIComponent(name)}`);
      if (mountedRef.current && request === fileRequest.current && !dirtyRef.current) { setCode(result.content); setSavedCode(result.content); }
    } catch (error) { if (mountedRef.current && request === fileRequest.current && !background) toast((error as Error).message); }
    finally { if (mountedRef.current && request === fileRequest.current) setFileLoading(false); }
  }, [toast]);

  const loadFiles = useCallback(async (projectId: string, forcePreview = false) => {
    const request = ++fileListRequest.current;
    try {
      const result = await api<{ files: FileInfo[]; source: string }>(`/projects/${projectId}/files`);
      if (!mountedRef.current || request !== fileListRequest.current) return;
      const version = JSON.stringify(result.files.map(file => [file.path, file.size, file.updated_at]));
      const changed = version !== versionRef.current;
      setFiles(result.files); setFilesSource(result.source);
      if (changed) {
        versionRef.current = version;
        const target = result.files.find(file => file.path === selectedRef.current) || result.files.find(file => file.path === 'index.html') || result.files[0];
        const writing = detailRef.current?.live?.drafts.some(item => item.path === target?.path && item.state === 'writing');
        if (target && !writing && (!selectedRef.current || target.path === selectedRef.current)) void openFile(projectId, target.path, true);
      }
      if (changed || forcePreview) {
        const value = await api<{ url: string | null; message?: string }>(`/projects/${projectId}/preview`);
        if (mountedRef.current && request === fileListRequest.current) { setPreview(value.url); setPreviewMessage(value.message || ''); }
      }
    } catch (error) { if (mountedRef.current && forcePreview) toast((error as Error).message); }
  }, [openFile, toast]);

  const snapshot = useCallback(async () => {
    const value = await api<RunDetail>('/runs/' + runId);
    if (!mountedRef.current) return;
    projectRef.current = value.project.id;
    setDetail(current => !current || value.cursor >= current.cursor ? value : current);
    setError('');
    return value;
  }, [runId]);

  useEffect(() => {
    mountedRef.current = true;
    void snapshot().then(value => { if (value) void loadFiles(value.project.id, true); }).catch(error => { if (mountedRef.current) setError(error.message); });
    return () => { mountedRef.current = false; if (refreshTimer.current) clearTimeout(refreshTimer.current); };
  }, [snapshot, loadFiles]);
  useEffect(() => {
    if (!detail || initialSelection.current) return;
    initialSelection.current = true;
    setSelection({ ...selection, model: detail.run.provider_id && detail.run.model ? JSON.stringify([detail.run.provider_id, detail.run.model]) : selection.model, agent: detail.run.agent_id, environment: detail.project.environment, node: detail.project.node_id || '' });
  }, [detail?.run.id]);

  useEffect(() => {
    if (!detailRef.current || !active) return;
    const source = new EventSource(`/api/runs/${runId}/events?after=${detailRef.current.cursor}`);
    let polling = false;
    const reconcile = async () => {
      if (polling) return;
      polling = true;
      try {
        const value = await snapshot();
        if (value) { await loadFiles(value.project.id); if (!isActive(value.run.status)) { source.close(); void refresh().catch(() => {}); } }
      } catch { setConnected(false); } finally { polling = false; }
    };
    source.onopen = () => {setConnected(true);void reconcile();}; source.onerror = () => setConnected(false);
    source.addEventListener('update', raw => {
      let event: RunEvent;
      try { event = JSON.parse((raw as MessageEvent).data); } catch { setConnected(false); return; }
      setDetail(current => current && current.run.id === runId ? applyRunEvent(current, event) : current);
      if (event.type === 'files_changed') {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => { void loadFiles(projectRef.current); }, 300);
      }
      if (event.type === 'status' && !isActive(event.data.status)) { source.close(); setConnected(true); void reconcile(); }
    });
    const poll = setInterval(() => void reconcile(), 10_000);
    const focus = () => { if (document.visibilityState === 'visible') void reconcile(); };
    document.addEventListener('visibilitychange', focus); window.addEventListener('online', focus);
    return () => { source.close(); clearInterval(poll); document.removeEventListener('visibilitychange', focus); window.removeEventListener('online', focus); };
  }, [runId, active, snapshot, loadFiles, refresh]);
  useEffect(()=>{const restore=()=>{void snapshot().then(value=>{if(value)void loadFiles(value.project.id);}).catch(()=>setConnected(false));};window.addEventListener('online',restore);return()=>window.removeEventListener('online',restore);},[snapshot,loadFiles]);
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [active]);
  useEffect(() => {
    if (stickToBottom.current && scrollRef.current && !mobilePanel) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [detail?.cursor, detail?.messages.length, mobilePanel]);
  useEffect(() => {
    if (!draftKey || !detail) return;
    const current = detail.live?.drafts.find(item => item.key === draftKey);
    if (current?.state === 'saved' && current.path) { setDraftKey(''); void openFile(detail.project.id, current.path, true); }
  }, [detail?.live?.drafts, draftKey, openFile]);
  // Refresh an expiring preview grant without remounting it on every progress snapshot.
  useEffect(() => { if (!preview || !detail) return; const timer = setTimeout(() => void loadFiles(detail.project.id, true), 12 * 60_000); return () => clearTimeout(timer); }, [preview, detail?.project.id, loadFiles]);

  const operations = useMemo(() => detail ? toolActivities(detail) : [], [detail?.events, detail?.run.status]);
  const computerRevealed=useRef('');
  useEffect(()=>{
    if(!active||computerRevealed.current===runId||!operations.some(item=>['computer_observe','computer_action','computer_capture'].includes(item.tool)))return;
    if(dirtyRef.current)return;
    computerRevealed.current=runId;setTab('computer');setMobilePanel(true);
  },[active,runId,operations]);
  const timeline = useMemo(() => {
    if (!detail) return [];
    return [
      ...detail.messages.filter(message => message.role !== 'tool' && message.message.content).map(message => ({ key: `msg_${message.id}`, time: message.created_at, message, operation: undefined as typeof operations[number] | undefined })),
      ...operations.map(operation => ({ key: `tool_${operation.id}`, time: operation.createdAt, operation, message: undefined as SavedMessage | undefined })),
    ].sort((a, b) => a.time.localeCompare(b.time));
  }, [detail?.messages, operations]);
  const streaming = useDeferredValue(detail?.live?.text || '');
  const liveDraft = detail?.live?.drafts.find(item => item.key === draftKey && item.state !== 'saved');
  const draftCode = useDeferredValue(liveDraft?.content || '');
  const editorCode = liveDraft ? draftCode : code;
  const liveDrafts = (detail?.live?.drafts || []).filter(item => ['writing', 'interrupted', 'failed'].includes(item.state) && (item.content || item.state === 'writing'));
  const livePaths = new Map(liveDrafts.filter(item => item.path).map(item => [item.path, item]));
  const fileTree = [...new Set([...files.map(file => file.path), ...livePaths.keys()])];
  const lineNumbers = useMemo(() => Array.from({ length: Math.max(1, editorCode.split('\n').length) }, (_, i) => i + 1).join('\n'), [editorCode]);
  const terminals = detail?.live?.terminals || [];
  const legacyTerminals = operations.filter(item => item.tool === 'run_command' && !terminals.some(terminal => terminal.callId === item.callId));

  const revealFile = useCallback((path: string, line = 1) => {
    if (dirtyRef.current) { toast('Avval kodni saqlang yoki o‘zgarishni bekor qiling.'); return; }
    setTab('code'); setMobilePanel(true);
    setJump({path,line,key:Date.now()});
    const latest = [...(detailRef.current?.live?.drafts || [])].reverse().find(item => item.path === path && item.state !== 'saved');
    if (latest) { setDraftKey(latest.key); setSelectedFile(path); selectedRef.current = path; setFileLoading(false); fileRequest.current++; }
    else if (projectRef.current) void openFile(projectRef.current, path);
  }, [openFile, toast]);
  useEffect(() => {
    if (!jump || fileLoading || tab !== 'code' || (liveDraft?.path || selectedFile) !== jump.path) return;
    const frame = requestAnimationFrame(() => {
      const editor = editorRef.current; if (!editor) return;
      const lines = editor.value.split('\n'); const line = Math.min(jump.line, lines.length);
      const start = lines.slice(0, line - 1).reduce((length, text) => length + text.length + 1, 0);
      editor.focus(); editor.setSelectionRange(start, start + lines[line - 1].length);
      editor.scrollTop = Math.max(0, (line - 3) * (parseFloat(getComputedStyle(editor).lineHeight) || 21));
      if (gutterRef.current) gutterRef.current.scrollTop = editor.scrollTop;
      setJump(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [jump,fileLoading,tab,selectedFile,liveDraft?.path,editorCode]);
  const revealTerminal = useCallback(() => { setTab('terminal'); setMobilePanel(true); }, []);
  async function saveFile() {
    if (!detail || !selectedFile || liveDraft || active) return;
    setSaving(true);
    try { await api(`/projects/${detail.project.id}/file`, { method: 'PUT', body: { path: selectedFile, content: code } }); setSavedCode(code); dirtyRef.current = false; await loadFiles(detail.project.id, true); toast('Fayl saqlandi.'); }
    catch (error) { toast((error as Error).message); } finally { setSaving(false); }
  }
  async function copyCode() { try { await navigator.clipboard.writeText(editorCode); toast('Kod nusxalandi.'); } catch { toast('Nusxalash imkoni bo‘lmadi.'); } }
  async function recoverDraft(key: string, resume = false) {
    if (!detail || active || recovering) return;
    setRecovering(key); setBusy(true);
    try {
      const result = await api<{ path: string; originalPath: string; operation: string }>(`/runs/${runId}/drafts/recover`, { method: 'POST', body: { key } });
      setDraftKey(''); await snapshot(); await loadFiles(detail.project.id, true);
      if (resume) {
        const method = result.operation === 'write_file' ? `Qoralamani ${result.originalPath} fayliga nusxalang, yozilgan kodni saqlab qoling va yetishmagan davomini qismlab qo‘shing.` : `Bu qoralama ${result.originalPath} fayliga qo‘shiladigan yoki almashtiriladigan tugallanmagan parchadir. Mavjud faylni saqlab, shu o‘zgarishni yakunlang.`;
        await onSubmit(`Oldingi topshiriqni shu joydan davom ettiring. Tiklangan qoralama: ${result.path}. ${method} Kodni boshidan qayta yaratmasdan xatolarini tuzating va natijani to‘liq tugatib, tekshirib bering.`, [], detail.project.id);
      } else { revealFile(result.path); toast('Qoralama alohida faylga tiklandi.'); }
    } catch (error) { toast((error as Error).message); } finally { setRecovering(''); setBusy(false); }
  }

  if (error) return <section className="page"><ErrorBox message={error}/><button className="button" onClick={onBack}>Vazifalarga qaytish</button></section>;
  if (!detail || detail.run.id !== runId) return <Spinner label="Vazifa ochilmoqda..."/>;
  const agent = agents.find(agent => agent.id === detail.run.agent_id);
  const composerSelection = { ...selection, environment: detail.project.environment, node: detail.project.node_id || '' };
  const activities = detail.events.filter(event => ['tool_start', 'tool_result', 'agent_start', 'agent_end', 'agent_progress', 'warning', 'thinking','model_route'].includes(event.type));
  return <section ref={workspaceRef} style={{'--chat-size':`${split}fr`,'--result-size':`${100-split}fr`} as React.CSSProperties} className={`workspace ${mobilePanel ? 'workspace-show-panel' : ''} ${resizing?'workspace-resizing':''}`}>
    <div className="mobile-work-tabs"><button className={!mobilePanel ? 'active' : ''} onClick={() => setMobilePanel(false)}>Suhbat</button><button className={mobilePanel ? 'active' : ''} onClick={() => setMobilePanel(true)}>Natija {liveDrafts.some(item => item.state === 'writing') && <span className="online-dot"/>}<ArrowRight size={14}/></button></div>
    <div className="conversation"><header className="conversation-heading"><div><button className="back-link" aria-label="Vazifalarga qaytish" onClick={onBack}><ChevronLeft size={15}/>Vazifalar</button><h1 title={detail.project.title}>{detail.project.title}</h1><p>{agent?.name || 'Agent'} · {detail.project.environment === 'local' ? <><Monitor size={13}/>Lokal</> : <><Cloud size={13}/>Bulut</>}</p></div><div className="workspace-publish-actions"><Badge active={detail.run.status === 'completed' || detail.run.status === 'running'}>{statusLabels[detail.run.status]}</Badge><Publish key={detail.project.id} projectId={detail.project.id} local={detail.project.environment==='local'} toast={toast}/></div></header>
      <div className="conversation-scroll" ref={scrollRef} onScroll={event => { const el = event.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}><div className="messages">
        {!!detail.live?.plan?.length && <PlanCard plan={detail.live.plan}/>}
        {timeline.map(item => item.message ? <MessageView key={item.key} saved={item.message} toast={toast} files={fileTree} onFile={revealFile}/> : item.operation ? <ToolCard key={item.key} item={item.operation} onFile={revealFile} onTerminal={revealTerminal}/> : null)}
        {streaming && detail.run.status !== 'completed' && <div className="assistant-message streaming-message"><div className="message-author"><Brand size={20}/><strong>OpenSI</strong>{active ? <LoaderCircle className="spin" size={13}/> : <small className="muted">Tugallanmagan javob</small>}</div><MarkdownContent content={streaming} files={fileTree} onFile={revealFile}/></div>}
        {liveDrafts.map(item => <DraftCard key={item.key} draft={item} busy={!!recovering} onRecover={!active && item.state === 'interrupted' && item.path ? () => void recoverDraft(item.key) : undefined} onResume={!active && item.state === 'interrupted' && item.path ? () => void recoverDraft(item.key, true) : undefined} onOpen={() => { if (item.path) revealFile(item.path); else { setDraftKey(item.key); setTab('code'); setMobilePanel(true); } }}/>) }
        {(detail.live?.drafts || []).filter(item => item.recoveredPath).map(item => <button key={item.key} className="output-file" onClick={() => revealFile(item.recoveredPath!)}><FileCode2 size={17}/><span>{item.path} · Tiklangan qoralama</span><small>Ochish<ArrowRight size={13}/></small></button>)}
        <RunProgress detail={detail} connected={connected} now={now}/>
      <ParallelTasks tasks={detail.parallel||[]} active={active} onCancel={id=>void api(`/runs/${runId}/parallel/${id}/cancel`,{method:'POST',body:{}}).then(()=>snapshot()).catch(error=>toast(error.message))}/>
        {detail.approvals.map(approval => <ApprovalPanel key={approval.id} approval={approval} toast={toast}/>)}
        {detail.run.error && <ErrorBox message={detail.run.error}/>}
        {detail.run.status==='cancelled'&&<p className="muted">Bajarilgan fayllar, ish rejasi va parallel qoralamalar saqlangan. Quyidagi tugma bilan shu joydan davom etasiz.</p>}
        {['failed', 'interrupted', 'cancelled'].includes(detail.run.status) && <button className="button retry-run" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/runs/${runId}/resume`,{method:'POST',body:{}});await snapshot();void refresh(); } catch (error) { toast((error as Error).message); } finally { setBusy(false); } }}>{busy ? <LoaderCircle size={14} className="spin"/> : <RefreshCw size={14}/>}Shu joydan davom ettirish</button>}
        {files.length > 0 && !active && <button className="output-file" onClick={() => revealFile(files.find(file => file.path === 'index.html')?.path || files[0].path)}><FileCode2 size={19}/><span>{files.find(file => file.path === 'index.html')?.path || `${files.length} ta fayl`}</span><small>Ochish<ArrowRight size={13}/></small></button>}
      </div></div>
      <ComposerPanel userId={userId} settings={<DeliveryPanel userId={userId} projectId={detail.project.id} runId={runId} status={detail.run.status} environment={detail.project.environment} toast={toast}/>}><Composer draft={draft} setDraft={setDraft} selection={composerSelection} setSelection={setSelection} providers={providers} agents={agents} nodes={nodes} compact busy={busy} active={active} allowParallel lockedEnvironment onConnect={onConnect} toast={toast}
        onStop={() => { void api(`/runs/${runId}/cancel`, { method: 'POST', body: {} }).catch(error => toast(error.message)); }}
        onSubmit={async attachments => {
          setBusy(true);
          try {
            if(active){
              const prompt=draft.trim()||'Biriktirilgan fayllarni joriy loyihaga qo‘shib, tekshiring.',key=JSON.stringify([prompt,attachments.map(f=>f.id)]);
              if(parallelRequest.current?.key!==key)parallelRequest.current={key,id:crypto.randomUUID()};
              await api(`/runs/${runId}/parallel`,{method:'POST',body:{prompt,requestId:parallelRequest.current.id,attachmentIds:attachments.map(f=>f.id)}});
              parallelRequest.current=null;await snapshot();void refresh();
            }else await onSubmit(draft,attachments,detail.project.id);
            setDraft('');
          } finally {setBusy(false);}
        }}/><p className="run-usage">{number(detail.usage.input + detail.usage.output)} token{detail.usage.unknown ? ' · Ayrim API javoblarida usage yo‘q' : ''}</p></ComposerPanel>
    </div>
    <div className="workspace-divider" role="separator" tabIndex={0} aria-label="Suhbat va preview kengligi" aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(split)} aria-valuetext={`Suhbat ${Math.round(split)} foiz`} title="Panel kengligini surib o‘zgartiring. Ikki marta bosish — tiklash. ← → — kenglik."
      onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);const width=(workspaceRef.current?.getBoundingClientRect().width||1000)-8;const chat=workspaceRef.current?.querySelector('.conversation')?.getBoundingClientRect().width||width*split/100;resizeStart.current={id:event.pointerId,x:event.clientX,percent:chat/width*100};setResizing(true);}}
      onPointerMove={event=>{const start=resizeStart.current;if(!start||start.id!==event.pointerId)return;const width=(workspaceRef.current?.getBoundingClientRect().width||1000)-8;resizeTo(start.percent+(event.clientX-start.x)/width*100);}}
      onPointerUp={event=>{resizeStart.current=null;setResizing(false);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
      onPointerCancel={()=>{resizeStart.current=null;setResizing(false);}} onLostPointerCapture={()=>{resizeStart.current=null;setResizing(false);}}
      onDoubleClick={()=>setSplit(43)} onKeyDown={event=>{const delta=event.shiftKey?10:2;if(['ArrowLeft','ArrowRight','Home','End','Enter'].includes(event.key)){event.preventDefault();resizeTo(event.key==='Home'?20:event.key==='End'?80:event.key==='Enter'?43:split+(event.key==='ArrowLeft'?-delta:delta));}}}/>
    <div className="result-panel"><div className="result-tabs" role="tablist" aria-label="Natija ko‘rinishi">{[{ id: 'preview', label: 'Preview', icon: Monitor }, ...(files.some(f=>f.path==='opensi-artifact.json')?[{id:'design',label:'Dizayn',icon:FileCode2}]:[]), {id:'deployments',label:'Deploy',icon:Cloud}, {id:'documents',label:'Hujjatlar',icon:FileCode2}, { id: 'code', label: 'Kod', icon: Code2 }, { id: 'terminal', label: 'Terminal', icon: Terminal }, { id: 'versions', label: 'Versiyalar', icon: RefreshCw }, { id: 'browser', label: 'Tekshiruv', icon: CheckCircle2 }, { id: 'computer', label: 'Kompyuter', icon: Monitor }, { id: 'activity', label: 'Faoliyat', icon: Activity }].map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={15}/><span>{item.label}</span>{item.id === 'code' && liveDrafts.some(draft => draft.state === 'writing') && <span className="online-dot"/>}</button>)}
      <div className="result-actions">{!active && detail.project.environment === 'cloud' && files.length > 0 && <a className="button small-button" href={`/api/projects/${detail.project.id}/export`} download title="Loyihani ZIP yuklab olish">ZIP</a>}<button className="icon-button" aria-label="Faylni yuklab olish" disabled={(!selectedFile && !liveDraft) || fileLoading || !editorCode} onClick={() => downloadText((liveDraft ? liveDraft.path.split('/').at(-1) + '.draft.txt' : selectedFile.split('/').at(-1)) || 'code.txt', editorCode)}><Download size={17}/></button></div></div>
      {tab === 'deployments' && <DeploymentsPanel projectId={detail.project.id}/>}
      {tab === 'documents' && <DocumentCenter projectId={detail.project.id} compact/>}
      {tab === 'preview' && <div className="preview-panel"><div className="preview-toolbar"><span><FileCode2 size={14}/>{preview ? (files.some(file => file.path === 'dist/index.html') ? 'dist/index.html' : 'index.html') : 'Preview'}{active && <small className="preview-live-label">{phaseLabel(detail)}</small>}</span><div><button className={`icon-button ${previewWidth === 'desktop' ? 'selected' : ''}`} aria-label="Kompyuter preview" onClick={() => setPreviewWidth('desktop')}><Monitor size={16}/></button><button className={`icon-button ${previewWidth === 'mobile' ? 'selected' : ''}`} aria-label="Telefon preview" onClick={() => setPreviewWidth('mobile')}><Smartphone size={16}/></button><button className="icon-button" aria-label="Previewni yangilash" onClick={() => void loadFiles(detail.project.id, true)}><RefreshCw size={15}/></button><button className="icon-button" aria-label="Previewni katta ochish" disabled={!preview} onClick={() => { previewRef.current?.requestFullscreen().catch(() => toast('Brauzer to‘liq ekranga ruxsat bermadi.')); }}><Maximize2 size={15}/></button></div></div>
        <div className={`preview-canvas ${previewWidth === 'mobile' ? 'preview-mobile' : ''}`} ref={previewRef}>{preview ? <iframe title="Loyiha preview" src={preview} key={preview} sandbox="allow-scripts allow-downloads" referrerPolicy="no-referrer"/> : active ? <div className="preview-pending"><div className="preview-pending-icon"><Code2 size={26}/></div><h2>{phaseLabel(detail)}</h2><p>{liveDrafts.length ? 'Yozilayotgan kodni hozir ko‘rishingiz mumkin. Fayl saqlangach preview shu yerda ochiladi.' : 'Agentning amallari suhbatda jonli ko‘rinadi. index.html tayyor bo‘lgach sahifa avtomatik ochiladi.'}</p>{liveDrafts.map(item => <DraftCard key={item.key} draft={item} onOpen={() => { setDraftKey(item.key); setTab('code'); }}/>)}</div> : <Empty>{previewMessage || 'Hali preview yo‘q.'}</Empty>}</div></div>}
      {tab === 'code' && <div className="code-panel"><div className="code-toolbar"><span className="mono" title={liveDraft?.path || selectedFile}>{liveDraft?.path || selectedFile || 'Fayllar'}</span><div>{dirtyRef.current && !liveDraft && <button className="text-button" onClick={() => { setCode(savedCode); dirtyRef.current = false; }}>Bekor qilish</button>}<button className="icon-button" aria-label="Kodni nusxalash" disabled={!editorCode} onClick={() => void copyCode()}><Copy size={14}/></button><button className="button small-button" title={active ? 'Agent ishini tugatgach saqlash mumkin' : ''} disabled={!selectedFile || !!liveDraft || active || saving || code === savedCode} onClick={() => void saveFile()}>{saving ? <LoaderCircle size={14} className="spin"/> : <Save size={14}/>}Saqlash</button></div></div>
        {liveDraft && <div className="draft-banner">{liveDraft.state === 'writing' ? <LoaderCircle size={13} className="spin"/> : <AlertCircle size={13}/>}<span>{liveDraft.state !== 'writing' ? 'Saqlanmagan qoralama' : liveDraft.operation === 'append_file' ? 'Qo‘shiladigan kod jonli yozilmoqda' : liveDraft.operation === 'edit_file' ? 'Kod o‘zgarishi jonli yozilmoqda' : 'Kod jonli yozilmoqda'} · {number(liveDraft.lines)} qator · {bytesLabel(liveDraft.bytes)}</span></div>}
        <div className="code-body"><aside className="file-tree" aria-label="Loyiha fayllari">{fileTree.map(path => <button key={path} title={path} className={(liveDraft?.path || selectedFile) === path ? 'selected' : ''} onClick={() => revealFile(path)}>{livePaths.get(path)?.state === 'writing' ? <LoaderCircle size={14} className="spin"/> : <FileCode2 size={14}/>}<span>{path}</span></button>)}{!fileTree.length && <small className="muted">Fayllar tayyorlanmoqda</small>}</aside><div className="code-editor">{fileLoading ? <Spinner/> : selectedFile || liveDraft ? <><div className="line-numbers" aria-hidden="true" ref={gutterRef}><pre>{lineNumbers}</pre></div><textarea ref={editorRef} aria-label={liveDraft ? 'Jonli fayl kodi' : 'Fayl kodi'} value={editorCode} readOnly={!!liveDraft} wrap="off" spellCheck={false} onScroll={event => { if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop; }} onChange={event => { setCode(event.target.value); dirtyRef.current = event.target.value !== savedCode; }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); void saveFile(); } }}/></> : <Empty>Fayl tanlang. Yozilayotgan fayllar ham shu ro‘yxatda ko‘rinadi.</Empty>}</div></div></div>}
      {tab === 'terminal' && <div className="terminal-panel">{terminals.length + legacyTerminals.length ? <>{terminals.map(item => <div className="terminal-output" key={item.callId}><p><Terminal size={14}/><strong>{item.command}</strong>{item.state === 'running' && <LoaderCircle size={13} className="spin"/>}</p><pre>{terminalText(item.output) || (detail.run.status === 'waiting_approval' ? 'Buyruq tasdiqlanishi kutilmoqda...' : item.state === 'running' ? 'Chiqish kutilmoqda...' : '(bo‘sh chiqish)')}</pre><small>{item.state === 'running' ? 'Jonli chiqish' : item.state === 'interrupted' ? 'Buyruq uzildi' : `Exit code: ${item.exitCode ?? '—'}`}</small></div>)}{legacyTerminals.map(item => <div className="terminal-output" key={item.id}><p><Terminal size={14}/>{item.args.command}</p><pre>{terminalText(item.result?.output || '') || item.result?.error || (item.state === 'running' ? 'Buyruq natijasi kutilmoqda...' : '(bo‘sh chiqish)')}</pre><small>Exit code: {item.result?.exitCode ?? '—'}</small></div>)}</> : <Empty>{detail.project.environment === 'cloud' && !detail.capabilities?.cloudShell ? <><span>Bu bulut muhitida terminal hali sozlanmagan. Fayl yozish va HTML preview ishlaydi. Kompyuteringizda buyruq bajarish uchun lokal connectorni ulang.</span><button className="button small-button" onClick={onConnect}><Monitor size={14}/>Lokal connector ulash</button></> : detail.project.environment === 'local' && !nodes.find(node => node.id === detail.project.node_id)?.online ? 'Lokal connector offline. Terminal chiqishi uchun uni kompyuteringizda ishga tushiring.' : 'Agent terminal buyrug‘ini yuborganda, buyruq va uning chiqishi shu yerda ko‘rinadi.'}</Empty>}</div>}
      {tab === 'versions' && <VersionsPanel projectId={detail.project.id} active={active} local={detail.project.environment === 'local'} toast={toast} onRestore={() => void loadFiles(detail.project.id, true)}/>}
      {tab === 'browser' && <BrowserPanel projectId={detail.project.id} active={active} enabled={detail.project.environment === 'cloud' && !!detail.capabilities?.browser} toast={toast}/>}
      {tab === 'computer' && <div className="computer-workspace"><Computer projects={[detail.project]} projectId={detail.project.id}/></div>}
      {tab === 'design' && <ArtifactEditor projectId={detail.project.id} active={active} local={detail.project.environment==='local'} onSaved={()=>void loadFiles(detail.project.id,true)}/>}
      {tab === 'activity' && <div className="full-activity"><ActivityList events={activities}/></div>}
      <footer className="result-status"><span className={active ? 'online-dot' : 'status-dot'}/>{files.length} ta fayl{liveDrafts.some(item => item.state === 'writing') && <span>· {liveDrafts.filter(item => item.state === 'writing').length} ta yozilmoqda</span>}<span>·</span>{liveDraft ? 'Jonli qoralama' : code !== savedCode ? 'Saqlanmagan o‘zgarish' : liveDrafts.length && !files.length ? 'Kod tayyorlanmoqda' : filesSource === 'cached' ? 'Lokal nusxa · Connector offline' : files.length ? 'Saqlangan' : 'Hali fayl yo‘q'}</footer>
    </div>
  </section>;
}

const MarkdownContent = memo(function MarkdownContent({ content, files, onFile }: { content: string; files: string[]; onFile: (path:string,line?:number)=>void }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, href, ...props }) => { const ref = fileReference(href || '', files); return ref ? <button className="file-reference" onClick={() => onFile(ref.path,ref.line)}>{typeof children === 'string' ? children : ref.path + (ref.line > 1 ? ':'+ref.line : '')}</button> : <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}</a>; }, code: ({ children, className }) => { const ref = !className && typeof children === 'string' ? fileReference(children,files) : null; return ref ? <button className="file-reference" title={`${ref.path}:${ref.line} — kodda ochish`} onClick={() => onFile(ref.path,ref.line)}><code>{children}</code></button> : <code className={className}>{children}</code>; }, img: () => <span className="muted">[Model qaytargan rasm manzili]</span> }}>{content}</ReactMarkdown></div>;
});
const MessageView = memo(function MessageView({ saved, toast, files, onFile }: { saved: SavedMessage; toast: (text: string) => void; files:string[]; onFile:(path:string,line?:number)=>void }) {
  const user = saved.role === 'user';
  const content = typeof saved.message.content === 'string' ? saved.message.content : saved.message.content?.filter(item => item.type === 'text').map(item=>item.text).join('\n') || '';
  const attached = Array.isArray(saved.message.content) ? saved.message.content.filter(item=>item.type!=='text').length : 0;
  const copyLabel=user?'Promptni nusxalash':'Javobni nusxalash';
  return <div className={user ? 'user-message' : 'assistant-message'}><div className="message-author">{!user && <Brand size={20}/>}<strong>{user ? 'Siz' : 'OpenSI'}</strong><time>{dateTime(saved.created_at)}</time><button className="icon-button message-copy" aria-label={copyLabel} title={copyLabel} onClick={() => { void navigator.clipboard.writeText(content).then(() => toast(user?'Prompt nusxalandi.':'Javob nusxalandi.')).catch(() => toast('Nusxalash imkoni bo‘lmadi. Matnni belgilab Ctrl+C bosing.')); }}><Copy size={13}/></button></div><MarkdownContent content={content} files={files} onFile={onFile}/>{attached > 0 && <small className="muted">{attached} ta fayl biriktirilgan</small>}</div>;
});
function ActivityList({ events }: { events: RunEvent[] }) {
  if (!events.length) return <Empty>Hali faoliyat yo‘q.</Empty>;
  return <div className="activity-list">{events.map(event => <div key={event.id} className="activity-item">{event.type === 'tool_result' ? event.data.result?.error || event.data.result?.denied ? <AlertCircle size={16}/> : <CheckCircle2 size={16} className="lime"/> : event.type === 'warning' ? <AlertCircle size={16}/> : <Activity size={16}/>}<div><strong>{event.type === 'model_route' ? `${event.data.model} · ${event.data.reason}` : event.type === 'thinking' ? `${event.data.agent} · ${event.data.model} · ${event.data.step}-bosqich` : event.type === 'agent_start' ? `${event.data.agent} ish boshladi` : event.type === 'agent_end' ? `${event.data.agent} yakunladi` : event.type === 'warning' ? event.data.message : toolLabels[event.data.tool] || event.data.tool}</strong><small>{dateTime(event.created_at)}{event.data.agent && event.type.startsWith('tool') ? ` · ${event.data.agent}` : ''}</small>{event.type === 'agent_start' && <p>{event.data.task}</p>}{event.type === 'tool_result' && <details><summary>Natija</summary><pre>{JSON.stringify(event.data.result, null, 2).slice(0, 8000)}</pre></details>}{event.type === 'tool_start' && event.data.args.path && <code>{event.data.args.path}</code>}</div></div>)}</div>;
}
function ApprovalPanel({ approval, toast }: { approval: Approval; toast: (text: string) => void }) {
  const [answer, setAnswer] = useState(''); const [busy, setBusy] = useState(false); const question = approval.tool === 'ask_user';
  async function respond(approved: boolean) { setBusy(true); try { await api('/approvals/' + approval.id, { method: 'POST', body: { approved, ...(question ? { answer } : {}) } }); } catch (error) { toast((error as Error).message); setBusy(false); } }
  if(approval.tool==='computer_login')return <div className="approval-panel"><h3>Brauzerda kirishni yakunlang</h3><p>{approval.args.reason}</p><p className="small muted">Kompyuter bo‘limida hisobingizga kiring. Parol yoki kodni chatga yubormang. Agent javobingizni kutmoqda.</p><div className="approval-actions"><button className="button" disabled={busy} onClick={()=>void respond(false)}>Davom ettirmaslik</button><button className="button button-primary" disabled={busy} onClick={()=>void respond(true)}>Kirish tugadi — davom etish</button></div></div>;
  if(approval.tool==='await_integration')return <div className="approval-panel"><h3>{approval.args.kind==='vercel'?'Vercel':'Xizmat'} ulanishi kutilmoqda</h3><p>Agent loyiha fayllarini saqladi. Hisobni ulaganingizdan keyin shu vazifa o‘zi davom etadi; token yoki parolni chatga yozmang.</p><div className="approval-actions"><button className="button" disabled={busy} onClick={()=>void respond(false)}>Kutishni bekor qilish</button><button className="button button-primary" onClick={()=>{window.location.hash='/connections/automation';}}>Ulanishlarga o‘tish</button></div></div>;
  return <div className="approval-panel"><h3>{question ? 'Agent sizning javobingizni kutyapti' : 'Amalni tasdiqlang'}</h3>{question ? <><p>{approval.args.question}</p><textarea aria-label="Agentga javob" rows={3} value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Javobingizni yozing..."/></> : <><p>{approval.tool === 'run_command' ? 'Quyidagi terminal buyrug‘i tanlangan muhitda bajariladi. Tasdiqlangach agent davom etadi.' : approval.tool === 'antigravity_task' ? 'Antigravity loyiha fayllarini o‘qishi va tahrirlashini tasdiqlang.' : `Tashqi vosita: ${approval.tool}`}</p>{approval.args.cwd && <p>Papka: {approval.args.cwd}</p>}<pre>{approval.tool === 'run_command' ? approval.args.command : approval.tool === 'antigravity_task' ? approval.args.prompt : JSON.stringify(approval.args, null, 2).slice(0, 8000)}</pre>{approval.tool === 'antigravity_task' && <small>Terminal amallari zarur bo‘lsa alohida tasdiqlash so‘raladi.</small>}</>}
    <div className="approval-actions"><button className="button" onClick={() => void respond(false)} disabled={busy}>Rad etish</button><button className="button button-primary" onClick={() => void respond(true)} disabled={busy || (question && !answer.trim())}>{busy ? <LoaderCircle size={15} className="spin"/> : <Check size={15}/>} {question ? 'Javob yuborish' : 'Tasdiqlash'}</button></div></div>;
}
