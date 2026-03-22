# Dashboard Summary — DORA-Konforme Dokumentation

**Dokumenten-ID:** AUT-DS-001
**Version:** 1.0
**Erstellt:** 2026-03-15
**Klassifikation:** Intern — Betriebsdokumentation
**Verantwortlich:** IT-Automatisierung

---

## 1. Zweck und Geltungsbereich

Dieses Skript erstellt eine **aggregierte Übersicht** aller relevanten Betriebskennzahlen für das Smart Desktop Dashboard. Es dient als zentrale Statusanzeige für den aktuellen Betriebstag.

### Regulatorischer Bezug (DORA)
- **Art. 10 (Erkennung anomaler Aktivitäten):** Tagesaktuelle Fehler- und Ausführungsstatistiken
- **Art. 11 (IKT-Risikomanagement):** Übersicht über Backup-Status und Automatisierungslauf
- **Art. 15 (Berichtswesen):** Grundlage für regelmäßige IKT-Statusberichte

---

## 2. Funktionsbeschreibung

| Eigenschaft | Wert |
|---|---|
| **Skriptname** | `dashboard-summary` |
| **Sprachen** | JavaScript (Node.js), C# (.NET) |
| **Typ** | Lesend (Read-Only) |
| **Einstiegspunkt JS** | `main.js` |
| **Einstiegspunkt C#** | `csharp/Program.cs` |
| **Ausgabeformat** | JSON via `stdout` |

### Ablauf
1. Umgebungsvariable `SMART_DESKTOP_DB` wird geprüft
2. Aktuelles Datum (UTC, `YYYY-MM-DD`) wird ermittelt
3. Sechs aggregierte Kennzahlen werden per SQL abgefragt
4. Ergebnis wird als JSON-Objekt auf `stdout` ausgegeben

---

## 3. Ein- und Ausgabedaten

### Eingabe
| Parameter | Quelle | Pflicht | Beschreibung |
|---|---|---|---|
| `SMART_DESKTOP_DB` | Umgebungsvariable | Ja | Absoluter Pfad zur SQLite-Datenbank |

### Ausgabe (JSON-Felder)
| Feld | Typ | Beschreibung |
|---|---|---|
| `date` | String (YYYY-MM-DD) | Referenzdatum |
| `files_sorted_today` | Integer | Heute sortierte Dateien |
| `total_invoices` | Integer | Gesamtanzahl gespeicherter Rechnungen |
| `automations_today` | Integer | Heutige Automatisierungslog-Einträge |
| `executions_today` | Integer | Heutige Skriptausführungen |
| `errors_today` | Integer | Heutige Fehlermeldungen |
| `last_backup` | Object / null | Letztes Backup (Datum, Status, Dateien) |

---

## 4. Datenbankzugriffe

| Tabelle | Abfrage | Beschreibung |
|---|---|---|
| `file_processing_records` | COUNT WHERE timestamp | Heute verarbeitete Dateien |
| `invoices` | COUNT | Gesamtanzahl Rechnungen |
| `automation_logs` | COUNT WHERE timestamp | Heutige Logeinträge |
| `errors` | COUNT WHERE timestamp | Heutige Fehler |
| `execution_tracking` | COUNT WHERE start_time | Heutige Ausführungen |
| `backup_history` | SELECT TOP 1 DESC | Letztes Backup |

**Schreibzugriffe:** Keine. Dieses Skript ist ausschließlich lesend.

---

## 5. Fehlerbehandlung

| Fehlerbedingung | Verhalten | Exit-Code |
|---|---|---|
| `SMART_DESKTOP_DB` nicht gesetzt | Fehlermeldung auf `stderr`, Abbruch | 1 |
| Datenbank nicht erreichbar | Exception, Abbruch | 1 |
| Tabelle nicht vorhanden | SQLite-Fehler, Abbruch | 1 |

---

## 6. Sicherheitsaspekte

- **Keine Schreiboperationen:** Reines Reporting
- **Keine Netzwerkkommunikation:** Rein lokale Ausführung
- **Parametrisierte Abfragen:** Kein SQL-Injection-Risiko
- **Keine Verarbeitung personenbezogener Daten**

---

## 7. Abhängigkeiten

| Komponente | Version | Zweck |
|---|---|---|
| Node.js | ≥ 18.x | Runtime (JS-Variante) |
| .NET SDK | ≥ 8.0 | Runtime (C#-Variante) |
| `sql.js` | npm-Abhängigkeit | WASM-basierter Datenbankzugriff (JS) |
| `Microsoft.Data.Sqlite` | NuGet | Datenbankzugriff (C#) |

---

## 8. Änderungshistorie

| Version | Datum | Autor | Änderung |
|---|---|---|---|
| 1.0 | 2026-03-15 | IT-Automatisierung | Erstdokumentation inkl. C#-Variante |
