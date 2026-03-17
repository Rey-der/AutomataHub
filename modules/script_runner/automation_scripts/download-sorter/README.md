# Download Sorter

Sorts files in `~/Downloads` into categorised subfolders (Images, Documents, Archives, Audio, Video, Code, Other).

## Language Variants

This script is available in two languages:

- **JavaScript** (Node.js): `main.js`
- **C#** (.NET): `csharp/Program.cs`

## What it does

1. Scans all non-hidden files in the Downloads directory
2. Categorises each file by extension
3. Moves the file into a subfolder matching its category
4. Skips files that already exist at the destination
5. Records every file operation in `file_processing_records`
6. Logs a summary to `automation_logs`

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DOWNLOADS_DIR` | `~/Downloads` | Source folder to sort |
| `DRY_RUN` | (unset) | Set to `1` to preview without moving files |

### Run (Node.js)

```bash
node main.js
```

### Run (C#)

```bash
dotnet run --project csharp/
```

## Database writes

- `file_processing_records` — one row per file (operation: `sort` or `skip`)
- `automation_logs` — start, summary, and any errors
- `execution_tracking` — start/finish with status
- `errors` — on fatal failure

## Audit Documentation

For formal DORA-compliant documentation, see [DOKUMENTATION.md](DOKUMENTATION.md).
