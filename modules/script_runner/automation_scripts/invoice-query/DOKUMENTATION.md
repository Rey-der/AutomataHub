# Invoice Query — DORA-Konforme Dokumentation

**Dokumenten-ID:** AUT-IQ-001
**Version:** 1.0
**Erstellt:** 2026-03-15
**Klassifikation:** Intern — Betriebsdokumentation
**Verantwortlich:** IT-Automatisierung

---

## 1. Zweck und Geltungsbereich

Dieses Skript ermöglicht die **Abfrage gespeicherter Rechnungsdaten**, filterbar nach Lieferant oder Datumsbereich. Es dient der operativen Rechnungseinsicht und Auditierung.

### Regulatorischer Bezug (DORA)
- **Art. 11 (IKT-Risikomanagement):** Nachvollziehbarkeit automatisiert erfasster Finanzdaten
- **Art. 15 (Berichtswesen):** Datengrundlage für finanzrelevante IKT-Berichte
- **Art. 28 (IKT-Drittdienstleister):** Rechnungsdaten zur Überwachung von Dienstleisterkosten

---

## 2. Funktionsbeschreibung

| Eigenschaft | Wert |
|---|---|
| **Skriptname** | `invoice-query` |
| **Sprachen** | JavaScript (Node.js), C# (.NET) |
| **Typ** | Lesend (Read-Only) |
| **Einstiegspunkt JS** | `main.js` |
| **Einstiegspunkt C#** | `csharp/Program.cs` |
| **Ausgabeformat** | JSON via `stdout` |

### Ablauf
1. Umgebungsvariable `SMART_DESKTOP_DB` wird geprüft
2. Filterparameter werden ausgelesen:
   - `VENDOR` → Filterung nach Lieferant
   - `FROM` + `TO` → Filterung nach Datumsbereich
   - Kein Filter → Alle Rechnungen
3. Parametrisierte SQL-Abfrage auf Tabelle `invoices`
4. Ergebnis wird als JSON-Array ausgegeben

---

## 3. Ein- und Ausgabedaten

### Eingabe
| Parameter | Quelle | Pflicht | Beschreibung |
|---|---|---|---|
| `SMART_DESKTOP_DB` | Umgebungsvariable | Ja | Absoluter Pfad zur SQLite-Datenbank |
| `VENDOR` | Umgebungsvariable | Nein | Filterung nach Lieferantenname |
| `FROM` | Umgebungsvariable | Nein | Startdatum (inklusiv, YYYY-MM-DD) |
| `TO` | Umgebungsvariable | Nein | Enddatum (inklusiv, YYYY-MM-DD) |

### Ausgabe (JSON-Felder)
| Feld | Typ | Beschreibung |
|---|---|---|
| `id` | Integer | Primärschlüssel |
| `vendor` | String | Lieferantenname |
| `amount` | Float | Rechnungsbetrag |
| `invoice_date` | String (YYYY-MM-DD) | Rechnungsdatum |
| `file_path` | String | Pfad zur Original-PDF |
| `timestamp` | String (ISO 8601) | Erfassungszeitpunkt |

---

## 4. Datenbankzugriffe

| Tabelle | Zugriffsart | Beschreibung |
|---|---|---|
| `invoices` | SELECT | Alle oder gefilterte Rechnungen |

**Schreibzugriffe:** Keine.

---

## 5. Fehlerbehandlung

| Fehlerbedingung | Verhalten | Exit-Code |
|---|---|---|
| `SMART_DESKTOP_DB` nicht gesetzt | Fehlermeldung, Abbruch | 1 |
| Keine Rechnungen gefunden | Hinweistext mit Filterinfo | 0 |

---

## 6. Sicherheitsaspekte

- **Keine Schreiboperationen**
- **Parametrisierte SQL-Abfragen:** Kein SQL-Injection-Risiko
- **Keine Netzwerkkommunikation**
- **Dateipfade:** Ausgabe enthält lokale Dateipfade — Zugriff beschränken
- **Finanzdaten:** Rechnungsbeträge sind vertraulich — Zugriffsberechtigungen prüfen

---

## 7. Abhängigkeiten

| Komponente | Version | Zweck |
|---|---|---|
| Node.js | ≥ 18.x | Runtime (JS-Variante) |
| .NET SDK | ≥ 8.0 | Runtime (C#-Variante) |
| `better-sqlite3` | via smart_desktop_sql | Datenbankzugriff (JS) |
| `Microsoft.Data.Sqlite` | NuGet | Datenbankzugriff (C#) |

---

## 8. Änderungshistorie

| Version | Datum | Autor | Änderung |
|---|---|---|---|
| 1.0 | 2026-03-15 | IT-Automatisierung | Erstdokumentation inkl. C#-Variante |
