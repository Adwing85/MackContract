import { ChevronRight, Database, FolderKanban, ListTodo, Plus, Scale, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { StatusBadge, StatusBar } from '../components/status';
import { greeting, Hero } from '../components/Hero';
import { DueChip, EmptyState, ErrorBox, Loading, StatTile } from '../components/ui';
import { formatDateTime } from '../format';
import { useAction, useAsync, useUsers } from '../state';
import { ComparisonCard } from './Comparisons';
import { NewProjectDialog } from './Projects';

export function DashboardPage() {
  const { currentUser, reloadPeople } = useUsers();
  const { data, error, loading, reload } = useAsync(() => api.dashboard(), [currentUser?.id]);
  const comparisons = useAsync(() => api.comparisons.list(), [data?.counts.documents]);
  const myDeviations = useAsync(
    () => (currentUser ? api.deviations.list({ assigneeId: currentUser.id, open: true }) : Promise.resolve([])),
    [currentUser?.id, data?.counts.openDeviations],
  );
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
      <Hero
        eyebrow="MACK Rides · Contract"
        title={currentUser ? `${greeting()}, ${currentUser.name.split(' ')[0]}.` : 'Verträge prüfen. Angebote vergleichen.'}
        actions={
          <>
            <Link className="btn btn-hero-ghost" to="/comparisons">
              <Scale size={16} /> Angebotsvergleich
            </Link>
            <button className="btn btn-hero" onClick={() => setCreating(true)}>
              <Plus size={16} /> Neues Projekt
            </button>
          </>
        }
      >
        <p className="hero-text">
          {isEmpty
            ? 'Verträge, Angebote und Auftragsbestätigungen zeilenweise prüfen, im Team bewerten und Angebote fundiert vergleichen.'
            : 'Jede Anforderung sicher ins Ziel – hier ist der aktuelle Stand deiner Prüfungen.'}
        </p>
        {!isEmpty && (
          <section className="stat-row hero-stats">
            <StatTile label="Projekte" value={counts.projects} sub={`${counts.documents} Dokumente`} />
            <StatTile label="Anforderungen offen" value={counts.openRequirements} sub={`von ${counts.requirements} insgesamt`} />
            <StatTile label="Offene Prüfaufgaben" value={counts.openTasks} sub={<Link to="/tasks">Aufgabenverteilung</Link>} />
            <StatTile
              label="Überfällige Aufgaben"
              value={counts.overdueTasks}
              tone={counts.overdueTasks > 0 ? 'bad' : undefined}
              sub={counts.overdueTasks > 0 ? <Link to="/tasks?overdue=1">Anzeigen</Link> : 'Alles im Plan'}
            />
            <StatTile
              label="Offene Abweichungen"
              value={counts.openDeviations}
              tone={counts.openDeviations > 0 ? 'warn' : undefined}
              sub={<Link to="/standards?tab=register">Abweichungsregister</Link>}
            />
          </section>
        )}
      </Hero>

      {__STANDALONE__ && (
        <div className="hint-box">
          <p>
            <strong>Lokale Version:</strong> Alle Daten werden nur in diesem Browser gespeichert. Mit „Sicherung speichern“ lassen sie
            sich sichern oder an Kolleginnen und Kollegen weitergeben. Für die gleichzeitige Arbeit im Team gibt es die Server-Version.
          </p>
        </div>
      )}

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
          {comparisons.data && comparisons.data.length > 0 && (
            <section className="stack-sm">
              <div className="section-title">
                <h2>
                  <Scale size={18} /> Laufende Angebotsvergleiche
                </h2>
                <Link to="/comparisons" className="link-sm">
                  Alle Vergleiche <ChevronRight size={14} />
                </Link>
              </div>
              <div className="card-grid">
                {comparisons.data.slice(0, 3).map((p) => (
                  <ComparisonCard key={p.id} project={p} />
                ))}
              </div>
            </section>
          )}

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
              ) : data.myTasks.length === 0 && !myDeviations.data?.length ? (
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
                  {myDeviations.data && myDeviations.data.length > 0 && (
                    <li className="list-item clickable" onClick={() => navigate('/my-tasks')}>
                      <div className="list-main">
                        <div className="list-title">
                          <ShieldCheck size={14} aria-hidden /> {myDeviations.data.length} Abweichung{myDeviations.data.length === 1 ? '' : 'en'} vom Standard zu klären
                        </div>
                        <div className="list-meta">{[...new Set(myDeviations.data.map((d) => d.documentTitle))].join(' · ')}</div>
                      </div>
                      <DueChip date={myDeviations.data.map((d) => d.dueDate).filter((x): x is string => Boolean(x)).sort()[0] ?? null} />
                    </li>
                  )}
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
