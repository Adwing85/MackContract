import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Field, Modal } from '../../components/ui';
import { addDays, todayIso } from '../../format';
import { useAction, useUsers } from '../../state';

/** Weist eine oder mehrere Anforderungen einer Person mit Termin zur Prüfung zu. */
export function AssignDialog({
  requirementIds,
  onClose,
  onAssigned,
}: {
  requirementIds: number[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const { people } = useUsers();
  const [assigneeId, setAssigneeId] = useState<number | ''>('');
  const [dueDate, setDueDate] = useState(addDays(todayIso(), 7));
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useAction();
  const count = requirementIds.length;

  const submit = async () => {
    if (!assigneeId) return;
    setBusy(true);
    const result = await run(
      () => api.tasks.create({ requirementIds, assigneeId, dueDate: dueDate || null, instruction }),
      count === 1 ? 'Aufgabe zugewiesen' : `${count} Aufgaben zugewiesen`,
    );
    setBusy(false);
    if (result) {
      onAssigned();
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={count === 1 ? 'Anforderung zur Prüfung zuweisen' : `${count} Anforderungen zur Prüfung zuweisen`}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!assigneeId || busy}>
            <UserPlus size={16} /> Zuweisen
          </button>
        </>
      }
    >
      {people.length === 0 ? (
        <p>
          Es sind noch keine Personen angelegt. <Link to="/people">Personen verwalten</Link>
        </p>
      ) : (
        <div className="form">
          <Field label="Person">
            <select className="select" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">– bitte wählen –</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.role ? ` (${p.role})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Termin" hint="Bis wann soll kommentiert und bewertet werden?">
            <div className="row gap-sm wrap">
              <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ maxWidth: 180 }} />
              {[3, 7, 14].map((d) => (
                <button key={d} type="button" className="btn btn-sm" onClick={() => setDueDate(addDays(todayIso(), d))}>
                  +{d} Tage
                </button>
              ))}
            </div>
          </Field>
          <Field label="Hinweis / Arbeitsauftrag" hint="Optional">
            <textarea
              className="textarea"
              rows={3}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="z. B. Bitte technische Machbarkeit prüfen und Abweichungen begründen."
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}
