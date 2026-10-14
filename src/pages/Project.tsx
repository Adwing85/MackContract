import { ArrowLeft, ChartBar, FileText, GitCompareArrows, Pencil, Scale, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { ErrorBox, Field, Loading, Modal, Tabs } from '../components/ui';
import { useAction, useAsync } from '../state';
import { ComparisonTab } from './project/ComparisonTab';
import { DiffTab } from './project/DiffTab';
import { DocumentsTab } from './project/DocumentsTab';
import { ScoringTab } from './project/ScoringTab';

export function ProjectPage() {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'documents';
  const { data: project, setData, error, loading, reload } = useAsync(() => api.projects.get(id), [id]);
  const [editing, setEditing] = useState(false);
  const run = useAction();
  const navigate = useNavigate();

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

      <Tabs
        active={tab}
        onChange={(t) => setParams(t === 'documents' ? {} : { tab: t }, { replace: true })}
        tabs={[
          { id: 'documents', label: 'Dokumente', icon: <FileText size={16} />, count: project.documents.length },
          { id: 'scoring', label: 'Kriterien & Bewertung', icon: <Scale size={16} />, count: project.criteria.length },
          { id: 'comparison', label: 'Gegenüberstellung', icon: <ChartBar size={16} /> },
          { id: 'diff', label: 'Textvergleich', icon: <GitCompareArrows size={16} /> },
        ]}
      />

      {tab === 'documents' && <DocumentsTab project={project} reload={reload} />}
      {tab === 'scoring' && <ScoringTab project={project} setProject={setData} reload={reload} />}
      {tab === 'comparison' && <ComparisonTab project={project} />}
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
