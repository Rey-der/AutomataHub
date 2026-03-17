# Backup Query

Displays the full backup history from the database, most recent first.

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

JSON array of backup records: `id`, `backup_date`, `folders` (JSON array), `files_copied`, `files_skipped`, `backup_location`, `status`.

## Audit Documentation

For formal DORA-compliant documentation, see [DOKUMENTATION.md](DOKUMENTATION.md).
