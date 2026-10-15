import { CircleAlert, CircleCheck, CircleDashed, CircleHelp, CirclePlus, CircleX, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  DEVIATION_STATUS_LABELS,
  DEVIATION_STATUSES,
  FINDING_LABELS,
  SEVERITY_LABELS,
  type Deviation,
  type DeviationStatus,
  type FindingResult,
  type Severity,
} from '../../shared/standards';
import { api } from '../api';
import { useAction, useUsers } from '../state';

const RESULT_TONE: Record<FindingResult, 'good' | 'warn' | 'bad' | 'open' | 'accent'> = {
  conform: 'good',
  match: 'good',
  tolerated: 'warn',
  changed: 'warn',
  deviation: 'bad',
  missing: 'bad',
  unclear: 'open',
  additional: 'accent',
};

export function resultTone(result: FindingResult) {
  return RESULT_TONE[result];
}

export function FindingIcon({ result, size = 18 }: { result: FindingResult; size?: number }) {
  const tone = RESULT_TONE[result];
  const props = { size, className: `finding-icon tone-${tone}`, 'aria-hidden': true } as const;
  if (result === 'conform' || result === 'match') return <CircleCheck {...props} />;
  if (result === 'tolerated' || result === 'changed') return <CircleAlert {...props} />;
  if (result === 'deviation' || result === 'missing') return <CircleX {...props} />;
  if (result === 'additional') return <CirclePlus {...props} />;
  return <CircleHelp {...props} />;
}

export function FindingBadge({ result }: { result: FindingResult }) {
  return (
    <span className={`finding-badge tone-${RESULT_TONE[result]}`}>
      <FindingIcon result={result} size={13} />
      {FINDING_LABELS[result]}
    </span>
  );
}

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span className={`severity severity-${severity}`} title={SEVERITY_LABELS[severity]}>
      {severity === 'critical' && <ShieldAlert size={12} aria-hidden />}
      {severity === 'critical' ? 'K.O.' : SEVERITY_LABELS[severity]}
    </span>
  );
}

export function DeviationStatusBadge({ status }: { status: DeviationStatus }) {
  return (
    <span className={`dev-status dev-status-${status}`}>
      {status === 'resolved' ? <CircleCheck size={12} /> : <CircleDashed size={12} />}
      {DEVIATION_STATUS_LABELS[status]}
    </span>
  );
}

/** Entscheidung, Zuständigkeit, Termin und Kommentar zu einer Abweichung. */
export function DeviationControls({ deviation, onChange, compact }: { deviation: Deviation; onChange: (d: Deviation) => void; compact?: boolean }) {
  const { people } = useUsers();
  const run = useAction();
  const [comment, setComment] = useState(deviation.comment);
  useEffect(() => setComment(deviation.comment), [deviation.comment]);

  const patch = async (p: Parameters<typeof api.deviations.update>[1]) => {
    const updated = await run(() => api.deviations.update(deviation.id, p));
    if (updated) onChange(updated);
  };

  return (
    <div className={`dev-controls ${compact ? 'compact' : ''}`}>
      <select
        className={`select select-sm dev-select dev-status-${deviation.status}`}
        value={deviation.status}
        onChange={(e) => patch({ status: e.target.value as DeviationStatus })}
        aria-label="Status der Abweichung"
      >
        {DEVIATION_STATUSES.map((s) => (
          <option key={s} value={s}>
            {DEVIATION_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <select
        className="select select-sm"
        value={deviation.assigneeId ?? ''}
        onChange={(e) => patch({ assigneeId: e.target.value ? Number(e.target.value) : null })}
        aria-label="Zuständige Person"
      >
        <option value="">– zuständig –</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <input
        className="input input-sm dev-date"
        type="date"
        value={deviation.dueDate ?? ''}
        onChange={(e) => patch({ dueDate: e.target.value || null })}
        aria-label="Termin"
      />
      <input
        className="input input-sm dev-comment"
        value={comment}
        placeholder="Kommentar / Verhandlungsstand"
        onChange={(e) => setComment(e.target.value)}
        onBlur={() => comment !== deviation.comment && patch({ comment })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label="Kommentar"
      />
    </div>
  );
}
