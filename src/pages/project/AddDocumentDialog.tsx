import { FileUp, Type } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DOC_TYPES, DOC_TYPE_LABELS, type DocType } from '../../../shared/types';
import { api } from '../../api';
import { Field, Modal } from '../../components/ui';
import { parseDecimal } from '../../format';
import { useAction, useToast } from '../../state';

const ACCEPT = '.pdf,.docx,.txt,.md,.csv,.html,.htm';

function guessType(name: string): DocType {
  const n = name.toLowerCase();
  if (/auftragsbest|order.?confirm|\bab[-_ ]/.test(n)) return 'order_confirmation';
  if (/angebot|offer|quotation|quote/.test(n)) return 'offer';
  if (/vertrag|contract|agreement|rahmen/.test(n)) return 'contract';
  return 'other';
}

export function AddDocumentDialog({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: number }) {
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState<DocType>('offer');
  const [counterparty, setCounterparty] = useState('');
  const [reference, setReference] = useState('');
  const [docDate, setDocDate] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [extractNow, setExtractNow] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const run = useAction();
  const toast = useToast();
  const navigate = useNavigate();

  const pickFile = (f: File | null) => {
    setFile(f);
    if (f) {
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
      setDocType(guessType(f.name));
    }
  };

  const reset = () => {
    setFile(null);
    setText('');
    setTitle('');
    setCounterparty('');
    setReference('');
    setDocDate('');
    setAmount('');
  };

  const canSubmit = (mode === 'file' ? !!file : text.trim().length > 0) && (mode === 'file' || title.trim().length > 0);

  const submit = async () => {
    const parsedAmount = parseDecimal(amount);
    if (amount.trim() && parsedAmount === null) {
      toast('Betrag ist keine gültige Zahl', 'error');
      return;
    }
    const form = new FormData();
    if (mode === 'file' && file) form.append('file', file);
    if (mode === 'text') form.append('content', text);
    form.append('title', title);
    form.append('docType', docType);
    form.append('counterparty', counterparty);
    form.append('reference', reference);
    form.append('docDate', docDate);
    form.append('amount', parsedAmount === null ? '' : String(parsedAmount));
    form.append('currency', currency);
    setBusy(true);
    const result = await run(() => api.documents.create(projectId, form), 'Dokument hinzugefügt');
    setBusy(false);
    if (!result) return;
    if (result.warning) toast(result.warning, 'error');
    reset();
    onClose();
    navigate(`/documents/${result.document.id}${extractNow && result.document.contentLength > 0 ? '?extract=1' : ''}`);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Dokument hinzufügen"
      width={720}
      footer={
        <>
          <label className="checkbox footer-left">
            <input type="checkbox" checked={extractNow} onChange={(e) => setExtractNow(e.target.checked)} />
            Anschließend Anforderungen extrahieren
          </label>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!canSubmit || busy}>
            {busy ? 'Wird verarbeitet …' : 'Hinzufügen'}
          </button>
        </>
      }
    >
      <div className="segmented" role="tablist">
        <button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')} role="tab" aria-selected={mode === 'file'}>
          <FileUp size={16} /> Datei hochladen
        </button>
        <button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')} role="tab" aria-selected={mode === 'text'}>
          <Type size={16} /> Text einfügen
        </button>
      </div>

      {mode === 'file' ? (
        <div
          className={`dropzone ${dragOver ? 'over' : ''} ${file ? 'has-file' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files[0] ?? null);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        >
          <FileUp size={28} aria-hidden />
          {file ? (
            <div>
              <strong>{file.name}</strong>
              <div className="muted">{(file.size / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 })} KB – klicken zum Ändern</div>
            </div>
          ) : (
            <div>
              <strong>Datei hierher ziehen oder klicken</strong>
              <div className="muted">PDF, Word (.docx), Text, HTML – max. 30 MB</div>
            </div>
          )}
          <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
        </div>
      ) : (
        <Field label="Dokumenttext" hint="Text aus E-Mail, PDF oder Word hier einfügen. Zeilenumbrüche bleiben erhalten.">
          <textarea className="textarea mono" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="1. Lieferumfang&#10;1.1 Der Auftragnehmer liefert …" />
        </Field>
      )}

      <div className="form-grid">
        <Field label="Titel">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={mode === 'file' ? 'Aus Dateiname' : 'z. B. Angebot Lieferant A'} />
        </Field>
        <Field label="Dokumenttyp">
          <select className="select" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vertragspartner / Lieferant">
          <input className="input" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
        </Field>
        <Field label="Referenz / Nummer">
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Angebots-, Vertrags- oder AB-Nr." />
        </Field>
        <Field label="Datum">
          <input className="input" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
        </Field>
        <Field label="Betrag (netto)">
          <div className="input-group">
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
            <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Währung">
              {['EUR', 'CHF', 'USD', 'GBP'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </Field>
      </div>
    </Modal>
  );
}
