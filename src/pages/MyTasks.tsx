import { CircleCheck, ExternalLink, ListTodo, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { TaskWithContext } from '../../shared/types';
import { api } from '../api';
import { StatusBadge } from '../components/status';
import { DocTypeBadge, DueChip, EmptyState, ErrorBox, Loading } from '../components/ui';
import { daysUntil, formatDateTime } from '../format';
import { useAction, useAsync, useUsers } from '../state';
import { TaskResponseForm } from './document/TaskResponseForm';

type View = 'open' | 'done';

function groupOpen(tasks: TaskWithContext[]) {
  const groups: Array<{ id: string; title: string; tasks: TaskWithContext[] }> = [
    { id: 'overdue', title: 'Überfällig', tasks: [] },
    { id: 'week', title: 'Fällig in den nächsten 7 Tagen', tasks: [] },
    { id: 'later', title: 'Später', tasks: [] },
    { id: 'none', title: 'Ohne Termin', tasks: [] },
  ];
  for (const t of tasks) {
    if (!t.dueDate) groups[3].tasks.push(t);
    else {
      const days = daysUntil(t.dueDate);
      if (days < 0) groups[0].tasks.push(t);
      else if (days <= 7) groups[1].tasks.push(t);
      else groups[2].tasks.push(t);
    }
  }
  return groups.filter((g) => g.tasks.length > 0);
}

export function MyTasksPage() {
  const { currentUser, people, setCurrentUserId } = useUsers();
  const [view, setView] = useState<View>('open');
  const { data, error, loading, reload } = useAsync(
    () => (currentUser ? api.tasks.list({ assigneeId: currentUser.id, state: view }) : Promise.resolve([])),
    [currentUser?.id, view],
  );
  const location = useLocation();
  const run = useAction();

  useEffect(() => {
    if (!data || !location.hash) return;
    document.querySelector(location.hash)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [data, location.hash]);

  const groups = useMemo(() => (data && view === 'open' ? groupOpen(data) : []), [data, view]);

  if (!currentUser) {
    return (
      <div className="page">
        <header className="page-header">
          <h1>Meine Aufgaben</h1>
        </header>
        <div className="card">
          <EmptyState
            icon={<ListTodo size={36} />}
            title="Wer bist du?"
            text="Wähle deine Person aus, um die dir zugewiesenen Anforderungen zu sehen, zu kommentieren und zu bewerten."
            action={
              people.length === 0 ? (
                <Link className="btn btn-primary" to="/people">
                  Personen anlegen
                </Link>
              ) : (
                <div className="person-pick">
                  {people.map((p) => (
                    <button key={p.id} className="btn" onClick={() => setCurrentUserId(p.id)}>
                      {p.name}
                    </button>
                  ))}
                </div>
              )
            }
          />
        </div>
      </div>
    );
  }

  const reopen = async (t: TaskWithContext) => {
    const ok = await run(() => api.tasks.update(t.id, { state: 'open' }), 'Aufgabe wieder geöffnet');
    if (ok) void reload();
  };

  const renderTask = (t: TaskWithContext) => (
    <article key={t.id} id={`task-${t.id}`} className="card task-card">
      <div className="task-card-head">
        <div className="task-context">
          <DocTypeBadge type={t.docType} />
          <Link to={`/projects/${t.projectId}`}>{t.projectName}</Link>
          <span className="muted">›</span>
          <Link to={`/documents/${t.documentId}?req=${t.requirementId}`}>
            {t.documentTitle} <ExternalLink size={12} />
          </Link>
        </div>
        <DueChip date={t.dueDate} done={t.state === 'done'} />
      </div>
      <p className="task-req">
        {t.requirementRef && <span className="ref">{t.requirementRef}</span>}
        {t.requirementText}
      </p>
      {t.instruction && (
        <p className="task-instruction">
          „{t.instruction}“{t.assignedByName ? ` – ${t.assignedByName}` : ''}
        </p>
      )}
      {t.state === 'open' ? (
        <TaskResponseForm task={t} onSaved={reload} />
      ) : (
        <div className="task-done">
          <div className="row gap-sm wrap">
            {t.rating && <StatusBadge status={t.rating} />}
            <span className="muted small">
              <CircleCheck size={12} /> abgegeben {formatDateTime(t.completedAt)}
            </span>
            <button className="btn btn-sm btn-ghost push-right" onClick={() => reopen(t)}>
              <RotateCcw size={14} /> Wieder öffnen
            </button>
          </div>
          {t.response && <p>{t.response}</p>}
        </div>
      )}
    </article>
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Meine Aufgaben</h1>
          <p className="page-sub">Dir zugewiesene Anforderungen: bis zum Termin kommentieren und als Accepted, Accepted with comments oder Declined bewerten.</p>
        </div>
        <div className="segmented">
          <button className={view === 'open' ? 'active' : ''} onClick={() => setView('open')}>
            Offen
          </button>
          <button className={view === 'done' ? 'active' : ''} onClick={() => setView('done')}>
            Erledigt
          </button>
        </div>
      </header>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && loading && <Loading />}
      {data && data.length === 0 && (
        <div className="card">
          <EmptyState
            icon={<CircleCheck size={36} />}
            title={view === 'open' ? 'Keine offenen Aufgaben' : 'Noch nichts erledigt'}
            text={view === 'open' ? 'Sobald dir Anforderungen zugewiesen werden, erscheinen sie hier.' : undefined}
          />
        </div>
      )}
      {data && view === 'open' &&
        groups.map((g) => (
          <section key={g.id} className={`task-group task-group-${g.id}`}>
            <h2>
              {g.title} <span className="count">{g.tasks.length}</span>
            </h2>
            <div className="stack-sm">{g.tasks.map(renderTask)}</div>
          </section>
        ))}
      {data && view === 'done' && <div className="stack-sm">{data.map(renderTask)}</div>}
    </div>
  );
}
