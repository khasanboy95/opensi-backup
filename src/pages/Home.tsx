import { Monitor, Code2, ChartNoAxesColumn, ArrowRight } from 'lucide-react';
import { Brand } from '../components/Brand';
import { Composer } from '../components/Composer';
import {ProjectLink} from '../components/ProjectLink';
import type { ComponentProps } from 'react';

export function Home({ composer, connected, onConnect }: { composer: ComponentProps<typeof Composer>; connected: boolean; onConnect: () => void }) {
  const suggestions = [{ icon: Monitor, label: 'Veb-sayt yaratish', prompt: 'Zamonaviy, telefon va kompyuterga mos portfolio veb-sayt yaratib ber.' },
    { icon: Code2, label: 'Kodni yaxshilash', prompt: 'Biriktirgan kodimni tekshir, xatolarini tuzat va kerakli o‘zgarishlarni tushuntir.' },
    { icon: ChartNoAxesColumn, label: 'Ma’lumot tahlili', prompt: 'Biriktirgan ma’lumotlarimni tahlil qil va asosiy natijalarni tushuntir.' }];
  return <section className="home"><div className="home-center"><Brand size={47}/><h1>Bugun nima yaratamiz?</h1><p className="home-subtitle">G‘oyadan tayyor dasturgacha. Agentlaringiz bilan birga.</p>
    <div className="home-local-connect"><Monitor size={22}/><div><strong>O‘z kompyuteringizda ishlang</strong><span>Loyiha papkasini ulang. Kod va fayllar tanlangan kompyuterda saqlanadi.</span></div><a className="button" href="#/connections/nodes">Kompyuter ulash <ArrowRight size={16}/></a></div>
    <div className="suggestions"><ProjectLink onLinked={async id=>{window.location.hash='/workspace/project:'+id;}}/></div>
    <p className="small muted">Papka yo‘lini xabarning birinchi qatoriga ham yozishingiz mumkin: <code>{'D:\\Dastur 1\\14'}</code>. Keyingi qatorda vazifani yozing.</p>
    <Composer {...composer}/><div className="suggestions">{suggestions.map(item => <button key={item.label} className="button" onClick={() => composer.setDraft(item.prompt)}><item.icon size={18} strokeWidth={1.5}/>{item.label}</button>)}</div>
    {!connected && <p className="connect-hint">Boshlash uchun <button onClick={onConnect}>API ulang <ArrowRight size={14}/></button></p>}</div>
    <p className="home-footer">Barcha ishlar bitta maydonda. Har qanday qurilmadan.</p></section>;
}
