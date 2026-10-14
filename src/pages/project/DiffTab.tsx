import { ArrowLeftRight } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { diffRows, diffSummary, diffWords, type DiffRow } from '../../../shared/diff';
import { cleanLine, extractCandidates } from '../../../shared/extract';
import { DOC_TYPE_LABELS, type DocumentFull, type ProjectDetail } from '../../../shared/types';
import { api } from '../../api';
import { EmptyState, ErrorBox, Loading } from '../../components/ui';
import { formatPercent } from '../../format';

type Basis = 'sentences' | 'lines';

function segments(content: string, basis: Basis): string[] {
  if (basis === 'lines') return content.split('\n').map(cleanLine).filter(Boolean);
  // Satzweise Segmente sind robust gegenüber unterschiedlichen Zeilenumbrüchen in PDFs.
  return extractCandidates(content, { mode: 'sentences', minLength: 1 }, true).map((c) => (c.ref ? `${c.ref} ${c.text}` : c.text));
}

function defaultPair(project: ProjectDetail): [number | null, number | null] {
  const docs = project.documents;
  const ab = docs.find((d) => d.docType === 'order_confirmation');
  const offer = docs.find((d) => d.docType === 'offer' && (!ab || d.counterparty === ab.counterparty)) ?? docs.find((d) => d.docType === 'offer');
  if (ab && offer) return [offer.id, ab.id];
  return [docs[0]?.id ?? null, docs[1]?.id ?? null];
}

function Words({ left, right, side }: { left: string; right: string; side: 'left' | 'right' }) {
  const parts = useMemo(() => diffWords(left, right), [left, right]);
  return (
    <>
      {parts[side].map((p, i) =>
        p.changed ? (
          <mark key={i} className={side === 'left' ? 'diff-word-del' : 'diff-word-add'}>
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function DiffTab({ project }: { project: ProjectDetail }) {
  const [initialA, initialB] = defaultPair(project);
  const [aId, setAId] = useState<number | null>(initialA);
  const [bId, setBId] = useState<number | null>(initialB);
  const [basis, setBasis] = useState<Basis>('sentences');
  const [onlyChanges, setOnlyChanges] = useState(true);
  const [docs, setDocs] = useState<Record<number, DocumentFull>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    for (const id of [aId, bId]) {
      if (id === null || docs[id]) continue;
      api.documents
        .get(id)
        .then((d) => setDocs((prev) => ({ ...prev, [id]: d })))
        .catch((e: Error) => setError(e.message));
    }
  }, [aId, bId, docs]);

  const a = aId !== null ? docs[aId] : undefined;
  const b = bId !== null ? docs[bId] : undefined;

  const rows = useMemo<DiffRow[] | null | undefined>(() => {
    if (!a || !b) return undefined;
    return diffRows(segments(a.content, basis), segments(b.content, basis));
  }, [a, b, basis]);

  if (project.documents.length < 2) {
    return (
      <div className="card">
        <EmptyState title="Mindestens zwei Dokumente nötig" text="Der Textvergleich zeigt z. B. Abweichungen zwischen Angebot und Auftragsbestätigung." />
      </div>
    );
  }

  const summary = rows ? diffSummary(rows) : null;

  const select = (value: number | null, onChange: (id: number) => void, label: string) => (
    <select className="select" value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
      {project.documents.map((d) => (
        <option key={d.id} value={d.id}>
          {d.title} ({DOC_TYPE_LABELS[d.docType]})
        </option>
      ))}
    </select>
  );

  return (
    <section className="stack">
      <div className="card">
        <div className="diff-controls">
          {select(aId, setAId, 'Linkes Dokument')}
          <button
            className="icon-btn"
            onClick={() => {
              setAId(bId);
              setBId(aId);
            }}
            title="Seiten tauschen"
            aria-label="Seiten tauschen"
          >
            <ArrowLeftRight size={18} />
          </button>
          {select(bId, setBId, 'Rechtes Dokument')}
          <div className="segmented small">
            <button className={basis === 'sentences' ? 'active' : ''} onClick={() => setBasis('sentences')}>
              Sätze
            </button>
            <button className={basis === 'lines' ? 'active' : ''} onClick={() => setBasis('lines')}>
              Zeilen
            </button>
          </div>
          <label className="checkbox">
            <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
            Nur Unterschiede
          </label>
        </div>
        {summary && (
          <div className="diff-summary">
            <span>
              Übereinstimmung <strong>{formatPercent(summary.similarity * 100)}</strong>
            </span>
            <span className="diff-pill diff-pill-changed">{summary.changed} geändert</span>
            <span className="diff-pill diff-pill-removed">{summary.removed} nur links</span>
            <span className="diff-pill diff-pill-added">{summary.added} nur rechts</span>
          </div>
        )}
      </div>

      {error && <ErrorBox message={error} />}
      {aId === bId && <p className="muted">Bitte zwei unterschiedliche Dokumente wählen.</p>}
      {rows === undefined && aId !== bId && <Loading />}
      {rows === null && <ErrorBox message="Die Dokumente sind zu umfangreich für den Detailvergleich. Bitte den Vergleich auf Satzbasis verwenden." />}
      {rows && aId !== bId && (
        <div className="card diff">
          <div className="diff-head">
            <div>{a?.title}</div>
            <div>{b?.title}</div>
          </div>
          {renderRows(rows, onlyChanges)}
          {summary && summary.changed + summary.added + summary.removed === 0 && <p className="muted pad">Keine inhaltlichen Unterschiede gefunden.</p>}
        </div>
      )}
    </section>
  );
}

function renderRows(rows: DiffRow[], onlyChanges: boolean) {
  const out: React.ReactNode[] = [];
  let skipped = 0;
  const flushSkipped = (key: string) => {
    if (skipped > 0) {
      out.push(
        <div key={key} className="diff-skip">
          … {skipped} übereinstimmende {skipped === 1 ? 'Abschnitt' : 'Abschnitte'} …
        </div>,
      );
      skipped = 0;
    }
  };
  rows.forEach((row, i) => {
    if (row.kind === 'equal' && onlyChanges) {
      skipped++;
      return;
    }
    flushSkipped(`skip-${i}`);
    out.push(
      <Fragment key={i}>
        <div className={`diff-row diff-${row.kind}`}>
          <div className="diff-cell">
            {row.left === null ? null : row.kind === 'changed' ? <Words left={row.left} right={row.right!} side="left" /> : row.left}
          </div>
          <div className="diff-cell">
            {row.right === null ? null : row.kind === 'changed' ? <Words left={row.left!} right={row.right} side="right" /> : row.right}
          </div>
        </div>
      </Fragment>,
    );
  });
  flushSkipped('skip-end');
  return out;
}
