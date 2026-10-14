import { HardDrive, RotateCcw, Save, TriangleAlert, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAction } from '../state';

/** Datensicherung der eigenständigen HTML-Version (Daten liegen nur im Browser). */
export function LocalDataPanel() {
  const run = useAction();
  const inputRef = useRef<HTMLInputElement>(null);
  const [persistent, setPersistent] = useState(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    void import('../local/backend').then((m) => {
      setPersistent(m.isPersistent());
      unsubscribe = m.onPersistenceChange(setPersistent);
    });
    return () => unsubscribe?.();
  }, []);

  const backup = () => run(async () => (await import('../local/backend')).exportBackup());

  const restore = async (file: File | undefined) => {
    if (!file) return;
    if (!window.confirm('Alle Daten in diesem Browser werden durch die Sicherung ersetzt. Fortfahren?')) return;
    const result = await run(async () => (await import('../local/backend')).importBackup(file));
    if (result) {
      window.alert(
        result.projects
          ? `Sicherung geladen: ${result.projects} Projekte.`
          : 'Die Datei enthält keine Projekte. Bei einer Datenbank der Server-Version bitte den Server vor dem Kopieren beenden.',
      );
      window.location.hash = '#/';
      window.location.reload();
    }
  };

  const reset = async () => {
    if (!window.confirm('Wirklich ALLE Projekte, Dokumente, Aufgaben und Personen in diesem Browser löschen? Vorher am besten eine Sicherung speichern.')) return;
    const ok = await run(async () => {
      await (await import('../local/backend')).resetLocalData();
      return true;
    });
    if (ok) {
      window.location.hash = '#/';
      window.location.reload();
    }
  };

  return (
    <div className="local-data">
      <div className={`local-data-status ${persistent ? '' : 'warn'}`}>
        {persistent ? <HardDrive size={14} aria-hidden /> : <TriangleAlert size={14} aria-hidden />}
        <span>{persistent ? 'Daten im Browser gespeichert' : 'Nicht dauerhaft gespeichert – bitte Sicherung speichern'}</span>
      </div>
      <div className="local-data-actions">
        <button className="btn btn-sm" onClick={backup} title="Alle Daten als Sicherungsdatei herunterladen">
          <Save size={14} /> <span>Sicherung speichern</span>
        </button>
        <button className="btn btn-sm" onClick={() => inputRef.current?.click()} title="Sicherung oder Server-Datenbank (.db) laden">
          <Upload size={14} /> <span>Sicherung laden</span>
        </button>
        <button className="btn btn-sm btn-ghost-danger" onClick={reset} title="Alle Daten in diesem Browser löschen">
          <RotateCcw size={14} /> <span>Alles löschen</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".json,.db,.sqlite,application/json"
        hidden
        onChange={(e) => {
          void restore(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
