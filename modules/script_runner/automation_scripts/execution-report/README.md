# Execution Report

Displays recent script executions with duration and status.

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

JSON array of execution records:
- `id`, `script`, `start_time`, `end_time`
- `status` — `RUNNING`, `SUCCESS`, `PARTIAL`, or `FAIL`
- `error_message` — error details if failed
- `duration_seconds` — computed runtime in seconds (null if still running)

Default: last 20 executions. Pass a number as the first argument to override.

## Audit Documentation

For formal DORA-compliant documentation, see [DOKUMENTATION.md](DOKUMENTATION.md).
