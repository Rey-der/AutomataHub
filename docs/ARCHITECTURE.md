# Architecture Design

> **Updated for Modular Architecture v2.0.0** — March 15, 2026

## System Architecture

AutomataHub follows a **hub + plugin** architecture on Electron's multi-process model:

```
┌──────────────────────────────────────────────────────────────┐
│                  Main Process (Node.js)                       │
│                                                              │
│  ┌───────────────┐  ┌─────────────────────────────────────┐  │
│  │   main.js     │  │         core/                       │  │
│  │               │  │  module-loader.js  module-registry   │  │
│  │ - Window      │  │  ipc-bridge.js    path-utils.js     │  │
│  │ - Hub IPC     │  │  config-utils.js  event-bus.js      │  │
│  │ - Module      │  │  errors.js                          │  │
│  │   bootstrap   │  └─────────────────────────────────────┘  │
│  └───────┬───────┘                                           │
│          │           ┌────────────────────────────────────┐   │
│          ├──────────→│  Module main-handlers              │   │
│          │           │  (e.g. script-runner)              │   │
│          │           │  - IPC handlers via ipcBridge      │   │
│          │           │  - script-executor.js              │   │
│          │           └────────────────────────────────────┘   │
│          │                                                    │
└──────────┼────────────────────────────────────────────────────┘
           │ IPC (contextBridge, dynamic channel allowlist)
┌──────────┼────────────────────────────────────────────────────┐
│ Preload  │   preload.js                                       │
│          │   - Dynamic channel allowlist from module manifests │
│          │   - Generic invoke() / on() / off()                │
└──────────┼────────────────────────────────────────────────────┘
           │
┌──────────┼────────────────────────────────────────────────────┐
│          │ Renderer Process (Chromium)                         │
│          │                                                    │
│  ┌───────┴──────────────────────────────┐                     │
│  │      module-bootstrap.js             │                     │
│  │  - Load module CSS (<link>)          │                     │
│  │  - Load module scripts (<script>)    │                     │
│  │  - Init dynamic IPC channels         │                     │
│  └───────┬──────────────────────────────┘                     │
│          │                                                    │
│  ┌───────┴──────────┐  ┌──────────────────────────────────┐   │
│  │  tab-manager.js  │  │  Module renderer scripts         │   │
│  │  - registerType  │  │  (loaded dynamically)            │   │
│  │  - createTab     │  │  e.g. script-home.js             │   │
│  │  - per-type max  │  │       execution-tab.js           │   │
│  └──────────────────┘  └──────────────────────────────────┘   │
│                                                               │
│  ┌─────────┐  ┌────────────────────────────────────────────┐  │
│  │ ui.js   │  │  core.css — hub theme + --hub-* variables  │  │
│  └─────────┘  └────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

## Module Discovery

The hub discovers modules from two sources (local wins on ID conflict):

| Source | Path | Priority |
|---|---|---|
| Local modules | `modules/*/manifest.json` | High |
| Installed packages | `node_modules/automatahub-*/manifest.json` | Low |

### Module Manifest Schema

```json
{
  "id": "string (required)",
  "name": "string (required)",
  "version": "string",
  "description": "string",
  "mainEntry": "string (default: main-handlers.js)",
  "ipcChannels": ["array of channel names"],
  "tabTypes": [{"id": "string", "label": "string"}],
  "rendererScripts": ["array of relative paths"],
  "rendererStyles": ["array of relative paths"]
}
```

## Data Flow

### 1. Application Startup
```
User launches app
    ↓
Main: app.whenReady()
    ↓
setupHubIPC() — register hub channels
    ↓
loadModules():
    discoverModules(modules/)
    discoverInstalledModules(node_modules/automatahub-*)
    deduplicate (local wins)
    for each: register + setup(context)
    ↓
createWindow() — set CSP, load index.html
    ↓
Renderer loads core scripts (ui.js, tab-manager.js, home-tab.js)
    ↓
module-bootstrap.js:
    api.getModules() → get module descriptors
    initChannels() → dynamic IPC allowlist
    for each module: load CSS, then scripts
    ↓
Boot TabManager → show home dashboard
```

### 2. Module Loading (Per Module)
```
module-loader reads manifest.json
    ↓
Validate required fields (id, name)
    ↓
require(main-handlers.js) → get setup/teardown
    ↓
Resolve absolute paths for rendererScripts and rendererStyles
    ↓
registry.register(descriptor)
    ↓
mod.setup({ ipcBridge, mainWindow, paths, send })
    ↓
Module registers IPC handlers via ipcBridge.handle()
```

### 3. Script Execution Flow
```
User clicks script card in script-home tab
    ↓
TabManager.createTab('script-execution', name, data)
    ↓
User clicks "Run" in execution tab
    ↓
api.invoke('script-runner:run-script', {scriptPath, name, tabId})
    ↓
Preload → Main: ipcBridge handler
    ↓
executor.execute(job):
    if idle: _spawn(job)
    if running: queue + emit 'queue-status'
    ↓
stdout/stderr → 'script-runner:output' / 'script-runner:error'
    ↓
close → 'script-runner:complete' → _processNext()
```

## Process Communication

### Hub IPC Channels (always available)
| Channel | Direction | Purpose |
|---|---|---|
| `get-resources-path` | invoke | Get resources directory path |
| `open-external-url` | invoke | Open URL (allowlisted) |
| `hub:get-modules` | invoke | Get all module descriptors |
| `hub:get-allowed-channels` | invoke | Get dynamic push channel list |

### Module Channels (registered per-module)
Each module declares its channels in `manifest.json`. They are namespaced by convention (e.g., `script-runner:*`). The hub aggregates all push channels for the preload's dynamic allowlist.

## Security Considerations

1. **Context Isolation** — Renderer has no Node.js access
2. **CSP Headers** — `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`
3. **Dynamic Channel Allowlist** — Preload only allows channels declared in manifests
4. **IPC Bridge** — Modules register handlers through `ipcBridge`, enabling clean teardown
5. **Path Containment** — `resolveInside()` in shared utils blocks path traversal
6. **No raw ipcRenderer** — Only `window.api` surface exposed via contextBridge
7. **Module Isolation** — Modules share the hub's main process but use namespaced IPC channels

## CSS Architecture

```
core.css (hub)                Module styles (per-module)
├── Base variables             ├── Uses --hub-* variables
│   --bg, --text, etc.        ├── Module-specific selectors
├── --hub-* alias layer       └── Loaded via <link> at startup
│   --hub-bg → var(--bg)
├── Layout, tabs, buttons
└── Home tab, notifications
```

Modules use `--hub-*` prefixed variables for theming stability. The alias layer means the hub can refactor its internal variable names without breaking modules.

## Design Principles

1. **Hub + Plugin** — Hub provides shell, modules provide features
2. **Separate Repos** — Each module is independently versioned and distributed
3. **Convention over Configuration** — Module manifests follow a standard schema
4. **Local Priority** — `modules/` overrides `node_modules/` for development
5. **Namespace Isolation** — Module IPC channels and CSS selectors are namespaced
6. **Clean Teardown** — ipcBridge tracks handlers for removal on quit

---

**Architecture Review Date:** March 15, 2026
**Last Updated:** March 15, 2026
