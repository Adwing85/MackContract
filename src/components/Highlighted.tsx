import { useMemo } from 'react';
import { findHighlights } from '../../shared/extract';

/** Zeigt Text mit markierten Pflicht- und Risikoformulierungen. */
export function Highlighted({ text, query }: { text: string; query?: string }) {
  const parts = useMemo(() => {
    const ranges: Array<{ start: number; end: number; kind: string }> = findHighlights(text);
    if (query && query.trim().length >= 2) {
      const q = query.trim().toLowerCase();
      const lower = text.toLowerCase();
      let idx = lower.indexOf(q);
      while (idx !== -1) {
        const start = idx;
        const end = idx + q.length;
        // Suchtreffer haben Vorrang; überlappende Markierungen entfernen.
        for (let i = ranges.length - 1; i >= 0; i--) if (ranges[i].start < end && ranges[i].end > start) ranges.splice(i, 1);
        ranges.push({ start, end, kind: 'search' });
        idx = lower.indexOf(q, end);
      }
      ranges.sort((a, b) => a.start - b.start);
    }
    const out: Array<{ text: string; kind?: string }> = [];
    let pos = 0;
    for (const r of ranges) {
      if (r.start < pos) continue;
      if (r.start > pos) out.push({ text: text.slice(pos, r.start) });
      out.push({ text: text.slice(r.start, r.end), kind: r.kind });
      pos = r.end;
    }
    if (pos < text.length) out.push({ text: text.slice(pos) });
    return out;
  }, [text, query]);

  return (
    <>
      {parts.map((p, i) =>
        p.kind ? (
          <mark key={i} className={`hl hl-${p.kind}`}>
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
