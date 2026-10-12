import { Home, List, Users, Link, Shield, Settings, Plus, Folder, Menu, ChevronsLeft, ChevronDown, LogOut, X, LibraryBig, Workflow, AudioLines, Monitor, PanelsTopLeft, Palette, FileText, Scissors, MessageCircle } from 'lucide-react';
import { Brand, GoogleMark } from './Brand';
import { BookOpen } from 'lucide-react';
import type { AuthConfig, Page, Project, User } from '../types';

const nav = [{ page: 'personal', label: 'Davomiy suhbat', icon: BookOpen }, { page: 'home', label: 'Ish maydoni', icon: Home }, { page: 'tasks', label: 'Vazifalar', icon: List }, { page: 'agents', label: 'Agentlar', icon: Users }, { page: 'skills', label: 'Ko‘nikmalar', icon: BookOpen }, { page: 'projects', label: 'Loyihalar', icon: Folder }, { page: 'documents', label: 'Hujjatlar', icon: FileText }, { page: 'library', label: 'Kutubxona', icon: LibraryBig }, { page: 'flows', label: 'Ish oqimlari', icon: Workflow }, { page: 'creative', label: 'Ijod studiyasi', icon: Palette }, { page: 'media', label: 'Media studiya', icon: AudioLines }, { page: 'montage', label: 'Video montaj', icon: Scissors }, { page: 'computer', label: 'Kompyuter', icon: Monitor }, { page: 'dashboard', label: 'Panellar', icon: PanelsTopLeft }, { page: 'connections', label: 'Ulanishlar', icon: Link }] as const;
export function Shell({ page, user, auth, projects, open, setOpen, collapsed, setCollapsed, go, newTask, onLogin, onLogout, children }: {
  page: Page; user: User; auth: AuthConfig; projects: Project[]; open: boolean; setOpen: (open: boolean) => void;
  collapsed: boolean; setCollapsed: (collapsed: boolean) => void; go: (page: Page, id?: string) => void;
  newTask: () => void; onLogin: () => void; onLogout: () => void; children: React.ReactNode;
}) {
  const navigate = (target: Page, id?: string) => { go(target, id); setOpen(false); };
  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    {open && <button className="sidebar-backdrop" aria-label="Menyuni yopish" onClick={() => setOpen(false)} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><button className="brand-link" onClick={() => navigate('home')} aria-label="OpenSI bosh sahifa"><Brand /><strong>OpenSI</strong></button>
        <button className="icon-button collapse-button" aria-label="Menyuni yig‘ish" onClick={() => setCollapsed(!collapsed)}><ChevronsLeft size={17}/></button>
        <button className="icon-button mobile-close" aria-label="Menyuni yopish" onClick={() => setOpen(false)}><X size={18}/></button></div>
      <button className="new-task" onClick={() => { newTask(); setOpen(false); }}><Plus size={19}/><span>Yangi vazifa</span></button>
      <nav className="main-nav" aria-label="Asosiy navigatsiya">{nav.map(item => <button key={item.page} className={`nav-item ${page === item.page || (page === 'workspace' && item.page === 'tasks') ? 'selected' : ''}`} onClick={() => navigate(item.page)} title={item.label}>
        <item.icon size={20} strokeWidth={1.6}/><span>{item.label}</span></button>)}</nav>
      <div className="project-nav"><div className="section-label"><span>LOYIHALAR</span><button className="icon-button" aria-label="Yangi loyiha" onClick={() => { newTask(); setOpen(false); }}><Plus size={17}/></button></div>
        {!projects.length ? <p className="no-projects">Hali loyiha yo‘q</p> : <div className="project-list">{projects.map(project => <button key={project.id} className="nav-item" onClick={() => navigate('workspace', `project:${project.id}`)} title={project.title}><Folder size={18}/><span>{project.title}</span></button>)}</div>}</div>
      <div className="sidebar-bottom"><nav aria-label="Hisob navigatsiyasi">{user.role === 'admin' && <button className={`nav-item ${page === 'admin' ? 'selected' : ''}`} onClick={() => navigate('admin')} title="Admin panel"><Shield size={20} strokeWidth={1.6}/><span>Admin panel</span></button>}
        <button className={`nav-item ${page === 'settings' ? 'selected' : ''}`} onClick={() => navigate('settings')} title="Sozlamalar"><Settings size={20} strokeWidth={1.6}/><span>Sozlamalar</span></button></nav>
        <div className="profile"><span className="avatar">{user.local ? 'O' : user.name.slice(0, 1).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.email || 'Shaxsiy'}</small></div>
          {user.local ? <ChevronDown size={16}/> : <button className="icon-button" aria-label="Hisobdan chiqish" onClick={onLogout}><LogOut size={16}/></button>}</div></div>
    </aside>
    <main className="main-area"><header className="topbar"><div className="workspace-title"><button className="icon-button menu-button" aria-label="Menyuni ochish" onClick={() => { if (window.innerWidth < 800) setOpen(true); else setCollapsed(false); }}><Menu size={19}/></button><span>Shaxsiy workspace</span><ChevronDown size={15}/></div>
      <a className="button topbar-dot" href="#/connections/dot" aria-label="ChatGPT dot va OpenSI suhbatini ochish"><MessageCircle size={17}/><span>Dot</span></a>
      <a className="button topbar-connect" href="#/connections/nodes"><Monitor size={17}/><span>Kompyuter ulash</span></a>
      {user.local ? <button className="button google-button" onClick={onLogin} title={auth.configured ? 'Google hisob orqali kiring' : 'Google OAuth sozlamalarini ochish'}><GoogleMark/><span>Google bilan kirish</span></button> : <span className="signed-in"><span className="online-dot"/>{user.email}</span>}</header>
      <div className="main-content">{children}</div></main>
  </div>;
}
