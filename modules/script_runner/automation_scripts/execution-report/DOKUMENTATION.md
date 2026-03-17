# Execution Report — DORA-Konforme Dokumentation

**Dokumenten-ID:** AUT-EXR-001
**Version:** 1.0
**Erstellt:** 2026-03-15
**Klassifikation:** Intern — Betriebsdokumentation
**Verantwortlich:** IT-Automatisierung

---

## 1. Zweck und Geltungsbereich

Dieses Skript zeigt **aktuelle Skriptausführungen** mit Dauer, Status und etwaigen Fehlermeldungen an. Es dient der Nachvollziehbarkeit der Automatisierungsaktivitäten.

### Regulatorischer Bezug (DORA)
- **Art. 10 (Erkennung):** Überwachung der Ausführungshistorie zur Anomalie-Erkennung
- **Art. 11 (IKT-Risikomanagement):** Nachvollziehbarkeit automatisierter Prozesse
- **Art. 15 (Berichtswesen):** Execution-Daten für Compliance-Reports

---

## 2. Funktionsbeschreibung

| Eigenschaft | Wert |
|---|---|
| **Skriptname** | `execution-report` |
| **Sprachen** | JavaScript (Node.js), C# (.NET) |
| **Typ** | Lesend (Read-Only) |
| **Einstiegspunkt JS** | `main.js` |
| **Einstiegspunkt C#** | `csharp/Program.cs` |
| **Ausgabeformat** | JSON via `stdout` |

### Ablauf
1. Umgebungsvariable `SMART_DESKTOP_DB` wird geprüft
2. Optionaler Limit-Parameter wird ausgelesen (Standard: 20)
3. SQL-Abfrage auf `execution_tracking` mit berechneter Dauer in Sekunden
4. Ergebnis wird als JSON-Array ausgegeben

---

## 3. Ein- und Ausgabedaten

### Eingabe
| Parameter | Quelle | Pflicht | Standard | Beschreibung |
|---|---|---|---|---|
| `SMART_DESKTOP_DB` | Umgebungsvariable | Ja | — | Absoluter Pfad zur SQLite-Datenbank |
| Argument 1 | CLI-Argument | Nein | `20` | Maximale Anzahl Einträge |

### Ausgabe (JSON-Felder)
| Feld | Typ | Beschreibung |
|---|---|---|
| `id` | Integer | Primärschlüssel |
| `script` | String | Skriptname |
| `start_time` | String (ISO 8601) | Startzeitpunkt |
| `end_time` | String / null | Endzeitpunkt |
| `status` | String | `RUNNING`, `SUCCESS`, `PARTIAL`, `FAIL` |
| `error_message` | String / null | Fehlermeldung (bei Status FAIL) |
| `duration_seconds` | Float / null | Berechnete Laufzeit in Sekunden |

---

## 4. Datenbankzugriffe

| Tabelle | Zugriffsart | Beschreibung |
|---|---|---|
| `execution_tracking` | SELECT | Letzte N Ausführungen mit berechneter Dauer |

**Schreibzugriffe:** Keine.

---

## 5. Fehlerbehandlung

| Fehlerbedingung | Verhalten | Exit-Code |
|---|---|---|
| `SMART_DESKTOP_DB` nicht gesetzt | Fehlermeldung, Abbruch | 1 |
| Keine Einträge vorhanden | Hinweistext | 0 |

---

## 6. Sicherheitsaspekte

- **Keine Schreiboperationen**
- **Keine Netzwerkkommunikation**
- **Fehlermeldungen** können interne Informationen enthalten — Zugriff beschränken

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
