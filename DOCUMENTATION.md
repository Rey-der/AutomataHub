# AutomataHub — Comprehensive Technical Documentation

> **Version:** 1.0.0 (Modular Architecture - First Release)
> **Last Verified:** 2026-03-15
> **Runtime:** Electron 41.0.2 · Node.js 18+
> **Platform:** macOS (primary), cross-platform capable
> **License:** ISC

---

## Table of Contents

1. [Project Summary](#1-project-summary)
2. [System Architecture](#2-system-architecture)
3. [File Inventory](#3-file-inventory)
4. [Main Process](#4-main-process)
5. [Preload Bridge](#5-preload-bridge)
6. [Renderer Process](#6-renderer-process)
7. [IPC Protocol](#7-ipc-protocol)
8. [Script Execution Engine](#8-script-execution-engine)
9. [Script Folder System](#9-script-folder-system)
10. [Security Model](#10-security-model)
11. [Data Flow Diagrams](#11-data-flow-diagrams)
12. [Error Handling](#12-error-handling)
13. [UI & Styling](#13-ui--styling)
14. [Build & Distribution](#14-build--distribution)
15. [Dependencies](#15-dependencies)
16. [Configuration Files](#16-configuration-files)
17. [Known Limitations](#17-known-limitations)
18. [Threat Model](#18-threat-model)
19. [Glossary](#19-glossary)

---

## 1. Project Summary

**AutomataHub** is a modular Electron desktop hub for automation tools. The hub provides the shell (window, tabs, IPC, theming) and modules provide features. Each module is a self-contained package — developed, versioned, and distributed independently.

### Hub Capabilities

| Capability | Description |
|---|---|
| Module Discovery | Discovers modules from `modules/` (local) and `node_modules/automatahub-*` (installed) |
| Dynamic Tab System | Modules register tab types; hub manages creation, switching, closing |
| IPC Bridge | Dynamic channel allowlisting from module manifests; secure preload bridge |
| CSS Variable Contract | `--hub-*` prefixed variables for stable module theming |
| Shared Utilities | `path-utils`, `config-utils`, `event-bus` available to all modules |
| Dark Theme | VS Code One Dark Pro-inspired interface with CSS custom properties |

### Installed Modules

| Module | Provides |
|---|---|
| Script Runner (`automatahub-script-runner`) | Script discovery, live terminal, execution queue, log saving, drag-and-drop import |

### Supported Script Types

| Extension | Interpreter | Language Label |
|---|---|---|
| `.sh`, `.bash` | `/bin/bash` | bash |
| `.py`, `.py3` | `python3` | python |
| `.js`, `.mjs` | `node` | javascript |
| `.rb` | `ruby` | ruby |
| `.pl` | `perl` | perl |

---

## 2. System Architecture

AutomataHub follows a **hub + plugin** architecture on top of Electron's multi-process model:

```
┌──────────────────────────────────────────────────────────────┐
│                     Main Process (Node.js)                   │
│                                                              │
│  ┌─────────────┐  ┌──────────────────────────────────────┐   │
│  │   main.js   │  │          core/                       │   │
│  │             │  │  module-loader.js  module-registry.js│   │
│  │ - Window    │  │  ipc-bridge.js    path-utils.js      │   │
│  │ - Hub IPC   │  │  config-utils.js  event-bus.js       │   │
│  │ - Module    │  │  errors.js                           │   │
│  │   bootstrap │  └──────────────────────────────────────┘   │
│  └──────┬──────┘                                             │
│         │          ┌─────────────────────────────────────┐   │
│         │          │   Loaded Modules (main-handlers.js) │   │
│         │          │   e.g. script-runner:               │   │
│         ├──────────│   - script-executor.js              │   │
│         │          │   - IPC handlers via ipcBridge      │   │
│         │          └─────────────────────────────────────┘   │
│         │                                                    │
└─────────┼────────────────────────────────────────────────────┘
          │ IPC (contextBridge, dynamic channel allowlist)
┌─────────┼────────────────────────────────────────────────────┐
│ Preload │   preload.js                                       │
│ Bridge  │   - Dynamic channel allowlist (from module manifests)│
│         │   - Generic invoke() / on() / off()                │
│         │   - window.api surface                             │
└─────────┼────────────────────────────────────────────────────┘
          │
┌─────────┼────────────────────────────────────────────────────┐
│              Renderer Process (Chromium)                     │
│         │                                                    │
│  ┌──────┴────────────────────────────┐                       │
│  │      module-bootstrap.js          │                       │
│  │  - Inits dynamic IPC channels     │                       │
│  │  - Loads module styles (<link>)   │                       │
│  │  - Loads module scripts (<script>)│                       │
│  └──────┬────────────────────────────┘                       │
│         │                                                    │
│  ┌──────┴──────────────────┐  ┌──────────┐                   │
│  │    tab-manager.js       │  │  ui.js   │                   │
│  │ - Dynamic tab types     │  │ - Toast  │                   │
│  │ - registerTabType()     │  │ - Format │                   │
│  │ - Per-type max limits   │  └──────────┘                   │
│  └──────┬──────────────────┘                                 │
│         │                                                    │
│  ┌──────┴──────┐  ┌──────────────────────────────┐           │
│  │ home-tab.js │  │  Module renderer scripts     │           │
│  │ (hub dash)  │  │  e.g. script-home.js         │           │
│  │ - Module    │  │       execution-tab.js       │           │
│  │   cards     │  │       + module CSS           │           │
│  └─────────────┘  └──────────────────────────────┘           │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │         core.css — Hub theme & --hub-* variables     │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### Module Discovery Sources

| Source | Priority | Use Case |
|---|---|---|
| `modules/` directory | High (wins on conflict) | Local development, embedded modules |
| `node_modules/automatahub-*` | Low (fallback) | npm-installed modules, separate repos |

### Process Boundaries

| Boundary | Enforcement |
|---|---|
| Main ↔ Preload | `contextBridge.exposeInMainWorld()` — only `window.api` object exposed |
| Preload ↔ Renderer | Context isolation enabled; no `nodeIntegration`; sandbox enabled |
| Main ↔ Child Process | `child_process.spawn()` with `shell: false`, `stdio: ['ignore', 'pipe', 'pipe']` |
| Renderer ↔ Network | CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` |

---

## 3. File Inventory

### Hub Core — Main Process

| File | Purpose |
|---|---|
| `app/main.js` | App entry: window, hub IPC, module bootstrap, lifecycle |
| `app/preload.js` | Secure IPC bridge with dynamic channel allowlisting |
| `app/script-executor.js` | Execution queue, process spawning, stream routing |
| `app/core/module-loader.js` | Discovers modules from `modules/` and `node_modules/automatahub-*` |
| `app/core/module-registry.js` | In-memory module metadata store |
| `app/core/ipc-bridge.js` | Safe IPC handler registration with cleanup tracking |
| `app/core/path-utils.js` | `resolveInside()`, `isInside()`, `ensureDir()` |
| `app/core/config-utils.js` | `readJsonConfig()` with fallback defaults |
| `app/core/event-bus.js` | Inter-module EventEmitter singleton (`hubBus`) |
| `app/core/errors.js` | Centralized error message constants |

### Hub Core — Renderer

| File | Purpose |
|---|---|
| `renderer/index.html` | Single-page HTML shell |
| `renderer/core.css` | Hub theme: CSS variables, layout, tabs, `--hub-*` aliases |
| `renderer/ui.js` | Notification toasts, formatting utilities |
| `renderer/tab-manager.js` | Dynamic tab types via `registerTabType()` |
| `renderer/module-bootstrap.js` | Loads module styles and scripts at startup |
| `renderer/pages/home-tab.js` | Hub dashboard — module cards with Open buttons |

### Script Runner Module

| File | Purpose |
|---|---|
| `modules/script-runner/manifest.json` | Module metadata: channels, tab types, scripts, styles |
| `modules/script-runner/main-handlers.js` | All script-related main-process IPC handlers |
| `modules/script-runner/renderer/script-home.js` | Script list + import zone tab |
| `modules/script-runner/renderer/execution-tab.js` | Live terminal view tab |
| `modules/script-runner/renderer/styles.css` | Module-specific CSS |

### Configuration & Meta Files

| File | Purpose |
|---|---|
| `package.json` | npm manifest, electron-builder config, scripts |
| `package-lock.json` | Dependency lockfile (4,517 lines, 379 packages) |
| `.gitignore` | Ignores `node_modules/`, `dist/`, `.DS_Store`, `logs/*.txt`, `*.log`, `.env` |
| `.editorconfig` | UTF-8, LF, 2-space indent, trim trailing whitespace |
| `.npmrc` | `audit-level=high` — suppresses moderate-severity npm audit advisories |

### Documentation

| File | Purpose |
|---|---|
| `README.md` | Setup, usage, project structure, security summary |
| `SECURITY.md` | AI-assisted development security policy, threat model, review checklists |
| `TODO.md` | Development plan (all 10 chunks marked complete) |
| `docs/PROJECT_OVERVIEW.md` | High-level product description |
| `docs/ARCHITECTURE.md` | System design, data flow, IPC protocol |
| `docs/FEATURES.md` | Feature specifications |
| `docs/COMPONENT_SPECS.md` | Component-level specs |
| `docs/API_INTERFACE.md` | Full IPC API documentation |
| `docs/FILE_STRUCTURE.md` | Directory layout |
| `docs/STYLING_GUIDE.md` | CSS design system reference |
| `docs/DEVELOPMENT_PLAN.md` | Chunk-based build plan |
| `docs/SCRIPT_FOLDER_SYSTEM.md` | Script folder conventions |

### Resources

| File | Purpose |
|---|---|
| `resources/icon.png` | Application icon (source PNG) |
| `resources/icon.icns` | macOS application icon (generated from icon.png via `sips` + `iconutil`) |
| `resources/mw.png` | Watermark logo displayed on Home tab |
| `resources/info.png` | Info button icon (rendered with CSS `filter: invert(1)`) |

### Runtime Directories

| Directory | Purpose | Git-tracked |
|---|---|---|
| `scripts/` | User script folders (one sample: `hello-world/`) | Yes (`.gitkeep` + sample) |
| `logs/` | Saved execution log files | No (`.gitkeep` only; `*.txt` in `.gitignore`) |
| `node_modules/` | Dependencies (~615 MB) | No |
| `dist/` | Build output | No |

---

## 4. Main Process

**File:** `app/main.js`

### Initialization Sequence

1. `app.name = 'AutomataHub'` — set **before** `app.whenReady()` so macOS Dock shows the correct name
2. Constants defined: `MODULES_DIR`, `NODE_MODULES_DIR`, `ICON_PATH`
3. `app.whenReady()` → set Dock icon → `setupHubIPC()` → `loadModules()` → `createWindow()`

### Module Loading (`loadModules()`)

1. `discoverModules(MODULES_DIR)` — scans local `modules/` subfolder
2. `discoverInstalledModules(NODE_MODULES_DIR)` — scans `node_modules/automatahub-*`
3. Deduplication: local modules win if the same `id` exists in both sources
4. For each module: `registry.register(mod)`, then call `mod.setup(context)`
5. Setup context provides: `ipcBridge`, `mainWindow()`, `paths`, `send()`

### Window Configuration

```javascript
{
  width: 1280, height: 800,
  minWidth: 960, minHeight: 640,
  backgroundColor: '#1e1e1e',
  title: 'AutomataHub',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,    // Renderer cannot access Node.js
    nodeIntegration: false,     // No require() in renderer
    sandbox: true               // Full Chromium sandbox
  }
}
```

### Content Security Policy

Applied via `session.defaultSession.webRequest.onHeadersReceived()`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
```

- `default-src 'self'` — all resources must originate from the application
- `script-src 'self'` — no inline scripts, no external scripts, no `eval()`
- `style-src 'self' 'unsafe-inline'` — local stylesheets + inline styles (needed for dynamic styling)

### Script Discovery (`getAvailableScripts()`)

1. Reads `scripts/` directory for subdirectories
2. Skips entries starting with `.` and entries in `IGNORED_DIRS` (`node_modules`, `.git`, `.venv`, `__pycache__`, `Trash`)
3. For each valid directory:
   - Reads `config.json` if present (parses with `JSON.parse`, catches malformed JSON)
   - Finds main script: uses `config.mainScript` if specified, otherwise first file with a supported extension
   - Extracts description: `config.description` → `README.md` first non-empty line → empty string
   - Detects language from file extension
4. Returns sorted array of script objects

### Log Saving (`saveLogs()`)

- **Filename format:** `{safeName}_{YYYY-MM-DD}_{HH-MM-SS}.txt`
- **safeName:** `scriptName.replace(/[^a-z0-9\-_]/gi, '_').toLowerCase()`
- **Destination:** `logs/` directory (auto-created if missing)
- **Content structure:** Header block (separator, metadata) + raw content + footer block
- **Validation:** Rejects empty or whitespace-only content

### Folder Import (`importScriptFolder()`)

1. Validates source folder exists and contains executables
2. Generates unique destination name (appends `-1`, `-2`, etc. on collision)
3. Copies entire folder recursively via `copyFolderSync()`
4. Creates/updates `config.json` with `mainScript` and `name` fields
5. Returns `{ success, scriptId, name }`

### Folder Removal (`removeScriptFolder()`)

- **Path traversal protection:** Resolves both the target path and `SCRIPTS_DIR`, then verifies the target starts with `SCRIPTS_DIR + path.sep` and is not the scripts directory itself
- Uses `fs.rmSync()` with `recursive: true, force: true`

### App Lifecycle

- `window-all-closed` — quits on non-macOS platforms
- `activate` — re-creates window on macOS if none exist
- `before-quit` — calls `executor.killAll()`, removes all event listeners, unregisters all IPC handlers

---

## 5. Preload Bridge

**File:** `app/preload.js`

### Dynamic Channel Allowlisting

The preload no longer hardcodes allowed channels. At startup:
1. `initChannels()` calls `hub:get-allowed-channels` to get the full list of push channels from all loaded modules
2. These channels are added to the dynamic allowlist
3. `on()` / `off()` only work for channels in this list

### Exposed API Methods (`window.api`)

| Method | Parameters | Returns |
|---|---|---|
| `invoke(channel, ...args)` | Any channel, any args | `Promise<any>` |
| `on(event, callback)` | event in dynamic allowlist | void |
| `off(event, callback)` | event in dynamic allowlist | void |
| `getModules()` | none | `Promise<ModuleDescriptor[]>` |
| `getResourcesPath()` | none | `Promise<string>` |
| `openExternalUrl(url)` | `url`: string | `Promise<void>` |

### Security Properties

- **No raw `ipcRenderer` exposure** — only specific invoke/on/off wrappers
- **Input validation at the preload boundary** — prevents invalid types from reaching main process
- **Channel whitelist** — `on()` / `off()` only works for the 6 listed channels
- **No `send()` exposed** — renderer can only invoke (request-response) or listen, never fire-and-forget

---

## 6. Renderer Process

### 6.1 HTML Shell (`renderer/index.html`)

Minimal 23-line single-page HTML:
- Tab bar (`<nav id="tab-bar">`) with ARIA `role="tablist"` and a permanent Home tab button
- Content area (`<main id="tab-content">`) with `role="tabpanel"`
- Loads 4 scripts in order: `ui.js` → `tab-manager.js` → `home-tab.js` → `execution-tab.js`
- No inline scripts (CSP compliant)

### 6.2 Tab Manager (`renderer/tab-manager.js`)

**Class:** `TabManager` — instantiated as `window.tabManager` on `DOMContentLoaded`

| Method | Behavior |
|---|---|
| `createTab(scriptName, scriptPath)` | Reuses existing tab for same `scriptPath`; enforces max 4 execution tabs; generates unique ID `script-{timestamp}-{random}` |
| `switchTab(tabId)` | Updates ARIA states, toggles `.active` class, delegates rendering to `homeTab.render()` or `executionTab.render()` |
| `closeTab(tabId)` | Cannot close Home; stops running/queued script via IPC; cleans up execution state; switches to Home if closed tab was active |
| `updateTabStatus(tabId, status)` | Updates status icon (●/✓/✗/◷) and CSS class on tab button |

**Tab Object Structure:**
```javascript
{
  id: string,          // 'home' or 'script-{ts}-{rand}'
  type: 'home' | 'execution',
  title: string,
  scriptName: string,  // execution tabs only
  scriptPath: string,  // execution tabs only
  status: 'idle' | 'running' | 'success' | 'error' | 'queued'
}
```

### 6.3 Home Tab (`renderer/pages/home-tab.js`)

**Module:** `HomeTab` (IIFE, exposes `window.homeTab`)

**Responsibilities:**
- Fetches script list via `window.api.getScripts()`
- Renders script cards in a responsive CSS grid (280px min column width)
- Renders import zone with drag-and-drop and Finder picker
- Shows executable selection dialog when an imported folder has multiple executables
- Shows empty state when no scripts found
- Info button (top-right) with rich HTML tooltip
- MW watermark logo (bottom-right, fixed position) with GitHub prompt

**GitHub Prompt Feature:**
- Click logo → old-school terminal box with neon flicker animation (`terminal-flicker-in` keyframe) and typewriter effect
- Keyboard shortcuts: `y` = open GitHub, `n`/`Escape` = dismiss
- Auto-dismiss on mouse-leave from both logo and prompt box (120ms debounce)
- External URL opened via IPC with allowlist validation (`https://github.com/Rey-der` only)

### 6.4 Execution Tab (`renderer/pages/execution-tab.js`)

**Module:** `ExecutionTab` (IIFE, exposes `window.executionTab`)

**Per-Tab State** (stored in `Map<tabId, State>`):
```javascript
{
  lines: Array<{text, timestamp, type}>,
  lineCount: number,
  isRunning: boolean,
  exitCode: number | null,
  runtime: number | null,    // milliseconds
  truncated: boolean
}
```

**Terminal Buffer Management:**
- Maximum 1,000 lines displayed (`MAX_LINES`)
- When exceeded: oldest lines removed from both array and DOM
- Truncation notice inserted once at the top
- Total `lineCount` preserved for the toolbar info display

**Live Append System:**
- `appendOutput(tabId, text, timestamp, type)` — adds a line, handles overflow, scrolls to bottom
- Only manipulates DOM if the tab is currently active (performance optimization)
- Removes placeholder on first output line

**IPC Listeners** (set up once on `DOMContentLoaded`):
- `script-output` → `appendOutput(..., 'stdout')`
- `script-error` → `appendOutput(..., 'stderr')`
- `script-complete` → `onComplete()` — updates state, status badge, adds system line
- `queue-status` → `onQueueStatus()` — updates tab status to 'queued', adds system line
- `log-saved` — passive listener for future use
- `app-error` — shows notification toast

### 6.5 UI Utilities (`renderer/ui.js`)

| Function | Purpose |
|---|---|
| `showNotification(message, type, duration)` | Fixed-position toast notification with close button and auto-dismiss (default 3s) |
| `formatTimestamp(date)` | Returns `date.toISOString()` |
| `sanitizeScriptName(name)` | Lowercase, replace non-alphanumeric with `-` |
| `truncateOutput(text, maxLines)` | Keeps last `maxLines` lines (default 1000) |

---

## 7. IPC Protocol

### Hub Channels (always available)

| Channel | Direction | Response | Handler |
|---|---|---|---|
| `get-resources-path` | invoke | `string` (absolute path) | `main.js` |
| `open-external-url` | invoke | void | `main.js` (allowlisted) |
| `hub:get-modules` | invoke | `ModuleDescriptor[]` | `main.js` |
| `hub:get-allowed-channels` | invoke | `string[]` | `main.js` |

### Module Channels (registered dynamically)

Modules declare their IPC channels in `manifest.json`. These are registered via `ipcBridge` during module setup. For example, the Script Runner module registers:

| Channel | Direction | Description |
|---|---|---|
| `script-runner:get-scripts` | invoke | Get list of available scripts |
| `script-runner:run-script` | invoke | Start a script execution |
| `script-runner:save-logs` | invoke | Save terminal output to file |
| `script-runner:stop-script` | invoke | Stop a running/queued script |
| `script-runner:clear-terminal` | invoke | Clear terminal state |
| `script-runner:open-folder-picker` | invoke | Open folder selection dialog |
| `script-runner:validate-dropped-folder` | invoke | Validate a dropped folder |
| `script-runner:import-script` | invoke | Import a script folder |
| `script-runner:remove-script` | invoke | Remove a script folder |
| `script-runner:output` | push | Live stdout line |
| `script-runner:error` | push | Live stderr line |
| `script-runner:complete` | push | Script execution completed |
| `script-runner:queue-status` | push | Queue position update |
| `script-runner:log-saved` | push | Log file saved |

### Dynamic Channel Allowlisting

Push channels (main → renderer) are dynamically allowlisted in the preload:
1. Module manifests declare `ipcChannels`
2. The registry aggregates all push channels
3. `hub:get-allowed-channels` returns the full list
4. Preload's `initChannels()` adds them to the `on()`/`off()` allowlist at startup

### Validation Chain

```
Renderer                           Preload                          Main Process
─────────────────────────────────────────────────────────────────────────────────
User action                   →    Type checks                  →   Type checks
(e.g., click Run)                  (string? non-empty?)              (string? non-empty?)
                                   Reject with Error                 Throw Error / return error obj
                                   if invalid                        if invalid
```

Every IPC invoke goes through **two validation gates**: the preload bridge and the main process handler. This defense-in-depth prevents invalid data from reaching business logic even if one layer is bypassed.

---

## 8. Script Execution Engine

**File:** `app/script-executor.js` (256 lines)

**Class:** `ScriptExecutor extends EventEmitter`

### Queue Architecture

```
execute(job)
    │
    ├── if running: push to queue[] → emit 'queue-status'
    │
    └── if idle: _spawn(job)
                    │
                    ├── _validatePath()  → path traversal check
                    ├── existsSync()     → file existence check
                    ├── _getInterpreter()→ extension → interpreter map
                    │
                    └── spawn(interpreter, [resolvedPath], {
                          cwd: script's directory,
                          stdio: ['ignore', 'pipe', 'pipe'],
                          shell: false,
                          detached: false
                        })
```

### Path Validation (`_validatePath`)

```javascript
const resolved = fs.realpathSync(scriptPath);  // resolves symlinks
const scriptsReal = fs.realpathSync(this.scriptsDir);
if (!resolved.startsWith(scriptsReal + path.sep) && resolved !== scriptsReal) {
  throw new Error('Script path is outside the allowed scripts directory');
}
```

- `realpathSync` resolves symlinks, preventing symlink escape attacks
- The `+ path.sep` suffix prevents prefix collisions (e.g., `scripts-evil/` passing a `startsWith('scripts')` check)

### Stream Handling

- stdout and stderr are read via `'data'` events on pipe streams
- Lines are split by `\n`; incomplete trailing lines are buffered in `stdoutRemainder` / `stderrRemainder`
- On child `close`, any remaining buffered content is flushed as a final line
- Each emitted event includes `{tabId, text, timestamp}`

### Process Termination

**Graceful stop (`stop(tabId)`):**
1. If the running process matches `tabId`: sends `SIGTERM`
2. After 5 seconds: sends `SIGKILL` as a fallback
3. If `tabId` is queued (not running): removes from queue silently

**Force kill (`killAll()`):**
1. Clears entire queue
2. Sends `SIGKILL` to current process immediately
3. Calls `_cleanup()` to reset internal state

### State Machine

```
idle ──execute()──→ running ──close──→ idle
  │                    │                 │
  │                    └──error──→ idle  │
  │                                     │
  └──execute() while running──→ queued ─┘
                                    │
                                    └──_processNext()──→ running
```

---

## 9. Script Folder System

### Directory Layout

```
scripts/
└── {script-name}/           ← Folder name = script ID
    ├── main.sh              ← Primary executable (required)
    ├── config.json           ← Optional metadata
    └── README.md             ← Optional description fallback
```

### config.json Schema

```json
{
  "name": "string — Display name (optional, defaults to folder name)",
  "description": "string — Description shown on card (optional)",
  "mainScript": "string — Filename of the primary executable (optional, auto-detected)"
}
```

All fields are optional. If `config.json` is absent or malformed, the application falls back gracefully:
- **name** → folder name
- **description** → first non-empty line of `README.md` → empty string
- **mainScript** → first file with a supported extension found by `readdirSync()`

### Ignored Directories

The following directory names are skipped during script discovery:  
`node_modules`, `.git`, `.venv`, `__pycache__`, `Trash`

Additionally, any directory starting with `.` is skipped.

### Import Process (Detailed)

```
External folder
    │
    ├── validateFolder()
    │   ├── exists? (fs.existsSync)
    │   ├── isDirectory? (fs.statSync)
    │   ├── not ignored? (name check)
    │   └── has executables? (extension scan)
    │
    ├── If multiple executables → show selection dialog
    │
    ├── Unique destination name (collision avoidance with counter suffix)
    │
    ├── copyFolderSync() — recursive deep copy
    │
    └── Write/update config.json with mainScript + name
```

---

## 10. Security Model

### 10.1 Electron Security Configuration

| Setting | Value | Purpose |
|---|---|---|
| `contextIsolation` | `true` | Renderer JavaScript runs in a separate context from preload/Node.js |
| `nodeIntegration` | `false` | No `require()`, `process`, or `fs` in renderer |
| `sandbox` | `true` | Full Chromium sandbox enabled for renderer process |
| CSP Header | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` | Restricts resource loading to application origin |

### 10.2 IPC Security

**Defense in Depth:**
1. **Preload validates types** — prevents non-string parameters from reaching main process
2. **Main process re-validates** — independent type and content checks before any action
3. **Channel whitelist** — `on()` / `off()` only accept 6 specific event names
4. **No `send()` exposed** — renderer cannot push arbitrary messages to main process
5. **No raw `ipcRenderer`** — only the `window.api` object is accessible

### 10.3 File System Security

| Control | Implementation |
|---|---|
| Path traversal prevention | `realpathSync()` + `startsWith(scriptsDir + path.sep)` in `_validatePath()` |
| Symlink resolution | `realpathSync()` resolves symlinks before comparison |
| Removal safety | `removeScriptFolder()` verifies resolved path is inside `SCRIPTS_DIR` and not equal to it |
| Log directory isolation | Logs are only written to `LOGS_DIR` with sanitized filenames |
| No user-controlled paths in `require()` | All module imports are static |

### 10.4 Process Execution Security

| Control | Implementation |
|---|---|
| `shell: false` | Prevents shell metacharacter injection |
| Explicit interpreter | Extension-to-interpreter mapping; never executes the file directly |
| `stdio: ['ignore', 'pipe', 'pipe']` | No stdin access from child processes |
| `detached: false` | Child processes are not detached from parent |
| Graceful termination | SIGTERM → 5s timeout → SIGKILL fallback |
| Full cleanup on app quit | `killAll()` called in `before-quit` handler |

### 10.5 External URL Security

The `open-external-url` IPC handler uses a strict allowlist:

```javascript
const allowed = ['https://github.com/Rey-der'];
if (typeof url === 'string' && allowed.some(a => url.startsWith(a))) {
  shell.openExternal(url);
}
```

Only URLs starting with `https://github.com/Rey-der` pass the filter. All other URLs are silently dropped.

### 10.6 What Is NOT Protected

| Risk | Status | Notes |
|---|---|---|
| Malicious script content | **Unmitigated** | Scripts execute with the user's full permissions. AutomataHub is an execution tool, not a sandbox. |
| Renderer XSS via script output | **Mitigated** | Output is set via `textContent`, not `innerHTML`. Exception: info tooltip uses `innerHTML` with static content only. |
| File permission escalation | **Unmitigated** | Scripts run as the current user. No privilege escalation or capability dropping is performed. |
| Denial of service via script | **Partially mitigated** | User can click Stop (SIGTERM → SIGKILL); but no CPU/memory resource limits are enforced on child processes. |

---

## 11. Data Flow Diagrams

### 11.1 Application Startup

```
1. User launches app (npm start / Electron binary)
2. Main process starts
3. app.name = 'AutomataHub' (synchronous, before ready)
4. app.whenReady():
   a. Set Dock icon (macOS only)
   b. setupHubIPC():
      - Register hub channels: get-resources-path, open-external-url,
        hub:get-modules, hub:get-allowed-channels
   c. loadModules():
      - discoverModules(modules/) → local modules
      - discoverInstalledModules(node_modules/) → installed modules
      - Deduplicate (local wins)
      - For each: registry.register(mod), mod.setup(context)
   d. createWindow():
      - Set CSP headers
      - Create BrowserWindow (1280×800)
      - Load renderer/index.html
5. Renderer loads:
   a. core.css (hub theme + --hub-* variable contract)
   b. ui.js → window.ui
   c. tab-manager.js → window.tabManager (on DOMContentLoaded)
   d. home-tab.js → hub dashboard
   e. module-bootstrap.js:
      - api.getModules() → get all module descriptors
      - initChannels() → dynamic IPC channel allowlisting
      - For each module: load CSS <link> tags, then <script> tags
      - Boot TabManager → switch to home tab
```

### 11.2 Script Execution

```
1. User clicks "▶ Run Script" on a script card
2. HomeTab.handleRunScript() → TabManager.createTab()
   - Reuses existing tab if same scriptPath
   - Creates new tab if under 4 limit
   - Shows notification if at limit
3. Tab created, switched to execution view
4. User clicks "▶ Run" in execution toolbar
5. ExecutionTab.handleRun():
   a. State: isRunning = true, exitCode = null
   b. TabManager: status = 'running'
   c. api.runScript(scriptPath, scriptName, tabId)
6. Preload validates types
7. Main process handler validates types
8. executor.execute({scriptPath, name, tabId}):
   a. If idle: _spawn(job)
   b. If running: queue.push(job) → emit 'queue-status'
9. _spawn():
   a. _validatePath() → realpathSync + prefix check
   b. existsSync() check
   c. _getInterpreter() → extension lookup
   d. spawn(interpreter, [path], {cwd, shell:false, ...})
10. stdout data → split lines → emit 'output' → IPC → appendOutput()
11. stderr data → split lines → emit 'error' → IPC → appendOutput()
12. close event:
    a. Flush remaining buffers
    b. _cleanup()
    c. emit 'complete' → IPC → onComplete()
    d. _processNext() → dequeue next job if any
```

### 11.3 Script Import (Drag & Drop)

```
1. User drags folder onto import zone
2. 'drop' event → handleDrop()
3. Read file.path from DataTransfer
4. api.validateDroppedFolder(folderPath)
5. Main: validateFolder():
   a. existsSync + isDirectory
   b. Not ignored directory
   c. Find executables
6. If 1 executable → auto-select
   If multiple → showExecutableSelectionDialog()
7. api.importScript(folderPath, mainScript)
8. Main: importScriptFolder():
   a. Generate unique dest name
   b. copyFolderSync(src, dest)
   c. Write config.json
9. Success → notification toast → re-render script grid
```

---

## 12. Error Handling

### 12.1 Error Constants (`app/errors.js`)

| Category | Constants |
|---|---|
| Script Execution | `SCRIPT_NOT_FOUND`, `SCRIPT_PATH_OUTSIDE`, `SCRIPT_NO_INTERPRETER`, `PERMISSION_DENIED`, `SPAWN_FAILED` |
| Metadata | `MALFORMED_CONFIG`, `NO_EXECUTABLES`, `FOLDER_NOT_FOUND`, `NOT_A_DIRECTORY`, `IGNORED_FOLDER` |
| IPC Validation | `MISSING_SCRIPT_PATH`, `MISSING_TAB_ID`, `MISSING_FOLDER_PATH`, `MISSING_MAIN_SCRIPT`, `MISSING_SCRIPT_ID`, `INVALID_SCRIPT_PATH`, `INVALID_TAB_ID`, `INVALID_FOLDER_PATH`, `INVALID_SCRIPT_ID`, `INVALID_CONTENT`, `INVALID_SCRIPT_NAME` |
| General | `LOAD_SCRIPTS_FAILED`, `SAVE_LOGS_FAILED`, `IMPORT_FAILED`, `REMOVE_FAILED`, `NO_CONTENT` |

### 12.2 Error Mapping (`friendlyError()`)

| System Code | User-Facing Message |
|---|---|
| `ENOENT` | Script file not found |
| `EACCES` | Permission denied — check file permissions |
| `EISDIR` | Selected path is not a folder |
| (other) | Original `err.message` or "An unknown error occurred" |

### 12.3 Error Propagation Strategy

| Layer | Behavior |
|---|---|
| **Script executor** | Emits `'error'` event with `{tabId, text, timestamp}`, then emits `'complete'` with `exitCode: 1`, then processes queue |
| **Main IPC handler** | Catches exceptions, returns error objects or sends `app-error` event |
| **Preload** | Rejects promise with typed `Error` for invalid parameters |
| **Renderer** | Shows notification toast via `window.ui.showNotification(message, 'error')` |

Stack traces are **never** exposed to the renderer process — only human-readable messages.

---

## 13. UI & Styling

### 13.1 Design System (`renderer/styles.css`)

**CSS Custom Properties (Root Variables):**

| Category | Variables |
|---|---|
| Backgrounds | `--bg: #1e1e1e`, `--surface: #252526`, `--surface-2: #2d2d30`, `--surface-3: #3e3e42` |
| Text | `--text: #d4d4d4`, `--text-secondary: #cccccc`, `--muted: #858585`, `--text-link: #9cdcfe` |
| Semantic Colors | `--accent: #007acc`, `--success: #4ec9b0`, `--warning: #dcdcaa`, `--error: #f48771`, `--info: #9cdcfe` |
| Borders | `--border: #3e3e42`, `--border-focus: #007acc` |
| Fonts | `--font-family-ui` (system sans-serif), `--font-family-mono` (Consolas/Monaco) |
| Sizes | `--size-xs: 11px` through `--size-xxl: 24px` |
| Spacing | `--space-xs: 4px` through `--space-2xl: 32px` |

### 13.2 Component Inventory

| Component | CSS Class | Notes |
|---|---|---|
| App Layout | `#app` | CSS Grid: `grid-template-rows: auto 1fr` |
| Tab Bar | `.tab-bar` | Horizontal flex, overflow-x scroll |
| Tab Button | `.tab` | Status icon + title + close button; `.tab.active` has border accent |
| Tab Status | `.tab-status` + `.status-{running,success,error,queued}` | Color-coded, running has pulse animation |
| Home Page | `.home-tab` | Padding, relative positioning |
| Script Card | `.script-card` | Surface bg, border accent on hover, keyboard focusable |
| Import Zone | `.import-zone` | Dashed border, active state (drag-over) changes to solid |
| Empty State | `.empty-state` | Centered flex column with icon, message, hint |
| Execution Header | `.execution-header` | Script name + status badge |
| Terminal | `.terminal` | Monospace, dark bg, scrollable, styled scrollbar |
| Terminal Lines | `.terminal-line`, `.terminal-error`, `.terminal-system` | Timestamp + content, error in red, system in blue italic |
| Toolbar | `.execution-toolbar` | Run/Stop/Save/Clear buttons + line count info |
| Notification | `.notification` | Fixed bottom-right, colored left border, auto-dismiss |
| Dialog | `.dialog-overlay` + `.dialog` | Modal overlay, dismiss on click outside or Escape |
| Info Tooltip | `.info-tooltip` | 320px popover on hover, rich HTML content |
| GitHub Prompt | `.github-prompt-box` | Fixed bottom-right, terminal aesthetic, neon flicker animation |
| Button Variants | `.btn`, `.btn-secondary`, `.btn-danger`, `.btn-success`, `.btn-sm` | Consistent padding/border/transition |
| MW Logo | `.home-logo` | Fixed position, 60px, z-index 10 |

### 13.3 Animations

| Animation | Keyframe | Usage |
|---|---|---|
| Pulse | `pulse` — opacity 1→0.4→1 over 1.5s | Running status indicator |
| Slide In | `slideIn` — translateX(100%) to 0 | Notification toast appearance |
| Neon Flicker | `terminal-flicker-in` — 3 hard on/off cuts over 1.1s | GitHub prompt box appearance |
| Blink | `blink` — opacity 1→0→1 over 1s | Terminal cursor in GitHub prompt |

### 13.4 Accessibility

- All interactive elements have `tabindex`, `role`, and `aria-label` attributes
- Tab bar has `role="tablist"` with `aria-selected` states
- Tab content has `role="tabpanel"`
- Script cards are focusable with Enter/Space activation
- Close buttons are keyboard-accessible (Enter/Space)
- Dialog is modal with `aria-modal="true"` and Escape dismissal
- Focus-visible outlines via `*:focus-visible` selector
- Import zone has `role="region"` with `aria-label`
- Color scheme set to `dark` in `:root`

---

## 14. Build & Distribution

### 14.1 npm Scripts

| Script | Command | Purpose |
|---|---|---|
| `start` | `electron .` | Launch in development mode |
| `dev` | `electron .` | Alias for start |
| `build` | `electron-builder` | Package as distributable |
| `lint` | `echo "No lint configured yet"` | Placeholder |

### 14.2 electron-builder Configuration

Defined in `package.json` under the `build` key:

```json
{
  "appId": "com.automatahub.app",
  "productName": "AutomataHub",
  "files": [
    "app/**",
    "renderer/**",
    "resources/**",
    "scripts/**",
    "logs/.gitkeep"
  ],
  "mac": {
    "category": "public.app-category.developer-tools",
    "icon": "resources/icon.icns",
    "target": [{ "target": "dmg", "arch": ["arm64", "x64"] }]
  },
  "dmg": {
    "title": "AutomataHub"
  }
}
```

### 14.3 Build Artifacts

| Target | Format | Architectures |
|---|---|---|
| macOS | `.dmg` | arm64 (Apple Silicon), x64 (Intel) |

### 14.4 What Gets Packaged

- `app/` — main process source
- `renderer/` — renderer process source
- `resources/` — icons and images
- `scripts/` — sample scripts (shipped with app)
- `logs/.gitkeep` — empty log directory placeholder
- `node_modules/` — production dependencies (none; only devDependencies are excluded)

---

## 15. Dependencies

### 15.1 Direct Dependencies

| Package | Version | Type | Purpose |
|---|---|---|---|
| `automatahub-script-runner` | file:../automatahub-script-runner | dependency | Script Runner module (local dev link) |
| `electron` | ^41.0.2 | devDependency | Application runtime (Chromium + Node.js) |
| `electron-builder` | ^26.8.1 | devDependency | Packages app as `.dmg` distributable |

The hub uses only Node.js built-in modules at runtime:
- `path` — path manipulation
- `fs` — filesystem operations
- `events` — EventEmitter for ScriptExecutor
- `child_process` — spawn for script execution

### 15.2 Transitive Dependency Tree

- **Total packages:** 379 (per `package-lock.json`)
- **`node_modules/` size:** ~615 MB
  - `electron/`: ~300 MB (Chromium binary)
  - `app-builder-bin/`: ~209 MB (electron-builder platform binaries)
  - Remaining: ~106 MB (build tooling)

### 15.3 Known Advisories

| Package | Severity | Risk | Assessment |
|---|---|---|---|
| `yauzl` < 3.2.1 | Moderate | ZIP extraction vulnerability | **Install-time only** — used by electron's build chain, not at runtime. No user data passes through this path. Suppressed via `.npmrc` `audit-level=high`. |

---

## 16. Configuration Files

### 16.1 package.json

```json
{
  "name": "automata-hub",
  "productName": "AutomataHub",
  "version": "1.0.0",
  "description": "Modular Electron desktop hub for automation tools",
  "main": "app/main.js",
  "scripts": {
    "start": "electron .",
    "dev": "electron .",
    "lint": "echo \"No lint configured yet\"",
    "build": "electron-builder"
  },
  "dependencies": {
    "automatahub-script-runner": "file:../automatahub-script-runner"
  },
  "license": "ISC"
}
```

### 16.2 .editorconfig

- UTF-8 charset
- LF line endings
- 2-space indentation
- Trailing whitespace trimmed (except in `.md` files)
- Final newline inserted

### 16.3 .gitignore

```
node_modules/
dist/
.DS_Store
logs/*.txt
*.log
.env
```

Suppresses moderate-severity npm audit advisories (specifically the yauzl transitive dependency).

---

## 17. Known Limitations

| Area | Limitation | Impact |
|---|---|---|
| Execution Model | Sequential queue — only one script runs at a time | Users wanting parallel execution must open separate app instances |
| Script Sandbox | Scripts execute with the host user's full permissions | No resource limits, no capability dropping |
| Platform | macOS is the primary target; no Windows/Linux build targets configured yet | `electron-builder` config only lists `mac` target |
| Linting | No linter configured (`npm run lint` is a no-op) | Code quality relies on manual review |
| Testing | No automated test suite | Verification was manual QA pass |
| CI/CD | No continuous integration pipeline | Build/test/deploy is manual |
| Dev Dock Name | macOS may cache "Electron" in Dock during development | Full fix requires production build or Info.plist patching |
| Terminal Buffer | 1,000 line limit per tab | Very long script outputs lose early lines |
| Node.js Version | Developed on Node.js 18.12.1; some build dependencies expect 18.17+ or 20+ | EBADENGINE warnings during `npm install`; recommended upgrade to Node 20+ LTS |
| CSP | `style-src 'unsafe-inline'` is required for dynamic styles | Prevents strict CSP enforcement for styles |

---

## 18. Threat Model

### 18.1 Trust Boundaries

```
┌────────────────────────────────────────────────────────────┐
│                    TRUST BOUNDARY 1                        │
│               (User's Operating System)                    │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              TRUST BOUNDARY 2                       │   │
│  │           (Electron Main Process)                   │   │
│  │                                                     │   │
│  │  ┌──────────────────────────────────────────────┐   │   │
│  │  │           TRUST BOUNDARY 3                   │   │   │
│  │  │     (Preload — contextBridge)                │   │   │
│  │  │                                              │   │   │
│  │  │  ┌───────────────────────────────────────┐   │   │   │
│  │  │  │       TRUST BOUNDARY 4                │   │   │   │
│  │  │  │   (Renderer — Sandboxed Chromium)     │   │   │   │
│  │  │  │   - No Node.js API access             │   │   │   │
│  │  │  │   - CSP restricts resource loading    │   │   │   │
│  │  │  │   - Can only call window.api methods  │   │   │   │
│  │  │  └───────────────────────────────────────┘   │   │   │
│  │  └──────────────────────────────────────────────┘   │   │
│  │                                                     │   │
│  │  ┌──────────────────────────────────────────────┐   │   │
│  │  │           TRUST BOUNDARY 5                   │   │   │
│  │  │     (Child Processes — User Scripts)         │   │   │
│  │  │   - Run as current OS user                   │   │   │
│  │  │   - Full filesystem access                   │   │   │
│  │  │   - stdin is /dev/null                       │   │   │
│  │  │   - stdout/stderr piped to main process      │   │   │
│  │  └──────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

### 18.2 Attack Vectors & Mitigations

| # | Vector | Severity | Mitigation | Residual Risk |
|---|---|---|---|---|
| T1 | **Malicious script in `scripts/`** | High | User explicitly imports or places scripts. App validates folder structure only, not script content. | User must trust scripts they add. No sandboxing of script content. |
| T2 | **Path traversal via IPC** | High | `realpathSync()` + prefix check blocks `../` and symlink escapes | Low — defense tested against `..`, symlinks, and prefix collisions |
| T3 | **Shell injection via script name** | Medium | `shell: false` on `spawn()`. Script name only appears in display strings (`textContent`), never in commands. | Negligible |
| T4 | **XSS via script output** | Medium | All terminal output set via `textContent`, never `innerHTML` | Low — only the info tooltip uses `innerHTML` with hardcoded static HTML |
| T5 | **IPC channel pollution** | Medium | Preload whitelists 6 event channels. No `send()` exposed. Invoke handlers validate all params. | Low |
| T6 | **External URL manipulation** | Low | Hardcoded allowlist (`https://github.com/Rey-der`). `startsWith` match. | Very low — attacker would need to modify source code |
| T7 | **Log file injection** | Low | Filenames are sanitized (`[^a-z0-9\-_]` → `_`). Content is plaintext only. | Low — log content reflects raw script output |
| T8 | **Dependency supply chain** | Medium | Zero runtime deps. Build deps are well-known (electron, electron-builder). Lock file pins versions. | Medium — transitive deps are large (379 packages) |
| T9 | **CSP bypass** | Low | `'unsafe-inline'` for styles only. No `unsafe-eval`. Scripts restricted to `'self'`. | Low |
| T10 | **Resource exhaustion by child process** | Medium | SIGTERM → SIGKILL termination. No CPU/memory limits. | Medium — runaway scripts can consume resources until user clicks Stop |

---

## 19. Glossary

| Term | Definition |
|---|---|
| **Hub** | The AutomataHub core application — provides window, tabs, IPC bridge, module loading, and theming. Modules plug into the hub. |
| **Module** | A self-contained feature package with a `manifest.json`, main-process handlers, and renderer scripts/styles. Discovered from `modules/` or `node_modules/automatahub-*`. |
| **Manifest** | `manifest.json` — declares module id, name, IPC channels, tab types, renderer scripts, and styles. Required for module discovery. |
| **Main Process** | The Node.js process that manages the Electron window, IPC handlers, filesystem, and child processes |
| **Renderer Process** | The Chromium browser process that runs the UI. Sandboxed. No direct Node.js access. |
| **Preload Script** | JavaScript that runs before the renderer page loads, with access to both Node.js and DOM. Used to expose a safe API bridge. |
| **IPC** | Inter-Process Communication — Electron's mechanism for main ↔ renderer message passing |
| **IPC Bridge** | `app/core/ipc-bridge.js` — handles IPC handler registration with cleanup tracking. Modules register handlers through this. |
| **Module Bootstrap** | `renderer/module-bootstrap.js` — loads module CSS and scripts at startup, initializes dynamic IPC channels. |
| **Tab Type** | A registered tab kind (e.g., `script-home`, `script-execution`). Modules register tab types with `TabManager.registerTabType()`. |
| **Context Isolation** | Electron security feature that runs preload scripts in a separate JavaScript context from the renderer page |
| **CSP** | Content Security Policy — HTTP header that restricts which sources the renderer can load resources from |
| **CSS Variable Contract** | Hub provides `--hub-*` prefixed CSS variables as a stable theming API for modules |
| **Tab ID** | Unique string identifier for each tab. Used to route IPC events to the correct tab. |
| **Script Object** | `{id, name, path, description, language}` — the data structure representing a discovered script |
| **Execution Queue** | FIFO queue in ScriptExecutor. Only one script runs at a time; others wait in order. |
| **SIGTERM** | Unix signal requesting graceful process termination |
| **SIGKILL** | Unix signal forcing immediate process termination (cannot be caught) |
| **realpathSync** | Node.js function that resolves the absolute path of a file, following all symlinks |

---

*End of documentation.*
