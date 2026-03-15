# Project File Structure

> **Frozen at MVP v1.0.0** — This document reflects the shipped implementation.

## Directory Layout

```
AutomataHub/
├── app/                          # Main process (Node.js)
│   ├── main.js                   # Electron app entry point
│   ├── preload.js                # IPC bridge & security
│   ├── script-executor.js        # Execution queue + process lifecycle
│   └── errors.js                 # Centralized error messages
│
├── renderer/                     # Renderer process (Chromium)
│   ├── index.html                # Single-page app with tab system
│   ├── styles.css                # All styling
│   ├── ui.js                     # Shared UI utilities
│   ├── tab-manager.js            # Tab lifecycle/state manager
│   └── pages/
│       ├── home-tab.js           # Home tab logic (script list + import)
│       └── execution-tab.js      # Execution tab logic (terminal + controls)
│
├── resources/                    # App resources (icons, images)
│   ├── icon.png                  # App icon (PNG)
│   ├── icon.icns                 # App icon (macOS)
│   ├── mw.png                    # Author logo
│   └── info.png                  # Info button icon
│
├── scripts/                      # User script folders
│   ├── .gitkeep                  # Keep folder in git
│   ├── README.md                 # How to add scripts
│   └── hello-world/              # Quickstart sample script
│       ├── main.sh               # Main executable
│       ├── config.json           # Script metadata
│       └── README.md             # Script documentation
│
├── logs/                         # Output logs folder
│   └── .gitkeep                  # Keep folder in git
│
├── docs/                         # Project documentation
│   ├── PROJECT_OVERVIEW.md       # Project summary & goals
│   ├── ARCHITECTURE.md           # System design
│   ├── FEATURES.md               # Feature specifications
│   ├── FILE_STRUCTURE.md         # This document
│   ├── DEVELOPMENT_PLAN.md       # Development roadmap
│   ├── COMPONENT_SPECS.md        # Detailed component specs
│   ├── API_INTERFACE.md          # IPC communication protocol
│   ├── STYLING_GUIDE.md          # UI/UX guidelines
│   └── SCRIPT_FOLDER_SYSTEM.md   # Script folder & import rules
│
├── package.json                  # Node.js dependencies
├── .editorconfig                 # Editor formatting rules
├── .gitignore                    # Git ignore rules
├── .npmrc                        # npm configuration
├── README.md                     # Project readme
├── DOCUMENTATION.md              # Comprehensive technical documentation
├── SECURITY.md                   # Security policy
└── TODO.md                       # Development checklist
```

## File Descriptions

### App Layer (app/)

#### `app/main.js`
**Purpose:** Electron main process entry point
**Responsibilities:**
- Create BrowserWindow on app startup
- Set up IPC event listeners
- Handle file system operations
- Spawn and manage child processes for scripts
- Manage application lifecycle

**Key Functions:**
- `createWindow()` - Initialize window
- `ipcMain.handle('get-scripts', ...)` - List available scripts
- `ipcMain.handle('run-script', ...)` - Execute a script
- `ipcMain.handle('save-logs', ...)` - Save log file
- `ipcMain.handle('stop-script', ...)` - Stop running script
- `ipcMain.handle('clear-terminal', ...)` - Clear terminal for tab
- `ipcMain.handle('open-folder-picker', ...)` - Open folder picker dialog
- `ipcMain.handle('validate-dropped-folder', ...)` - Validate dropped folder
- `ipcMain.handle('import-script', ...)` - Import script folder
- `ipcMain.handle('remove-script', ...)` - Remove script
- `ipcMain.handle('get-resources-path', ...)` - Get resources directory path
- `ipcMain.handle('open-external-url', ...)` - Open URL in system browser

**Dependencies:** electron, fs, path, child_process

**Code Style:** JSDoc comments, async/await, error handling

#### `app/preload.js`
**Purpose:** Security bridge between main and renderer processes
**Responsibilities:**
- Expose safe IPC APIs to renderer
- Prevent direct access to Node.js APIs
- Validate IPC messages

**Key Functions:**
- `window.api.getScripts()` - Request script list
- `window.api.runScript(path, name, tabId)` - Execute script in a tab context
- `window.api.saveLogs(content, name, timestamp, tabId)` - Save logs for a tab
- `window.api.stopScript(tabId)` - Stop running script
- `window.api.clearTerminal(tabId)` - Clear terminal
- `window.api.openFolderPicker()` - Open folder picker dialog
- `window.api.validateDroppedFolder(path)` - Validate dropped folder
- `window.api.importScript(path, mainScript)` - Import script folder
- `window.api.removeScript(scriptId)` - Remove script
- `window.api.getResourcesPath()` - Get resources directory path
- `window.api.openExternalUrl(url)` - Open URL in system browser
- `window.api.on(event, callback)` - Listen for IPC events
- `window.api.off(event, callback)` - Remove event listener

**Security Model:** Context isolation enabled, only essential APIs exposed

---

### Renderer Layer (renderer/)

#### `renderer/index.html`
**Purpose:** Single-page tab shell (Home tab + execution tabs)
**Content:**
- Top tab bar (`<nav id="tab-bar">`) with Home button
- Main content area (`<main id="tab-content">`) for dynamically injected tab pages
- No toolbar in HTML — toolbar is created dynamically inside execution-tab.js

**Structure:**
```html
<div id="app">
  <nav id="tab-bar" class="tab-bar" role="tablist" aria-label="Script tabs">
    <button class="tab active" data-tab-id="home" role="tab">Home</button>
  </nav>
  <main id="tab-content" class="tab-content" role="tabpanel" aria-label="Tab content"></main>
</div>
```

**Scripts Loaded:** ui.js, tab-manager.js, pages/home-tab.js, pages/execution-tab.js

#### `renderer/styles.css`
**Purpose:** All styling for both pages
**Sections:**
- CSS variables for colors, fonts, sizes
- Reset/normalize styles
- Layout (grid, flex)
- Component styles (buttons, cards, terminal)
- Dark theme colors
- Responsive design rules
- Animation/transitions

**Key Classes:**
- `.script-card` - Script list item
- `.terminal` - Terminal output container
- `.terminal-line` - Single line of output
- `.btn` / `.btn-primary` - Button styles
- `.btn:hover` - Hover states

#### `renderer/ui.js`
**Purpose:** Shared UI utilities
**Functions:**
- `showNotification(message, type)` - Display toast notifications
- `formatTimestamp(date)` - Normalize UI and log timestamps
- `sanitizeScriptName(name)` - Safe names for ids/files
- `truncateOutput(text, maxLines)` - Keep terminal memory bounded

**Usage:** Called by both pages

#### `renderer/tab-manager.js`
**Purpose:** Tab lifecycle manager
**Responsibilities:**
- Create/switch/close tabs
- Enforce max tab rule (Home + 4)
- Reuse existing tab for already-open scripts
- Maintain per-tab state and output buffer

**Key Functions:**
- `createTab(script)` - Add new execution tab
- `switchTab(tabId)` - Activate selected tab
- `closeTab(tabId)` - Close script tab
- `updateTabStatus(tabId, status)` - Update indicator (running/success/error)

#### `renderer/pages/home-tab.js`
**Purpose:** Home tab logic (script list + import actions)
**Responsibilities:**
- Request scripts from main process
- Render script cards
- Handle Open Finder import action
- Handle drag-and-drop folder imports
- Open/reuse execution tab when user clicks script card

**IPC Events Used:**
- Invoke: `get-scripts`, `open-folder-picker`, `validate-dropped-folder`, `import-script`, `remove-script`, `get-resources-path`
- Listen: `app-error`

#### `renderer/pages/execution-tab.js`
**Purpose:** Execution tab logic (run, stop, stream, save logs)
**Responsibilities:**
- Start/stop script execution in active tab
- Stream output/errors into the correct tab terminal
- Manage queue state badges/messages
- Save tab output logs with timestamped filenames

**Key Functions:**
- `runActiveTabScript(tabId, scriptPath, scriptName)` - Start execution
- `appendOutput(tabId, text, isError)` - Add output line to tab terminal
- `handleSaveLogs(tabId)` - Save terminal output for the tab
- `handleStop(tabId)` - Stop running process for tab

**IPC Events Used:**
- Invoke: `run-script`, `stop-script`, `save-logs`, `clear-terminal`
- Listen: `script-output`, `script-error`, `script-complete`, `queue-status`, `log-saved`, `app-error`

---

### Supporting Folders

#### `scripts/`
**Purpose:** User script folder directory (auto-scanned by app)
**Contents:**
- One folder per script
- Each folder contains at least one executable file
- Optional metadata files (`config.json`, `README.md`, `icon.png`)

**Notes:**
- App scans folders, not loose root scripts
- User chooses main executable on import when multiple executables exist
- Invalid/non-executable folders are skipped with reason

#### `logs/`
**Purpose:** Output logs saved by users
**Contents:** Generated dynamically when users save logs
**File Format:** `{script-name}_{YYYY-MM-DD}_{HH-MM-SS}.txt`
**Notes:**
- Directory kept via `.gitkeep` file
- User-generated, not version controlled

#### `docs/`
**Purpose:** Project documentation
**Contents:**
1. PROJECT_OVERVIEW.md - Project summary and goals
2. ARCHITECTURE.md - System design and data flow
3. FEATURES.md - Feature specifications
4. FILE_STRUCTURE.md - **This document**
5. DEVELOPMENT_PLAN.md - Step-by-step development
6. COMPONENT_SPECS.md - Detailed component specs
7. API_INTERFACE.md - IPC protocol
8. STYLING_GUIDE.md - Design system
9. SCRIPT_FOLDER_SYSTEM.md - Script folder & import rules

---

### Root Files

#### `package.json`
**Purpose:** Node.js project manifest
**Contents:**
```json
{
  "name": "automata-hub",
  "version": "0.1.0",
  "description": "Desktop app for managing and executing local automation scripts",
  "main": "app/main.js",
  "homepage": "./",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder"
  },
  "dependencies": {
    "electron": "^latest"
  }
}
```

#### `.gitignore`
**Purpose:** Git version control ignore rules
**Contents:**
```
node_modules/
dist/
.DS_Store
logs/*.txt
*.log
.env
```

#### `README.md`
**Purpose:** Project overview for users
**Contents:**
- Project description
- Installation instructions
- Usage guide
- Screenshot examples
- Development setup
- Contribution guidelines

#### `LICENSE`
**Purpose:** Software license
**Default:** MIT License

---

## File Dependencies

### HTML Dependencies
```
index.html
├── styles.css (linked)
├── ui.js (script)
├── tab-manager.js (script)
├── home-tab.js (script)
└── execution-tab.js (script)
```

### JS Module Dependencies
```
main.js
├── fs (Node.js)
├── path (Node.js)
├── electron
├── child_process (Node.js)
└── os (Node.js)

preload.js
├── electron.contextBridge
├── electron.ipcRenderer

script-executor.js
├── child_process
├── events (queue signaling)
└── path

home-tab.js
├── ui.js
├── tab-manager.js
├── window.api (preload)

execution-tab.js
├── ui.js
├── tab-manager.js
├── window.api (preload)

ui.js
└── (no dependencies, standalone utilities)
```

---

## Important Notes

1. **Source of Truth:** Main process (main.js) holds state
2. **Security:** All Node.js APIs accessed only through preload.js
3. **Styling:** Single CSS file for consistency and easier theming
4. **Stateless Renderer:** Can refresh without data loss
5. **Modular Tabs:** Home and execution tabs have independent logic files
6. **Utilities Shared:** ui.js contains reusable functions

---

## Future Enhancements

- `/src/` folder for TypeScript migration
- `/tests/` folder for unit/integration tests
- `/build/` folder for build artifacts
- `/node_modules/` ignored and generated at install
- Asset management (`/assets/images/`, `/assets/icons/`)

---

**Document Version:** 1.1
**Last Updated:** March 13, 2026
