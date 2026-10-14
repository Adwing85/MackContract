import { ArrowLeft, FileText, GitCompareArrows, Pencil, Scale, SlidersHorizontal, Trash2, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { ErrorBox, Field, Loading, Modal, Tabs } from '../components/ui';
import { analyzeProject } from '../comparison';
import { formatMoney, formatPercent } from '../format';
import { useAction, useAsync } from '../state';
import { ComparisonTab } from './project/ComparisonTab';
import { DiffTab } from './project/DiffTab';
import { DocumentsTab } from './project/DocumentsTab';
import { OffersTab } from './project/OffersTab';
import { ScoringTab } from './project/ScoringTab';
import type { ProjectDetail } from '../../shared/types';

export function ProjectPage() {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'documents';
  const { data: project, setData, error, loading, reload } = useAsync(() => api.projects.get(id), [id]);
  const [editing, setEditing] = useState(false);
  const run = useAction();
  const navigate = useNavigate();
  const updateProject = (fn: (p: ProjectDetail) => ProjectDetail) => setData((prev) => (prev ? fn(prev) : prev));
  const summary = useMemo(() => (project ? analyzeProject(project, false) : null), [project]);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!project) return loading ? <Loading /> : null;

  const remove = async () => {
    if (!window.confirm(`Projekt „${project.name}“ mit allen Dokumenten, Anforderungen und Aufgaben löschen?`)) return;
    const ok = await run(async () => {
      await api.projects.remove(project.id);
      return true;
    }, 'Projekt gelöscht');
    if (ok) navigate('/projects');
  };

  return (
    <div className="page">
      <Link to="/projects" className="back-link">
        <ArrowLeft size={14} /> Projekte
      </Link>
      <header className="page-header">
        <div>
          <h1>{project.name}</h1>
          {project.description && <p className="page-sub">{project.description}</p>}
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setEditing(true)}>
            <Pencil size={16} /> Bearbeiten
          </button>
          <button className="btn btn-ghost-danger" onClick={remove} title="Projekt löschen">
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      {summary && summary.docs.length >= 2 && <ProjectStrip project={project} />}

      <Tabs
        active={tab}
        onChange={(t) =>
          setParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              if (t === 'documents') next.delete('tab');
              else next.set('tab', t);
              return next;
            },
            { replace: true },
          )
        }
        tabs={[
          { id: 'documents', label: 'Dokumente', icon: <FileText size={16} />, count: project.documents.length },
          { id: 'offers', label: 'Angebotsvergleich', icon: <Scale size={16} /> },
          { id: 'scoring', label: 'Bewertung', icon: <SlidersHorizontal size={16} />, count: project.criteria.length },
          { id: 'comparison', label: 'Ergebnis & Empfehlung', icon: <Trophy size={16} /> },
          { id: 'diff', label: 'Textvergleich', icon: <GitCompareArrows size={16} /> },
        ]}
      />

      {tab === 'documents' && <DocumentsTab project={project} reload={reload} />}
      {tab === 'offers' && <OffersTab project={project} setProject={updateProject} reload={reload} />}
      {tab === 'scoring' && <ScoringTab project={project} setProject={setData} reload={reload} />}
      {tab === 'comparison' && <ComparisonTab project={project} setProject={updateProject} />}
      {tab === 'diff' && <DiffTab project={project} />}

      <EditProjectDialog
        open={editing}
        onClose={() => setEditing(false)}
        initial={{ name: project.name, description: project.description }}
        onSave={async (patch) => {
          const updated = await run(() => api.projects.update(project.id, patch), 'Gespeichert');
          if (updated) {
            setData(updated);
            setEditing(false);
          }
        }}
      />
    </div>
  );
}

function EditProjectDialog({
  open,
  onClose,
  initial,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initial: { name: string; description: string };
  onSave: (patch: { name: string; description: string }) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Projekt bearbeiten"
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={() => onSave({ name, description })}>
            Speichern
          </button>
        </>
      }
    >
      <div className="form">
        <Field label="Projektname">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Beschreibung">
          <textarea className="textarea" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/** Kurzüberblick: Favorit, günstigstes Angebot, Empfehlung. */
function ProjectStrip({ project }: { project: ProjectDetail }) {
  const a = analyzeProject(project, false);
  const leader = a.results.find((r) => r.rank === 1 && !r.knockedOut);
  const leaderDoc = leader ? project.documents.find((d) => d.id === leader.documentId) : undefined;
  const priced = a.docs.filter((d) => (a.prices.get(d.id) ?? null) !== null);
  const cheapest = priced.sort((x, y) => (a.prices.get(x.id) ?? 0) - (a.prices.get(y.id) ?? 0))[0];
  const recommended = project.documents.find((d) => d.id === project.recommendedDocumentId);
  return (
    <div className="project-strip">
      <div className="strip-item">
        <span className="strip-label">Im Vergleich</span>
        <strong>{a.docs.length} Angebote</strong>
      </div>
      <div className="strip-item">
        <span className="strip-label">Favorit</span>
        <strong>{leaderDoc ? `${leaderDoc.title} · ${formatPercent(leader!.percent)}` : '–'}</strong>
      </div>
      <div className="strip-item">
        <span className="strip-label">Günstigstes Angebot</span>
        <strong>{cheapest ? `${cheapest.title} · ${formatMoney(a.prices.get(cheapest.id) ?? null, cheapest.currency)}` : '–'}</strong>
      </div>
      <div className="strip-item">
        <span className="strip-label">Empfehlung</span>
        <strong>{recommended ? recommended.title : 'noch offen'}</strong>
      </div>
    </div>
  );
}
