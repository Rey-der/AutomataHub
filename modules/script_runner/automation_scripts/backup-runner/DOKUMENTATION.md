# Backup Runner — DORA-Konforme Dokumentation

**Dokumenten-ID:** AUT-BR-001
**Version:** 1.0
**Erstellt:** 2026-03-15
**Klassifikation:** Intern — Betriebsdokumentation
**Verantwortlich:** IT-Automatisierung

---

## 1. Zweck und Geltungsbereich

Dieses Skript führt die **automatisierte Sicherung konfigurierter Verzeichnisse** auf ein definiertes Backup-Ziel durch. Es implementiert eine inkrementelle Kopielogik mit Protokollierung sämtlicher Aktivitäten in der zentralen Datenbank.

### Regulatorischer Bezug (DORA)
- **Art. 11 (IKT-Risikomanagement):** Automatisierte, nachvollziehbare Datensicherung
- **Art. 12 (Backup & Recovery):** Regelmäßige Sicherung mit Statusprotokoll und Fehlerbehandlung
- **Art. 13 (Tests der Wiederherstellbarkeit):** Datengrundlage für Wiederherstellungstests

---

## 2. Funktionsbeschreibung

| Eigenschaft | Wert |
|---|---|
| **Skriptname** | `backup-runner` |
| **Sprachen** | JavaScript (Node.js), C# (.NET) |
| **Typ** | Schreibend (Write) |
| **Einstiegspunkt JS** | `main.js` |
| **Einstiegspunkt C#** | `csharp/Program.cs` |
| **Ausgabeformat** | JSON via `stdout` |

### Ablauf
1. Umgebungsvariablen `SMART_DESKTOP_DB` und `BACKUP_FOLDERS` werden geprüft
2. Alle Quellverzeichnisse werden auf Existenz validiert
3. Execution-Tracking wird gestartet (`RUNNING`)
4. Für jedes Quellverzeichnis:
   - Rekursive Kopie zum Zielverzeichnis
   - Dateien mit identischer Größe und Änderungszeit werden übersprungen
   - Änderungszeitstempel werden beibehalten
5. Zusammenfassung wird in `backup_history` geschrieben
6. Execution-Tracking wird abgeschlossen (`SUCCESS` / `PARTIAL` / `FAIL`)

---

## 3. Ein- und Ausgabedaten

### Eingabe
| Parameter | Quelle | Pflicht | Standard | Beschreibung |
|---|---|---|---|---|
| `SMART_DESKTOP_DB` | Umgebungsvariable | Ja | — | Absoluter Pfad zur SQLite-Datenbank |
| `BACKUP_FOLDERS` | Umgebungsvariable | Ja | — | Kommagetrennte Liste absoluter Verzeichnispfade |
| `BACKUP_DEST` | Umgebungsvariable | Nein | `~/Backups` | Zielverzeichnis für Backups |

### Ausgabe (JSON-Felder)
| Feld | Typ | Beschreibung |
|---|---|---|
| `folders` | Array\<String\> | Namen der gesicherten Ordner |
| `files_copied` | Integer | Anzahl neu kopierter Dateien |
| `files_skipped` | Integer | Anzahl übersprungener Dateien |
| `backup_location` | String | Zielpfad |
| `status` | String | `SUCCESS`, `PARTIAL` oder `FAIL` |

---

## 4. Datenbankzugriffe

| Tabelle | Zugriffsart | Beschreibung |
|---|---|---|
| `backup_history` | INSERT | Zusammenfassung pro Durchlauf |
| `automation_logs` | INSERT | Start-, Fortschritts- und Endmeldungen |
| `execution_tracking` | INSERT, UPDATE | Start-/Endzeit, Status, Fehlermeldung |
| `errors` | INSERT | Bei schwerwiegenden Fehlern |

---

## 5. Fehlerbehandlung

| Fehlerbedingung | Verhalten | Exit-Code |
|---|---|---|
| `SMART_DESKTOP_DB` nicht gesetzt | Fehlermeldung, Abbruch | 1 |
| `BACKUP_FOLDERS` nicht gesetzt | Fehlermeldung, Abbruch | 1 |
| Quellverzeichnis nicht vorhanden | Fehlermeldung, Abbruch | 1 |
| Einzelner Ordner fehlgeschlagen | Status `PARTIAL`, Fortsetzung | 0 |
| Schwerwiegender Fehler | Eintrag in `errors`, Abbruch | 1 |

### Statuswerte
| Status | Bedeutung |
|---|---|
| `SUCCESS` | Alle Verzeichnisse erfolgreich gesichert |
| `PARTIAL` | Mindestens ein Verzeichnis fehlgeschlagen |
| `FAIL` | Gesamter Durchlauf fehlgeschlagen |

---

## 6. Sicherheitsaspekte

- **Dateisystem-Operationen:** Ausschließlich Kopieren (kein Löschen von Quelldaten)
- **Zugriffskontrolle:** Über Dateisystem-Berechtigungen des ausführenden Benutzers
- **Keine Netzwerkkommunikation:** Rein lokale Ausführung
- **Keine Ausführung externer Prozesse:** Kein Shell-Injection-Risiko
- **Datenintegrität:** Größen- und Zeitstempelvergleich vor Überspringen

---

## 7. Abhängigkeiten

| Komponente | Version | Zweck |
|---|---|---|
| Node.js | ≥ 18.x | Runtime (JS-Variante) |
| .NET SDK | ≥ 8.0 | Runtime (C#-Variante) |
| `sql.js` | npm-Abhängigkeit | WASM-basierter Datenbankzugriff (JS) |
| `Microsoft.Data.Sqlite` | NuGet | Datenbankzugriff (C#) |

---

## 8. Betriebshinweise

- **Empfohlene Ausführung:** Täglich per Scheduler (z.B. cron, Aufgabenplanung)
- **Speicherbedarf:** Abhängig vom Volumen der Quellverzeichnisse
- **Monitoring:** Über `dashboard-summary` und `execution-report` Skripte

---

## 9. Änderungshistorie

| Version | Datum | Autor | Änderung |
|---|---|---|---|
| 1.0 | 2026-03-15 | IT-Automatisierung | Erstdokumentation inkl. C#-Variante |
