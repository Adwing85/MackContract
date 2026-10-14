import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import type { Rating, ReqStatus, Task } from '../../../shared/types';
import { api } from '../../api';
import { StatusPicker } from '../../components/status';
import { useAction } from '../../state';

/** Antwort der zugewiesenen Person: Bewertung + Kommentar, schließt die Aufgabe ab. */
export function TaskResponseForm({ task, onSaved }: { task: Task; onSaved: () => void }) {
  const [rating, setRating] = useState<Rating | null>(task.rating);
  const [response, setResponse] = useState(task.response);
  const [busy, setBusy] = useState(false);
  const run = useAction();
  const needsComment = rating === 'accepted_with_comments' || rating === 'declined';

  const submit = async () => {
    if (!rating) return;
    setBusy(true);
    const saved = await run(() => api.tasks.update(task.id, { rating, response, state: 'done' }), 'Bewertung abgegeben');
    setBusy(false);
    if (saved) onSaved();
  };

  return (
    <div className="task-form">
      <StatusPicker value={rating} onChange={(s: ReqStatus) => s !== 'open' && setRating(s)} size="lg" />
      <textarea
        className={`textarea ${needsComment && !response.trim() ? 'needs-input' : ''}`}
        rows={3}
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        placeholder={needsComment ? 'Bitte Abweichung bzw. Grund für die Ablehnung beschreiben' : 'Kommentar (optional)'}
      />
      <div className="row end">
        <button className="btn btn-primary" onClick={submit} disabled={!rating || busy || (needsComment && !response.trim())}>
          <CircleCheck size={16} /> Bewertung abgeben
        </button>
      </div>
    </div>
  );
}
