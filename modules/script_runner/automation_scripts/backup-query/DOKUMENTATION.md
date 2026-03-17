# Backup Query — DORA-Konforme Dokumentation

**Dokumenten-ID:** AUT-BQ-001
**Version:** 1.0
**Erstellt:** 2026-03-15
**Klassifikation:** Intern — Betriebsdokumentation
**Verantwortlich:** IT-Automatisierung

---

## 1. Zweck und Geltungsbereich

Dieses Skript dient der **Abfrage und Anzeige sämtlicher Backup-Verlaufsdaten** aus der zentralen Smart Desktop SQL-Datenbank. Es ist Bestandteil der internen Automatisierungsinfrastruktur und wird über den Script Runner ausgeführt.

### Regulatorischer Bezug (DORA)
- **Art. 11 (IKT-Risikomanagement):** Nachvollziehbarkeit der Datensicherungshistorie
- **Art. 12 (Backup-Richtlinien):** Auditfähige Abfrage zur Überprüfung von Sicherungsdurchläufen

---

## 2. Funktionsbeschreibung

| Eigenschaft | Wert |
|---|---|
| **Skriptname** | `backup-query` |
| **Sprachen** | JavaScript (Node.js), C# (.NET) |
| **Typ** | Lesend (Read-Only) |
| **Einstiegspunkt JS** | `main.js` |
| **Einstiegspunkt C#** | `csharp/Program.cs` |
| **Ausgabeformat** | JSON via `stdout` |

### Ablauf
1. Umgebungsvariable `SMART_DESKTOP_DB` wird geprüft
2. Datenbankverbindung wird hergestellt (nur lesend)
3. Tabelle `backup_history` wird absteigend nach Datum abgefragt
4. Ergebnis wird als JSON-Array auf `stdout` ausgegeben
5. Datenbankverbindung wird geschlossen

---

## 3. Ein- und Ausgabedaten

### Eingabe
| Parameter | Quelle | Pflicht | Beschreibung |
|---|---|---|---|
| `SMART_DESKTOP_DB` | Umgebungsvariable | Ja | Absoluter Pfad zur SQLite-Datenbank |

### Ausgabe (JSON-Felder)
| Feld | Typ | Beschreibung |
|---|---|---|
| `id` | Integer | Primärschlüssel des Eintrags |
| `backup_date` | String (ISO 8601) | Zeitpunkt des Backups |
| `folders` | JSON-Array | Gesicherte Ordner |
| `files_copied` | Integer | Anzahl kopierter Dateien |
| `files_skipped` | Integer | Anzahl übersprungener Dateien |
| `backup_location` | String | Zielpfad des Backups |
| `status` | String | `SUCCESS`, `PARTIAL` oder `FAIL` |

---

## 4. Datenbankzugriffe

| Tabelle | Zugriffsart | Beschreibung |
|---|---|---|
| `backup_history` | SELECT | Vollständiger Verlauf, absteigend sortiert |

**Schreibzugriffe:** Keine. Dieses Skript ist ausschließlich lesend.

---

## 5. Fehlerbehandlung

| Fehlerbedingung | Verhalten | Exit-Code |
|---|---|---|
| `SMART_DESKTOP_DB` nicht gesetzt | Fehlermeldung auf `stderr`, Abbruch | 1 |
| Datenbank nicht erreichbar | Exception, Abbruch | 1 |
| Keine Einträge vorhanden | Hinweistext auf `stdout` | 0 |

---

## 6. Sicherheitsaspekte

- **Zugriffskontrolle:** Datenbankzugriff erfolgt über Dateisystem-Berechtigung der SQLite-Datei
- **Keine Schreiboperationen:** Kein Risiko der Datenmanipulation
- **Keine Netzwerkkommunikation:** Rein lokale Ausführung
- **Keine Verarbeitung personenbezogener Daten** im Sinne der DSGVO

---

## 7. Abhängigkeiten

| Komponente | Version | Zweck |
|---|---|---|
| Node.js | ≥ 18.x | Runtime (JS-Variante) |
| .NET SDK | ≥ 8.0 | Runtime (C#-Variante) |
| `better-sqlite3` | via smart_desktop_sql | Datenbankzugriff (JS) |
| `Microsoft.Data.Sqlite` | NuGet | Datenbankzugriff (C#) |
| smart_desktop_sql | aktuell | Datenbank und Modell-Schicht |

---

## 8. Änderungshistorie

| Version | Datum | Autor | Änderung |
|---|---|---|---|
| 1.0 | 2026-03-15 | IT-Automatisierung | Erstdokumentation inkl. C#-Variante |
