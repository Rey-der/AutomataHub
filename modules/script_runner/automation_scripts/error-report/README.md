# Error Report

Displays recent errors from the database, most recent first.

## Language Variants

This script is available in two languages:

- **JavaScript** (Node.js): `main.js`
- **C#** (.NET): `csharp/Program.cs`

### Run (Node.js)

```bash
node main.js [limit]
```

### Run (C#)

```bash
dotnet run --project csharp/ [limit]
```

## Output

JSON array of error records: `id`, `script`, `timestamp`, `message`, `stack_trace`.

Default: last 20 errors. Pass a number as the first argument to override.

## Audit Documentation

For formal DORA-compliant documentation, see [DOKUMENTATION.md](DOKUMENTATION.md).
