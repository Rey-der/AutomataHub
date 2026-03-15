# AutomataHub TODO

> **MVP v1.0.0 Complete** — Script Runner core shipped.
> **v2.0.0 In Progress** — Refactor into modular hub architecture.

---

## Phase 0 — Rename & Rebrand ✓

- [x] Rename root folder from `script_runner` to `AutomataHub`
- [x] Update `package.json`: name → `automata-hub`, productName → `AutomataHub`
- [x] Update `package-lock.json` name field
- [x] Update `app/main.js`: `app.name`, window title
- [x] Update `renderer/index.html` `<title>`
- [x] Update `renderer/pages/home-tab.js` heading and aria-label
- [x] Update `DOCUMENTATION.md` all references
- [x] Update `README.md` all references
- [x] Update `docs/` all references (PROJECT_OVERVIEW, FILE_STRUCTURE, COMPONENT_SPECS, FEATURES)
- [x] Update build config: `appId` → `com.automatahub.app`, dmg title
- [x] Update example scripts' references (hello-world, hello-csharp)
- [x] Update `SECURITY.md` references
- [x] Verify app launches with `npm start` under new name

---

## Phase 1 — Module Loader (Hub Core) ✓

### 1A — Define the module contract ✓

- [x] Design `manifest.json` schema: `{ id, name, version, description, tabTypes[], ipcChannels[], rendererScripts[], mainEntry }`
- [x] Create `app/core/` directory
- [x] Create `app/core/module-loader.js` — scans `modules/` for subdirectories containing `manifest.json`
- [x] Create `app/core/module-registry.js` — stores loaded module metadata, exposes lookup methods
- [x] Move `app/errors.js` → `app/core/errors.js` (shared across all modules)
- [x] Verify the hub boots with zero modules loaded (empty `modules/` folder)

### 1B — Dynamic IPC channel registration ✓

- [x] Refactor `app/preload.js` → build `ALLOWED_CHANNELS` dynamically from loaded module manifests
- [x] Namespace IPC channels per module: `{moduleId}:{channel}` (e.g., `script-runner:run-script`)
- [x] Add `app/core/ipc-bridge.js` — utility for modules to register handlers safely
- [x] Validate that only declared channels are accessible from renderer

### 1C — Dynamic tab type registration ✓

- [x] Add `registerTabType(typeId, { render, onClose, maxTabs })` method to `TabManager`
- [x] Refactor `TabManager._renderContent()` to dispatch to registered renderers instead of hardcoded `HomeTab`/`ExecutionTab`
- [x] Remove hardcoded tab type checks — all types come from module registration
- [x] Keep "home" as a built-in tab type owned by the hub (module list / dashboard)

### 1D — Dynamic renderer loading ✓

- [x] Create `renderer/module-bootstrap.js` — loads module renderer scripts dynamically via `file://` URLs
- [x] Remove hardcoded `execution-tab.js` `<script>` tag from `index.html`
- [x] Load renderer scripts from each module's `renderer/` folder based on manifest `rendererScripts`
- [x] Verify script loading order: core (ui.js, tab-manager.js, home-tab.js) → module scripts → TabManager boot

### 1E — Hub Home tab becomes a dashboard ✓

- [x] Redesign Home tab to show installed modules as cards (not just scripts)
- [x] Each module card shows: name, version, description, "Open" button
- [x] Clicking a module card opens its default tab type (via `moduleOpeners` hook)
- [x] Move script-specific card rendering into the script-runner module

---

## Phase 2 — Extract Script Runner into Module ✓

### 2A — Create the module folder structure ✓

- [x] Create `modules/script-runner/manifest.json`
- [x] Create `modules/script-runner/main-handlers.js` — exports `setup({ ipcBridge, mainWindow, paths, send })`
- [x] `app/script-executor.js` stays in `app/` — module requires it via relative path `../../app/script-executor.js`
- [x] Create `modules/script-runner/renderer/script-home.js` (script list + import zone)
- [x] Create `modules/script-runner/renderer/execution-tab.js` (terminal view + IPC listeners)
- [x] Move script-specific styles from `renderer/styles.css` into `modules/script-runner/renderer/styles.css`

### 2B — Extract IPC handlers from main.js ✓

- [x] Move `getAvailableScripts()`, `saveLogs()`, script discovery functions into `modules/script-runner/main-handlers.js`
- [x] Move `validateDroppedFolder()`, `importScriptFolder()`, `removeScriptFolder()` into the module
- [x] Move `EXECUTABLE_EXTENSIONS`, `EXTENSION_LANGUAGE_MAP`, `IGNORED_ENTRIES` into the module
- [x] Keep only hub bootstrap logic in `app/main.js`: window creation, module loading, shared IPC (resources path, external URLs)

### 2C — Wire through module loader ✓

- [x] Register script-runner's IPC channels via `ipc-bridge.js`
- [x] Register script-runner's tab types (`script-home`, `script-execution`) via `TabManager.registerTabType()`
- [x] Load script-runner's renderer scripts via `module-bootstrap.js`
- [x] Hub boots with module: `[hub] Loaded 1 module(s): script-runner`
- [x] Verify full script execution flow end-to-end (run, queue, stop, save logs, import, remove)

### 2D — Validate standalone module repo structure ✓

- [x] Add `modules/script-runner/package.json` (name: `automatahub-script-runner`)
- [x] Add `modules/script-runner/README.md` — module-specific docs
- [x] Verify the module folder could be extracted to its own git repo
- [x] Test: delete `modules/script-runner/`, hub boots cleanly with empty dashboard

---

## Phase 3 — Shared Infrastructure ✓

### 3A — Shared styles system ✓

- [x] Split `renderer/styles.css` into `renderer/core.css` (layout, tabs, theme variables) and module-specific styles
- [x] Create CSS variable contract: modules use `--hub-*` variables for theming
- [x] Module styles are loaded dynamically alongside renderer scripts

### 3B — Shared utilities ✓

- [x] Create `app/core/path-utils.js` — safe path resolution (`resolveInside`), containment check (`isInside`), `ensureDir`
- [x] Create `app/core/config-utils.js` — `readJsonConfig` with fallback defaults and optional error callback
- [x] Refactor `script-executor.js` and `script-runner/main-handlers.js` to use shared utilities
- [x] Modules import shared utilities; no duplication

### 3C — Module communication ✓

- [x] Define inter-module event bus in `app/core/event-bus.js` (minimal `EventEmitter` singleton)
- [x] Modules can emit/listen to hub-level events (e.g., `module:activated`, `module:data-available`)
- [x] Kept minimal — only a skeleton until two modules actually need to talk

---

## Phase 4 — Prepare for Separate Repos ✓

### 4A — Repository structure ✓

- [x] Initialize `AutomataHub` as the main git repo (hub only)
- [x] Initialize `automatahub-script-runner` as a separate git repo
- [x] Add the module to hub via `npm install` with `file:../automatahub-script-runner` for local dev
- [x] Update module loader to scan `node_modules/automatahub-*` in addition to `modules/`
- [x] Document the two loading strategies: local `modules/` folder (dev) and `node_modules/` (installed)

### 4B — Per-module polish ✓

- [x] Each module repo has: `package.json`, `manifest.json`, `README.md`, `LICENSE`
- [x] Each module repo has a working example or demo script
- [x] Each module README explains: what it does, how to install into hub, how to develop standalone

### 4C — Hub README and docs ✓

- [x] Rewrite `README.md` for AutomataHub — explain the hub concept, list available modules
- [x] Update `DOCUMENTATION.md` for new architecture
- [x] Update `docs/ARCHITECTURE.md` with module system diagrams
- [x] Remove or archive MVP-frozen docs that no longer apply

---

## Phase 5 — New Modules (Future)

> Each module is a separate repo: `automatahub-{name}`

### SQL Viewer (`automatahub-sql-viewer`)

- [ ] Connect to SQLite / PostgreSQL / MySQL databases
- [ ] Browse tables, run queries, display results in a data grid
- [ ] Tab types: `sql-connection`, `sql-query`

### Network Monitor (`automatahub-netmon`)

- [ ] Ping sweep, port scan, latency tracking
- [ ] Real-time dashboard with charts
- [ ] Tab types: `net-dashboard`, `net-scan`

### System Monitor (`automatahub-sysmon`)

- [ ] CPU, memory, disk usage graphs
- [ ] Process list with search/filter
- [ ] Tab types: `sys-dashboard`

---

## Archived — MVP v1.0.0 Chunks (Completed)

<details>
<summary>Click to expand completed MVP tasks</summary>

### Chunk 0 - Documentation Alignment
- [x] Update docs to match tab-based architecture
- [x] Update file structure docs
- [x] Update development plan with tab manager, queue, import flow

### Chunk 1 - Project Bootstrap
- [x] Create package.json, install Electron, create base folders/files

### Chunk 2 - Main Process Core
- [x] BrowserWindow, preload bridge, IPC handlers, script-executor queue

### Chunk 3 - Renderer Tab System
- [x] Tab bar, max tabs, create/reuse/close, Home tab, Execution tab

### Chunk 4 - Script Folder Discovery and Import
- [x] Folder scanning, validation, drag-and-drop, metadata parsing, import

### Chunk 5 - Terminal and Logging
- [x] Streaming output, formatting, buffer limits, log saving

</details>
- [x] Support multiple saves per day for same script

## Chunk 6 - Reliability and Error Handling

- [x] Add centralized error messages for common failures
- [x] Handle script not found, permission denied, malformed metadata
- [x] Handle tab close while queued/running script safely
- [x] Add cleanup on app exit (child process and listeners)
- [x] Validate IPC payloads in preload/main boundary

## Chunk 7 - UI Polish

- [x] Finalize dark theme tokens and spacing
- [x] Add tab status indicators (running/success/error)
- [x] Add drag-over states for import zone
- [x] Improve empty states (no scripts, no output)
- [x] Ensure keyboard focus visibility and logical tab order

## Chunk 8 - Manual QA Pass

- [x] Startup scan works with valid and invalid script folders
- [x] Tab creation/reuse/close behavior matches spec
- [x] Queue order is correct for multiple run requests
- [x] Output routing by tabId is always correct
- [x] Save Logs works repeatedly and paths are correct
- [x] Import flow works for drag-drop and finder paths
- [x] Test negative scenarios and verify user-facing error messages

## Chunk 9 - Wrap-Up

- [x] Update root README.md with setup and usage
- [x] Add quickstart sample script folder in scripts/
- [x] Freeze docs versions after implementation parity
- [x] Tag MVP milestone

## Suggested Execution Order

1. Complete Chunk 0 fully.
2. Implement Chunks 1-3 to get a runnable tab-based shell.
3. Implement Chunk 4 and Chunk 5 for core product value.
4. Finish Chunks 6-9 for stability and release readiness.
