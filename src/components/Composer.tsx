import {attachLocalFile,pickLocalFiles} from '../local-attachments';
import {attachBrowserFile} from '../browser-workspace';
import {isTextModel} from '../model-capabilities';
import { useEffect, useRef, useState } from 'react';
import {clipboardFiles} from '../clipboard';
import { ArrowUp, Plus, Minus, RotateCcw, Brain, Cloud, Monitor, Code2, ChevronDown, X, LoaderCircle, Square, LibraryBig } from 'lucide-react';
import { api } from '../api';
import {canChooseFolder,chooseFolder} from '../delivery';
import {Modal} from './Ui';
import {EnvironmentPicker} from './EnvironmentPicker';
import type {Asset} from '../pages/Library';
import type { Agent, Attachment, Node, Provider, Selection } from '../types';

export function Composer({ draft, setDraft, selection, setSelection, providers, agents, nodes, onSubmit, busy = false, active = false, allowParallel=false,compact = false, lockedEnvironment = false, onStop, onConnect, toast }: {
  draft: string; setDraft: (value: string) => void; selection: Selection; setSelection: (value: Selection) => void;
  providers: Provider[]; agents: Agent[]; nodes: Node[]; onSubmit: (attachments: Attachment[]) => Promise<void>;allowParallel?:boolean;
  busy?: boolean; active?: boolean; compact?: boolean; lockedEnvironment?: boolean; onStop?: () => void; onConnect: () => void; toast: (text: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null); const inputRef = useRef<HTMLTextAreaElement>(null);
  const heightKey = `opensi.composer-height.${selection.userId || 'user'}.${compact ? 'workspace' : 'home'}`;
  const defaultHeight = compact ? 64 : 84;
  const [inputHeight, setInputHeight] = useState(defaultHeight);
  const [heightLimit, setHeightLimit] = useState(() => Math.max(64, Math.min(480, Math.round(window.innerHeight * .4))));
  const resizeGesture = useRef<{ id: number; y: number; height: number } | null>(null);
  const [resizingInput, setResizingInput] = useState(false);
  useEffect(() => {
    try { const saved = Number(localStorage.getItem(heightKey)); setInputHeight(saved >= 40 && saved <= 480 ? saved : defaultHeight); }
    catch { setInputHeight(defaultHeight); }
  }, [heightKey, defaultHeight]);
  useEffect(() => {
    const updateLimit = () => setHeightLimit(Math.max(64, Math.min(480, Math.round((window.visualViewport?.height || window.innerHeight) * .4))));
    updateLimit(); window.addEventListener('resize', updateLimit); window.visualViewport?.addEventListener('resize', updateLimit);
    return () => { window.removeEventListener('resize', updateLimit); window.visualViewport?.removeEventListener('resize', updateLimit); };
  }, []);
  const visibleHeight = Math.min(inputHeight, heightLimit);
  function changeHeight(value: number) {
    const height = Math.round(Math.max(40, Math.min(heightLimit, value)));
    setInputHeight(height);
    try { localStorage.setItem(heightKey, String(height)); } catch { /* Resizing still works when storage is unavailable. */ }
  }
  const [attachments, setAttachments] = useState<Attachment[]>([]); const [uploading, setUploading] = useState(false);
  const [library,setLibrary]=useState<Asset[]|null>(null);
  const uploadingRef=useRef(false);const [uploadProgress,setUploadProgress]=useState('');const [dragging,setDragging]=useState(false);
  const queued=useRef<File[]>([]);const attachmentsRef=useRef(attachments);attachmentsRef.current=attachments;
  const previewUrls=useRef<Record<string,string>>({});const [previews,setPreviews]=useState<Record<string,string>>({});
  useEffect(()=>()=>{for(const url of Object.values(previewUrls.current))URL.revokeObjectURL(url);},[]);
  async function upload(files: FileList | File[] | null) {
    if (!files?.length) return;
    if(busy){toast('Xabar yuborilmoqda. Yuklash tugagach faylni qayta biriktiring.');return;}
    if (attachmentsRef.current.length + queued.current.length + files.length + (uploadingRef.current?1:0) > 100) { toast('Bir vazifaga 100 tagacha fayl biriktiring; qolganlarini ZIP qilib qo‘shing.'); return; }
    queued.current.push(...Array.from(files));if(uploadingRef.current)return;
    uploadingRef.current=true;setUploading(true);let failed=0,lastError='';
    try {
      while(queued.current.length){const file=queued.current.shift()!;
        try {
          if(file.size>1_000_000_000)throw new Error(`${file.name}: 1 GB dan katta.`);
          setUploadProgress(`${file.name} · Yuklanmoqda…`);
          const local=selection.environment==='local';
          if(local)setUploadProgress(`${file.name} · Kompyuterda tayyorlanmoqda…`);
          const attachment=local?(nodes.find(n=>n.id===selection.node)?.platform==='browser'?await attachBrowserFile(selection.userId||'',selection.node,file):await attachLocalFile(selection.node,file)):await new Promise<Attachment>((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST','/api/uploads');xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.setRequestHeader('x-opensi-client','web');xhr.setRequestHeader('x-file-name',encodeURIComponent(file.name||'screenshot.png'));xhr.timeout=1800000;xhr.upload.onprogress=e=>setUploadProgress(`${file.name} · ${e.lengthComputable?Math.round(e.loaded/e.total*100):0}%${queued.current.length?` · navbatda ${queued.current.length}`:''}`);xhr.onerror=()=>reject(new Error('Tarmoq uzildi. Faylni qayta biriktiring.'));xhr.ontimeout=()=>reject(new Error('Yuklash vaqti tugadi.'));xhr.onload=()=>{try{const value=JSON.parse(xhr.responseText);if(xhr.status>=200&&xhr.status<300)resolve(value);else reject(new Error(value.error||'Yuklash bajarilmadi.'));}catch{reject(new Error('Server javobi o‘qilmadi.'));}};xhr.send(file);});
          attachmentsRef.current=[...attachmentsRef.current,attachment];setAttachments(attachmentsRef.current);
          if(/^image\/(png|jpeg|webp|gif)$/.test(file.type)){previewUrls.current[attachment.id]=URL.createObjectURL(file);setPreviews({...previewUrls.current});}
        }catch(e){failed++;lastError=(e as Error).message;toast(lastError);}
      }
    } finally { uploadingRef.current=false;setUploading(false);setUploadProgress(failed?`${failed} ta fayl biriktirilmadi. ${lastError}`:'');if(fileRef.current)fileRef.current.value=''; }
  }
  useEffect(()=>{
    const paste=(event:ClipboardEvent)=>{
      if(event.defaultPrevented||!event.clipboardData)return;
      const target=event.target instanceof Element?event.target:null;
      if(target?.closest('input,textarea,[contenteditable="true"],[role="dialog"]')&&!target.closest('.composer'))return;
      const files=clipboardFiles(event.clipboardData);if(!files.length)return;
      event.preventDefault();void upload(files);
    };
    window.addEventListener('paste',paste);return()=>window.removeEventListener('paste',paste);
  });
  async function submit() {
    if ((!draft.trim()&&!attachments.length) || busy || active&&!allowParallel || uploading) return;
    try { await onSubmit(attachments); setAttachments([]);attachmentsRef.current=[];for(const url of Object.values(previewUrls.current))URL.revokeObjectURL(url);previewUrls.current={};setPreviews({}); } catch (error) { toast((error as Error).message); }
  }
  async function pickNative(){if(uploading||busy)return;setUploading(true);try{const files=await pickLocalFiles(selection.node);if(attachmentsRef.current.length+files.length>100)throw Error('100 tagacha fayl tanlang.');attachmentsRef.current=[...attachmentsRef.current,...files];setAttachments(attachmentsRef.current);}catch(e){toast((e as Error).message);}finally{setUploading(false);}}
  const models = providers.filter(provider => provider.enabled||provider.protocol==='antigravity-cli').flatMap(provider => provider.models.filter(m=>isTextModel(provider,m)).map(model => ({ value: JSON.stringify([provider.id, model]), label: model, provider: provider.label })));
  const selectedProvider = providers.find(provider => provider.models.some(model => JSON.stringify([provider.id, model]) === selection.model));
  function selectModel(value: string) {
    if (value === '__connect') { onConnect(); return; }
    const provider = providers.find(p => p.models.some(m => JSON.stringify([p.id, m]) === value));
    if (provider?.node_id) {
      if(lockedEnvironment){if(selection.environment==='local'&&selection.node!==provider.node_id){toast('Bu loyiha boshqa lokal kompyuterga tegishli.');return;}setSelection({...selection,model:value});return;}
      setSelection({ ...selection, model: value, environment: provider.hosted?'cloud':'local', node: provider.hosted?'':provider.node_id });
    } else setSelection({ ...selection, model: value });
  }
  return <div className={`composer ${compact ? 'composer-compact' : ''} ${dragging?'composer-dragging':''}`} onDragOver={e=>{e.preventDefault();if(!busy)setDragging(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as globalThis.Node))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);void upload(e.dataTransfer.files);}}>
    <div className={`composer-size-bar ${resizingInput ? 'is-resizing' : ''}`}>
      <div className="composer-height-handle" role="separator" tabIndex={0} aria-label="Matn oynasi balandligi" aria-orientation="horizontal" aria-valuemin={40} aria-valuemax={heightLimit} aria-valuenow={visibleHeight} aria-valuetext={`${visibleHeight} piksel`} title="Yuqoriga torting — kattalashadi; pastga — kichrayadi. ↑ ↓ yoki ikki marta bosib tiklang."
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); resizeGesture.current = { id: event.pointerId, y: event.clientY, height: visibleHeight }; setResizingInput(true); }}
        onPointerMove={event => { const start = resizeGesture.current; if (start?.id === event.pointerId) changeHeight(start.height + start.y - event.clientY); }}
        onPointerUp={event => { if (resizeGesture.current?.id === event.pointerId) { resizeGesture.current = null; setResizingInput(false); event.currentTarget.releasePointerCapture(event.pointerId); } }}
        onLostPointerCapture={() => { resizeGesture.current = null; setResizingInput(false); }}
        onPointerCancel={() => { resizeGesture.current = null; setResizingInput(false); }}
        onDoubleClick={() => changeHeight(defaultHeight)}
        onKeyDown={event => { const next = event.key === 'ArrowUp' ? visibleHeight + 32 : event.key === 'ArrowDown' ? visibleHeight - 32 : event.key === 'Home' ? 40 : event.key === 'End' ? heightLimit : event.key === 'Enter' ? defaultHeight : null; if (next !== null) { event.preventDefault(); changeHeight(next); } }}><span/><small>O‘lcham</small></div>
      <button type="button" className="icon-button" aria-label="Matn oynasini kichraytirish" title="Kichraytirish" disabled={visibleHeight <= 40} onClick={() => changeHeight(visibleHeight - 48)}><Minus size={15}/></button>
      <button type="button" className="icon-button" aria-label="Matn oynasini kattalashtirish" title="Kattalashtirish" disabled={visibleHeight >= heightLimit} onClick={() => changeHeight(visibleHeight + 48)}><Plus size={15}/></button>
      <button type="button" className="icon-button" aria-label="Matn oynasi o‘lchamini tiklash" title="O‘lchamni tiklash" onClick={() => changeHeight(defaultHeight)}><RotateCcw size={14}/></button>
    </div>
    <textarea ref={inputRef} style={{ height: visibleHeight, minHeight: visibleHeight, flex: '0 0 auto' }} aria-label="Vazifa matni" placeholder={active&&allowParallel?'Qo‘shimcha vazifa yozing — boshqa model parallel tayyorlaydi...':compact ? 'Davom ettirish uchun yozing...' : 'Vazifani yozing yoki fayl biriktiring...'} value={draft} onChange={event => setDraft(event.target.value)} disabled={busy}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }}/>
    {attachments.length > 0 && <div className="attachments">{attachments.map(file => <span key={file.id}>{previews[file.id]&&<img className="attachment-thumbnail" src={previews[file.id]} alt={`Biriktirilgan screenshot: ${file.name}`}/>}<span>{file.name}</span><button aria-label={`${file.name}ni olib tashlash`} onClick={() => {attachmentsRef.current=attachmentsRef.current.filter(item=>item.id!==file.id);setAttachments(attachmentsRef.current);if(previewUrls.current[file.id])URL.revokeObjectURL(previewUrls.current[file.id]);delete previewUrls.current[file.id];setPreviews({...previewUrls.current});}}><X size={13}/></button></span>)}</div>}
    {active&&allowParallel&&<small role="status" className="parallel-composer-hint">Qo‘shimcha so‘rov alohida tayyorlanadi. Nazorat modeli natijalarni birlashtiradi.</small>}
    <div className="composer-toolbar"><div className="composer-controls">
      <input ref={fileRef} type="file" multiple hidden onChange={event => void upload(event.target.files)}/>
      <button className="composer-attach" aria-label="Fayl biriktirish" title="Har qanday turdagi fayl, ZIP, hujjat yoki rasm biriktirish" disabled={uploading || busy} onClick={() => fileRef.current?.click()}>{uploading ? <LoaderCircle size={18} className="spin"/> : <Plus size={21}/>}</button>
      {selection.environment==='local'&&nodes.find(n=>n.id===selection.node)?.platform==='win32'&&<button className="button small-button" disabled={uploading||busy} onClick={()=>void pickNative()} title="Faylni kompyuterdan tanlash; serverga yuklanmaydi">Kompyuterdan tanlash</button>}
      <button className="composer-attach" aria-label="Kutubxonadan biriktirish" title="Kutubxonadan biriktirish" disabled={uploading||busy} onClick={()=>void api<Asset[]>('/library').then(setLibrary).catch(e=>toast(e.message))}><LibraryBig size={18}/></button>
      <label className="select-control model-select"><Brain size={17}/><select aria-label="Modelni tanlash" value={models.some(model => model.value === selection.model) ? selection.model : ''} onChange={event => selectModel(event.target.value)} disabled={busy || active}>
        <option value="">Modelni tanlang</option>{providers.filter(provider => provider.enabled||provider.protocol==='antigravity-cli').map(provider => <optgroup key={provider.id} label={provider.label}>{provider.models.filter(m=>isTextModel(provider,m)).map(model => <option key={model} disabled={!provider.enabled} value={JSON.stringify([provider.id, model])}>{provider.model_labels?.[model] || model}{!provider.enabled?(provider.hosted?' · Bulut xizmati offline':' · Kompyuter offline'):''}</option>)}</optgroup>)}{!models.length && <option value="__connect">API ulash...</option>}</select><ChevronDown size={14}/></label>
      <EnvironmentPicker selection={selection} setSelection={setSelection} nodes={nodes} disabled={busy||active} locked={lockedEnvironment||selectedProvider?.protocol==='antigravity-cli'} onConnect={onConnect} toast={toast}/>
      {!compact && <label className="select-control agent-select"><Code2 size={17}/><select aria-label="Agentni tanlash" value={selection.agent} onChange={event => setSelection({ ...selection, agent: event.target.value })} disabled={busy || active}>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><ChevronDown size={14}/></label>}
    </div><div className="composer-send-actions">{active&&<button className="send-button stop-button" aria-label="Vazifani to‘xtatish" title="Asosiy vazifani to‘xtatish" onClick={onStop}><Square size={15} fill="currentColor"/></button>}{(!active||allowParallel)&&<button className="send-button" aria-label={active?'Qo‘shimcha vazifani parallel yuborish':'Vazifani yuborish'} title={active?'Parallel yuborish · Enter':'Yuborish · Enter'} onClick={() => void submit()} disabled={(!draft.trim()&&!attachments.length) || busy || uploading}>{busy ? <LoaderCircle size={18} className="spin"/> : <ArrowUp size={21}/>}</button>}</div></div>
    <div className="composer-options">{!compact&&<label>Agent <select aria-label="Agent ishlash rejimi" value={selection.autonomy||'automatic'} disabled={busy||active} onChange={e=>setSelection({...selection,autonomy:e.target.value as Selection['autonomy']})}><option value="automatic">Avtomatik</option><option value="guided">Tasdiqlash bilan</option></select></label>}{!compact&&selection.environment==='cloud'&&<><label>Natija <select aria-label="Natija saqlash joyi" value={selection.destination||'cloud'} onChange={e=>setSelection({...selection,destination:e.target.value as Selection['destination']})}><option value="cloud">Bulutda</option><option value="download">Qurilmaga ZIP</option>{canChooseFolder()&&<option value="folder">Qurilma papkasiga</option>}</select></label>{selection.destination==='folder'&&<button className="text-button" onClick={async()=>{try{const folderName=await chooseFolder(selection.userId||'');setSelection({...selection,folderName});}catch(e){toast((e as Error).message);}}}>{selection.folderName||'Papka tanlash'}</button>}</>}</div>
    {selection.environment==='local'&&<small className="composer-help">Lokal fayllar shu qurilmada biriktiriladi. Modelga vazifa uchun kerakli matn yoki rasm yuboriladi.</small>}
    {uploadProgress&&<small role="status" className="upload-progress">{uploadProgress}</small>}
    {selectedProvider?.protocol === 'antigravity-cli' && <small className="composer-help">{selectedProvider.hosted?(selectedProvider.enabled?'Antigravity Bulut · Telefon va kompyuterdan ishlaydi. Shaxsiy kompyuter yoqilgan bo‘lishi shart emas.':'Antigravity bulut xizmati offline. Server ulanishini tekshiring.'):(selectedProvider.enabled?'Antigravity online · Telefondan ham shu kompyuterda bajariladi.':'Antigravity offline · Hisob ulangan kompyuter va connectorni yoqing.')} Avtomatik rejimda vazifa qayta tasdiqsiz boshlanadi. CLI ruxsatlari va hisob limitlari amal qiladi.</small>}
    {library&&<Modal title="Kutubxonadan fayl biriktirish" onClose={()=>setLibrary(null)}><div className="studio-form">{library.map(a=><button className="button" key={a.id} disabled={uploading||attachments.length>=100} onClick={async()=>{setUploading(true);try{const file=await api<Attachment>(`/library/${a.id}/attach`,{method:'POST',body:{}});setAttachments(prev=>[...prev,file]);setLibrary(null);}catch(e){toast((e as Error).message);}finally{setUploading(false);}}}>{a.name}</button>)}{!library.length&&<p className="muted">Kutubxona hozir bo‘sh.</p>}</div></Modal>}
    {selectedProvider?.protocol === 'chatgpt-plan' && <div className="chatgpt-plan-note">{selectedProvider.shared && !selectedProvider.can_manage ? 'OpenSI umumiy ChatGPT modellari' : <>Using ChatGPT plan · <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">Manage usage</a></>}</div>}
  </div>;
}
