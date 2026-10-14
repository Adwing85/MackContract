import { ChevronRight, Database, FolderKanban, ListTodo, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { StatusBadge, StatusBar } from '../components/status';
import { DueChip, EmptyState, ErrorBox, Loading, StatTile } from '../components/ui';
import { formatDateTime } from '../format';
import { useAction, useAsync, useUsers } from '../state';
import { NewProjectDialog } from './Projects';

export function DashboardPage() {
  const { currentUser, reloadPeople } = useUsers();
  const { data, error, loading, reload } = useAsync(() => api.dashboard(), [currentUser?.id]);
  const [creating, setCreating] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const run = useAction();
  const navigate = useNavigate();

  const seed = async () => {
    setSeeding(true);
    const result = await run(() => api.seedDemo(), 'Beispieldaten angelegt');
    setSeeding(false);
    if (result) {
      await reloadPeople();
      await reload();
    }
  };

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return loading ? <Loading /> : null;

  const { counts } = data;
  const isEmpty = counts.projects === 0;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Übersicht</h1>
          <p className="page-sub">
            {currentUser ? `Hallo ${currentUser.name.split(' ')[0]} – hier ist der aktuelle Stand.` : 'Verträge, Angebote und Auftragsbestätigungen prüfen.'}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> Neues Projekt
          </button>
        </div>
      </header>

      {isEmpty ? (
        <div className="card">
          <EmptyState
            icon={<FolderKanban size={36} />}
            title="Noch keine Projekte"
            text={
              <>
                Lege ein Projekt an (z. B. eine Ausschreibung oder einen Kundenvertrag) und füge Verträge, Angebote oder
                Auftragsbestätigungen hinzu. Zum Ausprobieren können Beispieldaten erzeugt werden.
              </>
            }
            action={
              <div className="row gap">
                <button className="btn btn-primary" onClick={() => setCreating(true)}>
                  <Plus size={16} /> Projekt anlegen
                </button>
                <button className="btn" onClick={seed} disabled={seeding}>
                  <Database size={16} /> {seeding ? 'Wird angelegt …' : 'Beispieldaten laden'}
                </button>
              </div>
            }
          />
        </div>
      ) : (
        <>
          <section className="stat-row">
            <StatTile label="Projekte" value={counts.projects} sub={`${counts.documents} Dokumente`} />
            <StatTile
              label="Anforderungen offen"
              value={counts.openRequirements}
              sub={`von ${counts.requirements} insgesamt`}
            />
            <StatTile label="Offene Prüfaufgaben" value={counts.openTasks} />
            <StatTile
              label="Überfällige Aufgaben"
              value={counts.overdueTasks}
              tone={counts.overdueTasks > 0 ? 'bad' : undefined}
              sub={counts.overdueTasks > 0 ? <Link to="/tasks?overdue=1">Anzeigen</Link> : 'Alles im Plan'}
            />
          </section>

          <div className="grid-2">
            <section className="card">
              <div className="card-header">
                <h2>
                  <ListTodo size={18} /> Meine nächsten Aufgaben
                </h2>
                <Link to="/my-tasks" className="link-sm">
                  Alle anzeigen <ChevronRight size={14} />
                </Link>
              </div>
              {!currentUser ? (
                <p className="muted pad">Wähle links unten aus, wer du bist, um deine Aufgaben zu sehen.</p>
              ) : data.myTasks.length === 0 ? (
                <p className="muted pad">Keine offenen Aufgaben – alles erledigt.</p>
              ) : (
                <ul className="list">
                  {data.myTasks.map((t) => (
                    <li key={t.id} className="list-item clickable" onClick={() => navigate(`/my-tasks#task-${t.id}`)}>
                      <div className="list-main">
                        <div className="list-title clamp-2">
                          {t.requirementRef && <span className="ref">{t.requirementRef}</span>} {t.requirementText}
                        </div>
                        <div className="list-meta">
                          {t.projectName} › {t.documentTitle}
                        </div>
                      </div>
                      <DueChip date={t.dueDate} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <div className="card-header">
                <h2>
                  <FolderKanban size={18} /> Zuletzt bearbeitete Projekte
                </h2>
                <Link to="/projects" className="link-sm">
                  Alle Projekte <ChevronRight size={14} />
                </Link>
              </div>
              <ul className="list">
                {data.recentProjects.map((p) => (
                  <li key={p.id} className="list-item clickable" onClick={() => navigate(`/projects/${p.id}`)}>
                    <div className="list-main">
                      <div className="list-title">{p.name}</div>
                      <div className="list-meta">
                        {p.documentCount} Dokumente · {p.stats.total} Anforderungen · geändert {formatDateTime(p.updatedAt)}
                      </div>
                      <StatusBar stats={p.stats} />
                    </div>
                    {p.stats.declined > 0 && <StatusBadge status="declined" compact />}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}

      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
