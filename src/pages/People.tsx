import { Pencil, Trash2, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import type { Person } from '../../shared/types';
import { api } from '../api';
import { Avatar, EmptyState, Field, Modal } from '../components/ui';
import { useAction, useAsync, useUsers } from '../state';

export function PeoplePage() {
  const { people, reloadPeople, currentUser, setCurrentUserId } = useUsers();
  const tasks = useAsync(() => api.tasks.list({ state: 'open' }), [people.length]);
  const [editing, setEditing] = useState<Person | 'new' | null>(null);
  const run = useAction();

  const openCount = (id: number) => tasks.data?.filter((t) => t.assigneeId === id).length ?? 0;

  const remove = async (p: Person) => {
    const open = openCount(p.id);
    const msg = open
      ? `${p.name} hat ${open} offene Aufgaben. Person und alle zugehörigen Aufgaben löschen?`
      : `${p.name} löschen?`;
    if (!window.confirm(msg)) return;
    const ok = await run(async () => {
      await api.people.remove(p.id);
      return true;
    }, 'Person gelöscht');
    if (ok) {
      await reloadPeople();
      void tasks.reload();
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Personen</h1>
          <p className="page-sub">Personen, denen Anforderungen zur Prüfung zugewiesen werden können.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <UserPlus size={16} /> Person hinzufügen
          </button>
        </div>
      </header>

      {people.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Users size={36} />}
            title="Noch keine Personen"
            text="Lege Kolleginnen und Kollegen aus Technik, Einkauf, Recht oder Qualität an."
            action={
              <button className="btn btn-primary" onClick={() => setEditing('new')}>
                <UserPlus size={16} /> Person hinzufügen
              </button>
            }
          />
        </div>
      ) : (
        <div className="card table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Rolle / Abteilung</th>
                <th>E-Mail</th>
                <th className="num">Offene Aufgaben</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="row gap-sm">
                      <Avatar name={p.name} size={28} />
                      <strong>{p.name}</strong>
                      {currentUser?.id === p.id && <span className="chip chip-accent">Du</span>}
                    </span>
                  </td>
                  <td>{p.role || '–'}</td>
                  <td>{p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : '–'}</td>
                  <td className="num">{openCount(p.id)}</td>
                  <td className="nowrap right">
                    {currentUser?.id !== p.id && (
                      <button className="btn btn-sm btn-ghost" onClick={() => setCurrentUserId(p.id)}>
                        Als diese Person arbeiten
                      </button>
                    )}
                    <button className="icon-btn" onClick={() => setEditing(p)} aria-label={`${p.name} bearbeiten`}>
                      <Pencil size={15} />
                    </button>
                    <button className="icon-btn" onClick={() => remove(p)} aria-label={`${p.name} löschen`}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <PersonDialog
          person={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (saved, isNew) => {
            await reloadPeople();
            if (isNew && !currentUser) setCurrentUserId(saved.id);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function PersonDialog({
  person,
  onClose,
  onSaved,
}: {
  person: Person | null;
  onClose: () => void;
  onSaved: (p: Person, isNew: boolean) => void;
}) {
  const [name, setName] = useState(person?.name ?? '');
  const [role, setRole] = useState(person?.role ?? '');
  const [email, setEmail] = useState(person?.email ?? '');
  const run = useAction();
  const save = async () => {
    const saved = await run(() => (person ? api.people.update(person.id, { name, role, email }) : api.people.create({ name, role, email })), 'Gespeichert');
    if (saved) onSaved(saved, !person);
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={person ? 'Person bearbeiten' : 'Person hinzufügen'}
      width={480}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>
            Speichern
          </button>
        </>
      }
    >
      <div className="form">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Rolle / Abteilung">
          <input className="input" value={role} onChange={(e) => setRole(e.target.value)} placeholder="z. B. Konstruktion, Einkauf, Recht" />
        </Field>
        <Field label="E-Mail">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
