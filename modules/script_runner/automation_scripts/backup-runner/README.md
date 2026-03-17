# Backup Runner

Copies configured folders to a backup destination, tracking progress in the database.

## Language Variants

This script is available in two languages:

- **JavaScript** (Node.js): `main.js`
- **C#** (.NET): `csharp/Program.cs`

## What it does

1. Reads source folders from `BACKUP_FOLDERS` env var
2. Recursively copies each folder to the backup destination
3. Skips files that already exist with the same size and modification time
4. Preserves file modification timestamps
5. Records a summary row in `backup_history`

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `BACKUP_FOLDERS` | *(required)* | Comma-separated list of absolute folder paths |
| `BACKUP_DEST` | `~/Backups` | Destination directory |

### Run (Node.js)

```bash
BACKUP_FOLDERS="/Users/me/Documents,/Users/me/Projects" BACKUP_DEST="/Volumes/External/Backup" node main.js
```

### Run (C#)

```bash
BACKUP_FOLDERS="/Users/me/Documents,/Users/me/Projects" BACKUP_DEST="/Volumes/External/Backup" dotnet run --project csharp/
```

## Database writes

- `backup_history` — one summary row (folders, files copied/skipped, status)
- `automation_logs` — start, per-folder progress, summary
- `execution_tracking` — start/finish with status
- `errors` — on fatal failure

## Status values

- `SUCCESS` — all folders backed up without error
- `PARTIAL` — some folders failed, others succeeded
- `FAIL` — entire backup failed (logged via execution tracking)

## Audit Documentation

For formal DORA-compliant documentation, see [DOKUMENTATION.md](DOKUMENTATION.md).
