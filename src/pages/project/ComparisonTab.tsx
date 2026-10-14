import { Ban, Medal, Printer, Save, ThumbsDown, ThumbsUp, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { requirementScore } from '../../../shared/scoring';
import { DOC_TYPE_LABELS, STATUS_META, type DocumentMeta, type ProjectDetail, type ReqStatus } from '../../../shared/types';
import { MAX_SERIES, seriesVar, TooltipRow, useChartTooltip } from '../../components/charts';
import { MackWordmark } from '../../components/Logo';
import { ScopeToggle } from '../../components/ScopeToggle';
import { StatusBar } from '../../components/status';
import { EmptyState } from '../../components/ui';
import { analyzeProject, contributions, strengthsAndWeaknesses, useScope, type Analysis } from '../../comparison';
import { api } from '../../api';
import { formatDate, formatMoney, formatNumber, formatPercent } from '../../format';
import { useAction, useUsers } from '../../state';

type SetProject = (updater: (p: ProjectDetail) => ProjectDetail) => void;

export function ComparisonTab({ project, setProject }: { project: ProjectDetail; setProject: SetProject }) {
  const [includeAll, setIncludeAll] = useScope();
  const analysis = useMemo(() => analyzeProject(project, includeAll), [project, includeAll]);

  if (analysis.docs.length === 0) {
    return (
      <div className="card">
        <EmptyState title="Noch nichts zu vergleichen" text="Füge Angebote hinzu und bewerte sie anhand der Kriterien." />
      </div>
    );
  }

  return (
    <section className="stack">
      <div className="toolbar wrap no-print">
        <p className="muted">Ergebnis der gewichteten Bewertung (Nutzwertanalyse) mit Vergabeempfehlung.</p>
        <div className="toolbar-spacer" />
        {analysis.canToggleScope && <ScopeToggle includeAll={includeAll} onChange={setIncludeAll} />}
        <button className="btn" onClick={() => window.print()}>
          <Printer size={16} /> Vergabevorschlag drucken
        </button>
      </div>

      <PrintHeader project={project} />
      <Podium project={project} analysis={analysis} />
      <Recommendation project={project} analysis={analysis} setProject={setProject} />
      <ContributionChart project={project} analysis={analysis} />
      <CriteriaChart project={project} analysis={analysis} />
      <RequirementsCard analysis={analysis} />
    </section>
  );
}

function PrintHeader({ project }: { project: ProjectDetail }) {
  return (
    <div className="print-only print-header">
      <MackWordmark className="print-wordmark" />
      <div>
        <h1>Vergabevorschlag: {project.name}</h1>
        <p>Stand {formatDate(new Date().toISOString())}</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Siegerpodest

function Podium({ project, analysis }: { project: ProjectDetail; analysis: Analysis }) {
  const ranked = analysis.results
    .filter((r) => r.rank !== null && !r.knockedOut)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .slice(0, 3);
  const excluded = analysis.results.filter((r) => r.knockedOut);
  const unrated = analysis.results.filter((r) => r.rank === null);
  const order = [ranked[1], ranked[0], ranked[2]].filter(Boolean);
  const docOf = (id: number) => project.documents.find((d) => d.id === id)!;

  if (ranked.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<Trophy size={36} />}
          title="Noch kein Ergebnis"
          text={
            <>
              Erfasse Konditionen im <Link to={`/projects/${project.id}?tab=offers`}>Angebotsvergleich</Link> und bewerte die Kriterien unter{' '}
              <Link to={`/projects/${project.id}?tab=scoring`}>Bewertung</Link>.
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="card podium-card">
      <div className="podium">
        {order.map((r) => {
          const doc = docOf(r.documentId);
          const { strengths, weaknesses } = strengthsAndWeaknesses(project.criteria, analysis, doc.id);
          return (
            <div key={r.documentId} className={`podium-place place-${r.rank}`}>
              <div className="podium-info">
                <span className="podium-medal" aria-label={`Platz ${r.rank}`}>
                  {r.rank === 1 ? <Trophy size={22} /> : <Medal size={20} />}
                </span>
                <Link to={`/documents/${doc.id}`} className="podium-title">
                  {doc.title}
                </Link>
                <span className="podium-sub">{doc.counterparty || DOC_TYPE_LABELS[doc.docType]}</span>
                <span className="podium-score">{formatPercent(r.percent)}</span>
                <span className="podium-meta">
                  {formatMoney(analysis.prices.get(doc.id) ?? null, doc.currency)}
                  {r.coverage < 0.999 && ` · vorläufig (${formatPercent(r.coverage * 100)} bewertet)`}
                </span>
                {(strengths.length > 0 || weaknesses.length > 0) && (
                  <div className="podium-sw">
                    {strengths.map((c) => (
                      <span key={c.id} className="sw sw-plus" title="Bester Wert aller Angebote">
                        <ThumbsUp size={12} /> {c.name}
                      </span>
                    ))}
                    {weaknesses.map((c) => (
                      <span key={c.id} className="sw sw-minus" title="Schwächster Wert aller Angebote">
                        <ThumbsDown size={12} /> {c.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="podium-step">
                <span>{r.rank}</span>
              </div>
            </div>
          );
        })}
      </div>
      {(excluded.length > 0 || unrated.length > 0) && (
        <div className="podium-foot">
          {excluded.map((r) => (
            <span key={r.documentId} className="chip chip-bad" title={r.knockoutReasons.join('\n')}>
              <Ban size={12} /> {docOf(r.documentId).title}: ausgeschlossen ({r.knockoutReasons.join('; ')})
            </span>
          ))}
          {unrated.map((r) => (
            <span key={r.documentId} className="chip">
              {docOf(r.documentId).title}: noch nicht bewertet
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Empfehlung

function Recommendation({ project, analysis, setProject }: { project: ProjectDetail; analysis: Analysis; setProject: SetProject }) {
  const run = useAction();
  const { currentUser } = useUsers();
  const leader = analysis.results.find((r) => r.rank === 1 && !r.knockedOut);
  const [docId, setDocId] = useState<number | ''>(project.recommendedDocumentId ?? leader?.documentId ?? '');
  const [text, setText] = useState(project.recommendation);
  useEffect(() => {
    setDocId(project.recommendedDocumentId ?? leader?.documentId ?? '');
    setText(project.recommendation);
  }, [project.recommendedDocumentId, project.recommendation]); // eslint-disable-line react-hooks/exhaustive-deps

  const saved = project.recommendedDocumentId !== null;
  const dirty = docId !== (project.recommendedDocumentId ?? '') || text !== project.recommendation;
  const chosen = analysis.docs.find((d) => d.id === docId) ?? project.documents.find((d) => d.id === docId);
  const chosenResult = chosen ? analysis.byDoc.get(chosen.id) : undefined;

  const suggestion = () => {
    if (!chosen || !chosenResult) return '';
    const { strengths } = strengthsAndWeaknesses(project.criteria, analysis, chosen.id);
    const parts = [
      `Empfohlen wird das Angebot „${chosen.title}“${chosen.counterparty ? ` von ${chosen.counterparty}` : ''}`,
      `mit ${formatPercent(chosenResult.percent)} der erreichbaren Punkte (Rang ${chosenResult.rank ?? '–'})`,
    ];
    let s = `${parts.join(' ')}.`;
    if (strengths.length) s += ` Stärken: ${strengths.map((c) => c.name).join(', ')}.`;
    const price = analysis.prices.get(chosen.id);
    if (price) s += ` Vergleichspreis: ${formatMoney(price, chosen.currency)} netto.`;
    if (chosen.stats.declined) s += ` Offene Punkte: ${chosen.stats.declined} Anforderungen mit „Declined“ sind vor Vergabe zu klären.`;
    return s;
  };

  const save = async () => {
    const updated = await run(
      () => api.projects.update(project.id, { recommendedDocumentId: docId === '' ? null : docId, recommendation: text }),
      'Empfehlung gespeichert',
    );
    if (updated) setProject((p) => ({ ...p, recommendation: updated.recommendation, recommendedDocumentId: updated.recommendedDocumentId }));
  };

  return (
    <div className="card recommendation">
      <div className="card-header">
        <h2>
          <Trophy size={18} /> Vergabeempfehlung
        </h2>
        {saved ? <span className="chip chip-good">gespeichert</span> : <span className="chip">Entwurf</span>}
      </div>
      <div className="recommendation-body">
        <label className="field">
          <span className="field-label">Empfohlenes Angebot</span>
          <select className="select" value={docId} onChange={(e) => setDocId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">– keine Empfehlung –</option>
            {analysis.docs.map((d) => {
              const r = analysis.byDoc.get(d.id);
              return (
                <option key={d.id} value={d.id}>
                  {d.title}
                  {r?.rank ? ` – Rang ${r.rank}, ${formatPercent(r.percent)}` : ''}
                  {r?.knockedOut ? ' (ausgeschlossen)' : ''}
                </option>
              );
            })}
          </select>
        </label>
        {chosen && leader && chosen.id !== leader.documentId && (
          <p className="hint-box">
            <span>
              Abweichung vom Bewertungsergebnis: Rang 1 ist „{project.documents.find((d) => d.id === leader.documentId)?.title}“. Bitte die Begründung
              dokumentieren.
            </span>
          </p>
        )}
        <label className="field">
          <span className="field-label">Begründung</span>
          <textarea className="textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Warum fällt die Wahl auf dieses Angebot?" />
        </label>
        <div className="row gap-sm wrap no-print">
          <button className="btn btn-sm" onClick={() => setText(suggestion())} disabled={!chosen}>
            Begründung vorschlagen
          </button>
          <div className="toolbar-spacer" />
          <button className="btn btn-primary" onClick={save} disabled={!dirty}>
            <Save size={16} /> Empfehlung speichern
          </button>
        </div>
        {currentUser && <p className="muted small print-only">Erstellt von {currentUser.name}</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Punkteverteilung

function ContributionChart({ project, analysis }: { project: ProjectDetail; analysis: Analysis }) {
  const { containerRef, bind, tooltip } = useChartTooltip();
  const criteria = project.criteria.filter((c) => c.weight > 0);
  const shown = criteria.slice(0, MAX_SERIES - 1);
  const rest = criteria.slice(MAX_SERIES - 1);
  const rows = [...analysis.results]
    .filter((r) => r.total !== null)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .map((r) => {
      const parts = contributions(project.criteria, r);
      const segments = shown
        .map((c, i) => ({ key: String(c.id), label: c.name, color: seriesVar(i), points: parts.find((p) => p.criterion.id === c.id)?.points ?? 0 }))
        .filter((s) => s.points > 0);
      const restPoints = parts.filter((p) => rest.some((c) => c.id === p.criterion.id)).reduce((s, p) => s + p.points, 0);
      if (restPoints > 0) segments.push({ key: 'rest', label: 'Weitere Kriterien', color: 'var(--open)', points: restPoints });
      return { r, doc: project.documents.find((d) => d.id === r.documentId)!, segments };
    });
  if (rows.length === 0) return null;

  return (
    <div className="card chart-card">
      <div className="card-header">
        <h2>Woraus sich die Punktzahl zusammensetzt</h2>
        <span className="muted small">gewichtete Punkte je Kriterium, Summe = Gesamtwert (100 % = 10 Punkte)</span>
      </div>
      <div className="legend">
        {shown.map((c, i) => (
          <span key={c.id} className="legend-item">
            <span className="legend-swatch" style={{ background: seriesVar(i) }} />
            {c.name}
          </span>
        ))}
        {rest.length > 0 && (
          <span className="legend-item">
            <span className="legend-swatch" style={{ background: 'var(--open)' }} />
            Weitere Kriterien
          </span>
        )}
      </div>
      <div className="bar-chart" ref={containerRef}>
        {rows.map(({ r, doc, segments }) => (
          <div key={r.documentId} className="bar-row">
            <div className="bar-label">
              <span className="bar-rank">{r.knockedOut ? '–' : r.rank}</span>
              <span className="bar-label-text">
                <strong>{doc.title}</strong>
                <small>{doc.counterparty || DOC_TYPE_LABELS[doc.docType]}</small>
              </span>
            </div>
            <div className="bar-track">
              <div className="stack-bar" style={{ width: `${((r.total ?? 0) / 10) * 100}%` }}>
                {segments.map((s) => (
                  <span
                    key={s.key}
                    className="stack-seg"
                    style={{ flexGrow: s.points, background: s.color }}
                    {...bind(
                      <>
                        <TooltipRow color={s.color} value={`${formatNumber(s.points * 10, 1)} %`} label={s.label} />
                        <div className="tt-sub">{doc.title}</div>
                      </>,
                    )}
                  />
                ))}
              </div>
              <span className="bar-value" style={{ left: `${((r.total ?? 0) / 10) * 100}%` }}>
                {formatPercent(r.percent)}
              </span>
            </div>
          </div>
        ))}
        {tooltip}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Kriterienvergleich

function CriteriaChart({ project, analysis }: { project: ProjectDetail; analysis: Analysis }) {
  const { containerRef, bind, tooltip } = useChartTooltip();
  const criteria = project.criteria.filter((c) => c.weight > 0);
  const docs = analysis.docs
    .filter((d) => criteria.some((c) => (analysis.byDoc.get(d.id)?.perCriterion[c.id] ?? null) !== null))
    .slice(0, MAX_SERIES);
  if (criteria.length === 0 || docs.length === 0) return null;
  const color = (d: DocumentMeta) => seriesVar(analysis.colorIndex.get(d.id) ?? 0);

  return (
    <div className="card chart-card">
      <div className="card-header">
        <h2>Kriterien im Vergleich</h2>
        <span className="muted small">Punkte 0–10 je Kriterium</span>
      </div>
      <div className="legend">
        {docs.map((d) => (
          <span key={d.id} className="legend-item">
            <span className="legend-swatch" style={{ background: color(d) }} />
            {d.title}
          </span>
        ))}
      </div>
      <div className="group-chart" ref={containerRef}>
        {criteria.map((c) => {
          const values = docs.map((d) => analysis.byDoc.get(d.id)?.perCriterion[c.id] ?? null);
          const max = Math.max(...values.map((v) => v ?? -1));
          return (
            <div key={c.id} className="group-row">
              <div className="group-label">
                <strong>{c.name}</strong>
                <small>Gewicht {c.weight}</small>
              </div>
              <div className="group-bars">
                {docs.map((d, i) => {
                  const v = values[i];
                  return (
                    <div key={d.id} className="group-bar-row">
                      <div className="bar-track thin">
                        {v !== null && (
                          <div
                            className="bar"
                            style={{ width: `${Math.max((v / 10) * 100, 0.8)}%`, background: color(d) }}
                            {...bind(
                              <>
                                <TooltipRow color={color(d)} value={`${formatNumber(v, 1)} / 10`} label={d.title} />
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

function RequirementsCard({ analysis }: { analysis: Analysis }) {
  const statuses: ReqStatus[] = ['accepted', 'accepted_with_comments', 'declined', 'open'];
  return (
    <div className="card">
      <div className="card-header">
        <h2>Anforderungsprüfung je Angebot</h2>
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
            {analysis.docs.map((d) => {
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
