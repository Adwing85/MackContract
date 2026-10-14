// Beispieldaten (fiktive Firmen und Personen) zum Ausprobieren der Anwendung.

import { extractCandidates } from '../shared/extract';
import type { DocType, Rating } from '../shared/types';
import type { DB } from './db';
import { transaction } from './db';
import * as store from './store';

const CONTRACT = `Liefervertrag Nr. NW-2026-114
zwischen der Nordwerk Fahrzeugtechnik GmbH (Auftraggeber) und dem Auftragnehmer

§ 1 Vertragsgegenstand
1.1 Der Auftragnehmer liefert eine vollautomatische Montagelinie für Achsträger gemäß Lastenheft LH-4711 Rev. C.
1.2 Die Anlage muss eine Taktzeit von höchstens 58 Sekunden je Bauteil erreichen.
1.3 Die technische Verfügbarkeit der Anlage muss mindestens 98 % betragen und ist über einen Dauerlauf von 72 Stunden nachzuweisen.

§ 2 Termine
2.1 Die Lieferung hat spätestens bis zum 31.03.2027 an das Werk Kassel zu erfolgen.
2.2 Der Auftragnehmer legt innerhalb von 4 Wochen nach Vertragsschluss einen detaillierten Terminplan vor.
2.3 Bei Überschreitung des Liefertermins wird eine Vertragsstrafe von 0,5 % des Auftragswertes je angefangener Woche fällig, maximal 10 %.

§ 3 Technische Anforderungen
3.1 Sämtliche Komponenten müssen der Maschinenrichtlinie 2006/42/EG entsprechen und mit CE-Kennzeichnung geliefert werden.
3.2 Die Steuerung ist auf Basis Siemens SIMATIC S7-1500 auszuführen.
3.3 Die Anlage muss über eine OPC-UA-Schnittstelle zur Anbindung an das MES des Auftraggebers verfügen.
3.4 Der Schalldruckpegel darf am Arbeitsplatz 75 dB(A) nicht überschreiten.
3.5 Die Dokumentation ist in deutscher und englischer Sprache bereitzustellen.

§ 4 Abnahme
4.1 Die Vorabnahme erfolgt beim Auftragnehmer, die Endabnahme nach Inbetriebnahme im Werk des Auftraggebers.
4.2 Der Auftragnehmer stellt für die Abnahme Prüfprotokolle und Messberichte aller sicherheitsrelevanten Funktionen bereit.

§ 5 Preise und Zahlung
5.1 Der Festpreis beträgt 1.240.000,00 EUR netto und gilt bis zur vollständigen Vertragserfüllung.
5.2 Zahlungen erfolgen zu 30 % nach Vorabnahme, 60 % nach Endabnahme und 10 % nach Ablauf der Gewährleistung.
5.3 Das Zahlungsziel beträgt 60 Tage netto.

§ 6 Gewährleistung und Haftung
6.1 Die Gewährleistungsfrist beträgt 36 Monate ab Endabnahme.
6.2 Der Auftragnehmer haftet unbeschränkt für sämtliche Schäden aus der Vertragsdurchführung.
6.3 Der Auftragnehmer stellt eine Vertragserfüllungsbürgschaft in Höhe von 10 % des Auftragswertes.

§ 7 Schlussbestimmungen
7.1 Es gilt deutsches Recht. Gerichtsstand ist Kassel.
7.2 Allgemeine Geschäftsbedingungen des Auftragnehmers finden keine Anwendung.`;

const OFFER_ALPHA = `Angebot Nr. A-2026-0815
Bearbeitungszentrum Alpha VX 800

1. Lieferumfang
1.1 Wir liefern ein 5-Achs-Bearbeitungszentrum Alpha VX 800 inklusive Steuerung Siemens SINUMERIK ONE, Kühlmittelanlage und Späneförderer.
1.2 Die Positioniergenauigkeit beträgt 0,004 mm nach VDI/DGQ 3441.
1.3 Die Spindelleistung beträgt 30 kW bei max. 18.000 U/min.

2. Liefertermin
2.1 Die Lieferung erfolgt 14 Wochen nach Auftragseingang frei Haus (DAP Incoterms 2020).

3. Preise und Zahlung
3.1 Der Gesamtpreis beträgt 412.000,00 EUR netto.
3.2 Zahlung: 30 % Anzahlung bei Auftragserteilung, 70 % nach Abnahme innerhalb von 30 Tagen netto.

4. Gewährleistung
4.1 Die Gewährleistung beträgt 24 Monate ab Abnahme.
4.2 Die Haftung für Folgeschäden ist ausgeschlossen.

5. Service
5.1 Ein Servicetechniker ist innerhalb von 24 Stunden vor Ort.`;

const OFFER_BETA = `Angebot 2026/4471
Beta Maschinenbau AG – Fräszentrum BM 6

1. Lieferumfang
1.1 Wir liefern ein 5-Achs-Fräszentrum BM 6 mit Steuerung Heidenhain TNC 640 und Kühlmittelanlage.
1.2 Die Positioniergenauigkeit beträgt 0,006 mm.
1.3 Die Spindelleistung beträgt 25 kW.

2. Liefertermin
2.1 Die Lieferzeit beträgt ca. 20 Wochen nach Klärung aller technischen Details.
2.2 Teillieferungen bleiben vorbehalten.

3. Preise und Zahlung
3.1 Der Gesamtpreis beträgt 389.500,00 EUR netto. Die Preise sind freibleibend.
3.2 Zahlung: 50 % Anzahlung bei Auftragserteilung, 50 % vor Versand.

4. Gewährleistung
4.1 Die Gewährleistung beträgt 12 Monate ab Lieferung.

5. Service
5.1 Reaktionszeit des Service: 48 Stunden an Werktagen.`;

const OFFER_GAMMA = `Angebot Nr. G-0926-33
Gamma CNC-Technik GmbH & Co. KG – Bearbeitungszentrum GX 5

1. Lieferumfang
1.1 Wir liefern ein 5-Achs-Bearbeitungszentrum GX 5 inklusive Steuerung Siemens SINUMERIK ONE, Werkzeugmagazin mit 60 Plätzen und Späneförderer.
1.2 Die Positioniergenauigkeit beträgt 0,003 mm nach VDI/DGQ 3441.
1.3 Die Spindelleistung beträgt 35 kW.

2. Liefertermin
2.1 Die Lieferung erfolgt verbindlich 10 Wochen nach Auftragseingang frei Haus (DAP Incoterms 2020).
2.2 Eine Vertragsstrafe von 0,3 % je Woche Verzug, maximal 5 %, wird akzeptiert.

3. Preise und Zahlung
3.1 Der Gesamtpreis beträgt 455.000,00 EUR netto als Festpreis bis 31.12.2026.
3.2 Zahlung: 100 % nach Abnahme innerhalb von 45 Tagen netto.

4. Gewährleistung
4.1 Die Gewährleistung beträgt 36 Monate ab Abnahme.

5. Service
5.1 Ein Servicetechniker ist innerhalb von 24 Stunden vor Ort; Ersatzteile sind 10 Jahre verfügbar.`;

const ORDER_CONFIRMATION_ALPHA = `Auftragsbestätigung Nr. AB-2026-1192 zu Angebot A-2026-0815
Bearbeitungszentrum Alpha VX 800

1. Lieferumfang
1.1 Wir liefern ein 5-Achs-Bearbeitungszentrum Alpha VX 800 inklusive Steuerung Siemens SINUMERIK ONE, Kühlmittelanlage und Späneförderer.
1.2 Die Positioniergenauigkeit beträgt 0,004 mm nach VDI/DGQ 3441.
1.3 Die Spindelleistung beträgt 30 kW bei max. 18.000 U/min.

2. Liefertermin
2.1 Die Lieferung erfolgt 16 Wochen nach Auftragseingang ab Werk (EXW Incoterms 2020).

3. Preise und Zahlung
3.1 Der Gesamtpreis beträgt 412.000,00 EUR netto.
3.2 Zahlung: 40 % Anzahlung bei Auftragserteilung, 60 % nach Abnahme innerhalb von 30 Tagen netto.

4. Gewährleistung
4.1 Die Gewährleistung beträgt 24 Monate ab Abnahme.
4.2 Die Haftung für Folgeschäden ist ausgeschlossen.
4.3 Es gelten ergänzend unsere Allgemeinen Lieferbedingungen.

5. Service
5.1 Ein Servicetechniker ist innerhalb von 24 Stunden vor Ort.`;

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDocument(
  db: DB,
  projectId: number,
  doc: { title: string; docType: DocType; counterparty: string; reference: string; amount: number | null; content: string; date: number },
) {
  const created = store.createDocument(db, projectId, {
    title: doc.title,
    docType: doc.docType,
    counterparty: doc.counterparty,
    docDate: isoDate(doc.date),
    reference: doc.reference,
    amount: doc.amount,
    currency: 'EUR',
    content: doc.content,
    fileName: null,
    filePath: null,
    fileMime: null,
  });
  const candidates = extractCandidates(doc.content, { mode: 'sentences', sensitivity: 'medium' }).filter((c) => c.isRequirement);
  const requirements = store.createRequirements(
    db,
    created.id,
    candidates.map((c) => ({ ref: c.ref, section: c.section, text: c.text, category: c.category, sourceLine: c.sourceLine })),
    { replace: false },
  );
  return { doc: created, requirements };
}

export function seedDemo(db: DB): { projectIds: number[] } {
  return transaction(db, () => {
    const existing = new Map(store.listPeople(db).map((p) => [p.name, p]));
    const person = (name: string, role: string, email: string) =>
      existing.get(name) ?? store.createPerson(db, { name, role, email });
    const anna = person('Anna Becker', 'Vertragsmanagement', 'anna.becker@example.com');
    const jonas = person('Jonas Weber', 'Konstruktion', 'jonas.weber@example.com');
    const lena = person('Lena Hoffmann', 'Recht', 'lena.hoffmann@example.com');
    const murat = person('Murat Yilmaz', 'Einkauf', 'murat.yilmaz@example.com');
    const sophie = person('Sophie Klein', 'Qualitätssicherung', 'sophie.klein@example.com');

    // ---------------------------------------------------- Projekt 1: Kundenvertrag prüfen
    const p1 = store.createProject(db, {
      name: 'Liefervertrag Nordwerk – Montagelinie Achsträger',
      description: 'Prüfung des Kundenvertrags NW-2026-114 auf Erfüllbarkeit (Beispieldaten).',
      defaultCriteria: true,
    });
    const contract = addDocument(db, p1.id, {
      title: 'Liefervertrag NW-2026-114',
      docType: 'contract',
      counterparty: 'Nordwerk Fahrzeugtechnik GmbH',
      reference: 'NW-2026-114',
      amount: 1240000,
      content: CONTRACT,
      date: -6,
    });

    const reqs = contract.requirements;
    const find = (needle: string) => reqs.find((r) => r.text.includes(needle));
    const assign = (needle: string, who: number, due: number, instruction: string, done?: { rating: Rating; response: string }) => {
      const req = find(needle);
      if (!req) return;
      const [task] = store.createTasks(db, { requirementIds: [req.id], assigneeId: who, dueDate: isoDate(due), instruction }, anna.id);
      if (done) store.updateTask(db, task.id, { state: 'done', rating: done.rating, response: done.response });
    };

    assign('Taktzeit', jonas.id, 3, 'Bitte Taktzeit anhand der Simulation bestätigen.', {
      rating: 'accepted',
      response: 'Simulation ergibt 54 s – erfüllbar.',
    });
    assign('Verfügbarkeit', jonas.id, 5, 'Verfügbarkeit 98 % realistisch?', {
      rating: 'accepted_with_comments',
      response: 'Erfüllbar mit Abweichungen: 98 % nur ohne Rüstzeiten und Fremdstörungen. Definition im Vertrag ergänzen.',
    });
    assign('OPC-UA', jonas.id, 7, 'Schnittstellenumfang mit IT klären.');
    assign('Schalldruckpegel', sophie.id, -2, 'Bitte Messwerte der Referenzanlage prüfen.');
    assign('Vertragsstrafe', lena.id, -1, 'Höhe der Vertragsstrafe und Deckelung bewerten.', {
      rating: 'accepted_with_comments',
      response: 'Akzeptabel mit Deckelung auf 5 % und Ausschluss weiterer Schadensersatzansprüche.',
    });
    assign('unbeschränkt', lena.id, 4, 'Haftungsregelung prüfen.', {
      rating: 'declined',
      response: 'Unbeschränkte Haftung nicht versicherbar – Begrenzung auf Auftragswert fordern.',
    });
    assign('Bürgschaft', murat.id, 6, 'Avalrahmen bei der Bank anfragen.');
    assign('Zahlungsziel', murat.id, 2, 'Zahlungsziel 60 Tage mit Finanzbuchhaltung abstimmen.');
    assign('Dokumentation', sophie.id, 10, 'Übersetzungsaufwand abschätzen.', {
      rating: 'accepted',
      response: 'Übersetzung über Dienstleister abgedeckt.',
    });

    const ce = find('Maschinenrichtlinie');
    if (ce) store.updateRequirement(db, ce.id, { status: 'accepted', statusComment: 'Standard bei allen Anlagen.' }, anna.id);
    const plc = find('S7-1500');
    if (plc) store.updateRequirement(db, plc.id, { status: 'accepted' }, anna.id);
    const law = find('Gerichtsstand');
    if (law) store.addComment(db, law.id, lena.id, 'Gerichtsstand Kassel ist für uns unkritisch.');

    // ---------------------------------------------------- Projekt 2: Angebotsvergleich
    const p2 = store.createProject(db, {
      name: 'Angebotsvergleich 5-Achs-Bearbeitungszentrum',
      description: 'Drei Lieferantenangebote im Vergleich, inkl. Auftragsbestätigung des Favoriten (Beispieldaten).',
      defaultCriteria: true,
    });
    const alpha = addDocument(db, p2.id, {
      title: 'Angebot Alpha VX 800',
      docType: 'offer',
      counterparty: 'Alpha Werkzeugmaschinen GmbH',
      reference: 'A-2026-0815',
      amount: 412000,
      content: OFFER_ALPHA,
      date: -20,
    });
    const beta = addDocument(db, p2.id, {
      title: 'Angebot Beta BM 6',
      docType: 'offer',
      counterparty: 'Beta Maschinenbau AG',
      reference: '2026/4471',
      amount: 389500,
      content: OFFER_BETA,
      date: -18,
    });
    const gamma = addDocument(db, p2.id, {
      title: 'Angebot Gamma GX 5',
      docType: 'offer',
      counterparty: 'Gamma CNC-Technik GmbH & Co. KG',
      reference: 'G-0926-33',
      amount: 455000,
      content: OFFER_GAMMA,
      date: -15,
    });
    addDocument(db, p2.id, {
      title: 'Auftragsbestätigung Alpha',
      docType: 'order_confirmation',
      counterparty: 'Alpha Werkzeugmaschinen GmbH',
      reference: 'AB-2026-1192',
      amount: 412000,
      content: ORDER_CONFIRMATION_ALPHA,
      date: -2,
    });

    const project = store.getProject(db, p2.id);
    const criterion = (prefix: string) => project.criteria.find((c) => c.name.startsWith(prefix))!;
    const scoreTable: Array<[string, number, number, number]> = [
      ['Preis', 7, 8, 6],
      ['Liefertermin', 7, 4, 9],
      ['Zahlungsbedingungen', 7, 3, 9],
      ['Gewährleistung', 6, 3, 9],
      ['Haftung', 5, 4, 7],
      ['Technische', 8, 6, 9],
      ['Service', 8, 5, 9],
    ];
    for (const [prefix, a, b, g] of scoreTable) {
      const c = criterion(prefix);
      store.setScore(db, { documentId: alpha.doc.id, criterionId: c.id, score: a, note: undefined });
      store.setScore(db, { documentId: beta.doc.id, criterionId: c.id, score: b, note: undefined });
      store.setScore(db, { documentId: gamma.doc.id, criterionId: c.id, score: g, note: undefined });
    }
    store.setScore(db, {
      documentId: beta.doc.id,
      criterionId: criterion('Preis').id,
      score: 8,
      note: 'Günstigster Preis, aber freibleibend.',
    });

    const rateAll = (requirements: typeof alpha.requirements, decide: (text: string) => Rating) => {
      for (const r of requirements) store.updateRequirement(db, r.id, { status: decide(r.text) }, murat.id);
    };
    rateAll(alpha.requirements, (t) => (t.includes('Folgeschäden') ? 'accepted_with_comments' : 'accepted'));
    rateAll(beta.requirements, (t) =>
      t.includes('freibleibend') || t.includes('Teillieferungen') ? 'declined' : t.includes('12 Monate') || t.includes('ca. 20') ? 'accepted_with_comments' : 'accepted',
    );
    rateAll(gamma.requirements, () => 'accepted');

    return { projectIds: [p1.id, p2.id] };
  });
}
