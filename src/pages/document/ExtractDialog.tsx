import { TriangleAlert, WandSparkles } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_EXTRACT_OPTIONS,
  extractCandidates,
  type ExtractMode,
  type ExtractOptions,
  type Sensitivity,
} from '../../../shared/extract';
import { api } from '../../api';
import { Highlighted } from '../../components/Highlighted';
import { Modal } from '../../components/ui';
import { useAction } from '../../state';

const MODES: Array<{ id: ExtractMode; label: string; hint: string }> = [
  { id: 'sentences', label: 'Sätze', hint: 'Jeder Satz wird eine eigene Zeile – empfohlen' },
  { id: 'clauses', label: 'Klauseln', hint: 'Ein Eintrag je Absatz bzw. nummerierter Klausel' },
  { id: 'lines', label: 'Textzeilen', hint: 'Jede Zeile des Dokuments unverändert' },
];

const SENSITIVITIES: Array<{ id: Sensitivity; label: string }> = [
  { id: 'high', label: 'Hoch' },
  { id: 'medium', label: 'Mittel' },
  { id: 'low', label: 'Niedrig' },
];

export function ExtractDialog({
  documentId,
  content,
  existingCount,
  onClose,
  onDone,
}: {
  documentId: number;
  content: string;
  existingCount: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [options, setOptions] = useState<ExtractOptions>(DEFAULT_EXTRACT_OPTIONS);
  const [onlySuggested, setOnlySuggested] = useState(false);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = useAction();

  const candidates = useMemo(() => extractCandidates(content, options), [content, options]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Bei geänderten Optionen die erkannten Anforderungen neu vorauswählen.
  useEffect(() => {
    setSelected(new Set(candidates.filter((c) => c.isRequirement).map((c) => c.key)));
  }, [candidates]);

  const visible = onlySuggested ? candidates.filter((c) => c.isRequirement) : candidates;
  const suggestedCount = candidates.filter((c) => c.isRequirement).length;

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const submit = async () => {
    if (replace && existingCount > 0) {
      if (!window.confirm(`Alle ${existingCount} bestehenden Anforderungen inkl. Bewertungen, Aufgaben und Kommentaren werden gelöscht. Fortfahren?`)) return;
    }
    const items = candidates
      .filter((c) => selected.has(c.key))
      .map((c) => ({ ref: c.ref, section: c.section, text: c.text, category: c.category, sourceLine: c.sourceLine }));
    setBusy(true);
    const result = await run(() => api.requirements.create(documentId, items, replace), `${items.length} Anforderungen übernommen`);
    setBusy(false);
    if (result) {
      onDone();
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={1080}
      title={
        <>
          <WandSparkles size={18} /> Anforderungen zeilenweise extrahieren
        </>
      }
      footer={
        <>
          {existingCount > 0 && (
            <div className="segmented small footer-left" role="radiogroup" aria-label="Bestehende Anforderungen">
              <button className={!replace ? 'active' : ''} onClick={() => setReplace(false)}>
                An {existingCount} bestehende anhängen
              </button>
              <button className={replace ? 'active danger' : ''} onClick={() => setReplace(true)}>
                Bestehende ersetzen
              </button>
            </div>
          )}
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={selected.size === 0 || busy}>
            {selected.size} übernehmen
          </button>
        </>
      }
    >
      <div className="extract-options">
        <div className="option-group">
          <span className="option-label">Aufteilung</span>
          <div className="segmented small">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={options.mode === m.id ? 'active' : ''}
                title={m.hint}
                onClick={() => setOptions((o) => ({ ...o, mode: m.id }))}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="option-group">
          <span className="option-label">Erkennung</span>
          <div className="segmented small">
            {SENSITIVITIES.map((s) => (
              <button
                key={s.id}
                className={options.sensitivity === s.id ? 'active' : ''}
                onClick={() => setOptions((o) => ({ ...o, sensitivity: s.id }))}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <label className="option-group">
          <span className="option-label">Min. Länge</span>
          <input
            className="input input-sm"
            type="number"
            min={1}
            max={200}
            value={options.minLength}
            onChange={(e) => setOptions((o) => ({ ...o, minLength: Math.max(1, Number(e.target.value) || 1) }))}
          />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={onlySuggested} onChange={(e) => setOnlySuggested(e.target.checked)} />
          Nur erkannte Anforderungen anzeigen
        </label>
      </div>

      <div className="extract-summary">
        <span>
          {candidates.length} Einträge · <strong>{suggestedCount}</strong> als Anforderung erkannt · <strong>{selected.size}</strong> ausgewählt
        </span>
        <span className="row gap-sm">
          <button className="btn btn-sm" onClick={() => setSelected(new Set(candidates.map((c) => c.key)))}>
            Alle
          </button>
          <button className="btn btn-sm" onClick={() => setSelected(new Set(candidates.filter((c) => c.isRequirement).map((c) => c.key)))}>
            Erkannte
          </button>
          <button className="btn btn-sm" onClick={() => setSelected(new Set())}>
            Keine
          </button>
        </span>
      </div>

      {content.trim().length === 0 ? (
        <p className="muted pad">Das Dokument enthält keinen Text. Füge den Text im Reiter „Dokumenttext“ ein.</p>
      ) : (
        <div className="extract-list">
          {visible.map((c, i) => {
            const showSection = c.section && c.section !== visible[i - 1]?.section;
            return (
              <Fragment key={c.key}>
                {showSection && <div className="extract-section">{c.section}</div>}
                <label className={`extract-item ${selected.has(c.key) ? 'selected' : ''} ${c.isRequirement ? 'suggested' : ''}`}>
                  <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggle(c.key)} />
                  <span className="extract-ref">{c.ref || ''}</span>
                  <span className="extract-text">
                    <span>
                      <Highlighted text={c.text} />
                    </span>
                    <span className="extract-meta">
                      <span className="chip">{c.category}</span>
                      <span className="muted">Z. {c.sourceLine}</span>
                      {c.risks.length > 0 && (
                        <span className="chip chip-warn">
                          <TriangleAlert size={12} /> {c.risks.join(', ')}
                        </span>
                      )}
                    </span>
                  </span>
                </label>
              </Fragment>
            );
          })}
        </div>
      )}
      <p className="muted small legend-line">
        <mark className="hl hl-obligation">Pflichtformulierung</mark> <mark className="hl hl-risk">Risikobegriff</mark> – die Vorauswahl ist ein
        Vorschlag; alle Einträge können angepasst werden.
      </p>
    </Modal>
  );
}
