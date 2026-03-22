# CSV Processor

Reads CSV files from a configurable directory, validates each row, and outputs a structured summary report.

## Language Variants

This script is available in two languages:

- **JavaScript** (Node.js): `main.js`
- **C#** (.NET): `csharp/Program.cs`

## What it does

1. Reads all `.csv` files from the input directory
2. Detects column headers from the first row of each file
3. Parses rows handling quoted fields (RFC 4180 style)
4. Validates each row:
   - All header columns must have a non-empty value
   - Columns whose header contains "amount", "price", "total", "qty", or "quantity" must be numeric
5. Logs per-file results (valid/invalid counts) to `automation_logs`
6. Stores a summary row per file in the `csv_processing` table
7. Outputs a JSON report to stdout

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `CSV_INPUT_DIR` | `~/Documents/csv-input` | Folder containing `.csv` files to process |

### Run (Node.js)

```bash
CSV_INPUT_DIR="/path/to/csvs" node main.js
```

### Run (C#)

```bash
CSV_INPUT_DIR="/path/to/csvs" dotnet run --project csharp/
```

## Database writes

- `csv_processing` — one summary row per file (filename, rows_total, rows_valid, rows_invalid)
- `automation_logs` — start, per-file outcome, summary
- `execution_tracking` — start/finish with status
- `errors` — on fatal failure
