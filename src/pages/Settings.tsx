import {PersonalMemory} from '../components/PersonalMemory';
import { useEffect, useState } from 'react';
import { KeyRound, Copy, LoaderCircle, ExternalLink, Shield, Cloud, Monitor } from 'lucide-react';
import { api, number } from '../api';
import { Badge, ErrorBox, Spinner } from '../components/Ui';
import type { User } from '../types';

interface SettingsValue { google: { clientId: string; hasSecret: boolean; adminEmails: string[]; configured: boolean; redirectUri: string }; deployment: { production: boolean; appUrl: string; cloudShell: boolean; localMode: boolean } }
export function Settings({ user, refresh, toast, openConnections }: { user: User; refresh: () => Promise<void>; toast: (message: string) => void; openConnections: () => void }) {
  const [settings, setSettings] = useState<SettingsValue | null>(null); const [clientId, setClientId] = useState(''); const [secret, setSecret] = useState(''); const [emails, setEmails] = useState('');
  const [usage, setUsage] = useState<{ model: string; input: number; output: number; unknown: number }[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const isAdmin = user.role === 'admin';
  async function load() {
    try { setUsage(await api('/usage')); if (isAdmin) { const value = await api<SettingsValue>('/admin/settings'); setSettings(value); setClientId(value.google.clientId); setEmails(value.google.adminEmails.join(', ')); } }
    catch (error) { setError((error as Error).message); }
  }
  useEffect(() => { void load(); }, [user.id]);
  return <section className="page settings-page"><header className="page-heading"><div><h1>Sozlamalar</h1><p>Hisobingiz va ish muhitingizni boshqaring.</p></div></header>
    <div className="settings-section"><h2>Hisob</h2><div className="account-details"><span className="avatar">{user.name.slice(0,1)}</span><div><strong>{user.name}</strong><p>{user.email || 'Shu kompyuterdagi development hisobi'}</p></div><Badge active={!user.local}>{user.local ? 'Lokal development' : 'Google orqali kirilgan'}</Badge></div></div>
    <PersonalMemory/>
    {error && <ErrorBox message={error}/>}
    {isAdmin && !settings && !error && <Spinner/>}
    {isAdmin && settings && <><div className="settings-section"><div className="section-heading"><h2><Shield size={19}/>Google orqali kirish</h2><Badge active={settings.google.configured}>{settings.google.configured ? 'Sozlangan' : 'Sozlanmagan'}</Badge></div>
      <p className="muted">Google Cloud Console’da OAuth client yarating. Quyidagi callback manzilini authorized redirect URI sifatida kiriting.</p><div className="callback-url"><code>{settings.google.redirectUri}</code><button className="icon-button" aria-label="Google callback manzilini nusxalash" onClick={() => { void navigator.clipboard.writeText(settings.google.redirectUri).then(() => toast('Callback manzili nusxalandi.')); }}><Copy size={16}/></button></div>
      <a className="text-link" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Google Cloud Console<ExternalLink size={13}/></a>
      <form className="settings-form" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { await api('/admin/settings/google', { method: 'PUT', body: { clientId, ...(secret ? { clientSecret: secret } : {}), adminEmails: emails.split(',').map(value => value.trim()).filter(Boolean) } }); setSecret(''); await load(); await refresh(); toast('Google OAuth sozlamalari saqlandi. Endi Google bilan kirishni tekshiring.'); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } }}>
        <label>Google Client ID<input required placeholder="...apps.googleusercontent.com" value={clientId} onChange={event => setClientId(event.target.value)}/></label><label>Google Client Secret<input type="password" autoComplete="off" required={!settings.google.hasSecret} placeholder={settings.google.hasSecret ? 'O‘zgartirish uchun yangi secret kiriting' : 'Client Secret'} value={secret} onChange={event => setSecret(event.target.value)}/></label><label>Administrator Gmail manzillari<input required type="text" placeholder="you@gmail.com" value={emails} onChange={event => setEmails(event.target.value)}/><small>Bir nechta manzilni vergul bilan ajrating. Faqat tasdiqlangan hisoblar admin bo‘ladi.</small></label><button className="button button-primary" disabled={busy} type="submit">{busy ? <LoaderCircle size={16} className="spin"/> : <KeyRound size={16}/>}Sozlamalarni saqlash</button>
      </form></div>
      <div className="settings-section"><h2>Ish muhiti</h2><div className="settings-row"><span><Cloud size={17}/>Server</span><strong>{settings.deployment.production ? 'Production' : 'Lokal development'}</strong></div><div className="settings-row"><span><Monitor size={17}/>Bulut terminali</span><Badge active={settings.deployment.cloudShell}>{settings.deployment.cloudShell ? 'Docker runner yoqilgan' : 'Docker runner yoqilmagan'}</Badge></div><p className="small muted">Bulutda terminal izolyatsiyalangan Docker runnerda ishlaydi. Kompyuteringizda ishlash uchun lokal connectorni ulang.</p><button className="button" onClick={openConnections}>Ulanishlarni ochish</button></div></>}
    <div className="settings-section"><h2>Mening token sarfim</h2>{usage.length ? <div className="table-wrap"><table><thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Usage</th></tr></thead><tbody>{usage.map(row => <tr key={row.model}><td>{row.model}</td><td>{number(row.input)}</td><td>{number(row.output)}</td><td>{row.unknown ? `${row.unknown} ta noma’lum` : 'API ma’lumoti'}</td></tr>)}</tbody></table></div> : <p className="muted">Hali token sarfi yo‘q.</p>}</div>
  </section>;
}
