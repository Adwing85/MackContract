import { ClipboardCheck, Download, FileText, ListChecks, Plus, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  DEVIATION_STATUS_LABELS,
  DEVIATION_STATUSES,
  FINDING_LABELS,
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  STANDARD_SCOPE_LABELS,
  STANDARD_SCOPES,
  type Deviation,
  type DeviationStatus,
  type DeviationWithContext,
  type Severity,
  type StandardScope,
} from '../../shared/standards';
import { api } from '../api';
import { DeviationControls, FindingBadge, SeverityChip } from '../components/deviation';
import { Hero } from '../components/Hero';
import { EmptyState, ErrorBox, Field, Loading, Modal, Tabs } from '../components/ui';
import { daysUntil, downloadCsv, formatDate, todayIso } from '../format';
import { useAction, useAsync, useUsers } from '../state';

export function NewStandardDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<StandardScope>('sales');
  const [template, setTemplate] = useState<'sales' | 'purchase' | ''>('sales');
  const [exampleDocument, setExampleDocument] = useState(true);
  const run = useAction();
  const navigate = useNavigate();

  const submit = async () => {
    const created = await run(
      () => api.standards.create({ name, description, scope, template: template || null, exampleDocument: template === 'sales' && exampleDocument }),
      'Standard angelegt',
    );
    if (created) {
      onClose();
      navigate(`/standards/${created.id}`);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Neuer Prüfstandard"
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!name.trim()}>
            Anlegen
          </button>
        </>
      }
    >
      <div className="form">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Verkaufsbedingungen 2026" />
        </Field>
        <Field label="Beschreibung">
          <textarea className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Geltungsbereich">
          <select className="select" value={scope} onChange={(e) => setScope(e.target.value as StandardScope)}>
            {STANDARD_SCOPES.map((s) => (
              <option key={s} value={s}>
                {STANDARD_SCOPE_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Startpunkt" hint="Vorlagen enthalten Beispielwerte, die du anschließend an eure Vorgaben anpasst.">
          <select className="select" value={template} onChange={(e) => setTemplate(e.target.value as 'sales' | 'purchase' | '')}>
            <option value="">Leer beginnen</option>
            <option value="sales">Vorlage Verkauf (Zahlungsziel, Haftung, Vertragsstrafe …)</option>
            <option value="purchase">Vorlage Einkauf (Festpreis, Gewährleistung, Vorbehalte …)</option>
          </select>
        </Field>
        {template === 'sales' && (
          <label className="checkbox">
            <input type="checkbox" checked={exampleDocument} onChange={(e) => setExampleDocument(e.target.checked)} />
            Beispiel-AGB als Referenzdokument anlegen (später durch eure AGB ersetzen)
          </label>
        )}
      </div>
    </Modal>
  );
}

export function StandardsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'standards';
  const standards = useAsync(() => api.standards.list(), []);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const openTotal = (standards.data ?? []).reduce((s, x) => s + x.openDeviations, 0);

  return (
    <div className="page">
      <Hero
        eyebrow="Eigene Standards"
        title="Unser Maßstab für jeden Vertrag."
        actions={
          <button className="btn btn-hero" onClick={() => setCreating(true)}>
            <Plus size={16} /> Neuer Standard
          </button>
        }
      >
        <p className="hero-text">
          Mindestpositionen als Parameter, eigene AGB und Musterangebote als Referenz – jedes Dokument wird dagegen geprüft, jede Abweichung
          nachverfolgt.
        </p>
      </Hero>

      <Tabs
        active={tab}
        onChange={(t) => setParams(t === 'standards' ? {} : { tab: t }, { replace: true })}
        tabs={[
          { id: 'standards', label: 'Prüfstandards', icon: <ShieldCheck size={16} />, count: standards.data?.length },
          { id: 'register', label: 'Abweichungsregister', icon: <ClipboardCheck size={16} />, count: openTotal },
        ]}
      />

      {tab === 'standards' && (
        <>
          {standards.error && <ErrorBox message={standards.error} onRetry={standards.reload} />}
          {!standards.data && standards.loading && <Loading />}
          {standards.data && standards.data.length === 0 && (
            <div className="card">
              <EmptyState
                icon={<ShieldCheck size={36} />}
                title="Noch keine Standards"
                text="Lege einen Prüfstandard an – leer oder aus einer Vorlage für Verkaufs- bzw. Einkaufsverträge."
                action={
                  <button className="btn btn-primary" onClick={() => setCreating(true)}>
                    <Plus size={16} /> Standard anlegen
                  </button>
                }
              />
            </div>
          )}
          {standards.data && standards.data.length > 0 && (
            <div className="card-grid">
              {standards.data.map((s) => (
                <button key={s.id} className="card standard-card" onClick={() => navigate(`/standards/${s.id}`)}>
                  <div className="standard-card-head">
                    <span className="standard-icon">
                      <ShieldCheck size={20} />
                    </span>
                    <div>
                      <h3>{s.name}</h3>
                      <span className="muted small">{STANDARD_SCOPE_LABELS[s.scope]}</span>
                    </div>
                  </div>
                  {s.description && <p className="muted small clamp-2">{s.description}</p>}
                  <div className="standard-card-stats">
                    <div>
                      <strong>{s.ruleCount}</strong>
                      <span>
                        <ListChecks size={12} aria-hidden /> Regeln
                      </span>
                    </div>
                    <div>
                      <strong>{s.documentCount}</strong>
                      <span>
                        <FileText size={12} aria-hidden /> Referenzen
                      </span>
                    </div>
                    <div>
                      <strong>{s.checkedDocuments}</strong>
                      <span>
                        <ShieldCheck size={12} aria-hidden /> geprüft
                      </span>
                    </div>
                  </div>
                  <div className="standard-card-foot">
                    {s.openDeviations > 0 ? (
                      <span className="chip chip-bad">{s.openDeviations} offene Abweichungen</span>
                    ) : (
                      <span className="chip chip-good">keine offenen Abweichungen</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'register' && <DeviationRegister />}
      {creating && <NewStandardDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

type StatusFilter = DeviationStatus | 'pending' | 'all';

/** Abweichungsregister über alle Projekte und Standards. */
export function DeviationRegister({ projectId, documentId, standardId }: { projectId?: number; documentId?: number; standardId?: number }) {
  const { people } = useUsers();
  const { data, setData, error, loading, reload } = useAsync(() => api.deviations.list({ projectId, documentId, standardId }), [projectId, documentId, standardId]);
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const [standard, setStandard] = useState<number | 'all'>('all');
  const [person, setPerson] = useState<number | 'all' | 'none'>('all');
  const [query, setQuery] = useState('');

  const standards = useMemo(() => {
    const m = new Map<number, string>();
    for (const d of data ?? []) m.set(d.standardId, d.standardName);
    return [...m.entries()];
  }, [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? [])
      .filter((d) => {
        if (status === 'pending' && !(d.status === 'open' || d.status === 'negotiate')) return false;
        if (status !== 'pending' && status !== 'all' && d.status !== status) return false;
        if (severity !== 'all' && d.severity !== severity) return false;
        if (standard !== 'all' && d.standardId !== standard) return false;
        if (person === 'none' && d.assigneeId !== null) return false;
        if (typeof person === 'number' && d.assigneeId !== person) return false;
        if (q && !`${d.title} ${d.expected} ${d.actual} ${d.comment} ${d.documentTitle} ${d.projectName}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }, [data, status, severity, standard, person, query]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, all: data?.length ?? 0 };
    for (const s of DEVIATION_STATUSES) c[s] = 0;
    for (const d of data ?? []) {
      c[d.status]++;
      if (d.status === 'open' || d.status === 'negotiate') c.pending++;
    }
    return c;
  }, [data]);

  const replace = (updated: DeviationWithContext) =>
    setData((prev) => (prev ? prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)) : prev));

  const exportCsv = () =>
    downloadCsv(`Abweichungsregister_${todayIso()}.csv`, [
      ['Schwere', 'Ergebnis', 'Abweichung', 'Soll', 'Ist', 'Fundstelle', 'Status', 'Zuständig', 'Termin', 'Kommentar', 'Dokument', 'Projekt', 'Standard', 'erkannt am', 'behoben am'],
      ...filtered.map((d) => [
        SEVERITY_LABELS[d.severity],
        FINDING_LABELS[d.result],
        d.title,
        d.expected,
        d.actual,
        d.evidence,
        DEVIATION_STATUS_LABELS[d.status],
        d.assigneeName ?? '',
        formatDate(d.dueDate),
        d.comment,
        d.documentTitle,
        d.projectName,
        d.standardName,
        formatDate(d.firstDetectedAt),
        formatDate(d.resolvedAt),
      ]),
    ]);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return loading ? <Loading /> : null;

  return (
    <section className="stack-sm">
      <div className="status-filter" role="tablist" aria-label="Nach Status filtern">
        {(['pending', ...DEVIATION_STATUSES, 'all'] as StatusFilter[]).map((s) => (
          <button key={s} className={`status-filter-btn ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)} role="tab" aria-selected={status === s}>
            {s === 'pending' ? 'Zu klären' : s === 'all' ? 'Alle' : DEVIATION_STATUS_LABELS[s]}
            <span className="count">{counts[s]}</span>
          </button>
        ))}
      </div>
      <div className="toolbar wrap">
        <div className="search">
          <Search size={16} aria-hidden />
          <input className="input" placeholder="Suchen" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value as Severity | 'all')} aria-label="Schwere">
          <option value="all">Alle Schweregrade</option>
          {(['critical', 'major', 'minor'] as Severity[]).map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABELS[s]}
            </option>
          ))}
        </select>
        {standards.length > 1 && (
          <select className="select" value={String(standard)} onChange={(e) => setStandard(e.target.value === 'all' ? 'all' : Number(e.target.value))} aria-label="Standard">
            <option value="all">Alle Standards</option>
            {standards.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
        <select
          className="select"
          value={String(person)}
          onChange={(e) => setPerson(e.target.value === 'all' || e.target.value === 'none' ? e.target.value : Number(e.target.value))}
          aria-label="Zuständig"
        >
          <option value="all">Alle Personen</option>
          <option value="none">Nicht zugewiesen</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="toolbar-spacer" />
        <button className="btn" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download size={16} /> CSV
        </button>
      </div>

      {data.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<ClipboardCheck size={36} />}
            title="Noch keine Abweichungen"
            text="Öffne ein Dokument und starte im Reiter „Standardprüfung“ eine Prüfung gegen einen eurer Standards."
          />
        </div>
      ) : filtered.length === 0 ? (
        <p className="muted pad">Keine Abweichungen für diesen Filter.</p>
      ) : (
        <div className="card dev-list">
          {filtered.map((d) => (
            <DeviationRow key={d.id} deviation={d} showContext={!documentId} onChange={(u) => replace({ ...d, ...u })} />
          ))}
        </div>
      )}
    </section>
  );
}

export function DeviationRow({ deviation: d, showContext, onChange }: { deviation: DeviationWithContext; showContext: boolean; onChange: (d: Deviation) => void }) {
  const due = d.dueDate && d.status !== 'resolved' && d.status !== 'accepted' && daysUntil(d.dueDate) < 0;
  return (
    <div className={`dev-row dev-row-${d.status} ${due ? 'overdue' : ''}`}>
      <div className="dev-row-main">
        <div className="dev-row-head">
          <SeverityChip severity={d.severity} />
          <FindingBadge result={d.result} />
          <strong>{d.title}</strong>
          {showContext && (
            <Link to={`/documents/${d.documentId}?tab=standards`} className="small">
              {d.projectName} › {d.documentTitle}
            </Link>
          )}
        </div>
        <div className="dev-values">
          <span>
            <span className="muted">Soll</span> {d.expected || '–'}
          </span>
          <span>
            <span className="muted">Ist</span> {d.actual || '–'}
          </span>
        </div>
        <div className="dev-meta muted small">
          erkannt {formatDate(d.firstDetectedAt)} · {d.standardName}
          {d.resolvedAt && ` · behoben ${formatDate(d.resolvedAt)}`}
          {d.decidedByName && ` · entschieden von ${d.decidedByName}`}
          {due && <span className="text-bad"> · Termin überschritten</span>}
        </div>
      </div>
      <DeviationControls deviation={d} onChange={onChange} compact />
    </div>
  );
}
