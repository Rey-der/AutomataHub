# automatahub-script-runner

> Script Runner module for [AutomataHub](https://github.com/Rey-der/AutomataHub) — execute and manage local automation scripts with live terminal output.

## What It Does

This module adds script execution capabilities to AutomataHub. It discovers script folders, lets users run them with real-time terminal output, manages a sequential execution queue, and saves logs — all within the hub's tab-based interface.

## Features

- **Script Discovery** — Automatically scans the `scripts/` directory for script folders containing executable files (`.sh`, `.py`, `.js`, `.rb`, `.pl`, `.csx`, etc.)
- **Live Terminal** — Real-time stdout/stderr streaming with timestamps, color-coded output, and line-count tracking
- **Script Queue** — Queue multiple scripts; they execute sequentially with visual queue-status indicators
- **Log Saving** — Save terminal output to timestamped log files in the `logs/` directory
- **Import/Remove** — Import script folders via drag-and-drop or a file picker; remove scripts from the UI
- **config.json** — Each script folder can contain a `config.json` with `name`, `description`, and `main` (entry-point override)

## Installation

### Option 1 — As a local module (development)

Clone this repo into the hub's `modules/` directory:

```bash
cd AutomataHub/modules
git clone https://github.com/Rey-der/automatahub-script-runner script-runner
```

The hub discovers it automatically on startup.

### Option 2 — As an npm dependency

```bash
cd AutomataHub
npm install automatahub-script-runner
```

Or for local development with a sibling directory:

```bash
npm install file:../automatahub-script-runner
```

The hub's module loader scans `node_modules/automatahub-*` for packages with a `manifest.json`. Local `modules/` takes priority over `node_modules/` if both exist.

## Standalone Development

This module is a self-contained package that can be developed independently:

```
automatahub-script-runner/
├── manifest.json        # Module metadata, IPC channels, tab types
├── main-handlers.js     # Main process logic (script execution, file ops)
├── renderer/
│   ├── script-home.js   # Script list + import UI (tab type: script-home)
│   ├── execution-tab.js # Live terminal view (tab type: script-execution)
│   └── styles.css       # Module-specific styles (uses --hub-* CSS variables)
├── package.json
├── README.md
└── LICENSE
```

**Key conventions:**
- IPC channels are namespaced: `script-runner:*`
- CSS uses hub-provided `--hub-*` custom properties for theming
- `main-handlers.js` exports `setup(context)` and `teardown()` functions
- The hub passes `ipcBridge`, `mainWindow`, `paths`, and `send` via the setup context

## Script Folder Format

Each script lives in its own subfolder under `scripts/`:

```
scripts/
  my-script/
    config.json    (optional)
    main.sh        (or .py, .js, .rb, .pl, .csx)
    README.md      (optional)
```

**config.json** (optional):

```json
{
  "name": "My Script",
  "description": "Does something useful",
  "main": "main.sh"
}
```

If `config.json` is absent, the folder name is used as the script name and the first executable file found is used as the entry point.

## Supported Languages

| Extension  | Interpreter      |
|-----------|------------------|
| `.sh`     | `/bin/bash`      |
| `.bash`   | `/bin/bash`      |
| `.py`     | `python3`        |
| `.py3`    | `python3`        |
| `.js`     | `node`           |
| `.mjs`    | `node`           |
| `.rb`     | `ruby`           |
| `.pl`     | `perl`           |
| `.csx`    | `dotnet-script`  |

## IPC Channels

All channels are namespaced with `script-runner:`:

| Channel | Direction | Description |
|---------|-----------|-------------|
| `script-runner:get-scripts` | invoke | Get list of available scripts |
| `script-runner:run-script` | invoke | Start a script execution |
| `script-runner:stop-script` | invoke | Stop a running/queued script |
| `script-runner:save-logs` | invoke | Save terminal output to file |
| `script-runner:clear-terminal` | invoke | Clear terminal state |
| `script-runner:open-folder-picker` | invoke | Open folder selection dialog |
| `script-runner:validate-dropped-folder` | invoke | Validate a dropped folder |
| `script-runner:import-script` | invoke | Import a script folder |
| `script-runner:remove-script` | invoke | Remove a script folder |
| `script-runner:output` | push | Live stdout line |
| `script-runner:error` | push | Live stderr line |
| `script-runner:complete` | push | Script execution completed |
| `script-runner:queue-status` | push | Queue position update |
| `script-runner:log-saved` | push | Log file saved (reserved) |

## Tab Types

| Type | Description |
|------|-------------|
| `script-home` | Script list with import zone (max 1 tab) |
| `script-execution` | Live terminal view for a running script (max 4 tabs) |

## License

MIT
