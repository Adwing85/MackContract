import { CircleAlert, CircleCheck, CircleDashed, CircleX, RotateCcw } from 'lucide-react';
import { STATUS_META, type ReqStats, type ReqStatus } from '../../shared/types';

export function StatusIcon({ status, size = 18 }: { status: ReqStatus; size?: number }) {
  const props = { size, className: `status-icon status-icon-${status}`, 'aria-hidden': true } as const;
  switch (status) {
    case 'accepted':
      return <CircleCheck {...props} />;
    case 'accepted_with_comments':
      return <CircleAlert {...props} />;
    case 'declined':
      return <CircleX {...props} />;
    default:
      return <CircleDashed {...props} />;
  }
}

export function StatusBadge({ status, compact }: { status: ReqStatus; compact?: boolean }) {
  const meta = STATUS_META[status];
  return (
    <span className={`status-badge status-${status}`} title={`${meta.label} – ${meta.hint}`}>
      <StatusIcon status={status} size={14} />
      {compact ? meta.short : meta.label}
    </span>
  );
}

const PICKABLE: Exclude<ReqStatus, 'open'>[] = ['accepted', 'accepted_with_comments', 'declined'];

/** Auswahl Accepted / Accepted with comments / Declined. */
export function StatusPicker({
  value,
  onChange,
  size = 'sm',
  allowReset = false,
  disabled,
}: {
  value: ReqStatus | null;
  onChange: (status: ReqStatus) => void;
  size?: 'sm' | 'lg';
  allowReset?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`status-picker status-picker-${size}`} role="radiogroup" aria-label="Bewertung">
      {PICKABLE.map((s) => {
        const meta = STATUS_META[s];
        const active = value === s;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            className={`status-option status-option-${s} ${active ? 'active' : ''}`}
            title={`${meta.label} – ${meta.hint}`}
            onClick={(e) => {
              e.stopPropagation();
              onChange(s);
            }}
          >
            <StatusIcon status={s} size={size === 'lg' ? 18 : 16} />
            {size === 'lg' ? (
              <span className="status-option-text">
                <strong>{meta.label}</strong>
                <small>{meta.hint}</small>
              </span>
            ) : (
              <span className="sr-only">{meta.label}</span>
            )}
          </button>
        );
      })}
      {allowReset && value && value !== 'open' && (
        <button
          type="button"
          className="status-option status-reset"
          title="Zurücksetzen auf Offen bzw. Prüfergebnis"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onChange('open');
          }}
        >
          <RotateCcw size={size === 'lg' ? 16 : 14} />
          {size === 'lg' ? <span className="status-option-text">Zurücksetzen</span> : <span className="sr-only">Zurücksetzen</span>}
        </button>
      )}
    </div>
  );
}

const BAR_ORDER: ReqStatus[] = ['accepted', 'accepted_with_comments', 'declined', 'open'];

/** Gestapelter Balken der Bewertungsverteilung (Teil-vom-Ganzen). */
export function StatusBar({ stats, legend = false, height = 8 }: { stats: ReqStats; legend?: boolean; height?: number }) {
  const total = stats.total;
  const rated = total - stats.open;
  return (
    <div className="status-bar-wrap">
      <div className="status-bar" style={{ height }} role="img" aria-label={statusSummary(stats)}>
        {total === 0 ? (
          <span className="status-seg status-seg-empty" style={{ flexGrow: 1 }} />
        ) : (
          BAR_ORDER.filter((s) => stats[s] > 0).map((s) => (
            <span
              key={s}
              className={`status-seg status-seg-${s}`}
              style={{ flexGrow: stats[s] }}
              title={`${STATUS_META[s].label}: ${stats[s]} von ${total}`}
            />
          ))
        )}
      </div>
      {legend && (
        <div className="status-legend">
          {BAR_ORDER.map((s) => (
            <span key={s} className="status-legend-item">
              <span className={`legend-swatch status-seg-${s}`} />
              {STATUS_META[s].label} <strong>{stats[s]}</strong>
            </span>
          ))}
          <span className="status-legend-item muted">
            {rated} von {total} bewertet
          </span>
        </div>
      )}
    </div>
  );
}

export function statusSummary(stats: ReqStats): string {
  return `${stats.accepted} Accepted, ${stats.accepted_with_comments} with comments, ${stats.declined} Declined, ${stats.open} offen`;
}
