# Automation Scripts

This folder contains the bundled automation library shipped with the
**Script Runner** module in AutomataHub.

Each script lives in its own folder, can expose one or more runnable variants,
and reads or writes operational data through the shared SQLite database using
`sql.js` in JavaScript and `Microsoft.Data.Sqlite` in C#.

---

## Prerequisites

| Requirement | Details |
|---|---|
| **AutomataHub** | Installed with `npm install` completed |
| **Node.js** | v22+ |
| **.NET SDK** | v8.0+ (for C# variants only) |
| **SMART_DESKTOP_DB** | Set automatically by the Script Runner module, or set manually for CLI use |

### Database resolution

When scripts run inside AutomataHub, the `SMART_DESKTOP_DB` environment variable
is set automatically by the Script Runner module, pointing to `data/smart_desktop.db`
in the project root. For manual CLI use:

```bash
export SMART_DESKTOP_DB="/path/to/AutomataHub/data/smart_desktop.db"
```

---

## Bundled Scripts

| Script | Type | Purpose |
|---|---|---|
| `api-health-check` | Monitoring | Probe configured HTTP endpoints and persist status, latency, and failures |
| `backup-query` | Query | Read stored backup history from SQLite |
| `backup-runner` | Automation | Copy configured folders to a backup target and log the run |
| `csv-processor` | Automation | Validate CSV files, summarize rows, and persist processing metrics |
| `dashboard-summary` | Query | Aggregate execution, backup, invoice, and processing KPIs |
| `download-sorter` | Automation | Categorize and move files out of the Downloads folder |
| `error-report` | Query | Review recent automation errors and stack traces |
| `execution-report` | Query | Inspect execution history, durations, and outcomes |
| `invoice-query` | Query | Search stored invoices by vendor or date range |
| `invoice-scanner` | Automation | Extract invoice data from documents and store it in SQLite |

## Architecture

Scripts use a shared helper library in `_lib/`:

```
automation_scripts/
├── _lib/                  -- Shared helpers (db, output, tracker)
│   ├── db.js              -- Database connection via sql.js (WASM)
│   ├── output.js          -- JSON output formatting
│   └── tracker.js         -- Execution tracking and logging
├── README.md              -- This file
├── api-health-check/      -- Monitoring: endpoint health checks
├── backup-query/          -- Query: backup history
├── backup-runner/         -- Automation: copies folders, logs to DB
├── csv-processor/         -- Automation: validates CSV files and stores summaries
├── dashboard-summary/     -- Query: aggregated statistics
├── download-sorter/       -- Automation: sorts Downloads folder, logs to DB
├── error-report/          -- Query: recent errors
├── execution-report/      -- Query: script executions with duration
├── invoice-query/         -- Query: stored invoices (filterable)
└── invoice-scanner/       -- Automation: scans PDF invoices, logs to DB
```

### Why sql.js instead of better-sqlite3?

Scripts are spawned as Node.js child processes by the Script Runner module.
The `better-sqlite3` native binary in `node_modules` is compiled for Electron's
architecture target, which is incompatible with regular Node.js. `sql.js` is a
pure WASM implementation that works in any environment.

Some script folders also ship a `csharp/` variant. Script Runner can discover
and run either variant from the same script folder, depending on the selected
implementation.

### Shared library (`_lib/`)

| File | Exports | Purpose |
|---|---|---|
| `db.js` | `openDatabase()` | Opens the DB, creates tables if missing, returns query helpers |
| `output.js` | `printJSON(data)` | Formats and prints JSON to stdout |
| `tracker.js` | `runTracked(db, name, fn)` | Wraps script execution with logging and tracking |

All scripts follow this async pattern:

```js
const { openDatabase } = require('../_lib/db');
const { printJSON } = require('../_lib/output');

(async () => {
  const db = await openDatabase();
  try {
    const rows = db.all('SELECT * FROM errors ORDER BY timestamp DESC LIMIT 10');
    printJSON(rows);
  } finally {
    db.close();
  }
})();
```

Write scripts add execution tracking:

```js
const { runTracked } = require('../_lib/tracker');

const result = runTracked(db, 'my-script', (log) => {
  log('INFO', 'Starting...');
  // ... do work, db.run('INSERT ...') ...
  log('SUCCESS', 'Done');
  return { key: 'value' };
});
```

---

## Script Categories

### Query scripts (read-only)

| Script | Output |
|---|---|
| `invoice-query` | Invoices (all, by vendor, or by date range) |
| `backup-query` | Backup history, newest first |
| `error-report` | Recent errors with stack traces |
| `dashboard-summary` | Aggregated daily stats |
| `execution-report` | Script executions with duration |

### Write scripts (automation)

| Script | What it does |
|---|---|
| `api-health-check` | Pings configured endpoints and records response health and latency |
| `download-sorter` | Sorts files from ~/Downloads into categorised folders |
| `invoice-scanner` | Scans PDF invoices and extracts vendor/amount/date |
| `backup-runner` | Copies configured folders to a backup location |
| `csv-processor` | Parses CSV files, validates rows, and stores per-file summaries |

Write scripts wrap their work in execution tracking, log every action to
`automation_logs`, record errors to the `errors` table, and use parameterized
queries exclusively.

---

## Database Tables

All tables are created automatically on first use by `_lib/db.js`:

| Table | Used by |
|---|---|
| `automation_logs` | All write scripts (via tracker) |
| `execution_tracking` | All write scripts (via tracker), execution-report |
| `errors` | All write scripts, error-report |
| `backup_history` | backup-runner, backup-query, dashboard-summary |
| `file_processing_records` | download-sorter, dashboard-summary |
| `invoices` | invoice-scanner, invoice-query, dashboard-summary |
| `csv_processing` | csv-processor |

---

## Security Notes

- All DB access uses parameterized queries
- No secrets are stored in these scripts
- The database file is in `.gitignore` and never committed
- Write scripts validate inputs before any INSERT
