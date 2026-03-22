# Invoice Scanner — DORA-Konforme Dokumentation

**Dokumenten-ID:** AUT-IS-001
**Version:** 1.0
**Erstellt:** 2026-03-15
**Klassifikation:** Intern — Betriebsdokumentation
**Verantwortlich:** IT-Automatisierung

---

## 1. Zweck und Geltungsbereich

Dieses Skript scannt ein konfiguriertes Verzeichnis nach **PDF-Rechnungen**, extrahiert automatisiert Lieferant, Betrag und Datum und speichert die Ergebnisse in der zentralen Datenbank. Es bildet die Grundlage der automatisierten Rechnungserfassung.

### Regulatorischer Bezug (DORA)
- **Art. 11 (IKT-Risikomanagement):** Automatisierte, protokollierte Datenerfassung
- **Art. 15 (Berichtswesen):** Rechnungsdaten für IKT-Kostenberichte
- **Art. 28 (IKT-Drittdienstleister):** Erfassung von Dienstleisterrechnungen

---

## 2. Funktionsbeschreibung

| Eigenschaft | Wert |
|---|---|
| **Skriptname** | `invoice-scanner` |
| **Sprachen** | JavaScript (Node.js), C# (.NET) |
| **Typ** | Schreibend (Write) |
| **Einstiegspunkt JS** | `main.js` |
| **Einstiegspunkt C#** | `csharp/Program.cs` |
| **Ausgabeformat** | JSON via `stdout` |

### Ablauf
1. Umgebungsvariable `SMART_DESKTOP_DB` wird geprüft
2. Rechnungsverzeichnis wird ermittelt (`INVOICE_DIR` oder Standard)
3. Execution-Tracking wird gestartet
4. Für jede PDF-Datei:
   a. Binärinhalt wird gelesen
   b. Textextraktion aus PDF-Textströmen (BT/ET-Blöcke)
   c. Lieferantenname wird aus Dateinamen abgeleitet
   d. Betrag wird per Regex extrahiert ($, €, £ oder Dezimalzahl)
   e. Datum wird per Regex extrahiert (ISO, DD.MM.YYYY, DD/MM/YYYY)
   f. Eintrag wird in Tabelle `invoices` geschrieben
5. Zusammenfassung wird ausgegeben

### Extraktionsstrategie

| Feld | Methode | Fallback |
|---|---|---|
| **Lieferant** | Erstes Wort des Dateinamens (bereinigt) | Vollständiger Dateiname |
| **Betrag** | Erstes Währungsmuster im Text | Übersprungen wenn nicht gefunden |
| **Datum** | Erstes Datumsmuster im Text | Aktuelles Datum |

**Einschränkung:** Textbasierte PDFs werden unterstützt. Gescannte Bilder (OCR) erfordern eine erweiterte Bibliothek.

---

## 3. Ein- und Ausgabedaten

### Eingabe
| Parameter | Quelle | Pflicht | Standard | Beschreibung |
|---|---|---|---|---|
| `SMART_DESKTOP_DB` | Umgebungsvariable | Ja | — | Absoluter Pfad zur SQLite-Datenbank |
| `INVOICE_DIR` | Umgebungsvariable | Nein | `~/Documents/Invoices` | Verzeichnis mit PDF-Rechnungen |

### Ausgabe (JSON-Felder)
| Feld | Typ | Beschreibung |
|---|---|---|
| `scanned` | Integer | Anzahl gescannter PDFs |
| `extracted` | Integer | Erfolgreich extrahierte Rechnungen |
| `failed` | Integer | Fehlgeschlagene Extraktionen |

---

## 4. Datenbankzugriffe

| Tabelle | Zugriffsart | Beschreibung |
|---|---|---|
| `invoices` | INSERT | Ein Eintrag pro erfolgreich extrahierter Rechnung |
| `automation_logs` | INSERT | Start, Einzelergebnisse, Zusammenfassung |
| `execution_tracking` | INSERT, UPDATE | Start-/Endzeit, Status |
| `errors` | INSERT | Bei schwerwiegenden Fehlern |

---

## 5. Fehlerbehandlung

| Fehlerbedingung | Verhalten | Exit-Code |
|---|---|---|
| `SMART_DESKTOP_DB` nicht gesetzt | Fehlermeldung, Abbruch | 1 |
| Rechnungsverzeichnis nicht vorhanden | Hinweistext, reguläres Ende | 0 |
| Kein Betrag in PDF gefunden | Datei übersprungen, protokolliert | 0 |
| PDF nicht lesbar | Übersprungen, als Fehler protokolliert | 0 |
| Schwerwiegender Fehler | Eintrag in `errors`, Abbruch | 1 |

---

## 6. Sicherheitsaspekte

- **Dateilese-Zugriff:** Nur lesend auf PDF-Dateien
- **Keine Ausführung externer Prozesse:** Kein Shell-/Command-Injection-Risiko
- **Keine Netzwerkkommunikation:** Rein lokale Verarbeitung
- **Finanzdaten:** Extrahierte Beträge und Lieferantennamen sind vertraulich
- **Parametrisierte SQL-Abfragen:** Kein SQL-Injection-Risiko
- **Reguläre Ausdrücke:** Werden auf extrahierten Text angewandt (keine ReDoS-Gefahr durch begrenzte Eingabelänge)

---

## 7. Abhängigkeiten

| Komponente | Version | Zweck |
|---|---|---|
| Node.js | ≥ 18.x | Runtime (JS-Variante) |
| .NET SDK | ≥ 8.0 | Runtime (C#-Variante) |
| `sql.js` | npm-Abhängigkeit | WASM-basierter Datenbankzugriff (JS) |
| `Microsoft.Data.Sqlite` | NuGet | Datenbankzugriff (C#) |

---

## 8. Bekannte Einschränkungen

| Einschränkung | Beschreibung | Empfohlene Maßnahme |
|---|---|---|
| Nur textbasierte PDFs | Gescannte Dokumente werden nicht erkannt | OCR-Bibliothek integrieren |
| Einfache Betragsextraktion | Erstes Währungsmuster wird verwendet | Manuelle Prüfung bei Mehrdeutigkeit |
| Lieferant aus Dateinamen | Keine Textanalyse des Inhalts | Konsistente Dateinamenkonvention verwenden |

---

## 9. Änderungshistorie

| Version | Datum | Autor | Änderung |
|---|---|---|---|
| 1.0 | 2026-03-15 | IT-Automatisierung | Erstdokumentation inkl. C#-Variante |
