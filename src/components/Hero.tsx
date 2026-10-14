import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

// Achterbahn-Strecke inkl. Looping (Koordinaten im viewBox 1200 × 260).
const TRACK =
  'M-40 214 C 110 214, 170 64, 300 64 S 470 206, 600 170 C 690 146, 712 58, 800 58 C 872 58, 890 128, 846 146 C 802 164, 772 112, 806 90 C 846 64, 930 84, 968 140 S 1100 224, 1260 112';

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

/** Dekorative Achterbahn mit Stützen und einem fahrenden Zug (respektiert „Bewegung reduzieren“). */
export function CoasterTrack({ className }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  const pathRef = useRef<SVGPathElement>(null);
  const [supports, setSupports] = useState<Array<{ x: number; y: number }>>([]);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const path = pathRef.current;
    if (!path || typeof path.getTotalLength !== 'function') return;
    const length = path.getTotalLength();
    const points: Array<{ x: number; y: number }> = [];
    for (let l = 0; l < length; l += 46) {
      const p = path.getPointAtLength(l);
      // Im Looping-Bereich keine Stützen zeichnen.
      if (p.x > 0 && p.x < 1200 && !(p.x > 760 && p.x < 900 && p.y < 150)) points.push({ x: p.x, y: p.y });
    }
    setSupports(points);
  }, []);

  return (
    <svg className={className} viewBox="0 0 1200 260" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <defs>
        <linearGradient id={`rail-${id}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#91b5c7" stopOpacity="0.2" />
          <stop offset="0.45" stopColor="#c5e7ff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#2f73b7" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <g stroke="#91b5c7" strokeOpacity="0.16" strokeWidth="2">
        {supports.map((p, i) => (
          <line key={i} x1={p.x} y1={p.y + 6} x2={p.x} y2={262} />
        ))}
      </g>
      <path d={TRACK} fill="none" stroke="#c5e7ff" strokeOpacity="0.28" strokeWidth="14" strokeDasharray="2.5 9" />
      <path ref={pathRef} id={`track-${id}`} d={TRACK} fill="none" stroke={`url(#rail-${id})`} strokeWidth="3.5" strokeLinecap="round" />
      <path d={TRACK} fill="none" stroke="#c5e7ff" strokeOpacity="0.35" strokeWidth="1.5" transform="translate(0 7)" />
      {!reduced &&
        [0, 0.32, 0.64].map((delay) => (
          <g key={delay}>
            <rect x="-13" y="-9" width="26" height="12" rx="4" fill="#ffffff" />
            <rect x="-9" y="-6" width="18" height="4" rx="2" fill="#2f73b7" />
            <animateMotion dur="11s" repeatCount="indefinite" rotate="auto" begin={`-${delay}s`}>
              <mpath href={`#track-${id}`} />
            </animateMotion>
          </g>
        ))}
    </svg>
  );
}

/** Kopfbereich mit Markenverlauf, Speedlines und Achterbahn. */
export function Hero({ eyebrow, title, children, actions }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="hero">
      <CoasterTrack className="hero-track" />
      <div className="hero-speedlines" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="hero-content">
        <div className="hero-head">
          <div>
            {eyebrow && <div className="hero-eyebrow">{eyebrow}</div>}
            <h1 className="hero-title">{title}</h1>
          </div>
          {actions && <div className="hero-actions">{actions}</div>}
        </div>
        {children}
      </div>
    </section>
  );
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 11) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}
