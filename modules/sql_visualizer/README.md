# SQL Monitor

> SQL Monitor module for [AutomataHub](../../README.md) — browse, query, and analyze SQLite databases with multi-DB support, analytics, and live monitoring.

<p align="center">
  <img src="../../resources/screenshots/sql_monitor/sql_monitor.gif" alt="SQL Monitor" width="800" />
</p>

## What It Does

This module adds database introspection and analytics capabilities to AutomataHub:

- Connect to multiple SQLite databases and switch between them
- Browse tables with pagination, sorting, filtering, and auto-refresh
- Run ad-hoc SQL queries with preset templates and history
- Visualize execution timelines as Gantt charts
- Monitor script health, error patterns, and performance metrics
- Detect integrity issues like zombie runs, stale tables, and execution gaps

## Features

- **Multi-DB Support** — register multiple SQLite databases; switch between them without restarting
- **Table Browser** — paginated rows with column sorting, row-level filters, cross-table drill-down, bookmarks, and CSV export
- **Query Editor** — ad-hoc SELECT execution with 7 preset templates, query history, saved queries, and Cmd+Enter shortcut
- **Execution Timeline** — Gantt chart of script runs with zoom, pan, overlap detection, and click-to-drill-down
- **RPA Analytics** — per-script health cards, performance stats (avg/min/max/p95), activity heatmap, and error clustering
- **DB Health** — file stats, integrity checks, index counts, WAL size monitoring
- **Live Monitoring** — auto-refreshing table view at configurable intervals (5s/15s/30s/60s)
- **Credential Support** — integrates with the hub's encrypted credential store for password-protected databases
- **Dual Driver** — uses better-sqlite3 for performance; falls back to sql.js if native bindings aren't available

## Architecture

```
sql_visualizer/
├── main-handlers.js        # Setup/teardown, IPC handler registration
├── db-bridge.js            # SQLite wrapper (better-sqlite3 / sql.js fallback)
├── query-analyzer.js       # Analytics engine (health, performance, heatmap, errors)
├── manifest.json           # Module metadata, IPC channels, tab types
├── package.json
├── renderer/
│   ├── db-connection-manager.js  # Background connection polling with backoff
│   ├── sql-home.js               # Dashboard: table cards, health, integrity
│   ├── sql-table-view.js         # Paginated table browser with filters
│   ├── sql-query.js              # Query editor with presets and history
│   ├── sql-timeline.js           # Gantt-style execution timeline
│   ├── sql-analytics.js          # Performance, heatmap, error patterns
│   └── styles.css                # Component styles (--hub-* CSS variables)
└── README.md (this file)
```

### Key Components

**db-bridge.js** — Database abstraction layer. Resolves DB paths, manages connections, caches schema metadata, and handles paginated read-only queries. Supports SQLCipher-compatible PRAGMA key via hex-encoded credentials.

**query-analyzer.js** — Analytics engine that computes script health (success rate, streaks, status), performance aggregates (avg/min/max/p95), activity heatmaps (hour × day grid), error clustering (normalized patterns), integrity reports (zombies, stale tables, gaps), and DB health (file stats, PRAGMA checks).

**db-connection-manager.js** — Renderer-side connection monitor with exponential backoff (500ms → 30s). Notifies all UI components on status changes so tabs can show/hide content based on connectivity.

## Tab Types

| Tab | Purpose |
|-----|---------|
| **SQL Monitor** (`sql-home`) | Dashboard with table cards, quick stats, script health, DB health, and integrity report |
| **Table View** (`sql-table-view`) | Paginated table browser with sorting, filtering, bookmarks, and CSV export |
| **Query Editor** (`sql-query`) | Ad-hoc SQL execution with presets, history, saved queries, and results grid |
| **Execution Timeline** (`sql-timeline`) | Gantt chart of script runs with zoom/pan, color-coded status, and drill-down |
| **RPA Analytics** (`sql-analytics`) | Performance stats, activity heatmap, error patterns, and file processing metrics |

## IPC Channels

### Connection
- `sql-visualizer:get-db-status` — connection state
- `sql-visualizer:get-db-path` — active database path
- `sql-visualizer:get-db-list` — registered databases
- `sql-visualizer:add-db` — register a database
- `sql-visualizer:remove-db` — unregister a database
- `sql-visualizer:switch-db` — switch active database

### Introspection
- `sql-visualizer:get-tables` — table names
- `sql-visualizer:get-table-info` — column metadata
- `sql-visualizer:get-table-stats` — row counts and timestamps

### Data
- `sql-visualizer:query-rows` — paginated rows with filters and sorting
- `sql-visualizer:run-query` — execute ad-hoc SELECT
- `sql-visualizer:get-row-count` — row count for a table
- `sql-visualizer:export-csv` — export results as CSV

### Analytics
- `sql-visualizer:get-execution-timeline` — timeline data for a time range
- `sql-visualizer:get-script-health` — per-script health snapshots
- `sql-visualizer:get-performance-stats` — runtime aggregates
- `sql-visualizer:get-activity-heatmap` — hour × day activity grid
- `sql-visualizer:get-error-patterns` — clustered error messages
- `sql-visualizer:get-integrity-report` — zombies, stale tables, execution gaps
- `sql-visualizer:get-db-health` — file stats and PRAGMA checks
- `sql-visualizer:get-correlated-records` — logs and errors for an execution
