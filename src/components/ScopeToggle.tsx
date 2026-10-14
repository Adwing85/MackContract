export function ScopeToggle({ includeAll, onChange }: { includeAll: boolean; onChange: (all: boolean) => void }) {
  return (
    <div className="segmented small" role="radiogroup" aria-label="Vergleichsumfang">
      <button className={!includeAll ? 'active' : ''} onClick={() => onChange(false)} role="radio" aria-checked={!includeAll}>
        Nur Angebote
      </button>
      <button className={includeAll ? 'active' : ''} onClick={() => onChange(true)} role="radio" aria-checked={includeAll}>
        Alle Dokumente
      </button>
    </div>
  );
}
