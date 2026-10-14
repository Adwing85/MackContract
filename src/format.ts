const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return toIsoDate(new Date(y, m - 1, d + days));
}

/** JJJJ-MM-TT als lokales Datum interpretieren (ohne Zeitzonenverschiebung). */
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  return dateFmt.format(iso.length === 10 ? parseLocalDate(iso) : new Date(iso));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '–';
  return dateTimeFmt.format(new Date(iso));
}

export function daysUntil(iso: string): number {
  const today = parseLocalDate(todayIso());
  return Math.round((parseLocalDate(iso).getTime() - today.getTime()) / 86_400_000);
}

export function dueLabel(iso: string | null): { text: string; tone: 'overdue' | 'soon' | 'normal' | 'none' } {
  if (!iso) return { text: 'ohne Termin', tone: 'none' };
  const days = daysUntil(iso);
  if (days < 0) return { text: `${formatDate(iso)} · ${-days} ${-days === 1 ? 'Tag' : 'Tage'} überfällig`, tone: 'overdue' };
  if (days === 0) return { text: `${formatDate(iso)} · heute`, tone: 'soon' };
  if (days === 1) return { text: `${formatDate(iso)} · morgen`, tone: 'soon' };
  if (days <= 7) return { text: `${formatDate(iso)} · in ${days} Tagen`, tone: 'soon' };
  return { text: formatDate(iso), tone: 'normal' };
}

export function formatMoney(amount: number | null | undefined, currency = 'EUR'): string {
  if (amount === null || amount === undefined) return '–';
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toLocaleString('de-DE')} ${currency}`;
  }
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '–';
  return value.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return '–';
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** CSV mit Semikolon und BOM – öffnet sich in deutschem Excel korrekt. */
export function downloadCsv(fileName: string, rows: Array<Array<string | number | null | undefined>>): void {
  const escape = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(escape).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80);
}

/** Liest Zahlen in deutscher oder englischer Schreibweise ("1.234,50", "1234.5"). */
export function parseDecimal(input: string): number | null {
  let s = input.trim().replace(/\s|€|EUR/gi, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
