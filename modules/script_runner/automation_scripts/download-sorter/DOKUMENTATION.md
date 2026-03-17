# Download Sorter — DORA-Konforme Dokumentation

**Dokumenten-ID:** AUT-DLS-001
**Version:** 1.0
**Erstellt:** 2026-03-15
**Klassifikation:** Intern — Betriebsdokumentation
**Verantwortlich:** IT-Automatisierung

---

## 1. Zweck und Geltungsbereich

Dieses Skript sortiert **Dateien im Downloads-Verzeichnis** automatisiert in kategorisierte Unterordner basierend auf Dateierweiterungen. Jede Dateiaktion wird in der zentralen Datenbank protokolliert.

### Regulatorischer Bezug (DORA)
- **Art. 9 (IKT-Systeme und -Werkzeuge):** Automatisierung betrieblicher Dateiverwaltung
- **Art. 11 (IKT-Risikomanagement):** Nachvollziehbare Protokollierung aller Dateioperationen
- **Art. 10 (Erkennung):** Anomalie-Erkennung durch kategorisierte Dateistatistiken

---

## 2. Funktionsbeschreibung

| Eigenschaft | Wert |
|---|---|
| **Skriptname** | `download-sorter` |
| **Sprachen** | JavaScript (Node.js), C# (.NET) |
| **Typ** | Schreibend (Write) — Dateisystem und Datenbank |
| **Einstiegspunkt JS** | `main.js` |
| **Einstiegspunkt C#** | `csharp/Program.cs` |
| **Ausgabeformat** | JSON via `stdout` |

### Ablauf
1. Umgebungsvariablen werden geprüft
2. Downloads-Verzeichnis wird gescannt (nur Dateien, keine versteckten)
3. Jede Datei wird einer Kategorie zugeordnet
4. Datei wird in den Kategorieordner verschoben (oder übersprungen bei Duplikat)
5. Jede Operation wird in `file_processing_records` protokolliert
6. Zusammenfassung wird ausgegeben

### Kategoriezuordnung

| Kategorie | Dateierweiterungen |
|---|---|
| **Images** | .jpg .jpeg .png .gif .webp .svg .bmp .ico .tiff |
| **Documents** | .pdf .doc .docx .xls .xlsx .ppt .pptx .txt .rtf .odt .csv |
| **Archives** | .zip .tar .gz .7z .rar .bz2 .xz .dmg .iso |
| **Audio** | .mp3 .wav .flac .aac .ogg .m4a .wma |
| **Video** | .mp4 .mkv .avi .mov .wmv .flv .webm |
| **Code** | .js .ts .py .rb .go .rs .java .c .cpp .h .css .html .json .xml .yaml .yml .sh .md |
| **Other** | Alle übrigen Erweiterungen |

---

## 3. Ein- und Ausgabedaten

### Eingabe
| Parameter | Quelle | Pflicht | Standard | Beschreibung |
|---|---|---|---|---|
| `SMART_DESKTOP_DB` | Umgebungsvariable | Ja | — | Absoluter Pfad zur SQLite-Datenbank |
| `DOWNLOADS_DIR` | Umgebungsvariable | Nein | `~/Downloads` | Quellverzeichnis |
| `DRY_RUN` | Umgebungsvariable | Nein | `0` | `1` = Simulation ohne Dateibewegung |

### Ausgabe (JSON-Felder)
| Feld | Typ | Beschreibung |
|---|---|---|
| `sorted` | Integer | Anzahl sortierter Dateien |
| `skipped` | Integer | Anzahl übersprungener Dateien |
| `categoryCounts` | Object | Aufschlüsselung nach Kategorie |

---

## 4. Datenbankzugriffe

| Tabelle | Zugriffsart | Beschreibung |
|---|---|---|
| `file_processing_records` | INSERT | Ein Eintrag pro verarbeiteter Datei |
| `automation_logs` | INSERT | Start-, Fortschritts- und Endmeldungen |
| `execution_tracking` | INSERT, UPDATE | Start-/Endzeit, Status |
| `errors` | INSERT | Bei schwerwiegenden Fehlern |

---

## 5. Fehlerbehandlung

| Fehlerbedingung | Verhalten | Exit-Code |
|---|---|---|
| `SMART_DESKTOP_DB` nicht gesetzt | Fehlermeldung, Abbruch | 1 |
| Downloads-Verzeichnis nicht vorhanden | Fehlermeldung, Abbruch | 1 |
| Zieldatei bereits vorhanden | Übersprungen, als `skip` protokolliert | 0 |
| Schwerwiegender Fehler | Eintrag in `errors`, Abbruch | 1 |

---

## 6. Sicherheitsaspekte

- **Dateibewegung:** `rename` / `File.Move` — kein Kopieren und Löschen
- **DRY_RUN-Modus:** Simulation ohne Dateisystemänderungen
- **Keine Verarbeitung von Dateiinhalten:** Nur Metadaten (Name, Erweiterung)
- **Keine Netzwerkkommunikation:** Rein lokale Ausführung
- **Versteckte Dateien** (`.`-Prefix) werden übersprungen

---

## 7. Abhängigkeiten

| Komponente | Version | Zweck |
|---|---|---|
| Node.js | ≥ 18.x | Runtime (JS-Variante) |
| .NET SDK | ≥ 8.0 | Runtime (C#-Variante) |
| `better-sqlite3` | via smart_desktop_sql | Datenbankzugriff (JS) |
| `Microsoft.Data.Sqlite` | NuGet | Datenbankzugriff (C#) |
| smart_desktop_sql | aktuell | Datenbank, Modelle, Logger, Validierung |

---

## 8. Betriebshinweise

- **Typische Ausführung:** Manuell bei Bedarf oder per Scheduler
- **Auswirkung:** Dateien werden unwiderruflich verschoben (kein Rückgängig)
- **Empfehlung:** Erstlauf mit `DRY_RUN=1` zur Überprüfung

---

## 9. Änderungshistorie

| Version | Datum | Autor | Änderung |
|---|---|---|---|
| 1.0 | 2026-03-15 | IT-Automatisierung | Erstdokumentation inkl. C#-Variante |
