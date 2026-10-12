import { useEffect, useState } from 'react';
import { Shield, RefreshCw, Copy, LoaderCircle, Check, ExternalLink } from 'lucide-react';
import { api } from '../api';
import { Badge, ErrorBox } from './Ui';
import type { Provider } from '../types';

export function ChatgptConnections({ providers, refresh, toast }: { providers: Provider[]; refresh: () => Promise<void>; toast: (message: string) => void }) {
  const accounts = providers.filter(p => p.protocol === 'chatgpt-plan');
  const [pair, setPair] = useState<{ code: string; server: string; expiresIn: number } | null>(null);
  const [expires, setExpires] = useState(0); const [busy, setBusy] = useState(''); const [error, setError] = useState('');
  const [models, setModels] = useState<Record<string, string>>({});
  useEffect(() => { if (!pair) return; const timer = setInterval(() => { setExpires(value => Math.max(0, value - 1)); }, 1000); return () => clearInterval(timer); }, [pair]);
  useEffect(() => { if (!pair || expires <= 0) return; const timer = setInterval(() => { void refresh().catch(() => {}); }, 5000); return () => clearInterval(timer); }, [pair, expires > 0, refresh]);
  async function begin(accountId?: string) { setBusy('connect'); setError(''); try { const value = await api<{ code: string; server: string; expiresIn: number }>('/chatgpt/connect', { method: 'POST', body: { accountId } }); setPair(value); setExpires(value.expiresIn); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } }
  async function action(account: Provider, name: 'models' | 'test' | 'disconnect') {
    setBusy(account.id); setError('');
    try { const result = await api<{ message?: string }>(`/chatgpt/${account.id}/${name}`, { method: 'POST', body: name === 'test' ? { model: models[account.id] || account.models[0] } : {} }); toast(result.message || 'Model ro‘yxati yangilandi.'); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  const command = pair ? `node chatgpt-connect.mjs --server ${pair.server} --code ${pair.code}` : '';
  return <div className="chatgpt-connections">
    <article className="connection-row"><div className="connection-icon"><Shield size={22}/></div><div className="connection-body"><h2>ChatGPT hisobingiz bilan ishlang</h2>
      <p>ChatGPT tarifingiz yoki kreditlaringiz orqali OpenSI agentlarini ishlating. Bir marta kompyuterda ulang; keyin telefon va kompyuterdan foydalaning.</p>
      <p className="small muted">Hisob va tarif ruxsat bergan modellar olinadi. ChatGPT tarixingiz import qilinmaydi. OpenSI fayl, terminal, preview va agent vositalari mavjud.</p>
      <div className="connection-actions"><button className="button button-primary" disabled={Boolean(busy)} onClick={() => void begin()}>{busy === 'connect' && <LoaderCircle size={15} className="spin"/>}Continue with ChatGPT</button><a className="text-button" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">Manage usage <ExternalLink size={13}/></a></div>
      {error && <ErrorBox message={error}/>}
      {pair && <div className="chatgpt-pair"><h3>Kompyuterda bir martalik ulash</h3><p>Node.js 24+ o‘rnatilgan kompyuterda <a href="/chatgpt-connect.mjs" download>ulash yordamchisini yuklab oling</a>. Shu fayl turgan papkada terminal ochib quyidagi buyruqni bajaring, keyin terminal bergan brauzer havolasini oching.</p><pre>{expires > 0 ? command : 'Ulash kodi eskirdi. Continue with ChatGPT tugmasini qayta bosing.'}</pre>
        <button className="button small-button" disabled={expires <= 0} onClick={async () => { try { await navigator.clipboard.writeText(command); toast('Buyruq nusxalandi.'); } catch { toast('Buyruqni belgilang va nusxalang.'); } }}><Copy size={14}/>Nusxalash</button> <span className="small muted">{expires} soniya · Faqat shaxsiy hisobingizga ulanadi</span>
        <p className="small muted">OpenAI tasdig‘idan keyin ulanish serverda shifrlanib saqlanadi. Sahifani yangilang yoki quyidagi hisobni tanlang.</p><button className="text-button" onClick={() => { setPair(null); void refresh(); }}>Ulash oynasini yopish</button>
      </div>}
    </div></article>
    {accounts.map(account => <article key={account.id} className="connection-row"><div className="connection-icon"><Shield size={22}/></div><div className="connection-body"><div className="connection-title"><h2>{account.label}</h2><Badge active={Boolean(account.tested_at && account.enabled)}>{!account.enabled ? 'Qayta kirish kerak' : account.tested_at ? 'Javob tekshirilgan' : 'Modellar olindi'}</Badge></div>
      {account.can_manage&&account.models.some(m=>/astra/i.test(m))&&<p className="small muted">GPT Astra faqat OpenSI egasining hisobida ishlaydi.</p>}<div className="model-pills">{account.models.map(model => <span key={model}>{account.model_labels?.[model] || model}</span>)}</div><p className="small muted">{account.shared ? account.can_manage ? 'Ruxsat berilgan modellar Google foydalanuvchilariga ochiq · Sarf sizning hisobingizdan' : 'Administrator taqdim etgan umumiy modellar · Shaxsiy ChatGPT ulash shart emas' : 'Using ChatGPT plan · Faqat sizning hisobingiz'}</p>
      <div className="connection-actions">{account.enabled && <><select aria-label={`${account.label} test modeli`} value={models[account.id] || account.models[0]} onChange={e => setModels({ ...models, [account.id]: e.target.value })}>{account.models.map(model => <option key={model} value={model}>{account.model_labels?.[model] || model}</option>)}</select><button className="button small-button" disabled={Boolean(busy)} onClick={() => void action(account, 'test')}><Check size={14}/>Javobni tekshirish</button>{account.can_manage && <button className="button small-button" disabled={Boolean(busy)} onClick={() => void action(account, 'models')}><RefreshCw size={14}/>Modellar</button>}</>}
        {account.can_manage && <><button className="text-button" disabled={Boolean(busy)} onClick={() => void begin(account.id)}>Qayta kirish</button>{account.enabled && <button className="text-button" disabled={Boolean(busy)} onClick={() => void action(account, 'disconnect')}>Ulanishni uzish</button>}</>}
        {account.can_share && <button className="button small-button" disabled={Boolean(busy)} onClick={async () => { setBusy(account.id); try { await api(`/chatgpt/${account.id}/sharing`, { method: 'PATCH', body: { shared: !account.shared } }); await refresh(); toast(account.shared ? 'Umumiy foydalanish yopildi.' : 'Barcha Google foydalanuvchilari uchun ochildi.'); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } }}>{account.shared ? 'Umumiy foydalanishni yopish' : 'Barcha Google foydalanuvchilariga ochish'}</button>}
      </div></div></article>)}
  </div>;
}
