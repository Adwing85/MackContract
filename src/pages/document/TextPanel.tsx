import { Pencil, Save } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Requirement } from '../../../shared/types';
import { StatusIcon } from '../../components/status';

/** Dokumenttext mit Zeilennummern; Zeilen mit extrahierten Anforderungen sind markiert. */
export function TextPanel({
  content,
  requirements,
  focusLine,
  onOpenRequirement,
  onSave,
}: {
  content: string;
  requirements: Requirement[];
  focusLine: number | null;
  onOpenRequirement: (id: number) => void;
  onSave: (content: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const containerRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => content.split('\n'), [content]);
  const byLine = useMemo(() => {
    const map = new Map<number, Requirement[]>();
    for (const r of requirements) {
      if (!r.sourceLine) continue;
      map.set(r.sourceLine, [...(map.get(r.sourceLine) ?? []), r]);
    }
    return map;
  }, [requirements]);

  useEffect(() => setDraft(content), [content]);

  useEffect(() => {
    if (!focusLine || editing) return;
    const el = containerRef.current?.querySelector(`[data-line="${focusLine}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusLine, editing]);

  if (editing) {
    return (
      <div className="card">
        <div className="card-header">
          <p className="muted small">
            Hinweis: Wenn Zeilen eingefügt oder gelöscht werden, verschieben sich die Zeilenverweise bereits extrahierter Anforderungen.
          </p>
          <div className="row gap-sm">
            <button className="btn" onClick={() => setEditing(false)}>
              Abbrechen
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                if (await onSave(draft)) setEditing(false);
              }}
            >
              <Save size={16} /> Speichern
            </button>
          </div>
        </div>
        <textarea className="textarea mono text-editor" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="muted small">
          {lines.length} Zeilen · {byLine.size} Zeilen mit Anforderungen
        </span>
        <button className="btn btn-sm" onClick={() => setEditing(true)}>
          <Pencil size={14} /> Text bearbeiten
        </button>
      </div>
      {content.trim() === '' ? (
        <p className="muted pad">Kein Text vorhanden. Über „Text bearbeiten“ kann der Text eingefügt werden.</p>
      ) : (
        <div className="doc-text" ref={containerRef}>
          {lines.map((line, i) => {
            const n = i + 1;
            const reqs = byLine.get(n);
            return (
              <div key={n} data-line={n} className={`doc-line ${reqs ? 'has-req' : ''} ${focusLine === n ? 'focus' : ''}`}>
                <span className="doc-line-no">{n}</span>
                <span className="doc-line-marks">
                  {reqs?.map((r) => (
                    <button key={r.id} className="icon-btn icon-btn-xs" onClick={() => onOpenRequirement(r.id)} title={r.text}>
                      <StatusIcon status={r.status} size={14} />
                    </button>
                  ))}
                </span>
                <span className="doc-line-text">{line || ' '}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
