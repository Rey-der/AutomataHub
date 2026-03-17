# Dashboard Summary

Displays aggregated statistics for the Smart Desktop automation system.

## Language Variants

This script is available in two languages:

- **JavaScript** (Node.js): `main.js`
- **C#** (.NET): `csharp/Program.cs`

### Run (Node.js)

```bash
node main.js
```

### Run (C#)

```bash
dotnet run --project csharp/
```

## Output

JSON object with:
- `date` — today's date
- `files_sorted_today` — files processed today
- `total_invoices` — total stored invoices
- `automations_today` — automation log entries today
- `executions_today` — script executions today
- `errors_today` — errors logged today
- `last_backup` — most recent backup (date, status, files copied/skipped) or null

## Audit Documentation

For formal DORA-compliant documentation, see [DOKUMENTATION.md](DOKUMENTATION.md).
