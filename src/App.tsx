import { ClipboardList, FolderKanban, LayoutDashboard, ListTodo, Scale, ShieldCheck, Users } from 'lucide-react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { LocalDataPanel } from './components/LocalData';
import { MackEmblem, MackWordmark } from './components/Logo';
import { Avatar } from './components/ui';
import { ComparisonsPage } from './pages/Comparisons';
import { DashboardPage } from './pages/Dashboard';
import { DocumentPage } from './pages/Document';
import { MyTasksPage } from './pages/MyTasks';
import { PeoplePage } from './pages/People';
import { ProjectPage } from './pages/Project';
import { ProjectsPage } from './pages/Projects';
import { StandardPage } from './pages/Standard';
import { StandardsPage } from './pages/Standards';
import { TasksPage } from './pages/Tasks';
import { useUsers } from './state';

const NAV = [
  { to: '/', label: 'Übersicht', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projekte', icon: FolderKanban },
  { to: '/comparisons', label: 'Angebotsvergleich', icon: Scale },
  { to: '/standards', label: 'Standards', icon: ShieldCheck },
  { to: '/my-tasks', label: 'Meine Aufgaben', icon: ListTodo },
  { to: '/tasks', label: 'Aufgabenverteilung', icon: ClipboardList },
  { to: '/people', label: 'Personen', icon: Users },
];

function UserSwitcher() {
  const { people, currentUser, setCurrentUserId } = useUsers();
  return (
    <div className="user-switcher">
      {currentUser ? <Avatar name={currentUser.name} size={30} /> : <span className="avatar avatar-empty">?</span>}
      <label className="user-switcher-select">
        <span className="user-switcher-label">Angemeldet als</span>
        <select
          value={currentUser?.id ?? ''}
          onChange={(e) => setCurrentUserId(e.target.value ? Number(e.target.value) : null)}
          aria-label="Aktuelle Person auswählen"
        >
          <option value="">– Person wählen –</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function App() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="app">
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="MACK Rides Contract – Übersicht">
          <MackEmblem size={30} className="brand-emblem" />
          <MackWordmark className="brand-wordmark" />
          <span className="brand-product">Contract</span>
        </NavLink>
        <nav className="nav">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon size={18} aria-hidden />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        {__STANDALONE__ && <LocalDataPanel />}
        <UserSwitcher />
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/comparisons" element={<ComparisonsPage />} />
          <Route path="/documents/:id" element={<DocumentPage />} />
          <Route path="/standards" element={<StandardsPage />} />
          <Route path="/standards/:id" element={<StandardPage />} />
          <Route path="/my-tasks" element={<MyTasksPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="*" element={<div className="page"><h1>Seite nicht gefunden</h1></div>} />
        </Routes>
      </main>
    </div>
  );
}
