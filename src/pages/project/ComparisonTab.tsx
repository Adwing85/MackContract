import { Ban, Trophy } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { computeScores, requirementScore } from '../../../shared/scoring';
import { DOC_TYPE_LABELS, STATUS_META, type ProjectDetail, type ReqStatus } from '../../../shared/types';
import { MAX_SERIES, seriesVar, TooltipRow, useChartTooltip } from '../../components/charts';
import { StatusBar } from '../../components/status';
import { DocTypeBadge, EmptyState } from '../../components/ui';
import { formatDate, formatMoney, formatNumber, formatPercent } from '../../format';

export function ComparisonTab({ project }: { project: ProjectDetail }) {
  const docs = project.documents;
  const results = useMemo(() => computeScores(project.criteria, docs, project.scores), [project.criteria, docs, project.scores]);
  const byDoc = new Map(results.map((r) => [r.documentId, r]));

  if (docs.length === 0) {
    return (
      <div className="card">
        <EmptyState title="Noch nichts zu vergleichen" text="Füge mindestens ein Dokument hinzu und bewerte es anhand der Kriterien." />
      </div>
    );
  }

  return (
    <section className="stack">
      <RankingChart project={project} results={results} />
      <CriteriaChart project={project} perCriterion={(docId, cId) => byDoc.get(docId)?.perCriterion[cId] ?? null} />
      <RequirementsCard project={project} />
      <FactsTable project={project} results={results} />
    </section>
  );
}

type Results = ReturnType<typeof computeScores>;

function RankingChart({ project, results }: { project: ProjectDetail; results: Results }) {
  const { containerRef, bind, tooltip } = useChartTooltip();
  const sorted = [...results].sort((a, b) => {
    if (a.rank === null) return 1;
    if (b.rank === null) return -1;
    return a.rank - b.rank;
  });

  return (
    <div className="card chart-card">
      <div className="card-header">
        <h2>Gesamtbewertung (gewichtet)</h2>
        <Link className="link-sm" to={`/projects/${project.id}?tab=scoring`}>
          Bewertung bearbeiten
        </Link>
      </div>
      <div className="bar-chart" ref={containerRef}>
        <div className="bar-axis">
          {[0, 25, 50, 75, 100].map((t) => (
            <span key={t} style={{ left: `${t}%` }}>
              {t} %
            </span>
          ))}
        </div>
        {sorted.map((r) => {
          const doc = project.documents.find((d) => d.id === r.documentId)!;
          const pct = r.percent ?? 0;
          return (
            <div key={r.documentId} className="bar-row">
              <div className="bar-label">
                <span className="bar-rank">{r.rank ?? '–'}</span>
                <span className="bar-label-text">
                  <strong>{doc.title}</strong>
                  <small>{doc.counterparty || DOC_TYPE_LABELS[doc.docType]}</small>
                </span>
              </div>
              <div className="bar-track">
                {[25, 50, 75].map((t) => (
                  <span key={t} className="bar-grid" style={{ left: `${t}%` }} />
                ))}
                {r.percent !== null && (
                  <div
                    className={`bar ${r.knockedOut ? 'bar-muted' : ''}`}
                    style={{ width: `${Math.max(pct, 0.5)}%` }}
                    aria-label={`${doc.title}: ${formatPercent(pct)}`}
                    {...bind(
                      <>
                        <TooltipRow value={formatPercent(pct, 1)} label={doc.title} />
                        <div className="tt-sub">
                          {formatNumber(r.total, 2)} von 10 Punkten · {r.ratedCount}/{r.activeCount} Kriterien bewertet
                        </div>
                        {r.knockedOut && <div className="tt-sub">Ausschluss: {r.knockoutReasons.join('; ')}</div>}
                      </>,
                    )}
                  />
                )}
                <span className="bar-value" style={{ left: `${Math.min(pct, 100)}%` }}>
                  {r.percent === null ? 'nicht bewertet' : formatPercent(pct)}
                  {r.rank === 1 && !r.knockedOut && (
                    <span className="chip chip-good">
                      <Trophy size={12} /> Favorit
                    </span>
                  )}
                  {r.knockedOut && (
                    <span className="chip chip-bad">
                      <Ban size={12} /> Ausschluss
                    </span>
                  )}
                  {r.percent !== null && r.coverage < 0.999 && <span className="muted small">vorläufig · {formatPercent(r.coverage * 100)} bewertet</span>}
                </span>
              </div>
            </div>
          );
        })}
        {tooltip}
      </div>
    </div>
  );
}

function CriteriaChart({ project, perCriterion }: { project: ProjectDetail; perCriterion: (docId: number, cId: number) => number | null }) {
  const { containerRef, bind, tooltip } = useChartTooltip();
  const criteria = project.criteria.filter((c) => c.weight > 0);
  // Farbe bleibt an die Position des Dokuments gebunden; unbewertete Dokumente werden ausgeblendet.
  const rated = project.documents
    .map((d, index) => ({ d, index }))
    .filter(({ d }) => criteria.some((c) => perCriterion(d.id, c.id) !== null));
  const docs = rated.slice(0, MAX_SERIES);
  const hidden = project.documents.length - docs.length;
  if (criteria.length === 0 || docs.length === 0) return null;

  return (
    <div className="card chart-card">
      <div className="card-header">
        <h2>Kriterien im Vergleich</h2>
        <span className="muted small">Punkte 0–10 je Kriterium</span>
      </div>
      <div className="legend" aria-label="Legende">
        {docs.map(({ d, index }) => (
          <span key={d.id} className="legend-item">
            <span className="legend-swatch" style={{ background: seriesVar(index) }} />
            {d.title}
          </span>
        ))}
      </div>
      {hidden > 0 && (
        <p className="muted small">
          {hidden} {hidden === 1 ? 'Dokument ist' : 'Dokumente sind'} noch nicht bewertet oder nicht dargestellt; alle Werte stehen in der Bewertungstabelle.
        </p>
      )}
      <div className="group-chart" ref={containerRef}>
        {criteria.map((c) => {
          const values = docs.map(({ d }) => perCriterion(d.id, c.id));
          const max = Math.max(...values.map((v) => v ?? -1));
          return (
            <div key={c.id} className="group-row">
              <div className="group-label">
                <strong>{c.name}</strong>
                <small>Gewicht {c.weight}</small>
              </div>
              <div className="group-bars">
                {docs.map(({ d, index }, i) => {
                  const v = values[i];
                  return (
                    <div key={d.id} className="group-bar-row">
                      <div className="bar-track thin">
                        {v !== null && (
                          <div
                            className="bar"
                            style={{ width: `${Math.max((v / 10) * 100, 0.8)}%`, background: seriesVar(index) }}
                            {...bind(
                              <>
                                <TooltipRow color={seriesVar(index)} value={`${formatNumber(v, 1)} / 10`} label={d.title} />
                                <div className="tt-sub">{c.name}</div>
                              </>,
                            )}
                          />
                        )}
                        {v === null ? (
                          <span className="bar-value muted small" style={{ left: 0 }}>
                            –
                          </span>
                        ) : (
                          v === max && (
                            <span className="bar-value small" style={{ left: `${(v / 10) * 100}%` }}>
                              {formatNumber(v, 1)}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {tooltip}
      </div>
    </div>
  );
}

function RequirementsCard({ project }: { project: ProjectDetail }) {
  const statuses: ReqStatus[] = ['accepted', 'accepted_with_comments', 'declined', 'open'];
  return (
    <div className="card">
      <div className="card-header">
        <h2>Anforderungsprüfung je Dokument</h2>
      </div>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Dokument</th>
              <th style={{ width: '32%' }}>Verteilung</th>
              {statuses.map((s) => (
                <th key={s} className="num">
                  {STATUS_META[s].short}
                </th>
              ))}
              <th className="num" title="Accepted = 100 %, with comments = 50 %, Declined = 0 %">
                Erfüllungsgrad
              </th>
            </tr>
          </thead>
          <tbody>
            {project.documents.map((d) => {
              const score = requirementScore(d.stats);
              return (
                <tr key={d.id}>
                  <td>
                    <Link to={`/documents/${d.id}`}>{d.title}</Link>
                  </td>
                  <td>
                    <StatusBar stats={d.stats} height={10} />
                  </td>
                  {statuses.map((s) => (
                    <td key={s} className="num">
                      {d.stats[s]}
                    </td>
                  ))}
                  <td className="num">
                    <strong>{score === null ? '–' : formatPercent(score * 10)}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="status-legend pad-x">
        {statuses.map((s) => (
          <span key={s} className="status-legend-item">
            <span className={`legend-swatch status-seg-${s}`} /> {STATUS_META[s].label} ({STATUS_META[s].hint})
          </span>
        ))}
      </div>
    </div>
  );
}

function FactsTable({ project, results }: { project: ProjectDetail; results: Results }) {
  const docs = project.documents;
  const byDoc = new Map(results.map((r) => [r.documentId, r]));
  const amounts = docs.map((d) => d.amount).filter((a): a is number => a !== null);
  const minAmount = amounts.length > 1 ? Math.min(...amounts) : null;

  const rows: Array<{ label: string; render: (d: (typeof docs)[number]) => React.ReactNode }> = [
    { label: 'Typ', render: (d) => <DocTypeBadge type={d.docType} /> },
    { label: 'Vertragspartner', render: (d) => d.counterparty || '–' },
    { label: 'Referenz', render: (d) => d.reference || '–' },
    { label: 'Datum', render: (d) => formatDate(d.docDate) },
    {
      label: 'Betrag (netto)',
      render: (d) => (
        <span className="num">
          {formatMoney(d.amount, d.currency)}
          {minAmount !== null && d.amount === minAmount && <span className="chip chip-good">günstigster</span>}
        </span>
      ),
    },
    { label: 'Anforderungen', render: (d) => d.stats.total },
    { label: 'Davon Declined', render: (d) => (d.stats.declined ? <strong className="text-bad">{d.stats.declined}</strong> : 0) },
    { label: 'Gesamtbewertung', render: (d) => formatPercent(byDoc.get(d.id)?.percent ?? null) },
    { label: 'Rang', render: (d) => (byDoc.get(d.id)?.knockedOut ? 'Ausschluss' : (byDoc.get(d.id)?.rank ?? '–')) },
  ];

  return (
    <div className="card">
      <div className="card-header">
        <h2>Eckdaten</h2>
      </div>
      <div className="table-scroll">
        <table className="table facts">
          <thead>
            <tr>
              <th />
              {docs.map((d, i) => (
                <th key={d.id}>
                  <span className="legend-swatch" style={{ background: seriesVar(i) }} /> {d.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                {docs.map((d) => (
                  <td key={d.id}>{row.render(d)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
