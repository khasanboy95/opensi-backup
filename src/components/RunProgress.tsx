import { memo } from 'react';
import { Activity, AlertCircle, CheckCircle2, ChevronRight, Clock3, Code2, FileCode2, FileSearch, Globe, Layers3, LoaderCircle, Terminal } from 'lucide-react';
import { number } from '../api';
import { isActive, statusLabels, type LiveDraft, type RunDetail } from '../types';
import type { ToolActivity } from '../run-stream';

export function bytesLabel(bytes: number) { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`; }
export function durationLabel(seconds: number) { return seconds < 60 ? `${seconds} soniya` : `${Math.floor(seconds / 60)} daq ${seconds % 60} s`; }
export const toolLabels: Record<string, string> = {
  parallel_read:'Parallel o‘zgarishlarni solishtirish',parallel_resolve:'Fayl ziddiyatini birlashtirish',parallel_finish:'Qo‘shimcha ishni tekshirib yakunlash',
  handoff_model:'Boshqa modelga davom ettirish uchun topshirish',
  project_inspect:'Mavjud loyihani o‘rganish',save_checkpoint:'Loyiha holatini saqlash',install_node_dependencies:'Node kutubxonalarini o‘rnatish',
  install_packages:'Python kutubxonalarini o‘rnatish',
  transcribe_media:'Video yoki audioni matnga aylantirish',
  project_service:'Bot / API jarayoni',integration_catalog:'Deploy va API ulanishlari',deploy_vercel:'Vercelga deploy qilish',deployment_status:'Vercel build va HTTP tekshiruvi',api_request:'API amalini bajarish',telegram_bot:'Telegram botni ulash',
  runtime_info:'Dasturlash va media vositalarini tekshirish',youtube_analyze:'YouTube ma’lumot va subtitrlarini tahlil qilish',create_agent:'Maxsus agent yaratish',consult_model:'Mutaxassis model bilan ishlash',computer_explore:'Ichki sahifa va kategoriyalarni o‘rganish',
  artifact_export:'Dizayn fayllarini eksport qilish',
  computer_observe:'Jonli brauzerni ko‘rish', computer_action:'Brauzerda amal bajarish',computer_capture:'Saytni scroll va screenshot bilan o‘rganish',
  update_plan: 'Ish rejasini yangilash', browser_test: 'Brauzerda tekshirish',
  list_files: 'Fayllarni ko‘rish', read_file: 'Faylni o‘qish', write_file: 'Faylni yozish', run_command: 'Terminal buyrug‘i',
  append_file: 'Kod qo‘shish', edit_file: 'Kodni tahrirlash', copy_file: 'Faylni nusxalash',
  publish_preview: 'Previewni tayyorlash', http_get: 'Manbani o‘qish', ask_user: 'Javob kutilmoqda', await_integration: 'Hisob ulanishini kutish', delegate_agent: 'Agentga vazifa berish',
};
export function phaseLabel(detail: RunDetail) {
  if (!isActive(detail.run.status)) return statusLabels[detail.run.status] || detail.run.status;
  if(detail.live?.phase==='reconnecting'||detail.run.status==='queued'&&detail.recovery?.state==='reconnecting')return 'Ulanish kutilmoqda · avtomatik davom etadi';
  if(detail.run.status==='queued'&&(detail.recovery?.resumes||0)>0)return 'Saqlangan holatdan davom ettirilmoqda';
  if (detail.run.status !== 'running') return statusLabels[detail.run.status];
  const live = detail.live;
  if (live?.phase === 'writing') return 'Kod yozilmoqda';
  if (live?.phase === 'executing') return toolLabels[live.tool || ''] || 'Vosita bajarilmoqda';
  if (live?.phase === 'responding') return 'Javob yozilmoqda';
  if (live?.phase === 'preparing') return 'Model javob tayyorlayapti';
  if (live?.phase === 'tool_done') return 'Amal yakunlandi';
  return 'Model javobi kutilmoqda';
}

export function RunProgress({ detail, connected, now }: { detail: RunDetail; connected: boolean; now: number }) {
  const active = isActive(detail.run.status);
  const elapsed = Math.max(0, Math.floor(((active ? now : Date.parse(detail.run.updated_at)) - Date.parse(detail.run.created_at)) / 1000));
  const idle = detail.live ? Math.max(0, Math.floor((now - Date.parse(detail.live.updatedAt)) / 1000)) : 0;
  const saved = new Set(detail.events.filter(event => event.type === 'tool_result' && ['write_file','append_file','edit_file','copy_file'].includes(event.data.tool) && !event.data.result?.error).map(event => event.data.result?.path).filter(Boolean)).size;
  return <div className={`run-progress ${active ? 'run-progress-active' : ''}`} role="status" aria-live="polite">
    <div className="progress-heading">{active ? <LoaderCircle className="spin" size={16}/> : detail.run.status === 'completed' ? <CheckCircle2 size={16}/> : <AlertCircle size={16}/>}<strong>{phaseLabel(detail)}</strong>{active && <span className={`connection-indicator ${connected ? 'connected' : ''}`}>{connected ? 'Jonli' : 'Qayta ulanmoqda'}</span>}</div>
    <div className="progress-meta"><span><Clock3 size={12}/>{durationLabel(elapsed)}</span>{detail.live?.step ? <span>{detail.live.agent} · {detail.live.step}-bosqich</span> : <span>{detail.run.model}</span>}{saved > 0 && <span>{saved} ta fayl yozildi</span>}{active && (detail.live?.receivedBytes || 0) > 0 && <span>{bytesLabel(detail.live!.receivedBytes)} javob olindi</span>}</div>
    {detail.run.provider_id==='auto'&&<div className="model-team"><strong>Avtomatik modellar jamoasi</strong>{detail.events.filter(e=>e.type==='model_route').slice(-6).map(e=><p key={e.id}>{e.data.model} · {e.data.reason}</p>)}</div>}
    {detail.run.provider_id==='auto'&&detail.events.some(e=>e.type==='model_handoff')&&<p className="skills-run-line">Avtomatik davom ettirish: {detail.events.filter(e=>e.type==='model_handoff').at(-1)?.data.reason} Bajarilgan ishlar keyingi modelga berildi.</p>}
    {detail.events.some(e=>e.type==='jev_supervision')&&<p className="skills-run-line jev-supervision"><strong>JEV nazorati</strong> · {detail.events.filter(e=>e.type==='jev_supervision').at(-1)?.data.label} · {detail.events.filter(e=>e.type==='jev_supervision').at(-1)?.data.durationMs} ms</p>}
    {detail.events.some(e=>e.type==='skills_applied')&&<p className="skills-run-line">Qo‘llangan ko‘nikmalar: {detail.events.filter(e=>e.type==='skills_applied').flatMap(e=>(e.data.skills||[]).map((skill:{title:string})=>skill.title)).join(', ')} · <a href="#/skills">Ko‘rish</a></p>}
    {detail.events.some(e=>e.type==='skill_learned')&&<p className="skills-run-line">Bu vazifa ko‘nikmalar tajribasiga qo‘shildi. <a href="#/skills">Ko‘nikmalar</a></p>}
    {active && !['waiting_approval', 'waiting_input'].includes(detail.run.status) && idle >= 30 && <p>Modeldan yangi ma’lumot kutilmoqda · oxirgi yangilanish {durationLabel(idle)} oldin. Vazifani pastdagi tugma bilan to‘xtatish mumkin.</p>}
  </div>;
}

export const ToolCard = memo(function ToolCard({ item, onFile, onTerminal }: { item: ToolActivity; onFile: (path: string) => void; onTerminal: () => void }) {
  const result = item.result;
  const Icon = item.tool === 'run_command' ? Terminal : item.tool === 'delegate_agent' ? Layers3 : item.tool === 'http_get' ? Globe : item.tool === 'read_file' || item.tool === 'list_files' ? FileSearch : item.tool === 'write_file' ? FileCode2 : Activity;
  const path = typeof item.args.path === 'string' ? item.args.path : '';
  const summary = result?.error || (result?.denied ? 'Amal rad etildi.' : item.tool === 'list_files' && result?.files ? `${result.files.length} ta fayl topildi` : item.tool === 'run_command' ? result?.timedOut ? 'Buyruq uchun vaqt tugadi' : result?.exitCode !== undefined ? `Exit code: ${result.exitCode}` : '' : ['write_file','append_file','edit_file','copy_file'].includes(item.tool) && result ? `${bytesLabel(result.bytes || item.args.bytes || 0)} saqlandi` : item.tool === 'publish_preview' && result?.files ? `${result.files.length} ta fayl previewga yuborildi` : item.tool === 'delegate_agent' ? item.args.task : item.tool === 'http_get' ? item.args.url : '');
  return <div className={`tool-card tool-card-${item.state}`}>
    <div className="tool-card-heading"><Icon size={16}/><strong>{toolLabels[item.tool] || item.tool}</strong><span>{item.agent}</span>{item.state === 'running' ? <LoaderCircle size={14} className="spin"/> : item.state === 'done' ? <CheckCircle2 size={14} className="lime"/> : <AlertCircle size={14}/>}</div>
    {path && <button className="tool-file-link mono" onClick={() => onFile(path)}><span>{path}</span><ChevronRight size={13}/></button>}
    {item.tool === 'run_command' && <button className="tool-command mono" onClick={onTerminal}><Terminal size={13}/><span>{item.args.command}</span><ChevronRight size={13}/></button>}
    {summary && <p className={item.state === 'failed' ? 'tool-error' : ''}>{String(summary).slice(0, 400)}</p>}
    {item.tool==='computer_capture'&&result?.manifestPath&&<><p>{result.frames?.length||0} ta screenshot · {result.assets?.length||0} ta rasm/font · {result.atBottom?'Sahifa oxirigacha ko‘rildi':'Keyingi bo‘limlarni o‘rganish kerak'}</p><button className="tool-file-link mono" onClick={()=>onFile(result.manifestPath)}>{result.manifestPath}<ChevronRight size={13}/></button></>}
    {item.state === 'interrupted' && <p>Amal uzilgan. Yakunlangan natija olinmadi.</p>}
    {result && !['write_file','append_file','edit_file','copy_file'].includes(item.tool) && <details><summary>Natijani ko‘rish</summary><pre>{(result.output || result.content || result.text || JSON.stringify(result, null, 2)).toString().slice(0, 12000)}</pre></details>}
  </div>;
});

export function DraftCard({ draft, onOpen, onRecover, onResume, busy }: { draft: LiveDraft; onOpen: () => void; onRecover?: () => void; onResume?: () => void; busy?: boolean }) {
  const label = draft.state !== 'writing' ? 'Saqlanmagan qoralama' : draft.operation === 'append_file' ? 'Kod qo‘shilmoqda' : draft.operation === 'edit_file' ? 'Kod tahrirlanmoqda' : 'Yozilmoqda';
  return <div className="draft-item"><button className="draft-card" onClick={onOpen} aria-label={`${draft.path || 'Fayl'} jonli kodini ochish`}><span className="draft-icon">{draft.state === 'writing' ? <LoaderCircle className="spin" size={18}/> : <FileCode2 size={18}/>}</span><span><strong>{draft.path || 'Fayl tayyorlanmoqda'}</strong><small>{label} · {number(draft.lines)} qator · {bytesLabel(draft.bytes)}</small></span><Code2 size={17}/></button>{onRecover && <div className="draft-recovery"><p>Qoralama tugallanmagan. Uni alohida faylga tiklab, shu joydan davom ettirish mumkin.</p><div><button className="button small-button" disabled={busy} onClick={onRecover}>{busy ? <LoaderCircle size={13} className="spin"/> : <FileCode2 size={13}/>}Qoralamani tiklash</button>{onResume && <button className="button button-primary small-button" disabled={busy} onClick={onResume}>Shu joydan davom etish<ChevronRight size={13}/></button>}</div></div>}</div>;
}
