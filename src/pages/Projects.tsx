import { FolderKanban, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { StatusBar } from '../components/status';
import { EmptyState, ErrorBox, Field, Loading, Modal } from '../components/ui';
import { formatDateTime } from '../format';
import { useAction, useAsync } from '../state';

export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [defaultCriteria, setDefaultCriteria] = useState(true);
  const [busy, setBusy] = useState(false);
  const run = useAction();
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const project = await run(() => api.projects.create({ name, description, defaultCriteria }), 'Projekt angelegt');
    setBusy(false);
    if (project) {
      setName('');
      setDescription('');
      onClose();
      navigate(`/projects/${project.id}`);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Neues Projekt"
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" form="new-project" type="submit" disabled={!name.trim() || busy}>
            Anlegen
          </button>
        </>
      }
    >
      <form id="new-project" className="form" onSubmit={submit}>
        <Field label="Projektname">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Ausschreibung Fräszentrum 2026" required />
        </Field>
        <Field label="Beschreibung" hint="Optional – Ziel, Kunde, Ansprechpartner …">
          <textarea className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={defaultCriteria} onChange={(e) => setDefaultCriteria(e.target.checked)} />
          Standard-Bewertungskriterien anlegen (Preis, Termine, Gewährleistung, Haftung …)
        </label>
      </form>
    </Modal>
  );
}

export function ProjectsPage() {
  const { data, error, loading, reload } = useAsync(() => api.projects.list(), []);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
  }, [data, query]);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Projekte</h1>
          <p className="page-sub">Ein Projekt bündelt alle Dokumente, die gemeinsam geprüft und gegenübergestellt werden.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> Neues Projekt
          </button>
        </div>
      </header>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && loading && <Loading />}
      {data && data.length === 0 && (
        <div className="card">
          <EmptyState
            icon={<FolderKanban size={36} />}
            title="Noch keine Projekte"
            action={
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={16} /> Projekt anlegen
              </button>
            }
          />
        </div>
      )}
      {data && data.length > 0 && (
        <>
          <div className="toolbar">
            <div className="search">
              <Search size={16} aria-hidden />
              <input className="input" placeholder="Projekte durchsuchen" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          <div className="card-grid">
            {filtered.map((p) => {
              const rated = p.stats.total - p.stats.open;
              return (
                <button key={p.id} className="card project-card" onClick={() => navigate(`/projects/${p.id}`)}>
                  <h3>{p.name}</h3>
                  {p.description && <p className="muted clamp-2">{p.description}</p>}
                  <div className="project-card-stats">
                    <span>
                      <strong>{p.documentCount}</strong> Dokumente
                    </span>
                    <span>
                      <strong>{p.stats.total}</strong> Anforderungen
                    </span>
                    <span>
                      <strong>{p.openTaskCount}</strong> offene Aufgaben
                    </span>
                  </div>
                  <StatusBar stats={p.stats} />
                  <div className="project-card-foot muted">
                    <span>{p.stats.total ? `${rated} von ${p.stats.total} bewertet` : 'Noch keine Anforderungen'}</span>
                    <span>{formatDateTime(p.updatedAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
