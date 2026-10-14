# MACK Rides Contract – Vertragsprüfung & Angebotsvergleich

Webanwendung im Erscheinungsbild der MACK Rides CI zur Prüfung von **Verträgen, Angeboten und Auftragsbestätigungen**:

- Dokumente hochladen (PDF, Word `.docx`, Text, HTML) oder Text direkt einfügen
- **Anforderungen zeilenweise extrahieren** und als To-do-Liste abarbeiten:
  **Accepted** (erfüllbar), **Accepted with comments** (erfüllbar mit Abweichungen), **Declined** (nicht umsetzbar)
- **Aufgabenverteilung**: einzelne Punkte Personen mit Termin zuweisen, die sie kommentieren und bewerten
- **Angebotsvergleich**: Konditionen (Lieferzeit, Incoterms, Zahlungsziel, Anzahlung, Skonto, Gewährleistung, Preisbindung,
  Gültigkeit, Vertragsstrafe, Haftung) werden aus den Angebotstexten erkannt und mit Bestwerten gegenübergestellt
- **Preisspiegel** nach Positionen inkl. Übernahme der Preiszeilen aus den Angeboten, „inkl.“/„nicht angeboten“ und Abweichung zum günstigsten Angebot
- **Gewichtete Bewertung** (Nutzwertanalyse): Preis, Lieferzeit, Zahlungsziel, Gewährleistung und Anforderungserfüllung werden automatisch
  gepunktet, weitere Kriterien manuell; K.O.-Kriterien möglich
- **Ergebnis & Empfehlung**: Siegerpodest, Stärken/Schwächen, Punkteverteilung je Kriterium, Vergabeempfehlung mit Begründungsvorschlag
  und druckfertiger Vergabevorschlag
- **Textvergleich**, z. B. Angebot ↔ Auftragsbestätigung, mit wortgenauer Markierung der Abweichungen
- CSV-Export (Excel-kompatibel) für Anforderungslisten, Bewertungsmatrix und Aufgaben

Die Oberfläche ist deutschsprachig, funktioniert im Hell- und Dunkelmodus und auf Mobilgeräten.

## Eigenständige HTML-Datei (ohne Installation)

**[`standalone/MackContract.html`](standalone/MackContract.html)** herunterladen und per Doppelklick im Browser öffnen
(Chrome, Edge, Firefox oder Safari in einer aktuellen Version). Es wird kein Server und keine Installation benötigt.

- Alle Funktionen sind enthalten: Upload und Text-Extraktion aus PDF und Word laufen lokal im Browser.
- Die Daten werden **nur in diesem Browser** gespeichert (IndexedDB). Sie bleiben beim Schließen erhalten, gehen aber verloren,
  wenn die Browserdaten gelöscht werden.
- **Sicherung speichern** (links unten) lädt eine JSON-Datei mit allen Projekten und Originaldateien herunter.
  **Sicherung laden** stellt sie wieder her, auch auf einem anderen Rechner. Auch die Datenbankdatei der Server-Version
  (`data/mackcontract.db`) lässt sich dort laden.
- Für die **gleichzeitige Arbeit im Team** (gemeinsame Aufgabenverteilung) ist die Server-Version gedacht, weil die HTML-Datei
  keine Daten zwischen Rechnern abgleicht.

Neu erzeugen: `npm run build:html` (Ergebnis: `standalone/MackContract.html`).

## Schnellstart (Server-Version)

Voraussetzung: **Node.js 22.13 oder neuer** (verwendet die eingebaute SQLite-Datenbank `node:sqlite`, keine nativen Zusatzpakete).

```bash
npm install
npm run dev
```

- Oberfläche: <http://localhost:5173>
- API: <http://localhost:3001>

Auf der leeren Übersichtsseite legt **„Beispieldaten laden“** zwei Projekte mit fiktiven Firmen und Personen an:
einen Kundenvertrag mit verteilten Prüfaufgaben und einen Angebotsvergleich mit drei Angeboten und einer Auftragsbestätigung.

### Produktivbetrieb

```bash
npm install
npm run build
npm start          # http://localhost:3001 – liefert Oberfläche und API aus
```

| Umgebungsvariable | Standard  | Bedeutung                                        |
| ----------------- | --------- | ------------------------------------------------ |
| `PORT`            | `3001`    | HTTP-Port                                        |
| `HOST`            | `0.0.0.0` | Netzwerkschnittstelle                            |
| `DATA_DIR`        | `./data`  | Ablage für Datenbank (`mackcontract.db`) und Uploads |

**Datensicherung:** Den Ordner `DATA_DIR` bei gestopptem Server kopieren. Er enthält die SQLite-Datenbank und die Originaldateien.

## Arbeitsablauf

1. **Personen anlegen** (Menü *Personen*) und links unten auswählen, wer man selbst ist.
2. **Projekt anlegen**, z. B. „Ausschreibung Fräszentrum“ oder „Kundenvertrag XY“. Standardkriterien werden auf Wunsch mit angelegt.
3. **Dokumente hinzufügen** und dabei den Typ (Vertrag, Angebot, Auftragsbestätigung …), den Vertragspartner, die Referenz und den Betrag angeben.
4. **Anforderungen extrahieren:** Die Vorschau zeigt jede Zeile bzw. jeden Satz mit Klauselnummer, Abschnitt, Kategorie und markierten Pflicht- und Risikoformulierungen. Erkannte Anforderungen sind vorausgewählt; die Auswahl lässt sich vor dem Übernehmen anpassen.
5. **Prüfen:** In der Anforderungsliste wird jeder Punkt direkt bewertet. Bei *Accepted with comments* und *Declined* fragt die App nach einer Begründung. Filter nach Status, Kategorie, Person und Risiken sowie Volltextsuche helfen beim Abarbeiten.
6. **Verteilen:** Einzelne oder mehrere Punkte per Mehrfachauswahl einer Person mit Termin und Arbeitsauftrag zuweisen (in der Liste oder unter *Aufgabenverteilung*).
7. **Bewerten durch die Zuständigen:** Unter *Meine Aufgaben* sieht jede Person ihre Punkte nach Fälligkeit sortiert (überfällig, nächste 7 Tage, später) und gibt Bewertung und Kommentar ab.
8. **Angebote vergleichen** (Menü *Angebotsvergleich* oder Reiter im Projekt):
   - *Angebotsvergleich*: „Konditionen aus Texten erkennen“ füllt Lieferzeit, Zahlungs- und Gewährleistungsbedingungen usw. vor; alle Werte sind
     direkt editierbar, Bestwerte werden grün markiert. Im *Preisspiegel* Positionen anlegen oder per „Positionen aus Angebot übernehmen“
     aus den Preiszeilen der Angebote erzeugen (Zuordnung zu bestehenden Positionen wird vorgeschlagen).
   - *Bewertung*: Kriterien gewichten; automatische Kriterien rechnen relativ zum besten Angebot (z. B. Preis: günstigstes = 10 Punkte,
     andere = 10 × günstigster Preis / eigener Preis), manuelle Kriterien mit 0–10 Punkten bewerten.
   - *Ergebnis & Empfehlung*: Siegerpodest, Punkteverteilung, Kriterienvergleich; Vergabeempfehlung speichern und als Vergabevorschlag drucken.
   - Standardmäßig werden nur Dokumente vom Typ *Angebot* verglichen; „Alle Dokumente“ bezieht z. B. Auftragsbestätigungen mit ein.

## Bewertungslogik

- **Gesamtwert** = gewichteter Mittelwert aller bewerteten Kriterien (0–10, zusätzlich in Prozent). Ein Kriterium mit Gewicht 0 zählt nicht. Ist die Bewertung unvollständig, wird das Ergebnis als „vorläufig“ mit dem bereits bewerteten Anteil der Gewichtung angezeigt.
- **Automatisches Kriterium „Erfüllung der Anforderungen“:** Accepted = 10, Accepted with comments = 5, Declined = 0 Punkte, gemittelt über alle bewerteten Anforderungen des Dokuments.
- **Automatische Kriterien aus dem Angebotsvergleich:** Preis (Summe Preisspiegel, sonst Angebotssumme) und Lieferzeit: Bestwert / eigener Wert × 10;
  Gewährleistung und Zahlungsziel: eigener Wert / Bestwert × 10. Fehlt eine Angabe, bleibt das Kriterium für dieses Angebot unbewertet.
- **K.O.-Kriterien:** Bei manuellen Kriterien führen 0 Punkte zum Ausschluss, beim automatischen Kriterium jede *Declined*-Anforderung. Ausgeschlossene Dokumente werden im Ranking ans Ende sortiert.
- **Status aus Prüfaufgaben:** Solange niemand manuell entschieden hat, übernimmt eine Anforderung das *kritischste* Ergebnis der abgeschlossenen Prüfaufgaben (Declined vor with comments vor Accepted). Eine manuelle Entscheidung hat Vorrang. „Zurücksetzen“ übernimmt wieder das Prüfergebnis.

## Anforderungsextraktion

Die Extraktion läuft lokal im Browser und arbeitet regelbasiert, ohne externe Dienste:

- **Aufteilung:** *Sätze* (empfohlen), *Klauseln* (Absatz bzw. nummerierte Klausel) oder *Textzeilen* (jede Zeile unverändert)
- erkennt Gliederungen wie `1.`, `4.2.1`, `§ 5`, `Art. 3`, `a)` und Aufzählungszeichen sowie Überschriften als Abschnitte
- fügt in PDFs umbrochene Zeilen und Silbentrennungen wieder zusammen und entfernt Seitenzahlen
- bewertet Pflichtformulierungen auf Deutsch und Englisch (*muss, ist … zu, verpflichtet, darf nicht, spätestens, mindestens, shall, must* …) mit einstellbarer Empfindlichkeit
- markiert Risikobegriffe (*Vertragsstrafe, unbeschränkt, ausgeschlossen, freibleibend, Teillieferung, Gerichtsstand* …) und ordnet eine Kategorie zu (Technisch, Kaufmännisch, Termine, Rechtlich, Qualität, Logistik)

Grenzen: Gescannte PDFs enthalten keinen Text und müssen vorher per OCR umgewandelt werden (die App weist darauf hin). Automatische Nummerierungen in Word-Dateien gehen beim Textexport verloren. Der Dokumenttext lässt sich im Reiter *Dokumenttext* nachbearbeiten.

## Erscheinungsbild

Farben, Wortmarke und Bildmarke folgen der MACK Rides CI (Quelle: mack-rides.com; Markenzeichen der MACK Rides GmbH & Co KG).
Die Hausschriften der Website sind lizenzpflichtig; die App nutzt die frei lizenzierten Schriften *Space Grotesk* (Überschriften) und
*Inter* (Text, OFL). Logos liegen unter `src/assets/brand/` bzw. `src/components/brandPaths.ts` und lassen sich durch offizielle
Dateien aus dem Corporate-Design-Portal ersetzen.

## Hinweise zum Betrieb

- Die App hat **keine Anmeldung**. Die Personenauswahl dient der Zuordnung von Kommentaren und Aufgaben und ist kein Zugriffsschutz. Betrieb daher nur im internen Netz oder hinter einem Reverse-Proxy mit Authentifizierung (z. B. SSO).
- Es werden keine E-Mail-Benachrichtigungen versendet. Fälligkeiten sind über *Meine Aufgaben*, *Aufgabenverteilung* und die Übersicht sichtbar.

## Entwicklung

```bash
npm test           # Unit- und API-Tests (Vitest + Supertest)
npm run typecheck  # TypeScript-Prüfung
npm run build:html # eigenständige HTML-Datei bauen
npm run dev:html   # HTML-Version mit Hot Reload entwickeln
```

```
shared/   Domänentypen, Anforderungsextraktion, Bewertungslogik, Textvergleich (Server + Browser)
server/   API-Routen (routes.ts, gemeinsam für Server und HTML-Version), Express-Anbindung, SQLite-Schema
          und Datenzugriff, Text-Extraktion aus PDF/DOCX, Beispieldaten
src/      React-Oberfläche (Vite); src/local/ = Browser-Backend der HTML-Version (sql.js + IndexedDB)
tests/    Tests
```
