import { Play, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProjectDetail } from '../../../shared/types';
import { api } from '../../api';
import { DocTypeBadge, EmptyState } from '../../components/ui';
import { formatDateTime, formatNumber } from '../../format';
import { useAction, useAsync, useToast } from '../../state';
import { DeviationRegister } from '../Standards';

const tone = (v: number | null) => (v === null ? '' : v >= 85 ? 'tone-good' : v >= 60 ? 'tone-warn' : 'tone-bad');

/** Prüfstand aller Dokumente eines Projekts gegen den Projekt-Standard und Register der Abweichungen. */
export function StandardsTab({ project, reload }: { project: ProjectDetail; reload: () => void }) {
  const standards = useAsync(() => api.standards.list(), []);
  const [busy, setBusy] = useState<number | 'all' | null>(null);
  const [registerKey, setRegisterKey] = useState(0);
  const run = useAction();
  const toast = useToast();

  const setStandard = async (standardId: number | null) => {
    const updated = await run(() => api.projects.update(project.id, { standardId }), 'Projekt-Standard gespeichert');
    if (updated) reload();
  };

  const check = async (ids: number[], key: number | 'all') => {
    if (!project.standardId) return;
    setBusy(key);
    let ok = 0;
    for (const id of ids) {
      const res = await run(() => api.checks.run(id, project.standardId!));
      if (res) ok++;
    }
    setBusy(null);
    if (ok) toast(ok === 1 ? 'Dokument geprüft' : `${ok} Dokumente geprüft`, 'success');
    reload();
    setRegisterKey((k) => k + 1);
  };

  const docs = project.documents;
  return (
    <div className="stack">
      <div className="card check-head">
        <div className="check-head-main">
          <label className="field-inline">
            <span className="muted small">Projekt-Standard</span>
            <select
              className="select"
              value={project.standardId ?? ''}
              onChange={(e) => setStandard(e.target.value ? Number(e.target.value) : null)}
              aria-label="Projekt-Standard"
            >
              <option value="">– kein Standard –</option>
              {(standards.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <span className="muted small">
            {project.standardId ? (
              <>
                {project.standardRules.filter((r) => r.active).length} aktive Regeln ·{' '}
                <Link to={`/standards/${project.standardId}`}>Standard öffnen</Link>
              </>
            ) : (
              <>
                Alle Dokumente dieses Projekts werden gegen den gewählten Standard geprüft. <Link to="/standards">Standards verwalten</Link>
              </>
            )}
          </span>
        </div>
        {project.standardId && docs.length > 0 && (
          <div className="check-head-actions">
            <button className="btn btn-primary" onClick={() => check(docs.map((d) => d.id), 'all')} disabled={busy !== null}>
              <RefreshCw size={16} className={busy === 'all' ? 'spin' : ''} /> {busy === 'all' ? 'Prüft …' : 'Alle Dokumente prüfen'}
            </button>
          </div>
        )}
      </div>

      {docs.length === 0 ? (
        <div className="card">
          <EmptyState icon={<ShieldCheck size={36} />} title="Noch keine Dokumente" text="Füge Verträge, Angebote oder Auftragsbestätigungen hinzu, um sie gegen euren Standard zu prüfen." />
        </div>
      ) : (
        <div className="card table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Dokument</th>
                <th>Letzte Prüfung</th>
                <th className="num">Konformität</th>
                <th className="num">Offene Abweichungen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const c = d.lastCheck;
                const otherStandard = c && project.standardId && c.standardId !== project.standardId;
                return (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/documents/${d.id}?tab=standards`} className="row-title">
                        {d.title}
                      </Link>
                      <div className="chips">
                        <DocTypeBadge type={d.docType} />
                        {d.counterparty && <span className="muted small">{d.counterparty}</span>}
                      </div>
                    </td>
                    <td className="small">
                      {c ? (
                        <>
                          {formatDateTime(c.checkedAt)}
                          <div className={otherStandard ? 'text-warn' : 'muted'}>{c.standardName}</div>
                        </>
                      ) : (
                        <span className="muted">nicht geprüft</span>
                      )}
                    </td>
                    <td className="num">
                      <strong className={`compliance-cell ${tone(c?.compliance ?? null)}`}>{c?.compliance == null ? '–' : `${formatNumber(c.compliance, 0)} %`}</strong>
                    </td>
                    <td className="num">{c ? <span className={c.openDeviations ? 'text-bad' : ''}>{c.openDeviations}</span> : '–'}</td>
                    <td className="nowrap">
                      {project.standardId && (
                        <button className="btn btn-sm" onClick={() => check([d.id], d.id)} disabled={busy !== null}>
                          {c ? <RefreshCw size={14} className={busy === d.id ? 'spin' : ''} /> : <Play size={14} />}
                          {c ? 'Erneut prüfen' : 'Prüfen'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-head">
        <h2>Abweichungen in diesem Projekt</h2>
      </div>
      <DeviationRegister key={registerKey} projectId={project.id} />
    </div>
  );
}
