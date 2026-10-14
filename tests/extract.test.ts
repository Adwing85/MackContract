import { describe, expect, it } from 'vitest';
import { extractCandidates, findHighlights, findRisks, guessCategory, normalizeContent, scoreRequirement, splitSentences } from '../shared/extract';

const OFFER = `Angebot Nr. 2026-0815
1. Lieferumfang
1.1 Der Auftragnehmer liefert eine CNC-Fräsmaschine Typ FM 500 inklusive Steuerung,
Kühlmittelanlage und Späneförderer gemäß beigefügter technischer Spezifikation.
1.2 Die Maschine muss eine Positioniergenauigkeit von mindestens 0,005 mm erreichen. Die
Spindelleistung beträgt 22 kW.
2. Liefertermin
2.1 Die Lieferung erfolgt spätestens 16 Wochen nach Auftragseingang frei Haus (DAP Incoterms
2020).
Seite 1 von 2
3. Preise und Zahlung
3.1 Der Gesamtpreis beträgt 285.000,00 EUR netto. Die Preise sind freibleibend.
§ 5 Abnahme
Der Auftraggeber ist verpflichtet, die Anlage innerhalb von 10 Werktagen abzunehmen. Die Abnahme
darf nicht ohne wichtigen Grund verweigert werden, z. B. bei unwesentlichen Mängeln.
- Dokumentation in deutscher Sprache ist bereitzustellen
Lieferung erfolgt im
4. Quartal 2026 an den Standort Ulm.`;

describe('extractCandidates', () => {
  it('fügt umbrochene Zeilen zusammen und übernimmt Klauselnummern', () => {
    const items = extractCandidates(OFFER, { mode: 'clauses' });
    const first = items.find((c) => c.ref === '1.1')!;
    expect(first.text).toBe(
      'Der Auftragnehmer liefert eine CNC-Fräsmaschine Typ FM 500 inklusive Steuerung, Kühlmittelanlage und Späneförderer gemäß beigefügter technischer Spezifikation.',
    );
    expect(first.section).toBe('1. Lieferumfang');
    expect(first.sourceLine).toBe(3);
    expect(items.find((c) => c.ref === '2.1')!.text).toContain('(DAP Incoterms 2020).');
  });

  it('teilt Klauseln im Satzmodus und beachtet Abkürzungen', () => {
    const items = extractCandidates(OFFER, { mode: 'sentences' });
    const clause12 = items.filter((c) => c.ref === '1.2');
    expect(clause12.map((c) => c.text)).toEqual([
      'Die Maschine muss eine Positioniergenauigkeit von mindestens 0,005 mm erreichen.',
      'Die Spindelleistung beträgt 22 kW.',
    ]);
    // „z. B.“ darf keinen Satz beenden
    expect(items.some((c) => c.text.startsWith('Die Abnahme darf nicht') && c.text.endsWith('Mängeln.'))).toBe(true);
    // Satz in der zweiten Zeile eines Absatzes bekommt die richtige Zeilennummer
    expect(clause12[1].sourceLine).toBe(5);
  });

  it('erkennt Überschriften als Abschnitt statt als Anforderung', () => {
    const items = extractCandidates(OFFER);
    expect(items.some((c) => c.text === 'Lieferumfang' || c.text === 'Preise und Zahlung')).toBe(false);
    expect(items.find((c) => c.text.startsWith('Der Auftraggeber ist verpflichtet'))!.section).toBe('§ 5 Abnahme');
  });

  it('entfernt Seitenzahlen und verbindet Fortsetzungen wie „im 4. Quartal“', () => {
    const items = extractCandidates(OFFER);
    expect(items.some((c) => /Seite 1 von 2/.test(c.text))).toBe(false);
    expect(items.some((c) => c.text === 'Lieferung erfolgt im 4. Quartal 2026 an den Standort Ulm.')).toBe(true);
  });

  it('markiert verpflichtende Formulierungen und Risiken als Anforderung', () => {
    const items = extractCandidates(OFFER);
    const byText = (start: string) => items.find((c) => c.text.startsWith(start))!;
    expect(byText('Die Maschine muss').isRequirement).toBe(true);
    expect(byText('Dokumentation in deutscher Sprache').isRequirement).toBe(true);
    expect(byText('Die Preise sind freibleibend').risks).toContain('freibleibend');
    expect(byText('Die Preise sind freibleibend').isRequirement).toBe(true);
  });

  it('liefert im Zeilenmodus jede Zeile einzeln', () => {
    const items = extractCandidates('Zeile eins ist hier\n\nZeile zwei ist da\n- Punkt drei folgt', { mode: 'lines', minLength: 1 });
    expect(items.map((c) => c.text)).toEqual(['Zeile eins ist hier', 'Zeile zwei ist da', 'Punkt drei folgt']);
    expect(items.map((c) => c.sourceLine)).toEqual([1, 3, 4]);
  });

  it('respektiert die Empfindlichkeit', () => {
    const text = 'Die Spindelleistung beträgt 22 kW.';
    expect(extractCandidates(text, { sensitivity: 'low' })[0].isRequirement).toBe(false);
    expect(extractCandidates(text, { sensitivity: 'high' })[0].isRequirement).toBe(true);
  });

  it('verwechselt Datum und Tausenderzahlen am Zeilenanfang nicht mit Klauselnummern', () => {
    const items = extractCandidates('Lieferung bis\n31.12.2026 an das Werk.\n\n1.000 Stück werden geliefert.', { mode: 'clauses' });
    expect(items.map((c) => c.ref)).toEqual(['', '']);
    expect(items[0].text).toBe('Lieferung bis 31.12.2026 an das Werk.');
  });
});

describe('Erkennungsregeln', () => {
  it('erkennt Wörter mit Umlauten am Wortanfang', () => {
    expect(scoreRequirement('Der Auftragnehmer übernimmt die Kosten.').score).toBeGreaterThanOrEqual(2);
  });

  it('erkennt „darf … nicht“ über Einheiten mit Klammern hinweg', () => {
    const { score, matches } = scoreRequirement('Der Schalldruckpegel darf am Arbeitsplatz 75 dB(A) nicht überschreiten.');
    expect(score).toBeGreaterThanOrEqual(3);
    expect(matches.join(' ')).toContain('nicht');
  });

  it('erkennt englische Anforderungen', () => {
    expect(scoreRequirement('The supplier shall deliver within 10 days.').score).toBeGreaterThanOrEqual(3);
  });

  it('ordnet Kategorien zu', () => {
    expect(guessCategory('Die Zahlung erfolgt 30 Tage netto nach Rechnungseingang.')).toBe('Kaufmännisch');
    expect(guessCategory('Die Haftung für Folgeschäden ist ausgeschlossen.')).toBe('Rechtlich');
    expect(guessCategory('Die Lieferung erfolgt DAP Incoterms 2020.')).toBe('Logistik');
  });

  it('findet Risikobegriffe', () => {
    expect(findRisks('Es gilt eine Vertragsstrafe; Teillieferungen bleiben vorbehalten.')).toEqual(['Vertragsstrafe', 'Teillieferungen']);
  });

  it('liefert überlappungsfreie Markierungen', () => {
    const text = 'Der Auftragnehmer muss spätestens liefern; die Preise sind freibleibend.';
    const marks = findHighlights(text);
    expect(marks.map((m) => text.slice(m.start, m.end))).toEqual(['muss', 'spätestens', 'freibleibend']);
    for (let i = 1; i < marks.length; i++) expect(marks[i].start).toBeGreaterThanOrEqual(marks[i - 1].end);
  });
});

describe('Hilfsfunktionen', () => {
  it('splitSentences trennt nicht nach Ordinalzahlen', () => {
    expect(splitSentences('Lieferung am 3. Juni 2026 frei Haus. Danach erfolgt die Montage vor Ort.').map((s) => s.text)).toEqual([
      'Lieferung am 3. Juni 2026 frei Haus.',
      'Danach erfolgt die Montage vor Ort.',
    ]);
  });

  it('normalizeContent vereinheitlicht Zeilenumbrüche und Sonderzeichen', () => {
    expect(normalizeContent('A\r\nB C­ D   \r\n\r\n\r\n\r\n\r\nE')).toBe('A\nB C D\n\n\nE');
  });
});
