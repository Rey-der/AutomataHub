# AutomataHub — Technical Documentation

> **Version:** 1.0.0  
> **Runtime:** Electron 28.3.3 · Node.js 18+  
> **Platform:** macOS (primary), Windows (build target configured)  
> **License:** ISC

This document covers the **hub core** and **Database Manager**. Module-specific documentation lives in each module's own README:

- [Script Runner](modules/script_runner/README.md)
- [NetOps Monitor](modules/netops/README.md)
- [SQL Monitor](modules/sql_visualizer/README.md)

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Main Process](#2-main-process)
3. [Preload Bridge](#3-preload-bridge)
4. [Renderer Process](#4-renderer-process)
5. [Module System](#5-module-system)
6. [Database Manager](#6-database-manager)
7. [IPC Protocol](#7-ipc-protocol)
8. [Security Model](#8-security-model)
9. [Data Flow Diagrams](#9-data-flow-diagrams)
10. [UI & Styling](#10-ui--styling)
11. [Build & Distribution](#11-build--distribution)
12. [Dependencies](#12-dependencies)
13. [Configuration Files](#13-configuration-files)
14. [Known Limitations](#14-known-limitations)
15. [Glossary](#15-glossary)

---

## 1. System Architecture

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
│  │ - Module    │  │  user-prefs.js    errors.js          │   │
│  │   bootstrap │  │  db-credentials.js  db-scanner.js    │   │
│  └──────┬──────┘  └──────────────────────────────────────┘   │
│         │                                                    │
│         │          ┌─────────────────────────────────────┐   │
│         ├──────────│   Loaded Modules (main-handlers.js) │   │
│         │          │   Scoped ipcBridge + eventBus each  │   │
│         │          └─────────────────────────────────────┘   │
│         │                                                    │
└─────────┼────────────────────────────────────────────────────┘
          │ IPC (contextBridge, dynamic channel allowlist)
┌─────────┼────────────────────────────────────────────────────┐
│ Preload │   preload.js                                       │
│ Bridge  │   - Dynamic channel allowlist from module manifests│
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
│  ┌──────┴──────────┐  ┌──────────────────────────────┐       │
│  │  home-tab.js    │  │  Module renderer scripts     │       │
│  │  (hub dashboard)│  │  (loaded dynamically)        │       │
│  ├─────────────────┤  └──────────────────────────────┘       │
│  │ db-manager-tab  │                                         │
│  │ (DB credentials)│                                         │
│  └─────────────────┘                                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │         core.css — Hub theme & --hub-* variables     │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

### Process Boundaries

| Boundary | Enforcement |
|---|---|
| Main ↔ Preload | `contextBridge.exposeInMainWorld()` — only `window.api` object exposed |
| Preload ↔ Renderer | Context isolation enabled; no `nodeIntegration`; sandbox enabled |
| Main ↔ Child Process | `child_process.spawn()` with `shell: false`, `stdio: ['ignore', 'pipe', 'pipe']` |
| Renderer ↔ Network | CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` |

---

## 2. Main Process

**File:** `app/main.js`

### Initialization Sequence

```
bootstrap()
  → await app.whenReady()
  → Set macOS Dock icon
  → setupHubIPC()                // Register all hub handlers
  → initDefaultCredentials()     // Set default '0000' for discovered DBs
  → loadModules()                // Discover + register + setup modules
  → logCredentialStatus()        // Log DB credential state
  → createWindow()               // BrowserWindow + CSP headers
  → app.on('activate')           // Re-create window on macOS dock click
```

### Window Configuration

```javascript
{
  width: 1280, height: 800,
  minWidth: 960, minHeight: 640,
  backgroundColor: '#1e1e1e',
  title: 'AutomataHub',
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
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

### Hub IPC Handlers

| Channel | Returns | Purpose |
|---|---|---|
| `get-resources-path` | `string` | Absolute path to `resources/` |
| `open-external-url` | void | Open URL in browser (allowlist: `github.com/Rey-der`) |
| `hub:get-modules` | `Module[]` | All loaded module descriptors |
| `hub:get-allowed-channels` | `string[]` | Aggregated push channels from all modules |
| `prefs:get` | `{ modules: { [id]: { favorite, autoStart } } }` | Full user preferences |
| `prefs:get-module` | `{ favorite, autoStart }` | Preferences for one module |
| `prefs:set-module` | `{ favorite, autoStart }` | Store module preferences |
| `hub:scan-databases` | `Database[]` | Scan project for SQLite files |
| `hub:get-db-credentials` | `Credential[]` | List credential status (no passwords exposed) |
| `hub:set-db-password` | `{ success, error? }` | Encrypt and store a password |
| `hub:change-db-password` | `{ success, error? }` | Change password (verifies old first) |
| `hub:remove-db-password` | `{ success, error? }` | Remove credential (requires verification) |
| `hub:test-db-connection` | `{ success, tables?, error? }` | Test DB connectivity (better-sqlite3 → sql.js fallback) |

### Module Setup Context

Each module's `setup()` receives:

```javascript
{
  ipcBridge,                              // Scoped IPC handler registration (manifest channels only)
  eventBus,                               // Scoped EventBus handle (frozen { on, off, emit })
  mainWindow: () => BrowserWindow,        // Window reference (lazy)
  paths: { root, modules, resources },    // Hub directories
  send: (channel, data) => void,          // Push to renderer
  getDbCredential: (dbPath) => string|null // Retrieve decrypted password
}
```

The `ipcBridge` is scoped: it only allows registering handlers for channels declared in the module's `manifest.json`. Attempts to register undeclared channels are blocked with a warning.

The `eventBus` is a frozen handle created by `createModuleBus(moduleId)`. It automatically tags emitted payloads with `{ source: moduleId }` and validates that payloads are plain objects.

### App Lifecycle

- **`window-all-closed`** — quits on non-macOS platforms
- **`activate`** — re-creates window on macOS if none exist
- **`before-quit`** — calls `teardown()` on each module, `ipcBridge.removeAll()`, removes hub handlers

---

## 3. Preload Bridge

**File:** `app/preload.js`

### Exposed API (`window.api`)

| Method | Signature | Purpose |
|---|---|---|
| `getResourcesPath()` | `() → Promise<string>` | Get resources directory path |
| `openExternalUrl(url)` | `(string) → Promise<void>` | Open external URL (allowlisted) |
| `getModules()` | `() → Promise<Module[]>` | Fetch loaded modules |
| `getPrefs()` | `() → Promise<Prefs>` | Get user preferences |
| `getModulePrefs(id)` | `(string) → Promise<ModulePrefs>` | Get per-module preferences |
| `setModulePrefs(id, updates)` | `(string, object) → Promise<ModulePrefs>` | Set per-module preferences |
| `initChannels()` | `() → Promise<string[]>` | Bootstrap dynamic channel allowlist |
| `invoke(channel, args)` | `(string, any?) → Promise<any>` | Generic IPC invoke |
| `on(event, callback)` | `(string, Function) → () => void` | Subscribe to push event; returns unsubscribe |
| `off(event, callback)` | `(string, Function) → void` | Unsubscribe from push event |

### Dynamic Channel Allowlisting

Push channels (main → renderer) are dynamically allowlisted at startup:

1. Module manifests declare `ipcChannels`
2. The registry aggregates all push channels via `hub:get-allowed-channels`
3. `initChannels()` adds them to the internal allowlist
4. `on()` and `off()` silently reject channels not in the list

Hub channels (`app-error`, `hub:db-auth-failed`, etc.) are always allowed.

### Security Properties

- No raw `ipcRenderer` exposure — only the `window.api` wrapper
- No `send()` exposed — renderer can only invoke (request-response) or listen
- **`invoke()` channel allowlist** — rejects channels not in the allowlist (hub channels + module-declared channels)
- **`on()` / `off()` channel allowlist** — silently rejects undeclared push events
- Two-gate validation — preload and main process both validate independently

---

## 4. Renderer Process

### HTML Shell (`renderer/index.html`)

```html
<div id="app">
  <div id="main-tab-bar" class="tab-bar main-tab-bar">
    <!-- Home tab button + module tab overflow -->
  </div>
  <main id="tab-content" class="tab-content">
    <!-- Dynamic tab content -->
  </main>
</div>
```

Scripts loaded in order: `ui.js` → `tab-manager.js` → `home-tab.js` → `db-manager-tab.js` → `chart.js` → `module-bootstrap.js` (type="module").

### Tab Manager (`renderer/tab-manager.js`)

**Class:** `TabManager`

| Method | Purpose |
|---|---|
| `registerTabType(typeId, opts)` | Register a tab type with `render(tab, container)` callback, optional `onClose`, optional `maxTabs` |
| `createTab(type, title, data?, opts?)` | Create tab; returns null if type limit reached |
| `switchTab(tabId)` | Activate tab; calls registered render callback |
| `closeTab(tabId)` | Close tab; calls `onClose` if registered; switches to most recent tab from history |
| `updateTabStatus(tabId, status)` | Update status indicator (idle / running / success / error / queued) |
| `getTab(tabId)` | Retrieve tab by ID |
| `getTabsByType(type)` | Get all tabs of a given type |
| `hasTabType(typeId)` | Check if a type is registered |

**Tab Object:**

```javascript
{
  id: string,
  type: string,        // e.g. 'home', 'db-manager', 'script-home'
  title: string,
  status: 'idle' | 'running' | 'success' | 'error' | 'queued',
  target: 'main' | 'module',
  reuseKey?: string,   // for tab deduplication
  ...customData
}
```

Tab history (up to 50 entries) is tracked for smart tab switching on close.

### Module Bootstrap (`renderer/module-bootstrap.js`)

Boot sequence:

1. `api.initChannels()` — fetch and set up dynamic push channel allowlist
2. `api.getModules()` — fetch all module descriptors
3. For each module: load CSS `<link>` tags, then `<script>` tags (sequential)
4. Create `TabManager`, register hub tab types (`db-manager`)
5. Switch to home tab
6. Listen for `hub:db-auth-failed` push events
7. Auto-start modules with `autoStart` preference (50 ms delay, background tabs)

### Home Tab (`renderer/pages/home-tab.js`)

Hub dashboard that displays installed modules as cards:

- **Module cards** — name, version, description, Favorite toggle, Auto-start toggle, Open button
- **Filtering** — text search across name + description
- **View filters** — All / Favorites / Auto-start
- **Sorting** — Default (favorites first) / A-Z / Z-A
- **Sidebar** — collapsible, shows counts per view and a DB Manager access button
- **Module opening** — checks for custom opener via `globalThis._hub.moduleOpeners[id]`, falls back to creating/reusing a tab with the module's first tab type

### UI Utilities (`renderer/ui.js`)

Exposed on `globalThis.ui`:

| Function | Purpose |
|---|---|
| `showNotification(message, type?, duration?)` | Temporary toast notification (default 3000 ms) |
| `formatTimestamp(date?)` | ISO string from date |
| `sanitizeScriptName(name)` | Lowercase, non-alphanumeric → `-` |
| `truncateOutput(text, maxLines?)` | Keep last N lines (default 1000) |

---

## 5. Module System

### Discovery (`app/core/module-loader.js`)

Modules are discovered from two sources:

| Source | Priority | Location |
|---|---|---|
| Local modules | High (wins on conflict) | `modules/` subdirectories containing `manifest.json` |
| Installed packages | Low (fallback) | `node_modules/automatahub-*` containing `manifest.json` |

### Manifest Schema (`manifest.json`)

```javascript
{
  id: string,                    // Required — unique module identifier
  name: string,                  // Required — display name
  version: string,               // Default: '0.0.0'
  description: string,           // Default: ''
  mainEntry: string,             // Default: 'main-handlers.js'
  ipcChannels: string[],         // Channels for renderer allowlist
  tabTypes: [{ id, label }],     // Tab type registrations
  rendererScripts: string[],     // Relative paths to .js files
  rendererStyles: string[]       // Relative paths to .css files
}
```

### Module Descriptor (runtime)

After loading, each module is represented as:

```javascript
{
  id, name, version, description,
  ipcChannels: string[],
  tabTypes: TabType[],
  rendererScripts: string[],     // Resolved to absolute paths
  rendererStyles: string[],      // Resolved to absolute paths
  moduleDir: string,
  setup?: (context) => void,     // From main-handlers.js exports
  teardown?: () => void
}
```

### Registry (`app/core/module-registry.js`)

In-memory store for loaded module descriptors.

| Method | Purpose |
|---|---|
| `register(mod)` | Store module; throws on duplicate ID |
| `get(id)` | Retrieve single module |
| `getAll()` | All registered modules |
| `getAllowedChannels()` | Aggregated `ipcChannels` from all modules |
| `getTabTypes()` | Aggregated tab types tagged with `moduleId` |

### IPC Bridge (`app/core/ipc-bridge.js`)

Safe handler registration wrapper for modules. Tracks all registrations for cleanup on `before-quit`. When constructed with an `allowedChannels` set, only channels in that set can be registered — this prevents modules from hijacking undeclared channels.

| Method | Purpose |
|---|---|
| `constructor(allowedChannels?)` | Optional `Set<string>` — restricts which channels can be registered |
| `handle(channel, handler)` | Register an IPC handler; blocked if channel is not in the allowlist |
| `removeAll()` | Remove all handlers registered through this bridge |
| `getRegisteredChannels()` | List registered channels (debugging) |

Each module receives its own scoped `IpcBridge` instance constructed with the channels from its `manifest.json`.

### Shared Utilities

**Path Utils** (`app/core/path-utils.js`):

| Function | Purpose |
|---|---|
| `resolveInside(targetPath, baseDir)` | Resolve path and verify containment; throws on escape |
| `isInside(targetPath, baseDir)` | Check containment (boolean, no throw) |
| `ensureDir(dirPath)` | Create directory recursively if missing |

**Config Utils** (`app/core/config-utils.js`):

| Function | Purpose |
|---|---|
| `readJsonConfig(filePath, onError?, fallback)` | Read JSON file; returns fallback on missing/malformed |

**Event Bus** (`app/core/event-bus.js`):

Secured inter-module communication bus. Modules receive scoped handles via `createModuleBus(moduleId)` during setup.

| Export | Purpose |
|---|---|
| `hubBus` | Raw `EventEmitter` (max 50 listeners) — for hub-level code only |
| `createModuleBus(moduleId)` | Returns a frozen `{ on, off, emit }` handle scoped to the module |
| `registerEvent(eventName)` | Add a new event name to the allowlist at runtime |
| `ALLOWED_EVENTS` | `Set<string>` of declared event names |

**Default allowed events:** `module:activated`, `module:deactivated`, `module:data-available`, `module:error`

**Security controls:**
- **Event allowlist** — only events in `ALLOWED_EVENTS` can be emitted or listened to
- **Payload validation** — payloads must be plain objects (`Object.getPrototypeOf(val) === Object.prototype`); functions, arrays, and primitives are blocked
- **Source tagging** — every emission is tagged with `{ source: moduleId }` automatically
- **Frozen handles** — module bus handles are `Object.freeze()`d to prevent mutation

```javascript
// Module usage (via scoped handle)
const bus = createModuleBus('netops');
bus.on('module:data-available', (data) => { /* data.source === 'netops' */ });
bus.emit('module:data-available', { key: 'value' });
// Listeners receive: { source: 'netops', key: 'value' }
```

**User Preferences** (`app/core/user-prefs.js`):

Persistent settings stored at `{userData}/user-prefs.json`.

| Function | Purpose |
|---|---|
| `getPrefs()` | Full preferences object (cached after first read) |
| `getModulePrefs(moduleId)` | Per-module prefs with defaults (`{ favorite: false, autoStart: false }`) |
| `setModulePrefs(moduleId, updates)` | Merge updates and persist to disk |

**Error Constants** (`app/core/errors.js`):

Exports `ERROR_MESSAGES` (categorized constants for script, metadata, IPC validation, and general errors) and `friendlyError(err)` which maps `errno` codes to user-facing messages.

---

## 6. Database Manager

The DB Manager is a hub-level feature providing encrypted credential storage and database discovery across the project.

### Credential Store (`app/core/db-credentials.js`)

Passwords are encrypted using Electron's `safeStorage` API (macOS Keychain, Windows DPAPI, Linux libsecret) and stored in `{userData}/db-credentials.json` with file mode `0o600`.

| Function | Signature | Purpose |
|---|---|---|
| `getCredential(dbPath)` | `(string) → string \| null` | Decrypt and return password |
| `setCredential(dbPath, password)` | `(string, string) → boolean` | Encrypt and store (validates 4–256 chars) |
| `removeCredential(dbPath)` | `(string) → boolean` | Delete stored credential |
| `hasCredential(dbPath)` | `(string) → boolean` | Check if a credential exists |
| `listCredentials()` | `() → [{ path, hasPassword }]` | List all entries (never exposes passwords) |
| `verifyCredential(dbPath, password)` | `(string, string) → boolean` | Compare plaintext against stored |

The credential store is passed to modules as `getDbCredential(dbPath)` in the setup context, allowing modules to retrieve decrypted passwords for their databases without direct access to the store.

### Database Scanner (`app/core/db-scanner.js`)

Discovers `.db`, `.sqlite`, and `.sqlite3` files across the project tree.

```javascript
scanForDatabases(rootDir, modulesDir?, userDataDir?) → Database[]
```

**Scan locations:**

| Location | Depth | Source Tag |
|---|---|---|
| `data/` | 3 | `hub` |
| `modules/{id}/` | 4 | `module:{id}` (reads `manifest.json`) |
| Project root | 1 (top-level only) | `project` |
| Electron userData | 3 | `module:{dirname}` |

**Skips:** `node_modules`, `.git`, `logs`

**Returns:**

```javascript
{
  path: string,           // Absolute path
  relativePath: string,   // Relative to rootDir
  source: string,         // 'hub' | 'project' | 'module:{id}'
  sizeBytes: number
}
```

### DB Manager UI (`renderer/pages/db-manager-tab.js`)

Registered as tab type `db-manager` (max 1 instance). Accessed via the sidebar button on the home dashboard.

**Features:**

- **Database list** — cards for each discovered database showing name, path, size, source badge (Hub / Module / Project), and credential status
- **Statistics bar** — total databases, with password, without password
- **Set password** — form with 4–256 character validation, show/hide toggle
- **Change password** — requires current password, then new password
- **Remove password** — requires current password verification
- **Connection test** — tries better-sqlite3 first, falls back to sql.js; shows table count on success
- **Auth failure alerts** — listens for `hub:db-auth-failed` push events from modules that failed credential auth at startup

### Connection Testing (`hub:test-db-connection`)

The test handler opens the database read-only and reports the result:

1. Try **better-sqlite3**: open with `readonly: true`, apply `PRAGMA key` if password provided (hex-encoded to prevent injection), query `sqlite_master` for table names
2. If better-sqlite3 fails, try **sql.js**: read file as buffer, create in-memory DB, apply same PRAGMA, query tables
3. Return `{ success: true, tables: [...] }` or `{ success: false, error: message }`

### Default Credentials

On first startup, `initDefaultCredentials()` scans for databases and sets a default password (`0000`) for any database that doesn't already have a credential stored. This ensures module databases are accessible out of the box.

---

## 7. IPC Protocol

### Channel Naming Convention

| Prefix | Scope |
|---|---|
| (none) | Hub utility channels (`get-resources-path`, `open-external-url`) |
| `hub:` | Hub feature channels (`hub:scan-databases`, `hub:get-modules`) |
| `prefs:` | User preference channels |
| `{module-id}:` | Module-scoped channels (e.g. `script-runner:run-script`, `netops:add-host`) |

### Validation Chain

```
Renderer                     Preload                        Main Process
────────────────────────────────────────────────────────────────────────
User action              →   Type checks                →   Scoped IPC Bridge
                             invoke() channel allowlist      channel enforcement
                             on()/off() channel allowlist    Type + content checks
                             Reject with Error               Business logic validation
                             if invalid                      Return error object
                                                             if invalid
```

Every invoke passes through **three validation gates**: the preload `invoke()` allowlist, the preload `on()`/`off()` allowlist (for push events), and the main-process scoped IPC Bridge channel enforcement.

### Push Events (main → renderer)

Push events use `mainWindow.webContents.send(channel, data)`. The renderer subscribes via `api.on(channel, callback)`. Only channels declared in module manifests or in the hub's built-in list are allowed.

Hub push channels: `app-error`, `hub:db-auth-failed`.

---

## 8. Security Model

### Electron Configuration

| Setting | Value | Purpose |
|---|---|---|
| `contextIsolation` | `true` | Renderer runs in separate JS context from preload |
| `nodeIntegration` | `false` | No `require()` or `process` in renderer |
| `sandbox` | `true` | Full Chromium sandbox for renderer |
| CSP | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` | Restricts loading to app origin |

### IPC Security

- **No raw `ipcRenderer`** — only the `window.api` wrapper is accessible
- **No `send()`** — renderer can only invoke (request-response) or subscribe to allowed push events
- **Three-gate validation:**
  1. **Preload `invoke()`** — rejects channels not in the dynamic allowlist
  2. **Preload `on()` / `off()`** — silently rejects undeclared push channels
  3. **Main-process IPC Bridge** — each module's scoped bridge rejects handler registration for undeclared channels
- **Scoped IPC bridges** — each module receives its own `IpcBridge` constructed with its manifest's `ipcChannels` set

### EventBus Security

| Control | Implementation |
|---|---|
| Event allowlist | Only events in `ALLOWED_EVENTS` can be emitted or listened to |
| Payload validation | `isPlainObject()` check — blocks functions, arrays, class instances |
| Source tagging | Payloads automatically tagged with `{ source: moduleId }` |
| Frozen handles | `Object.freeze()` on module bus handles prevents property injection |
| Scoped emission | Modules cannot impersonate other modules — source is set by the handle |

### File System Security

| Control | Implementation |
|---|---|
| Path traversal prevention | `resolveInside()` using `realpathSync()` + prefix check |
| Symlink resolution | `realpathSync()` resolves symlinks before path comparison |
| No user-controlled `require()` | All module imports are static |

### Credential Security

| Control | Implementation |
|---|---|
| Encryption at rest | `safeStorage.encryptString()` — OS keychain backed |
| File permissions | `0o600` on credential store file |
| No plaintext exposure | `listCredentials()` never returns passwords; only `hasPassword` boolean |
| PRAGMA injection prevention | Passwords hex-encoded before PRAGMA key interpolation — only `[0-9a-f]` reaches SQL |
| Password validation | 4–256 character length enforced on set/change |

### External URL Security

Hardcoded allowlist: only URLs starting with `https://github.com/Rey-der` pass. All others are silently dropped.

### Process Execution Security

| Control | Implementation |
|---|---|
| `shell: false` | Prevents shell metacharacter injection |
| Explicit interpreter | Extension-to-interpreter mapping; never executes files directly |
| `stdio: ['ignore', 'pipe', 'pipe']` | No stdin access from child processes |
| Graceful termination | SIGTERM → 5 s timeout → SIGKILL fallback |
| Cleanup on quit | Module `teardown()` + `ipcBridge.removeAll()` in `before-quit` |

---

## 9. Data Flow Diagrams

### Application Startup

```
1. Electron app.whenReady()
2. Set macOS Dock icon
3. setupHubIPC() — register hub + prefs + DB Manager channels
4. initDefaultCredentials() — scan DBs, set '0000' for uncredentialed ones
5. loadModules():
   a. discoverModules(modules/) → local modules
   b. discoverInstalledModules(node_modules/) → installed modules
   c. Deduplicate (local wins)
   d. For each: registry.register(mod)
   e. Create scoped IpcBridge(allowedChannels) from manifest ipcChannels
   f. Create scoped eventBus via createModuleBus(mod.id)
   g. mod.setup({ ipcBridge, eventBus, mainWindow, paths, send, getDbCredential })
6. logCredentialStatus() — log DB credential state
7. createWindow() — CSP headers, BrowserWindow, load index.html
8. Renderer loads:
   a. core.css — hub theme + CSS variable contract
   b. ui.js, tab-manager.js, home-tab.js, db-manager-tab.js
   c. module-bootstrap.js:
      i.   api.initChannels() → dynamic push channel allowlist
      ii.  api.getModules() → fetch module descriptors
      iii. For each module: load CSS <link>, then <script> tags
      iv.  Create TabManager, register db-manager tab type
      v.   Switch to home tab
      vi.  Auto-start modules with autoStart preference
```

### DB Manager Password Flow

```
1. User opens DB Manager tab (sidebar button)
2. Renderer: invoke('hub:scan-databases') → discover all SQLite files
3. Renderer: invoke('hub:get-db-credentials') → credential status per DB
4. Cards rendered with password status badges

Set Password:
5a. User enters password (4–256 chars) → clicks Save
6a. invoke('hub:set-db-password', { dbPath, password })
7a. Main: validates length → safeStorage.encryptString() → writes file (0o600)

Change Password:
5b. User enters current + new password → clicks Save
6b. invoke('hub:change-db-password', { dbPath, oldPassword, newPassword })
7b. Main: verifyCredential(old) → if match → setCredential(new)

Remove Password:
5c. User enters current password → clicks Remove
6c. invoke('hub:remove-db-password', { dbPath, password })
7c. Main: verifyCredential(password) → if match → removeCredential(dbPath)

Test Connection:
5d. User clicks Test → invoke('hub:test-db-connection', { dbPath, password? })
6d. Main: open DB read-only → PRAGMA key (hex-encoded) → query sqlite_master
7d. Returns { success, tables } or { success: false, error }
```

### Module Tab Creation

```
1. User clicks "Open" on module card
2. HomeTab checks globalThis._hub.moduleOpeners[moduleId] for custom opener
3. If none: createTab(firstTabType, moduleName, {}, { reuseKey })
4. TabManager checks for existing tab with same reuseKey
5. If found: switchTab(existingId)
6. If not: create new tab → call render callback → switch
```

---

## 10. UI & Styling

### Design Tokens (`renderer/core.css`)

**Backgrounds:**
`--bg: #1e1e1e` · `--surface: #252526` · `--surface-2: #2d2d30` · `--surface-3: #3e3e42`

**Text:**
`--text: #d4d4d4` · `--text-secondary: #cccccc` · `--muted: #858585` · `--text-link: #9cdcfe`

**Semantic Colors:**
`--accent: #007acc` · `--success: #4ec9b0` · `--warning: #dcdcaa` · `--error: #f48771` · `--info: #9cdcfe`

**Borders:** `--border: #3e3e42` · `--border-focus: #007acc`

**Typography:**
- UI: `-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif`
- Mono: `"Consolas", "Monaco", "Courier New", monospace`

**Sizing:** `--size-xs: 11px` → `--size-xxl: 24px`

**Spacing:** `--space-xs: 4px` → `--space-2xl: 32px`

### Hub CSS Variable Contract

Modules use `--hub-*` prefixed variables for stable theming:

`--hub-bg`, `--hub-surface`, `--hub-surface-2`, `--hub-text`, `--hub-muted`, `--hub-accent`, `--hub-success`, `--hub-warning`, `--hub-error`, `--hub-border`, `--hub-font-ui`, `--hub-font-mono`

### Key Components

| Component | CSS Class | Notes |
|---|---|---|
| Tab Bar | `.tab-bar`, `.main-tab-bar` | Flex layout; divider between home and module tabs |
| Tab Button | `.tab`, `.tab.active` | Status icon + title + close; active has border accent |
| Tab Status | `.status-{running,success,error,queued}` | Color-coded; running has pulse animation |
| Module Cards | `.hub-modules-grid`, `.script-card` | CSS grid, 260 px min columns |
| DB Manager | `.dbm-container`, `.dbm-grid`, `.dbm-card` | Grid layout with source badges |
| Buttons | `.btn`, `.btn-secondary`, `.btn-danger`, `.btn-sm` | Consistent padding/border/transition |
| Notifications | `.notification`, `.notification-{type}` | Fixed bottom-right, auto-dismiss |

### Animations

| Animation | Keyframe | Usage |
|---|---|---|
| Pulse | `pulse` — opacity 1→0.4→1 / 1.5 s | Running status indicator |
| Slide In | `slideIn` — translateX(100%) → 0 | Notification toast |

### Accessibility

- Tab bar: `role="tablist"` with `aria-selected` states
- Tab content: `role="tabpanel"`
- Interactive elements have `tabindex`, `role`, and `aria-label`
- Focus-visible outlines via `*:focus-visible`
- Color scheme set to `dark` in `:root`

---

## 11. Build & Distribution

### npm Scripts

| Script | Command | Purpose |
|---|---|---|
| `start` / `dev` | `electron .` | Launch in development mode |
| `test` | `node --test tests/*.test.js` | Run unit tests |
| `build` | `electron-builder` | Package all platforms |
| `build:mac` | `electron-builder --mac` | macOS DMG (arm64 + x64) |
| `build:win` | `electron-builder --win` | Windows NSIS installer |
| `rebuild-natives` | `node-gyp rebuild ...` | Rebuild better-sqlite3 for Electron |

### electron-builder Config

```json
{
  "appId": "com.automatahub.app",
  "productName": "AutomataHub",
  "files": ["app/**", "renderer/**", "resources/**", "scripts/**", "modules/**", "logs/.gitkeep"],
  "mac": { "category": "public.app-category.developer-tools", "target": "dmg" },
  "win": { "target": "nsis" },
  "asarUnpack": ["**/node_modules/better-sqlite3/**"]
}
```

### Packaged Contents

`app/` · `renderer/` · `resources/` · `scripts/` · `modules/` · `logs/.gitkeep` · production `node_modules/`

---

## 12. Dependencies

### Runtime Dependencies

| Package | Version | Purpose |
|---|---|---|
| `better-sqlite3` | ^11.10.0 | Fast synchronous SQLite driver |
| `sql.js` | ^1.14.1 | WASM SQLite fallback (no native compilation) |
| `chart.js` | ^4.5.1 | Chart rendering for module UIs |
| `uplot` | ^1.6.32 | High-performance time-series plotting |

### Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `electron` | ^28.3.3 | Application runtime |
| `electron-builder` | ^26.8.1 | App packaging and distribution |

The hub core uses only Node.js built-in modules at runtime: `path`, `fs`, `events`, `child_process`.

---

## 13. Configuration Files

| File | Purpose |
|---|---|
| `package.json` | npm manifest, scripts, dependencies, electron-builder config |
| `.editorconfig` | UTF-8, LF, 2-space indent, trim trailing whitespace |
| `.gitignore` | Ignores `node_modules/`, `dist/`, `.DS_Store`, `logs/`, `*.log`, `.env` |
| `.npmrc` | `audit-level=high` — suppresses moderate-severity advisories |

---

## 14. Known Limitations

| Area | Limitation |
|---|---|
| Platform | macOS is the primary development target; Windows builds configured but less tested |
| CSP | `style-src 'unsafe-inline'` required for dynamic styling |
| Dev Dock Name | macOS may cache "Electron" in Dock during development |
| Linting | No linter configured (`npm run lint` is a no-op) |
| CI/CD | No continuous integration pipeline |
| Node Version | Developed on Node 18; some build deps prefer Node 20+ |

---

## 15. Glossary

| Term | Definition |
|---|---|
| **Hub** | The AutomataHub core — window, tabs, IPC bridge, module loading, credential store, theming |
| **Module** | Self-contained feature package with `manifest.json`, main-process handlers, renderer scripts |
| **Manifest** | `manifest.json` — declares module ID, name, IPC channels, tab types, renderer assets |
| **IPC Bridge** | `app/core/ipc-bridge.js` — scoped handler registration wrapper with channel enforcement and cleanup tracking |
| **Event Bus** | `app/core/event-bus.js` — secured inter-module EventBus with event allowlist, payload validation, source tagging, and frozen per-module handles |
| **Module Bus Handle** | Frozen `{ on, off, emit }` object returned by `createModuleBus(moduleId)` — scoped to one module |
| **Tab Type** | A registered tab kind (e.g. `db-manager`, `script-home`). Modules register via `TabManager.registerTabType()` |
| **CSS Variable Contract** | Hub provides `--hub-*` variables as a stable theming API for modules |
| **safeStorage** | Electron API delegating encryption to the OS keychain |
| **Push Channel** | IPC channel where main process sends events to renderer (`webContents.send()`) |
| **Context Isolation** | Electron feature running preload in a separate JS context from renderer |
| **CSP** | Content Security Policy — restricts which resources the renderer can load |

---

*End of documentation.*
