import { useRef, useState, type ReactNode } from 'react';

export const MAX_SERIES = 8;

/** Feste Reihenfolge der Kategorienfarben – die Farbe folgt dem Dokument, nicht dem Rang. */
export function seriesVar(index: number): string {
  return `var(--series-${(index % MAX_SERIES) + 1})`;
}

interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** Ein Tooltip pro Diagramm, ausgelöst über Zeiger oder Tastaturfokus. */
export function useChartTooltip() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TooltipState | null>(null);

  const place = (clientX: number, clientY: number, content: ReactNode) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: clientX - box.left, y: clientY - box.top, content });
  };

  const bind = (content: ReactNode) => ({
    tabIndex: 0,
    onPointerMove: (e: React.PointerEvent) => place(e.clientX, e.clientY, content),
    onPointerLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      place(r.left + r.width, r.top + r.height / 2, content);
    },
    onBlur: () => setTip(null),
  });

  const box = containerRef.current?.getBoundingClientRect();
  const flip = tip && box ? tip.x > box.width - 220 : false;
  const node = tip ? (
    <div className="chart-tooltip" style={{ left: tip.x, top: tip.y, transform: `translate(${flip ? 'calc(-100% - 14px)' : '14px'}, -50%)` }} role="tooltip">
      {tip.content}
    </div>
  ) : null;

  return { containerRef, bind, tooltip: node };
}

export function TooltipRow({ color, value, label }: { color?: string; value: ReactNode; label: ReactNode }) {
  return (
    <div className="tt-row">
      {color && <span className="tt-key" style={{ background: color }} />}
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
