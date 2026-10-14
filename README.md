# MackContract – Vertragsprüfung

Webanwendung zur Prüfung von **Verträgen, Angeboten und Auftragsbestätigungen**:

- Dokumente hochladen (PDF, Word `.docx`, Text, HTML) oder Text direkt einfügen
- **Anforderungen zeilenweise extrahieren** und als To-do-Liste abarbeiten:
  **Accepted** (erfüllbar), **Accepted with comments** (erfüllbar mit Abweichungen), **Declined** (nicht umsetzbar)
- **Aufgabenverteilung**: einzelne Punkte Personen mit Termin zuweisen, die sie kommentieren und bewerten
- **Gewichtete Bewertung** nach eigenen Kriterien und **Gegenüberstellung** mehrerer Dokumente
- **Textvergleich**, z. B. Angebot ↔ Auftragsbestätigung, mit wortgenauer Markierung der Abweichungen
- CSV-Export (Excel-kompatibel) für Anforderungslisten, Bewertungsmatrix und Aufgaben

Die Oberfläche ist deutschsprachig, funktioniert im Hell- und Dunkelmodus und auf Mobilgeräten.

## Schnellstart

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
8. **Gegenüberstellen:** Unter *Kriterien & Bewertung* die Kriterien gewichten und jedes Dokument mit 0–10 Punkten bewerten. Die *Gegenüberstellung* zeigt Ranking, Kriterienvergleich, Anforderungserfüllung und Eckdaten.

## Bewertungslogik

- **Gesamtwert** = gewichteter Mittelwert aller bewerteten Kriterien (0–10, zusätzlich in Prozent). Ein Kriterium mit Gewicht 0 zählt nicht. Ist die Bewertung unvollständig, wird das Ergebnis als „vorläufig“ mit dem bereits bewerteten Anteil der Gewichtung angezeigt.
- **Automatisches Kriterium „Erfüllung der Anforderungen“:** Accepted = 10, Accepted with comments = 5, Declined = 0 Punkte, gemittelt über alle bewerteten Anforderungen des Dokuments.
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

## Hinweise zum Betrieb

- Die App hat **keine Anmeldung**. Die Personenauswahl dient der Zuordnung von Kommentaren und Aufgaben und ist kein Zugriffsschutz. Betrieb daher nur im internen Netz oder hinter einem Reverse-Proxy mit Authentifizierung (z. B. SSO).
- Es werden keine E-Mail-Benachrichtigungen versendet. Fälligkeiten sind über *Meine Aufgaben*, *Aufgabenverteilung* und die Übersicht sichtbar.

## Entwicklung

```bash
npm test           # Unit- und API-Tests (Vitest + Supertest)
npm run typecheck  # TypeScript-Prüfung
```

```
shared/   Domänentypen, Anforderungsextraktion, Bewertungslogik, Textvergleich (Server + Browser)
server/   Express-API, SQLite-Schema und Datenzugriff, Text-Extraktion aus PDF/DOCX, Beispieldaten
src/      React-Oberfläche (Vite)
tests/    Tests
```
