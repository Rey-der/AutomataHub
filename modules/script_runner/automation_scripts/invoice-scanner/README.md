# Invoice Scanner

Scans a folder for PDF invoices, extracts vendor/amount/date, and stores the data in the database.

## Language Variants

This script is available in two languages:

- **JavaScript** (Node.js): `main.js`
- **C#** (.NET): `csharp/Program.cs`

## What it does

1. Reads all `.pdf` files from the configured invoice directory
2. Extracts text content from each PDF (text-based PDFs only)
3. Searches for a monetary amount (e.g. `$123.45`, `€99,00`, `1234.56`)
4. Searches for a date (YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY)
5. Derives vendor name from the filename
6. Validates and inserts each extracted invoice into the database
7. Skips files where no amount can be found

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `INVOICE_DIR` | `~/Documents/Invoices` | Folder to scan for PDFs |

### Run (Node.js)

```bash
node main.js
```

### Run (C#)

```bash
dotnet run --project csharp/
```

## Database writes

- `invoices` — one row per successfully extracted PDF
- `automation_logs` — start, per-file outcome, summary
- `execution_tracking` — start/finish with status
- `errors` — on fatal failure

## Limitations

- Extracts text from text-based PDFs only (not scanned image PDFs)
- Amount detection uses simple regex patterns — may miss unusual formats
- Vendor name is derived from the filename, not the PDF content

## Audit Documentation

For formal DORA-compliant documentation, see [DOKUMENTATION.md](DOKUMENTATION.md).
