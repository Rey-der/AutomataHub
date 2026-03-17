# Automation Scripts — Integration Guide

This folder contains all automation scripts designed to run inside
[script_runner](https://github.com/Rey-der/script_runner).
They read from and write to the **Smart Desktop SQL** database.

---

## Prerequisites

| Requirement | Details |
|---|---|
| **script_runner** | Cloned and working — see its own README |
| **Node.js** | v18+ (v20+ recommended for `better-sqlite3`) — required for JavaScript variants |
| **.NET SDK** | v8.0+ — required for C# variants |
| **smart_desktop_sql** | Project set up with `npm install` completed and database initialised via the `db-setup` script |
| **SMART_DESKTOP_DB** | Environment variable pointing to the database file (absolute path) |

### Setting the environment variable

Add to `~/.zshrc` (or equivalent):

```bash
export SMART_DESKTOP_DB="/Users/<you>/path/to/smart_desktop_sql/data/smart_desktop.db"
```

Reload with `source ~/.zshrc`. Every script in this folder reads this variable to locate the database — no hardcoded paths.

---

## Folder Structure

Each script is a self-contained folder with both JavaScript and C# variants:

```
automation_scripts/
├── README.md              ← This file
├── log-query/             ← Query: latest automation log entries
│   ├── main.js            ← JavaScript variant
│   ├── config.json
│   ├── README.md
│   ├── DOKUMENTATION.md   ← DORA-compliant formal docs
│   └── csharp/            ← C# variant
│       ├── Program.cs
│       └── config.json
├── invoice-query/         ← Query: stored invoices (filterable)
├── backup-query/          ← Query: backup history
├── error-report/          ← Query: recent errors
├── dashboard-summary/     ← Query: aggregated statistics
├── execution-report/      ← Query: script executions with duration
├── download-sorter/       ← Write: sorts Downloads folder → DB
├── invoice-scanner/       ← Write: scans PDF invoices → DB
└── backup-runner/         ← Write: copies folders → DB
```

### Required files per script

| File | Purpose |
|---|---|
| `main.js` | JavaScript entry point |
| `csharp/Program.cs` | C# entry point |
| `config.json` | Metadata (top-level, references `main.js`) |
| `csharp/config.json` | C# metadata (references `Program.cs`) |
| `README.md` | Human-readable description of both variants |
| `DOKUMENTATION.md` | Formal DORA-compliant audit documentation |

### config.json format

**JavaScript variant** (root level):
```json
{
  "Language Variants

All scripts are implemented in two languages: **JavaScript** and **C#**.

### Running JavaScript variant

```bash
# Query scripts
node log-query/main.js

# Write scripts
BACKUP_FOLDERS="/path/to/folder" node backup-runner/main.js
```

### Running C# variant

```bash
# Query scripts
dotnet run --project log-query/csharp/

# Write scripts
BACKUP_FOLDERS="/path/to/folder" dotnet run --project backup-runner/csharp/
```

Both variants:
- Communicate with the same SQLite database
- Use identical environment variables
- Produce identical JSON output
- Support the same command-line arguments

---

## How Scripts Resolve the Database

### JavaScript variant

Derives the **smart_desktop_sql project root** from the env var:

```js
const dbPath = process.env.SMART_DESKTOP_DB;
// dbPath = /…/smart_desktop_sql/data/smart_desktop.db
const projectRoot = path.dirname(path.dirname(dbPath));
// projectRoot = /…/smart_desktop_sql
```

Then requires models and utilities from the project:

```js
const automationLog = require(path.join(projectRoot, 'src', 'models', 'automationLog'));
const { printJSON }  = require(path.join(projectRoot, 'src', 'utils', 'output'));
const { closeDb }    = require(path.join(projectRoot, 'src', 'utils', 'db'));
```

**No npm dependencies** inside `automation_scripts/` — everything resolves back to `smart_desktop_sql/node_modules/`.

### C# variant

Uses NuGet packages (`Microsoft.Data.Sqlite`) for database access. Both variants write identical data to the database and read the same tables

```js
const dbPath = process.env.SMART_DESKTOP_DB;
// dbPath = /…/smart_desktop_sql/data/smart_desktop.db
const projectRoot = path.dirname(path.dirname(dbPath));
// projectRoot = /…/smart_desktop_sql
```

Then requires models and utilities from the project:

```js
const automationLog = require(path.join(projectRoot, 'src', 'models', 'automationLog'));
const { printJSON }  = require(path.join(projectRoot, 'src', 'utils', 'output'));
const { closeDb }    = require(path.join(projectRoot, 'src', 'utils', 'db'));
```

This means **no npm dependencies are needed inside `automation_scripts/`** — everything resolves back to `smart_desktop_sql/node_modules/`.

---

## Integrating with script_runner

1. Copy (or symlink) the desired script folders into script_runner's `scripts/` directory.
2. Restart script_runner — it auto-discovers any folder containing a `config.json` + supported `main.*` file.
3. The scripts appear in the UI and can be run with one click.

### Examples

**Symlink JavaScript variant:**
```bash
ln -s /path/to/automation_scripts/log-query /path/to/script_runner/scripts/log-query
```

**Copy C# variant separately:**
```bash
cp -r /path/to/automation_scripts/log-query/csharp /path/to/script_runner/scripts/log-query-csharp
```

---

## Script Categories

### Query scripts (read-only)

Read from the database and output JSON to stdout. Safe to run at any time.

| Script | Output |
|---|---|
| `log-query` | Latest N automation log entries |
| `invoice-query` | Invoices (all, by vendor, or by date range) |
| `backup-query` | Backup history, newest first |
| `error-report` | Recent errors with stack traces |
| `dashboard-summary` | Aggregated daily stats |
| `execution-report` | Script executions with duration |

### Write scripts (automation)

Perform real work (file operations, scanning, backups) and persist results to the database.
Each write script:

- Wraps its work in **execution tracking** (start → run → finish)
- Logs every action to **automation_logs**
- Records errors to both **automation_logs** and the **errors** table
- Validates data with **zod** before writing to the DB
- Uses **parameterized queries** exclusively — no SQL string interpolation

| Script | What it does |
|---|---|
| `download-sorter` | Sorts files from ~/Downloads into categorised folders |
| `invoice-scanner` | Scans PDF invoices in a folder and extracts vendor/amount/date |
| `backup-runner` | Copies configured folders to a backup location |

---

## Audit & Compliance Documentation

Each script includes **DOKUMENTATION.md** — formal DORA-compliant documentation with:

- **Dokumenten-ID** and version tracking
- **Regulatory references** (DORA Art. 9–28)
- **Ein-/Ausgabedaten** und **Datenbankzugriffe**
- **Fehlerbehandlung** und **Sicherheitsaspekte**
- **Abhängigkeiten** und **Änderungshistorie**

Located in each script's root directory. See [backup-query/DOKUMENTATION.md](backup-query/DOKUMENTATION.md) as an example.

---

## Security Notes

- All DB access uses parameterized queries (both JS and C# variants)
- No secrets are stored in these scripts — the only config is the env var
- The database file is in `.gitignore` and never committed
- Write scripts validate inputs before any INSERT
- Both variants use identical security practices
