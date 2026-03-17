# Error Report — DORA-Konforme Dokumentation

**Dokumenten-ID:** AUT-ER-001
**Version:** 1.0
**Erstellt:** 2026-03-15
**Klassifikation:** Intern — Betriebsdokumentation
**Verantwortlich:** IT-Automatisierung

---

## 1. Zweck und Geltungsbereich

Dieses Skript zeigt die **letzten Fehlermeldungen** aller Automatisierungsskripte an. Es dient der operativen Fehlerüberwachung und stellt eine auditfähige Abfragefunktion bereit.

### Regulatorischer Bezug (DORA)
- **Art. 10 (Erkennung anomaler Aktivitäten):** Schnellzugriff auf aktuelle Fehlermeldungen
- **Art. 17 (IKT-Vorfallmanagement):** Datengrundlage für Incident-Erkennung und -Analyse
- **Art. 15 (Berichtswesen):** Fehlerdaten für IKT-Statusberichte

---

## 2. Funktionsbeschreibung

| Eigenschaft | Wert |
|---|---|
| **Skriptname** | `error-report` |
| **Sprachen** | JavaScript (Node.js), C# (.NET) |
| **Typ** | Lesend (Read-Only) |
| **Einstiegspunkt JS** | `main.js` |
| **Einstiegspunkt C#** | `csharp/Program.cs` |
| **Ausgabeformat** | JSON via `stdout` |

### Ablauf
1. Umgebungsvariable `SMART_DESKTOP_DB` wird geprüft
2. Optionaler Limit-Parameter wird ausgelesen (Standard: 20)
3. Tabelle `errors` wird absteigend nach Zeitstempel abgefragt
4. Ergebnis wird als JSON-Array ausgegeben

---

## 3. Ein- und Ausgabedaten

### Eingabe
| Parameter | Quelle | Pflicht | Standard | Beschreibung |
|---|---|---|---|---|
| `SMART_DESKTOP_DB` | Umgebungsvariable | Ja | — | Absoluter Pfad zur SQLite-Datenbank |
| Argument 1 | CLI-Argument | Nein | `20` | Maximale Anzahl anzuzeigender Fehler |

### Ausgabe (JSON-Felder)
| Feld | Typ | Beschreibung |
|---|---|---|
| `id` | Integer | Primärschlüssel |
| `script` | String | Name des verursachenden Skripts |
| `message` | String | Fehlermeldung |
| `stack_trace` | String | Stack-Trace (sofern verfügbar) |
| `timestamp` | String (ISO 8601) | Zeitpunkt des Fehlers |

---

## 4. Datenbankzugriffe

| Tabelle | Zugriffsart | Beschreibung |
|---|---|---|
| `errors` | SELECT | Letzte N Fehler, absteigend nach Zeitstempel |

**Schreibzugriffe:** Keine.

---

## 5. Fehlerbehandlung

| Fehlerbedingung | Verhalten | Exit-Code |
|---|---|---|
| `SMART_DESKTOP_DB` nicht gesetzt | Fehlermeldung, Abbruch | 1 |
| Keine Fehlereinträge vorhanden | Hinweistext | 0 |

---

## 6. Sicherheitsaspekte

- **Keine Schreiboperationen**
- **Keine Netzwerkkommunikation**
- **Stack-Traces** können interne Pfade enthalten — Zugriff auf autorisierte Nutzer beschränken

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
