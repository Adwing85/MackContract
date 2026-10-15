import { ArrowLeft, ExternalLink, FileText, ListChecks, Pencil, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DOC_TYPES, DOC_TYPE_LABELS, emptyStats, type DocType, type DocumentFull, type Requirement } from '../../shared/types';
import { api } from '../api';
import { StatusBar } from '../components/status';
import { DocTypeBadge, ErrorBox, Field, Loading, Modal, Tabs } from '../components/ui';
import { formatDate, formatMoney, parseDecimal } from '../format';
import { useAction, useAsync, useToast } from '../state';
import { ExtractDialog } from './document/ExtractDialog';
import { RequirementDrawer } from './document/RequirementDrawer';
import { RequirementsPanel } from './document/RequirementsPanel';
import { StandardCheckPanel } from './document/StandardCheckPanel';
import { TextPanel } from './document/TextPanel';

export function DocumentPage() {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'requirements';
  const openReq = params.get('req') ? Number(params.get('req')) : null;
  const focusLine = params.get('line') ? Number(params.get('line')) : null;
  const extractOpen = params.get('extract') === '1';

  const doc = useAsync(() => api.documents.get(id), [id]);
  const reqs = useAsync(() => api.requirements.list(id), [id]);
  const [editingMeta, setEditingMeta] = useState(false);
  const run = useAction();
  const navigate = useNavigate();

  const updateParams = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const stats = useMemo(() => {
    const s = emptyStats();
    for (const r of reqs.data ?? []) {
      s[r.status]++;
      s.total++;
    }
    return s;
  }, [reqs.data]);

  const setRequirements = useCallback(
    (updater: (prev: Requirement[]) => Requirement[]) => reqs.setData((prev) => updater(prev ?? [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (doc.error) return <ErrorBox message={doc.error} onRetry={doc.reload} />;
  if (!doc.data) return <Loading />;
  const d = doc.data;

  const remove = async () => {
    if (!window.confirm(`Dokument „${d.title}“ inkl. aller Anforderungen und Aufgaben löschen?`)) return;
    const ok = await run(async () => {
      await api.documents.remove(d.id);
      return true;
    }, 'Dokument gelöscht');
    if (ok) navigate(`/projects/${d.projectId}`);
  };

  const showLine = (line: number) => updateParams({ tab: 'text', line: String(line), req: null });

  return (
    <div className="page">
      <Link to={`/projects/${d.projectId}`} className="back-link">
        <ArrowLeft size={14} /> {d.projectName}
      </Link>
      <header className="page-header">
        <div>
          <div className="row gap-sm wrap">
            <DocTypeBadge type={d.docType} />
            {d.reference && <span className="muted">{d.reference}</span>}
          </div>
          <h1>{d.title}</h1>
          <div className="doc-facts">
            <span>
              <span className="muted">Partner</span> {d.counterparty || '–'}
            </span>
            <span>
              <span className="muted">Datum</span> {formatDate(d.docDate)}
            </span>
            <span>
              <span className="muted">Betrag</span> {formatMoney(d.amount, d.currency)}
            </span>
          </div>
        </div>
        <div className="page-actions">
          {d.hasFile && (
            <button className="btn" onClick={() => run(() => api.documents.openFile(d.id))} title={d.fileName ?? undefined}>
              <ExternalLink size={16} /> Original
            </button>
          )}
          <button className="btn" onClick={() => setEditingMeta(true)}>
            <Pencil size={16} /> Bearbeiten
          </button>
          <button className="btn btn-ghost-danger" onClick={remove} title="Dokument löschen" aria-label="Dokument löschen">
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      {stats.total > 0 && (
        <div className="card progress-card">
          <StatusBar stats={stats} legend height={12} />
        </div>
      )}

      <Tabs
        active={tab}
        onChange={(t) => updateParams({ tab: t === 'requirements' ? null : t, line: null })}
        tabs={[
          { id: 'requirements', label: 'Anforderungen', icon: <ListChecks size={16} />, count: stats.total },
          { id: 'standards', label: 'Standardprüfung', icon: <ShieldCheck size={16} />, count: d.lastCheck?.openDeviations || undefined },
          { id: 'text', label: 'Dokumenttext', icon: <FileText size={16} /> },
        ]}
      />

      {tab === 'requirements' &&
        (reqs.data ? (
          <RequirementsPanel
            documentId={d.id}
            documentTitle={d.title}
            requirements={reqs.data}
            setRequirements={setRequirements}
            reload={reqs.reload}
            onOpen={(rid) => updateParams({ req: String(rid) })}
            onExtract={() => updateParams({ extract: '1' })}
            hasContent={d.contentLength > 0}
          />
        ) : reqs.error ? (
          <ErrorBox message={reqs.error} onRetry={reqs.reload} />
        ) : (
          <Loading />
        ))}

      {tab === 'standards' && <StandardCheckPanel doc={d} onDocChange={doc.setData} onShowLine={showLine} />}

      {tab === 'text' && (
        <TextPanel
          content={d.content}
          requirements={reqs.data ?? []}
          focusLine={focusLine}
          onOpenRequirement={(rid) => updateParams({ req: String(rid) })}
          onSave={async (content) => {
            const updated = await run(() => api.documents.update(d.id, { content }), 'Text gespeichert');
            if (updated) doc.setData(updated);
            return Boolean(updated);
          }}
        />
      )}

      {extractOpen && (
        <ExtractDialog
          documentId={d.id}
          content={d.content}
          existingCount={reqs.data?.length ?? 0}
          onClose={() => updateParams({ extract: null })}
          onDone={() => {
            void reqs.reload();
            updateParams({ tab: null });
          }}
        />
      )}

      {openReq && (
        <RequirementDrawer
          requirementId={openReq}
          onClose={() => updateParams({ req: null })}
          onChanged={() => void reqs.reload()}
          onShowLine={showLine}
        />
      )}

      {editingMeta && (
        <EditDocumentDialog
          doc={d}
          onClose={() => setEditingMeta(false)}
          onSaved={(updated) => {
            doc.setData(updated);
            setEditingMeta(false);
          }}
        />
      )}
    </div>
  );
}

function EditDocumentDialog({ doc, onClose, onSaved }: { doc: DocumentFull; onClose: () => void; onSaved: (d: DocumentFull) => void }) {
  const [title, setTitle] = useState(doc.title);
  const [docType, setDocType] = useState<DocType>(doc.docType);
  const [counterparty, setCounterparty] = useState(doc.counterparty);
  const [reference, setReference] = useState(doc.reference);
  const [docDate, setDocDate] = useState(doc.docDate ?? '');
  const [amount, setAmount] = useState(doc.amount === null ? '' : doc.amount.toLocaleString('de-DE'));
  const [currency, setCurrency] = useState(doc.currency);
  const run = useAction();
  const toast = useToast();

  const save = async () => {
    const parsed = parseDecimal(amount);
    if (amount.trim() && parsed === null) {
      toast('Betrag ist keine gültige Zahl', 'error');
      return;
    }
    const updated = await run(
      () => api.documents.update(doc.id, { title, docType, counterparty, reference, docDate: docDate || null, amount: parsed, currency }),
      'Gespeichert',
    );
    if (updated) onSaved(updated);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Dokument bearbeiten"
      width={640}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!title.trim()}>
            Speichern
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Titel">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Dokumenttyp">
          <select className="select" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vertragspartner / Lieferant">
          <input className="input" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
        </Field>
        <Field label="Referenz / Nummer">
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Datum">
          <input className="input" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
        </Field>
        <Field label="Betrag (netto)">
          <div className="input-group">
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Währung">
              {[...new Set(['EUR', 'CHF', 'USD', 'GBP', currency])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </Field>
      </div>
    </Modal>
  );
}
