import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { extractPriceLines, type PriceLine } from '../../../shared/offers';
import type { DocumentMeta, ProjectDetail } from '../../../shared/types';
import { api } from '../../api';
import { Field, Loading, Modal } from '../../components/ui';
import { formatMoney } from '../../format';
import { useAction } from '../../state';

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-zäöüß ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  );

/** Ähnlichkeit zweier Positionsbezeichnungen (Wortüberschneidung). */
function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t) || [...tb].some((u) => u.startsWith(t.slice(0, 6)) || t.startsWith(u.slice(0, 6)))) common++;
  return common / Math.max(ta.size, tb.size);
}

/**
 * Liest Preiszeilen aus einem Angebot und legt daraus Positionen an bzw. ordnet die Preise
 * bestehenden Positionen zu (Zuordnung per Namensähnlichkeit vorgeschlagen).
 */
export function ImportPositionsDialog({
  project,
  docs,
  onClose,
  onDone,
}: {
  project: ProjectDetail;
  docs: DocumentMeta[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [docId, setDocId] = useState<number>(() => docs.find((d) => !project.priceEntries.some((e) => e.documentId === d.id))?.id ?? docs[0].id);
  const [lines, setLines] = useState<PriceLine[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<Record<string, number | 'new'>>({});
  const run = useAction();

  useEffect(() => {
    setLines(null);
    void api.documents.get(docId).then((d) => {
      const found = extractPriceLines(d.content);
      setLines(found);
      setSelected(new Set(found.filter((l) => !l.isTotal).map((l) => l.key)));
      const t: Record<string, number | 'new'> = {};
      for (const l of found) {
        let best: { id: number; score: number } | null = null;
        for (const p of project.positions) {
          const score = similarity(l.name, p.name) + (l.ref && l.ref === p.ref ? 0.25 : 0);
          if (!best || score > best.score) best = { id: p.id, score };
        }
        t[l.key] = best && best.score >= 0.34 ? best.id : 'new';
      }
      setTarget(t);
    });
  }, [docId, project.positions]);

  const chosen = useMemo(() => (lines ?? []).filter((l) => selected.has(l.key)), [lines, selected]);

  const submit = async () => {
    const ok = await run(async () => {
      const fresh = chosen.filter((l) => target[l.key] === 'new');
      if (fresh.length) {
        await api.positions.create(
          project.id,
          fresh.map((l) => ({ ref: l.ref, name: l.name, quantity: 1, unit: 'psch', prices: [{ documentId: docId, price: l.amount, state: 'priced' }] })),
        );
      }
      for (const l of chosen) {
        const t = target[l.key];
        if (t !== 'new') await api.positions.setPrice({ positionId: t, documentId: docId, price: l.amount, state: 'priced' });
      }
      return true;
    }, `${chosen.length} Preise übernommen`);
    if (ok) {
      onDone();
      onClose();
    }
  };

  const doc = docs.find((d) => d.id === docId)!;

  return (
    <Modal
      open
      onClose={onClose}
      width={900}
      title={
        <>
          <Sparkles size={18} /> Positionen aus Angebot übernehmen
        </>
      }
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={chosen.length === 0}>
            {chosen.length} übernehmen
          </button>
        </>
      }
    >
      <Field label="Angebot">
        <select className="select" value={docId} onChange={(e) => setDocId(Number(e.target.value))}>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
              {d.counterparty ? ` – ${d.counterparty}` : ''}
            </option>
          ))}
        </select>
      </Field>
      {!lines ? (
        <Loading />
      ) : lines.length === 0 ? (
        <p className="muted">In diesem Dokument wurden keine Zeilen mit Euro-Beträgen gefunden. Positionen lassen sich im Preisspiegel auch manuell anlegen.</p>
      ) : (
        <div className="extract-list">
          {lines.map((l) => (
            <label key={l.key} className={`extract-item import-item ${selected.has(l.key) ? 'selected' : ''}`}>
              <input
                type="checkbox"
                checked={selected.has(l.key)}
                onChange={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(l.key)) next.delete(l.key);
                    else next.add(l.key);
                    return next;
                  })
                }
              />
              <span className="extract-ref">{l.ref}</span>
              <span className="extract-text">
                <span>
                  {l.name} {l.isTotal && <span className="chip">Summe</span>}
                </span>
                <span className="extract-meta">
                  <strong>{formatMoney(l.amount, doc.currency)}</strong>
                  <span className="muted">Z. {l.sourceLine}</span>
                </span>
              </span>
              <select
                className="select select-sm"
                value={String(target[l.key] ?? 'new')}
                onChange={(e) => setTarget({ ...target, [l.key]: e.target.value === 'new' ? 'new' : Number(e.target.value) })}
                aria-label="Zuordnung"
              >
                <option value="new">Neue Position</option>
                {project.positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    → {p.ref ? `${p.ref} ` : ''}
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
