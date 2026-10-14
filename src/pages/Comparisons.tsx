import { ArrowRight, Plus, Scale, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ProjectDetail } from '../../shared/types';
import { api } from '../api';
import { seriesVar } from '../components/charts';
import { Hero } from '../components/Hero';
import { EmptyState, ErrorBox, Loading } from '../components/ui';
import { analyzeProject } from '../comparison';
import { formatMoney, formatPercent } from '../format';
import { useAsync } from '../state';
import { NewProjectDialog } from './Projects';

const STEPS = [
  { title: 'Angebote hochladen', text: 'PDF oder Word je Lieferant – Text wird automatisch gelesen.' },
  { title: 'Konditionen & Preise', text: 'Lieferzeit, Zahlung, Gewährleistung und Preisspiegel gegenüberstellen.' },
  { title: 'Bewerten', text: 'Kriterien gewichten – Preis & Co. werden automatisch gepunktet.' },
  { title: 'Empfehlen', text: 'Siegerpodest, Begründung und druckfertiger Vergabevorschlag.' },
];

export function ComparisonCard({ project }: { project: ProjectDetail }) {
  const navigate = useNavigate();
  const a = analyzeProject(project, false);
  const ranked = a.results.filter((r) => r.rank !== null && !r.knockedOut).sort((x, y) => (x.rank ?? 0) - (y.rank ?? 0));
  const docOf = (id: number) => project.documents.find((d) => d.id === id)!;
  const recommended = project.documents.find((d) => d.id === project.recommendedDocumentId);
  const prices = a.docs.map((d) => a.prices.get(d.id)).filter((p): p is number => typeof p === 'number');
  return (
    <button className="card comparison-card" onClick={() => navigate(`/projects/${project.id}?tab=comparison`)}>
      <div className="comparison-card-head">
        <h3>{project.name}</h3>
        {recommended ? (
          <span className="chip chip-good">
            <Trophy size={12} /> Empfehlung steht
          </span>
        ) : (
          <span className="chip">in Bewertung</span>
        )}
      </div>
      <div className="comparison-card-meta muted small">
        {a.docs.length} Angebote
        {prices.length > 1 && ` · ${formatMoney(Math.min(...prices))} – ${formatMoney(Math.max(...prices))}`}
      </div>
      {ranked.length === 0 ? (
        <p className="muted small">Noch keine Bewertung</p>
      ) : (
        <ol className="mini-ranking">
          {ranked.slice(0, 3).map((r) => {
            const doc = docOf(r.documentId);
            return (
              <li key={r.documentId} className={r.rank === 1 ? 'leader' : ''}>
                <span className="mini-rank">{r.rank}</span>
                <span className="mini-name">{doc.counterparty || doc.title}</span>
                <span className="mini-bar">
                  <span style={{ width: `${r.percent ?? 0}%`, background: seriesVar(a.colorIndex.get(doc.id) ?? 0) }} />
                </span>
                <span className="mini-value">{formatPercent(r.percent)}</span>
              </li>
            );
          })}
        </ol>
      )}
      <span className="comparison-card-cta">
        Zum Ergebnis <ArrowRight size={14} />
      </span>
    </button>
  );
}

export function ComparisonsPage() {
  const { data, error, loading, reload } = useAsync(() => api.comparisons.list(), []);
  const [creating, setCreating] = useState(false);

  return (
    <div className="page">
      <Hero
        eyebrow="Angebotsvergleich"
        title="Das beste Angebot gewinnt."
        actions={
          <button className="btn btn-hero" onClick={() => setCreating(true)}>
            <Plus size={16} /> Neuer Vergleich
          </button>
        }
      >
        <p className="hero-text">Preise, Konditionen und Anforderungen mehrerer Lieferanten gegenüberstellen, gewichtet bewerten und die Vergabe begründen.</p>
        <ol className="hero-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="hero-step-no">{i + 1}</span>
              <span>
                <strong>{s.title}</strong>
                <small>{s.text}</small>
              </span>
            </li>
          ))}
        </ol>
      </Hero>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && loading && <Loading />}
      {data && data.length === 0 && (
        <div className="card">
          <EmptyState
            icon={<Scale size={36} />}
            title="Noch kein Angebotsvergleich"
            text={
              <>
                Lege ein Projekt an und lade mindestens zwei Angebote hoch. Bestehende Projekte findest du unter <Link to="/projects">Projekte</Link>.
              </>
            }
            action={
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={16} /> Vergleich anlegen
              </button>
            }
          />
        </div>
      )}
      {data && data.length > 0 && (
        <div className="card-grid">
          {data.map((p) => (
            <ComparisonCard key={p.id} project={p} />
          ))}
        </div>
      )}
      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
