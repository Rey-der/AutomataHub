# AutomataHub — Module Creation Guide

This guide explains how to build a fully functioning module for the AutomataHub platform. A module is an isolated feature package (its own repo/directory) that plugs into the hub at runtime.

---

## Table of Contents

1. [Overview](#overview)
2. [File Structure](#file-structure)
3. [manifest.json](#manifestjson)
4. [Main Process — main-handlers.js](#main-process--main-handlersjs)
5. [Renderer Scripts](#renderer-scripts)
6. [Renderer Styles](#renderer-styles)
7. [Loading Strategies](#loading-strategies)
8. [npm Package Setup](#npm-package-setup)
9. [Minimal Example Module](#minimal-example-module)
10. [Reference — Script Runner Module](#reference--script-runner-module)

---

## Overview

AutomataHub discovers modules at startup, loads their main-process handlers, injects their renderer scripts/styles into the window, and displays them on the hub dashboard. The module system is built on three pillars:

| Layer | What you provide | What the hub does |
|-------|-----------------|-------------------|
| **Manifest** | `manifest.json` declaring metadata, IPC channels, tab types, scripts, styles | Validates, registers metadata, builds the IPC allowlist |
| **Main process** | `main-handlers.js` with `setup(ctx)` / `teardown()` | Calls `setup()` on load, `teardown()` on shutdown, passes IPC bridge and paths |
| **Renderer** | JS files that register tab types + optional CSS | Loads scripts via `<script>` and styles via `<link>` at boot time |

### Security Model

The hub runs with `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`. Renderer scripts have **no** access to Node.js APIs. All communication with the main process goes through `window.api.invoke()` / `window.api.on()` / `window.api.off()` — guarded by the IPC channel allowlist declared in your manifest.

---

## File Structure

A module directory must follow this layout:

```
my-module/
├── manifest.json          # Required — module metadata
├── main-handlers.js       # Main-process entry (configurable name)
├── renderer/
│   ├── my-tab.js          # Renderer script(s) — register tab types
│   └── styles.css         # Renderer stylesheet(s)
├── package.json           # Required for npm distribution only
└── README.md              # Recommended
```

The only hard requirement is `manifest.json` at the root. Everything else is referenced from the manifest.

---

## manifest.json

The manifest is the single source of truth for your module. The hub reads it to decide what to load and which IPC channels to allow.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique module identifier. Used as a key everywhere. Use kebab-case: `my-module`. |
| `name` | `string` | Human-readable display name shown on the hub dashboard. |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `version` | `string` | `"0.0.0"` | Semver version string. |
| `description` | `string` | `""` | Short description shown on the hub dashboard card. |
| `mainEntry` | `string` | `"main-handlers.js"` | Relative path to the main-process entry file. |
| `ipcChannels` | `string[]` | `[]` | All IPC channel names this module uses (invoke **and** push). Must be declared here or they won't work. |
| `tabTypes` | `object[]` | `[]` | Tab type descriptors: `{ "id": "type-id", "label": "Display Name" }`. |
| `rendererScripts` | `string[]` | `[]` | Relative paths to JS files loaded into the renderer. |
| `rendererStyles` | `string[]` | `[]` | Relative paths to CSS files loaded into the renderer. |

### Naming Conventions

**IPC channels** must be namespaced with your module ID to avoid collisions:

```
my-module:get-data       ← invoke (renderer → main → renderer)
my-module:data-updated   ← push   (main → renderer)
```

**Tab type IDs** should also be namespaced:

```
my-module-home
my-module-detail
```

### Example manifest.json

```json
{
  "id": "my-module",
  "name": "My Module",
  "version": "1.0.0",
  "description": "A sample module for AutomataHub",
  "mainEntry": "main-handlers.js",
  "ipcChannels": [
    "my-module:get-items",
    "my-module:create-item",
    "my-module:item-updated"
  ],
  "tabTypes": [
    { "id": "my-module-home", "label": "My Module" }
  ],
  "rendererScripts": [
    "renderer/my-module-home.js"
  ],
  "rendererStyles": [
    "renderer/styles.css"
  ]
}
```

---

## Main Process — main-handlers.js

Your main entry file must export two functions: `setup(ctx)` and `teardown()`.

### setup(ctx)

Called once when the hub loads your module. The `ctx` object provides everything you need:

```js
function setup(ctx) {
  const { ipcBridge, mainWindow, paths, send } = ctx;
  // ...
}
```

| Property | Type | Description |
|----------|------|-------------|
| `ipcBridge` | `object` | `ipcBridge.handle(channel, handler)` — register an IPC handler. The hub tracks these for automatic cleanup. |
| `mainWindow` | `function` | `mainWindow()` — returns the current `BrowserWindow` instance (or `null`). Call it as a function whenever you need the window. |
| `paths.root` | `string` | Absolute path to the hub project root. Use this to resolve hub utilities. |
| `paths.modules` | `string` | Absolute path to the hub's `modules/` directory. |
| `paths.resources` | `string` | Absolute path to the hub's `resources/` directory. |
| `send` | `function` | `send(channel, data)` — push events to the renderer. Only works for channels declared in your manifest. |

### Registering IPC Handlers

Use `ipcBridge.handle()` to register handlers for invoke-style IPC:

```js
ipcBridge.handle('my-module:get-items', async (_event, args) => {
  // args is whatever the renderer passed to window.api.invoke()
  return { items: [...] };
});
```

### Pushing Events to Renderer

Use `send()` for main → renderer push events:

```js
send('my-module:item-updated', { id: 42, name: 'Updated' });
```

The renderer listens with `window.api.on('my-module:item-updated', callback)`.

### teardown()

Called when the hub shuts down. Clean up resources here:

```js
function teardown() {
  // Cancel timers, kill child processes, close connections, etc.
}
```

> **Note:** You do **not** need to remove IPC handlers manually — the hub's `IpcBridge` removes all registered handlers automatically on shutdown.

### Accessing Hub Utilities (External Modules)

When your module lives outside the hub directory (separate repo, npm package), you can't use relative `require()` paths. Instead, use the **lazy require pattern** — resolve hub utilities at `setup()` time via `paths.root`:

```js
const path = require('path');

// Declare at module scope, resolve lazily
let resolveInside, ensureDir, readJsonConfig;

function setup(ctx) {
  const { ipcBridge, paths } = ctx;

  // Resolve hub utilities from the host project
  const hubApp = path.join(paths.root, 'app');
  ({ resolveInside, ensureDir } = require(path.join(hubApp, 'core', 'path-utils')));
  ({ readJsonConfig } = require(path.join(hubApp, 'core', 'config-utils')));

  // Now use them in your handlers...
}
```

#### Available Hub Utilities

| Utility | Path (from hub root) | Exports |
|---------|---------------------|---------|
| **path-utils** | `app/core/path-utils.js` | `resolveInside(base, ...segments)` — safe path join that prevents directory traversal. `isInside(parent, child)` — checks containment. `ensureDir(dir)` — mkdir -p. |
| **config-utils** | `app/core/config-utils.js` | `readJsonConfig(filePath, fallback, onError)` — reads and parses JSON with fallback. |
| **event-bus** | `app/core/event-bus.js` | `hubBus` — shared EventEmitter singleton for cross-module main-process events. |
| **errors** | `app/core/errors.js` | `ERROR_MESSAGES` — constant error strings. `friendlyError(err)` — error message mapper. |

### Complete main-handlers.js Template

```js
'use strict';

const path = require('path');

// Lazy-resolved hub utilities
let myHubUtility;

// Module state
let _send = null;

function setup(ctx) {
  const { ipcBridge, mainWindow, paths, send } = ctx;
  _send = send;

  // Resolve hub utilities (for external modules)
  ({ myHubUtility } = require(path.join(paths.root, 'app', 'core', 'some-util')));

  // Register IPC handlers
  ipcBridge.handle('my-module:get-items', async () => {
    return { items: ['one', 'two', 'three'] };
  });

  ipcBridge.handle('my-module:create-item', async (_event, args) => {
    const { name } = args || {};
    if (!name || typeof name !== 'string') throw new Error('Name is required');
    // ... create the item ...
    send('my-module:item-updated', { name });
    return { success: true };
  });
}

function teardown() {
  _send = null;
}

module.exports = { setup, teardown };
```

---

## Renderer Scripts

Renderer scripts run in the browser context. They register tab types with the `TabManager` and handle all UI for your module.

### Available Globals

| Global | Description |
|--------|-------------|
| `window.api.invoke(channel, args)` | Call a main-process IPC handler. Returns a Promise. |
| `window.api.on(event, callback)` | Listen for push events from main process. Only works for declared channels. |
| `window.api.off(event, callback)` | Remove a push event listener. |
| `window.api.getResourcesPath()` | Get the hub's resources directory path. |
| `window.api.openExternalUrl(url)` | Open a URL in the system browser. |
| `window.tabManager` | The hub's TabManager instance. |
| `window.ui.showNotification(msg, type)` | Show a notification toast. Types: `'success'`, `'error'`, `'warning'`, `'info'`. |
| `window._hub` | Hub-level shared namespace for module interop. |

### Registering a Tab Type

Each renderer script should:

1. Define a render function inside an IIFE (to avoid polluting the global scope)
2. Register the tab type once `window.tabManager` is available

```js
const MyModuleHome = (() => {
  async function render(tab, container) {
    container.innerHTML = '';

    const heading = document.createElement('h1');
    heading.textContent = 'My Module';
    container.appendChild(heading);

    // Fetch data via IPC
    const data = await window.api.invoke('my-module:get-items');
    // ... build UI from data ...
  }

  return { render };
})();

// --- Register with TabManager ---
(function register() {
  function doRegister() {
    if (!window.tabManager) {
      setTimeout(doRegister, 0);
      return;
    }

    window.tabManager.registerTabType('my-module-home', {
      render: MyModuleHome.render,
      maxTabs: 1,       // optional — max open tabs of this type (default: 4)
      // onClose: (tab) => { ... }  // optional — cleanup when tab is closed
    });
  }

  doRegister();
})();
```

### registerTabType(typeId, opts)

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `render` | `function(tab, container)` | Yes | Called to render the tab content. `tab` is the tab object, `container` is the DOM element to render into. |
| `onClose` | `function(tab)` | No | Called when the tab is closed. Use for cleanup (removing listeners, clearing state). |
| `maxTabs` | `number` | No | Maximum number of simultaneously open tabs of this type. Default: `4`. |

### createTab(type, title, data, opts)

Create new tabs from anywhere in your renderer code:

```js
window.tabManager.createTab('my-module-detail', 'Item Details', {
  itemId: 42,
}, {
  reuseKey: 'item-42',  // optional — if a tab with this reuseKey exists, switch to it instead
});
```

The `data` object is merged into the tab and accessible via `tab.itemId` in your render function.

### Registering a Module Opener

When users click your module's card on the hub dashboard, the hub checks `window._hub.moduleOpeners[moduleId]` for a custom handler. If found, it calls that function. Otherwise, it opens the first tab type from your manifest.

To register a custom opener (recommended):

```js
window._hub = window._hub || {};
window._hub.moduleOpeners = window._hub.moduleOpeners || {};
window._hub.moduleOpeners['my-module'] = () => {
  window.tabManager.createTab('my-module-home', 'My Module', {}, { reuseKey: 'my-module-home' });
};
```

This gives you control over what happens when the module is opened — e.g., always reuse a single tab instance.

### Listening for Push Events

```js
function onItemUpdated(data) {
  console.log('Item updated:', data);
  // Re-render or update UI...
}

// Start listening
window.api.on('my-module:item-updated', onItemUpdated);

// Stop listening (in onClose or when appropriate)
window.api.off('my-module:item-updated', onItemUpdated);
```

### Other TabManager Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `hasTabType(typeId)` | `boolean` | Check if a tab type is registered. |
| `getTabsByType(type)` | `tab[]` | Get all open tabs of a given type. |
| `getActiveTabId()` | `string` | Get the currently active tab's ID. |
| `getTab(id)` | `tab` | Get a tab object by ID. |
| `updateTabStatus(id, status)` | — | Update a tab's status badge. |
| `switchTab(id)` | — | Switch to a tab by ID. |

---

## Renderer Styles

Module stylesheets are injected as `<link>` elements at boot, before scripts execute.

### Hub Theme Contract

The hub exposes a stable set of CSS custom properties prefixed with `--hub-`. **Always use these in your module styles** — they are guaranteed to remain stable across hub versions while the internal variables may change.

#### Backgrounds

| Variable | Description |
|----------|-------------|
| `--hub-bg` | Page background |
| `--hub-surface` | Card / panel background |
| `--hub-surface-2` | Slightly lighter surface |
| `--hub-surface-3` | Active / hover surface |

#### Text

| Variable | Description |
|----------|-------------|
| `--hub-text` | Primary text |
| `--hub-text-secondary` | Secondary text |
| `--hub-muted` | Muted / placeholder text |
| `--hub-text-link` | Link text |

#### Semantic Colors

| Variable | Description |
|----------|-------------|
| `--hub-accent` | Primary accent (buttons, focus) |
| `--hub-success` | Success state |
| `--hub-warning` | Warning state |
| `--hub-error` | Error state |
| `--hub-info` | Info state |

#### Borders

| Variable | Description |
|----------|-------------|
| `--hub-border` | Default border color |
| `--hub-border-focus` | Focused border color |

#### Fonts

| Variable | Description |
|----------|-------------|
| `--hub-font-ui` | UI font stack |
| `--hub-font-mono` | Monospace font stack |

#### Sizes

`--hub-size-xs` through `--hub-size-xxl` (11px → 24px).

#### Spacing

`--hub-space-xs` through `--hub-space-2xl` (4px → 32px).

### Example Module Stylesheet

```css
/* Scope all styles under a unique class to avoid collisions */
.my-module-home {
  padding: var(--hub-space-lg);
  font-family: var(--hub-font-ui);
  color: var(--hub-text);
}

.my-module-home h1 {
  font-size: var(--hub-size-xxl);
  margin-bottom: var(--hub-space-md);
}

.my-module-card {
  background: var(--hub-surface);
  border: 1px solid var(--hub-border);
  border-radius: 8px;
  padding: var(--hub-space-lg);
}

.my-module-card:hover {
  border-color: var(--hub-accent);
}
```

---

## Loading Strategies

The hub discovers modules from two locations (in order of priority):

### 1. Local — `modules/` directory (development)

Place your module folder directly inside the hub's `modules/` directory:

```
AutomataHub/
└── modules/
    └── my-module/
        ├── manifest.json
        ├── main-handlers.js
        └── renderer/
```

This takes priority and is best for active development. No npm install required.

### 2. Installed — `node_modules/automatahub-*` (distribution)

Publish your module as an npm package named `automatahub-my-module`. Users install it with:

```bash
npm install automatahub-my-module
```

Or link during development:

```bash
# In hub project's package.json
"dependencies": {
  "automatahub-my-module": "file:../my-module"
}
```

Then `npm install` creates a symlink in `node_modules/`. The hub scans `node_modules/` for directories (and symlinks) matching the `automatahub-*` prefix.

### Deduplication

If the same module ID appears in both `modules/` and `node_modules/`, the **local version wins**. This allows you to override an installed module during development.

---

## npm Package Setup

To distribute your module as an npm package, add a `package.json`:

```json
{
  "name": "automatahub-my-module",
  "version": "1.0.0",
  "description": "My Module for AutomataHub",
  "main": "main-handlers.js",
  "peerDependencies": {
    "automata-hub": ">=1.0.0"
  },
  "keywords": ["automatahub", "module"],
  "license": "MIT"
}
```

Key points:

- **Name** must start with `automatahub-` for the hub to discover it in `node_modules/`.
- **peerDependencies** prevents the hub from being bundled inside your module.
- The `main` field is for npm conventions; the hub uses `manifest.json`'s `mainEntry`.

---

## Minimal Example Module

A complete, working module with one tab that displays a greeting.

### manifest.json

```json
{
  "id": "hello-hub",
  "name": "Hello Hub",
  "version": "1.0.0",
  "description": "A minimal example AutomataHub module",
  "ipcChannels": [
    "hello-hub:get-greeting"
  ],
  "tabTypes": [
    { "id": "hello-hub-home", "label": "Hello" }
  ],
  "rendererScripts": [
    "renderer/hello-home.js"
  ],
  "rendererStyles": [
    "renderer/styles.css"
  ]
}
```

### main-handlers.js

```js
'use strict';

function setup(ctx) {
  const { ipcBridge } = ctx;

  ipcBridge.handle('hello-hub:get-greeting', async () => {
    return { message: 'Hello from the Hub!' };
  });
}

function teardown() {
  // Nothing to clean up
}

module.exports = { setup, teardown };
```

### renderer/hello-home.js

```js
const HelloHome = (() => {
  async function render(tab, container) {
    container.innerHTML = '';
    container.className = 'hello-hub-home';

    const heading = document.createElement('h1');
    heading.textContent = 'Hello Hub';
    container.appendChild(heading);

    const result = await window.api.invoke('hello-hub:get-greeting');

    const msg = document.createElement('p');
    msg.className = 'hello-message';
    msg.textContent = result.message;
    container.appendChild(msg);
  }

  return { render };
})();

(function register() {
  function doRegister() {
    if (!window.tabManager) {
      setTimeout(doRegister, 0);
      return;
    }

    window.tabManager.registerTabType('hello-hub-home', {
      render: HelloHome.render,
      maxTabs: 1,
    });

    window._hub = window._hub || {};
    window._hub.moduleOpeners = window._hub.moduleOpeners || {};
    window._hub.moduleOpeners['hello-hub'] = () => {
      window.tabManager.createTab('hello-hub-home', 'Hello', {}, { reuseKey: 'hello-hub-home' });
    };
  }

  doRegister();
})();
```

### renderer/styles.css

```css
.hello-hub-home {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-family: var(--hub-font-ui);
  color: var(--hub-text);
}

.hello-hub-home h1 {
  font-size: var(--hub-size-xxl);
  color: var(--hub-accent);
  margin-bottom: var(--hub-space-lg);
}

.hello-message {
  font-size: var(--hub-size-lg);
  color: var(--hub-text-secondary);
}
```

---

## Reference — Script Runner Module

The **Script Runner** module (`automatahub-script-runner`) is a full-featured, production-quality reference implementation. It demonstrates:

- 14 IPC channels (invoke + push events)
- 2 tab types (home list + execution terminal)
- Live event streaming from main to renderer
- Lazy hub utility resolution
- Drag & drop import zone
- Tab state management with per-tab cleanup

Source: [`script-runner/`](../script-runner/) (included in `modules/` directory for automatic discovery)

---

## Checklist

Before publishing your module, verify:

- [ ] `manifest.json` has `id` and `name`
- [ ] All IPC channel names are listed in `ipcChannels`
- [ ] All tab type IDs match between manifest `tabTypes` and `registerTabType()` calls
- [ ] All `rendererScripts` and `rendererStyles` paths are correct relative to manifest
- [ ] `main-handlers.js` exports `setup()` and `teardown()`
- [ ] IPC handlers validate their input arguments
- [ ] CSS uses `--hub-*` variables (not raw hub internals)
- [ ] Tab type IDs and IPC channels are namespaced with your module ID
- [ ] Renderer scripts use IIFEs to avoid global scope pollution
- [ ] `package.json` name starts with `automatahub-` (if publishing to npm)
