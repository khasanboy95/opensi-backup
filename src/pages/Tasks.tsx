import { useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, CircleAlert, Cloud, LoaderCircle, Monitor, Plus, RefreshCw, Search, Square, Trash2 } from 'lucide-react';
import { api, dateTime, number } from '../api';
import { Badge, Empty, ErrorBox, Spinner } from '../components/Ui';
import { statusLabels, type Project, type Run } from '../types';

type Category = 'all' | 'working' | 'waiting' | 'completed' | 'issues' | 'cancelled';
type Counts = Record<Category, number>;
type Catalog = { items: Run[]; counts: Counts; nextCursor: string | null };
type CatalogState = { key: string; pages: Catalog[] };

const categories: { id: Category; label: string }[] = [
  { id: 'all', label: 'Barchasi' },
  { id: 'working', label: 'Jarayonda' },
  { id: 'waiting', label: 'Sizni kutmoqda' },
  { id: 'completed', label: 'Tayyor' },
  { id: 'issues', label: 'Muammo' },
  { id: 'cancelled', label: 'To‘xtatilgan' },
];

function stateIcon(status: string) {
  if (status === 'completed') return <CheckCircle2 size={19} />;
  if (status === 'failed' || status === 'interrupted' || status.startsWith('waiting_')) return <CircleAlert size={19} />;
  if (status === 'cancelled') return <Square size={17} />;
  return <LoaderCircle size={19} className={status === 'running' ? 'spin' : ''} />;
}

export function Tasks({ openRun, newTask, projects }: { openRun: (id: string) => void; newTask: () => void; projects: Project[] }) {
  const [catalog, setCatalog] = useState<CatalogState>({ key: '', pages: [] });
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<Category>('all');
  const [projectId, setProjectId] = useState('');
  const [environment, setEnvironment] = useState('all');
  const [sort, setSort] = useState('newest');
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState('');

  useEffect(() => { const timer = setTimeout(() => setTerm(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const query = new URLSearchParams({ category, q: term, projectId, environment, sort, limit: '40' }).toString();

  useEffect(() => {
    let active = true;
    let pending = false;
    setLoading(true);
    setError('');
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const first = await api<Catalog>('/runs/catalog?' + query);
        if (active) {
          setCatalog(current => ({ key: query, pages: [first, ...(current.key === query && current.pages[0]?.nextCursor === first.nextCursor ? current.pages.slice(1) : [])] }));
          setError('');
        }
      } catch (cause) { if (active) setError((cause as Error).message); }
      finally { pending = false; if (active) setLoading(false); }
    };
    void load();
    const timer = setInterval(() => void load(), 8000);
    return () => { active = false; clearInterval(timer); };
  }, [query, refresh]);

  const pages = catalog.key === query ? catalog.pages : [];
  const counts = pages[0]?.counts;
  const rows = [...new Map(pages.flatMap(page => page.items).map(run => [run.id, run])).values()];
  const nextCursor = pages.at(-1)?.nextCursor;
  const hasFilters = Boolean(search || projectId || environment !== 'all' || sort !== 'newest' || category !== 'all');
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await api<Catalog>('/runs/catalog?' + query + '&cursor=' + encodeURIComponent(nextCursor));
      setCatalog(current => current.key === query ? { key: query, pages: [...current.pages, next] } : current);
      setError('');
    } catch (cause) { setError((cause as Error).message); }
    finally { setLoadingMore(false); }
  };
  const removeRun = async (run: Run) => {
    if (!window.confirm('Bu vazifani ro‘yxatdan o‘chirasizmi? Loyiha fayllari saqlanadi.')) return;
    setDeleting(run.id); setError('');
    try {
      await api(`/runs/${run.id}`, { method: 'DELETE' });
      setCatalog(current => ({ ...current, pages: current.pages.map(page => ({ ...page, items: page.items.filter(item => item.id !== run.id) })) }));
      setRefresh(value => value + 1);
    } catch (cause) { setError((cause as Error).message); }
    finally { setDeleting(''); }
  };

  return <section className="page tasks-page">
    <header className="page-heading"><div><h1>Vazifalar</h1><p>Jarayonni kuzating, javob talab qiladigan ishlarni toping va tayyor natijaga qayting.</p></div><button className="button button-primary" onClick={newTask}><Plus size={17}/>Yangi vazifa</button></header>
    <nav className="task-categories" aria-label="Vazifalar toifalari">{categories.map(item => <button key={item.id} type="button" aria-current={category === item.id ? 'page' : undefined} className={category === item.id ? 'selected' : ''} onClick={() => setCategory(item.id)}><span>{item.label}</span><strong>{counts ? number(counts[item.id]) : '—'}</strong></button>)}</nav>
    <div className="task-filters">
      <label className="search-field"><Search size={17}/><input aria-label="Vazifalarni qidirish" placeholder="Vazifa, loyiha yoki modelni qidirish" value={search} onChange={event => setSearch(event.target.value)}/></label>
      <select aria-label="Loyiha bo‘yicha filtrlash" value={projectId} onChange={event => setProjectId(event.target.value)}><option value="">Barcha loyihalar</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select>
      <select aria-label="Muhit bo‘yicha filtrlash" value={environment} onChange={event => setEnvironment(event.target.value)}><option value="all">Bulut va lokal</option><option value="cloud">Bulut</option><option value="local">Lokal</option></select>
      <select aria-label="Vazifalarni saralash" value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Yangilari avval</option><option value="oldest">Eskilari avval</option></select>
      <button className="icon-button task-refresh" aria-label="Vazifalarni yangilash" title="Yangilash" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={17}/></button>
    </div>
    <div className="task-list-heading"><span>{counts ? number(counts[category]) + ' ta vazifa · ' + number(rows.length) + ' tasi ko‘rsatilmoqda' : 'Vazifalar yuklanmoqda'}</span>{hasFilters && <button type="button" onClick={() => { setSearch(''); setTerm(''); setCategory('all'); setProjectId(''); setEnvironment('all'); setSort('newest'); }}>Filtrlarni tozalash</button>}</div>
    {error && <ErrorBox message={error}/>}
    {(loading || catalog.key !== query) && !pages.length ? <Spinner/> : !rows.length ? <Empty>{hasFilters ? 'Bu toifada vazifa topilmadi. Boshqa filtrni tanlang.' : 'Hali vazifa yo‘q. Birinchi topshiriqni yozing.'}</Empty> : <>
      <div className="task-list">{rows.map(run => <div className="task-row" key={run.id}><button className="task-row-main" onClick={() => openRun(run.id)} aria-label={(run.prompt || run.project_title) + '. ' + (statusLabels[run.status] || run.status)}>
        <span className={'task-state task-state-' + run.status}>{stateIcon(run.status)}</span>
        <span className="task-title"><strong>{run.prompt?.replace(/\s+/g, ' ').trim() || run.project_title || 'Nomsiz vazifa'}</strong><span className="task-details"><span>{run.project_title || 'Loyiha'}</span><span aria-hidden="true">·</span><span>{run.environment === 'local' ? <Monitor size={13}/> : <Cloud size={13}/>} {run.environment === 'local' ? 'Lokal' : 'Bulut'}</span><span aria-hidden="true">·</span><span>{dateTime(run.created_at)}</span></span><small>{run.model || 'Model belgilanmagan'}{run.error && ['failed','interrupted'].includes(run.status) ? ' · ' + run.error : ''}</small></span>
        <span className="task-meta"><Badge active={run.status === 'completed' || run.status === 'running'}>{statusLabels[run.status] || run.status}</Badge><small>{number((run.usage?.input || 0) + (run.usage?.output || 0))} token{run.usage?.unknown ? ' + noma’lum' : ''}</small></span><ArrowUpRight className="task-open" size={17}/>
      </button><button type="button" className="icon-button task-delete" aria-label="Vazifani o‘chirish" title={['queued','running','waiting_approval','waiting_input'].includes(run.status) ? 'Avval vazifani to‘xtating' : 'Vazifani o‘chirish'} disabled={Boolean(deleting) || ['queued','running','waiting_approval','waiting_input'].includes(run.status)} onClick={() => void removeRun(run)}>{deleting === run.id ? <LoaderCircle className="spin" size={17}/> : <Trash2 size={17}/>}</button></div>)}</div>
      {nextCursor && <button type="button" className="button task-more" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? <LoaderCircle className="spin" size={16}/> : null}{loadingMore ? 'Yuklanmoqda...' : 'Yana vazifalarni ko‘rsatish'}</button>}
    </>}
  </section>;
}
