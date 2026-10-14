import { FileText, Paperclip, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectDetail } from '../../../shared/types';
import { StatusBar } from '../../components/status';
import { DocTypeBadge, EmptyState } from '../../components/ui';
import { formatDate, formatMoney } from '../../format';
import { AddDocumentDialog } from './AddDocumentDialog';

export function DocumentsTab({ project }: { project: ProjectDetail; reload: () => void }) {
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();

  return (
    <section>
      <div className="toolbar">
        <p className="muted">Verträge, Angebote und Auftragsbestätigungen dieses Projekts. Öffne ein Dokument, um Anforderungen zu prüfen.</p>
        <div className="toolbar-spacer" />
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Plus size={16} /> Dokument hinzufügen
        </button>
      </div>

      {project.documents.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FileText size={36} />}
            title="Noch keine Dokumente"
            text="Lade ein PDF oder Word-Dokument hoch oder füge den Text direkt ein."
            action={
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                <Plus size={16} /> Dokument hinzufügen
              </button>
            }
          />
        </div>
      ) : (
        <div className="card-grid">
          {project.documents.map((d) => {
            const rated = d.stats.total - d.stats.open;
            return (
              <button key={d.id} className="card doc-card" onClick={() => navigate(`/documents/${d.id}`)}>
                <div className="doc-card-top">
                  <DocTypeBadge type={d.docType} />
                  {d.hasFile && (
                    <span className="muted small" title={d.fileName ?? ''}>
                      <Paperclip size={13} /> Datei
                    </span>
                  )}
                </div>
                <h3>{d.title}</h3>
                <dl className="doc-card-meta">
                  <div>
                    <dt>Partner</dt>
                    <dd>{d.counterparty || '–'}</dd>
                  </div>
                  <div>
                    <dt>Referenz</dt>
                    <dd>{d.reference || '–'}</dd>
                  </div>
                  <div>
                    <dt>Datum</dt>
                    <dd>{formatDate(d.docDate)}</dd>
                  </div>
                  <div>
                    <dt>Betrag</dt>
                    <dd className="num">{formatMoney(d.amount, d.currency)}</dd>
                  </div>
                </dl>
                <StatusBar stats={d.stats} />
                <div className="doc-card-foot muted">
                  {d.stats.total === 0
                    ? 'Noch keine Anforderungen extrahiert'
                    : `${rated} von ${d.stats.total} Anforderungen bewertet${d.stats.declined ? ` · ${d.stats.declined} Declined` : ''}`}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <AddDocumentDialog open={adding} onClose={() => setAdding(false)} projectId={project.id} />
    </section>
  );
}
