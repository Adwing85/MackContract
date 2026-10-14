import emblemUrl from '../assets/brand/mack-emblem.png';
import { WORDMARK_PATHS, WORDMARK_VIEWBOX } from './brandPaths';

/** Wortmarke „MACK RIDES“ mit Speedlines – Farbe über currentColor. */
export function MackWordmark({ className, title = 'MACK Rides' }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox={WORDMARK_VIEWBOX} role="img" aria-label={title} fill="currentColor">
      {WORDMARK_PATHS.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/** Rundes „M“-Emblem (Bildmarke). */
export function MackEmblem({ size = 32, className }: { size?: number; className?: string }) {
  return <img src={emblemUrl} width={size} height={size} alt="MACK Rides" className={className} />;
}
