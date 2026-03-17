# automatahub-script-runner

> Script Runner module for [AutomataHub](https://github.com/Rey-der/AutomataHub) — execute and manage local automation scripts with org user-defined topics and live terminal output.

## What It Does

This module adds script execution and organization capabilities to AutomataHub:
- Discover and manage local automation scripts
- Organize scripts into **user-defined topics** for better categorization
- Execute scripts with real-time terminal output streaming
- Queue multiple scripts for sequential execution
- Save execution logs to disk
- All with a professional, tabbed UI matching the hub's design

## Features

- **Script Discovery** — Automatically scans the `automation_scripts/` directory for script folders with executable files (`.sh`, `.py`, `.js`, `.rb`, `.pl`, `.csx`)
- **Topic Organization** — Create custom topics, assign scripts to topics, filter by topic (new in Phase 1)
- **Live Terminal** — Real-time stdout/stderr streaming with color, timestamps, and scrolling
- **Script Queue** — Execute multiple scripts sequentially with visual queue indicators
- **Log Saving** — Save terminal output to timestamped log files
- **Import/Remove** — Add/remove script folders via drag-and-drop or file picker
- **Persistent Storage** — All topics and associations saved to SQLite (via sql.js) with auto-flush every 60s
- **config.json Support** — Each script folder can define name, description, and entry-point

## Installation

### Option 1 — Local development

Clone into the hub's `modules/` directory:

```bash
cd AutomataHub/modules
git clone https://github.com/Rey-der/automatahub-script-runner script-runner
```

The hub auto-discovers it on startup.

### Option 2 — npm package

```bash
npm install automatahub-script-runner
```

The hub's module loader scans both `modules/` (dev priority) and `node_modules/automatahub-*` (production).

## Architecture

This module follows AutomataHub's enterprise plugin pattern with clean separation of concerns:

```
script_runner/
├── core/
│   ├── script-store.js         # In-memory data store (topics, scripts, associations)
│   └── script-persistence.js   # SQLite persistence via sql.js (in-memory + periodic flush)
├── handlers/
│   ├── scripts.js              # Script discovery, import, removal (IPC: get-scripts, import-script, remove-script, ...)
│   ├── topics.js               # Topic CRUD operations (IPC: create-topic, update-topic, delete-topic, ...)
│   ├── organization.js         # Script-topic associations (IPC: add-script-to-topic, reorder-topic-scripts, ...)
│   └── execution.js            # Script execution + log management (IPC: run-script, stop-script, save-logs, ...)
├── monitoring/
│   └── script-executor.js      # Subprocess spawning, queue, lifecycle management (emits: output, error, complete, ...)
├── renderer/
│   ├── script-app.js           # Root layout component (sidebar + browser) — registers 'script-home' tab
│   ├── script-topics.js        # Topic list sidebar with create/edit/delete dialogs
│   ├── script-browser.js       # Main panel with script cards, filtering, topic tags
│   ├── script-home.js          # Legacy: helper functions and card renderer (no longer registers tab)
│   ├── execution-tab.js        # Live terminal for script execution (registers 'script-execution' tab)
│   └── styles.css              # Component styles using --hub-* and --topic-* CSS variables
├── main-handlers.js            # Slim orchestrator: wires handlers, manages dependencies, setup/teardown
├── manifest.json               # Module metadata: id, name, IPC channels, tab types, renderer scripts/styles
├── package.json
└── README.md (this file)
```

### Design Principles

- **Modular Handlers** — Each handler (scripts, topics, organization, execution) is self-contained and registered via `register(ipcBridge, deps)`
- **Dependency Injection** — Handlers receive shared dependencies (store, persistence, executor, send, etc.) — promotes testability and loose coupling
- **In-Memory Store** — ScriptStore holds all runtime data; persistence layer is write-through for consistency
- **Async Persistence** — ScriptPersistence uses sql.js (WASM SQLite) for zero native compilation issues. In-memory DB flushed to disk every 60s — no data loss on crash if close() is called
- **Slim Orchestrator** — main-handlers.js is 60 lines: creates store → persistence → executor → wires handlers. No business logic — just orchestration
- **Real-time Updates** — Renderer components subscribe to IPC push channels for live topic/script changes
- **Component Lifecycle** — Renderer classes (ScriptApp, TopicList, ScriptBrowser) follow init(container) → render() → destroy() pattern

## Script Folder Format

Each script lives in its own subfolder under `automation_scripts/`:

```
automation_scripts/
  my-script/
    config.json    (optional)
    main.sh        (or .py, .js, .rb, .pl, .csx)
    README.md      (optional)
```

**config.json** (optional):

```json
{
  "name": "Deploy Database",
  "description": "Backs up and deploys the database",
  "main": "main.sh"
}
```

Without `config.json`, folder name becomes script name and first executable file is used.

## Supported Languages

| Extension | Interpreter |
|-----------|------------|
| `.sh`, `.bash` | `/bin/bash` |
| `.py`, `.py3` | `python3` |
| `.js`, `.mjs` | `node` |
| `.rb` | `ruby` |
| `.pl` | `perl` |
| `.csx` | `dotnet-script` |

## IPC Channels

**All channels namespaced as `script-runner:*`**

### Script Management

| Channel | Type | Purpose |
|---------|------|---------|
| `get-scripts` | invoke | Get all discovered scripts (filtered by selected topic if any) |
| `import-script` | invoke | Import a script folder |
| `remove-script` | invoke | Remove a script from disk |
| `open-folder-picker` | invoke | Show file dialog |
| `validate-dropped-folder` | invoke | Validate a dropped folder |

### Script Execution

| Channel | Type | Purpose |
|---------|------|---------|
| `run-script` | invoke | Start execution (returns job ID) |
| `stop-script` | invoke | Cancel running/queued script |
| `output` | push | ~Stdout line with timestamp~ |
| `error` | push | ~Stderr line~ |
| `complete` | push | ~Execution finished (code, signal)~ |
| `queue-status` | push | ~Queue length, position~ |
| `clear-terminal` | invoke | Clear terminal state |
| `save-logs` | invoke | Save output to file |
| `log-saved` | push | Log saved notification |

### Topic Management (New)

| Channel | Type | Purpose |
|---------|------|---------|
| `get-topics` | invoke | Get all topics with metadata (name, description, color) |
| `create-topic` | invoke | Create new topic (returns topic object) |
| `update-topic` | invoke | Update topic (name, description, color) |
| `delete-topic` | invoke | Delete topic (cascades associations) |
| `topic-created` | push | Topic added (broadcast to all clients) |
| `topic-updated` | push | Topic modified |
| `topic-deleted` | push | Topic removed |

### Script-Topic Associations (New)

| Channel | Type | Purpose |
|---------|------|---------|
| `add-script-to-topic` | invoke | Associate script with topic |
| `remove-script-from-topic` | invoke | Remove association |
| `get-script-topics` | invoke | Get all topics a script is in |
| `get-topic-scripts` | invoke | Get all scripts in a topic |
| `reorder-topic-scripts` | invoke | Update script position within topic |
| `script-added-to-topic` | push | Association created |
| `script-removed-from-topic` | push | Association removed |
| `topic-scripts-reordered` | push | Order changed |
| `scripts-updated` | push | General scripts refreshed |

## Tab Types

| Type | Component | MaxTabs | Purpose |
|------|-----------|--------|---------|
| `script-home` | ScriptApp | 1 | Main UI: topic sidebar + script browser with filtering |
| `script-execution` | ExecutionTab | 4 | Live terminal for running script |

## New Renderer Components (Phase 1)

### ScriptApp
Root layout component managing state and lifecycle:
- Mounts TopicList sidebar and ScriptBrowser main panel
- Loads topics and scripts on init
- Handles topic selection and script filtering
- Persists UI state (selected topic) to localStorage
- Subscribes to IPC push channels for real-time updates

### TopicList
Sidebar component for topic selection and management:
- Displays all topics with color dots and script counts
- Create/edit/delete dialogs (inline or prompt-based)
- Color picker with predefined palette
- Active state styling
- Topic menu with edit option

### ScriptBrowser
Main panel for browsing and managing scripts:
- Auto-fill grid layout for script cards
- Filter input for searching scripts by name/path
- Script cards display: name, path, variant badges, topic tags
- Action buttons: Run, Add to Topic, Remove, Browse
- Variant picker when script has multiple versions
- Drag-&-drop import zone
- Real-time updates on topic/script changes

## Data Flow

```
User Action (UI) → IPC invoke() → Handler.register() →
  → Modifies ScriptStore → Calls persistence.save*() →
  → emit() broadcasts IPC push event → Renderer components update() via listeners
```

All state changes flow through ScriptStore (single source of truth) with write-through to persistent storage.

## License

MIT
