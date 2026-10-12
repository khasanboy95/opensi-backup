import { useState } from 'react';
import { Code2, Palette, Search, ChartNoAxesCombined, Plus, ArrowUpRight, LoaderCircle, Users } from 'lucide-react';
import { Modal, ErrorBox } from '../components/Ui';
import { api } from '../api';
import type { Agent, Provider } from '../types';

const icons: Record<string, typeof Code2> = { developer: Code2, designer: Palette, researcher: Search, analyst: ChartNoAxesCombined };
const toolLabels: Record<string, string> = { list_files: 'Fayllar ro‘yxati', read_file: 'Fayl o‘qish', write_file: 'Fayl yozish', run_command: 'Terminal', http_get: 'Sahifa o‘qish', ask_user: 'Savol berish', delegate_agent: 'Agentga vazifa berish', mcp: 'MCP vositalari' };
export function Agents({ agents, providers, refresh, startWithAgent, toast }: { agents: Agent[]; providers: Provider[]; refresh: () => Promise<void>; startWithAgent: (agent: string) => void; toast: (message: string) => void }) {
  const [modal, setModal] = useState(false); const [details, setDetails] = useState<Agent | null>(null);
  return <section className="page"><header className="page-heading"><div><h1>Agentlar</h1><p>Har bir vazifa uchun kerakli mutaxassisni tanlang.</p></div><button className="button button-primary" onClick={() => setModal(true)}><Plus size={17}/>Yangi agent</button></header>
    <div className="agent-list">{agents.map(agent => { const Icon = icons[agent.id] || Users; return <article key={agent.id} className="agent-row"><div className="agent-icon"><Icon size={24} strokeWidth={1.5}/></div><div className="agent-info"><h2>{agent.name}</h2><p>{agent.description}</p><div className="agent-tools">{agent.tools.map(tool => <span key={tool}>{toolLabels[tool] || tool}</span>)}</div></div><div className="agent-actions"><button className="text-button" onClick={() => setDetails(agent)}>Ko‘rsatmalar</button><button className="button" onClick={() => startWithAgent(agent.id)}>Vazifa berish<ArrowUpRight size={16}/></button></div></article>; })}</div>
    <p className="page-note">Agentlar API orqali ishlaydi. Bir agent vazifaning bir qismini boshqasiga topshirishi mumkin; har bir chaqiruvning token sarfi hisobga olinadi.</p>
    {details && <Modal title={details.name} onClose={() => setDetails(null)}><p className="agent-prompt">{details.prompt}</p><p className="small muted">{details.model ? `Model: ${details.model}` : 'Vazifada tanlangan modeldan foydalanadi.'}</p></Modal>}
    {modal && <AgentForm providers={providers} onClose={() => setModal(false)} onSaved={async () => { setModal(false); await refresh(); toast('Yangi agent tayyor.'); }}/>} 
  </section>;
}
function AgentForm({ providers, onClose, onSaved }: { providers: Provider[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(''); const [tools, setTools] = useState(['list_files', 'read_file', 'write_file', 'ask_user']); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Modal title="Yangi agent" onClose={onClose}><form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { const picked = model ? JSON.parse(model) : null; await api('/agents', { method: 'POST', body: { name, description, prompt, tools, ...(picked ? { provider_id: picked[0], model: picked[1] } : {}) } }); await onSaved(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } }}>
    <label>Agent nomi<input autoFocus required maxLength={80} value={name} onChange={event => setName(event.target.value)}/></label><label>Vazifasi<input maxLength={300} value={description} onChange={event => setDescription(event.target.value)}/></label><label>Agent ko‘rsatmasi<textarea required rows={5} maxLength={12000} placeholder="Agent nimalarni bajarishi kerakligini aniq yozing..." value={prompt} onChange={event => setPrompt(event.target.value)}/></label>
    <label>Model<select value={model} onChange={event => setModel(event.target.value)}><option value="">Vazifada tanlangan model</option>{providers.filter(provider => provider.enabled).map(provider => <optgroup key={provider.id} label={provider.label}>{provider.models.map(model => <option key={model} value={JSON.stringify([provider.id, model])}>{model}</option>)}</optgroup>)}</select><small>Bu model agentga delegatsiya qilinganda ishlatiladi.</small></label>
    <fieldset className="tool-checkboxes"><legend>Agent vositalari</legend>{Object.entries(toolLabels).map(([tool, label]) => <label key={tool}><input type="checkbox" checked={tools.includes(tool)} onChange={event => setTools(event.target.checked ? [...tools, tool] : tools.filter(value => value !== tool))}/>{label}</label>)}</fieldset>
    {error && <ErrorBox message={error}/>}<footer><button className="button" type="button" onClick={onClose}>Bekor qilish</button><button className="button button-primary" type="submit" disabled={busy}>{busy && <LoaderCircle size={16} className="spin"/>}Agent yaratish</button></footer>
  </form></Modal>;
}
