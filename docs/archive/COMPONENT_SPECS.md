# Component Specifications

> **Frozen at MVP v1.0.0** — This document reflects the shipped implementation.

## Main Process Components

### Component: ScriptDiscovery
**File:** `app/main.js`
**Purpose:** Scan and discover executable scripts

**Interface:**
```javascript
async function getAvailableScripts() {
  // Returns: Promise<Array<ScriptObject>>
}
```

**ScriptObject Structure:**
```javascript
{
  id: string,                    // Unique identifier (filename with extension)
  name: string,                  // Human-readable name (filename without extension)
  path: string,                  // Absolute path to script
  description: string,           // First line of script or empty
  language: string,              // bash, python, sh, executable, etc.
  executable: boolean,           // Is file executable
  size: number                   // File size in bytes
}
```

**Implementation Details:**
- Scans `/scripts` directory for script folders
- Each folder must contain at least one supported executable file
- Reads metadata from config.json or first line of README.md
- Returns sorted by name

**Error Handling:**
- No scripts found → Return empty array
- Directory doesn't exist → Create directory, return empty array
- Permission denied → Log error, return empty array

**Performance:**
- Max scan time: < 500ms
- Cache results for 30 seconds (future optimization)

---

### Component: ScriptExecutor
**File:** `app/script-executor.js`
**Purpose:** Execute scripts and stream output with queue management

**Interface:**
```javascript
async function executeScript(scriptPath, scriptName) {
  // Returns: Promise<ProcessInfo>
  // Emits: IPC events with output chunks
}
```

**ProcessInfo Structure:**
```javascript
{
  id: string,                    // Unique process ID
  scriptPath: string,
  scriptName: string,
  startTime: Date,
  endTime: Date | null,
  exitCode: number | null,
  signal: string | null,
  outputLines: number,
  errorLines: number
}
```

**Execution Flow:**
1. Validate script exists and is executable
2. Determine shell based on file extension
3. Create child process with `spawn(shell, [scriptPath])`
4. Attach listeners to stdout and stderr
5. Stream data chunks via IPC
6. Capture exit code and signal
7. Clean up process

**Spawn Configuration:**
```javascript
const options = {
  cwd: path.dirname(scriptPath),     // Set working directory
  stdio: ['ignore', 'pipe', 'pipe'],  // Ignore stdin, pipe stdout/stderr
  shell: false,                       // No shell — use explicit interpreter
  detached: false,                    // Don't create process group
  timeout: null                       // No timeout (user can kill)
};
// spawn(interpreter, [scriptPath], options)
// e.g. spawn('/bin/bash', ['backup.sh'], options)
```

**Shell Detection:**
```javascript
// .sh, .bash files → /bin/bash
// .py, .py3 files → python3
// .js, .mjs files → node
// .rb files → ruby
// Other → Try direct execution
// No extension + executable → Try direct execution
```

**Error Handling:**
- ENOENT (not found) → Emit error event
- EACCES (permission denied) → Emit error event
- Script crashes → Emit exit code with stderr
- Process killed → Emit signal info

**Performance:**
- Output streaming: Real-time, no buffering
- Memory: Limit terminal display to last 1000 lines (head truncation)

---

### Component: LogSaver
**File:** `app/main.js`
**Purpose:** Save execution logs to file

**Interface:**
```javascript
async function saveLogs(outputText, scriptName, timestamp) {
  // Returns: Promise<string> (file path)
}
```

**Implementation:**
1. Validate output text not empty
2. Create `/logs` directory if missing
3. Generate filename: `${sanitizeName(scriptName)}_${dateString}_${timeString}.txt`
4. Add header with metadata
5. Write output text
6. Return file path

**Filename Generation:**
```javascript
const dateString = new Date().toISOString().split('T')[0];  // YYYY-MM-DD
const timeString = new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, '-'); // HH-MM-SS
const safeName = scriptName.replace(/[^a-z0-9-_]/gi, '_').toLowerCase();
const filename = `${safeName}_${dateString}_${timeString}.txt`;
```

**Log File Format:**
```
================================================================================
SCRIPT EXECUTION LOG
================================================================================
Script Name: example-script
Date & Time: 2026-03-13 14:32:45 UTC
================================================================================

[OUTPUT CONTENT GOES HERE]

================================================================================
End of Log
================================================================================
```

**Error Handling:**
- Directory creation fails → Throw error
- Permission denied → Throw error
- Disk full → Throw error

---

## Renderer Components

### Component: TabManager
**Files:** `renderer/tab-manager.js`, styled in `renderer/styles.css`
**Purpose:** Manage tab creation, switching, closing, and state

**Key Methods:**
- `createTab(scriptName, scriptPath)` - Create or get execution tab
- `switchTab(tabId)` - Make tab active
- `closeTab(tabId)` - Close tab (except Home)
- `updateTabStatus(tabId, status)` - Update indicator (running/success/error)
- `getTabCount()` - Count open execution tabs

**Tab Object:**
```javascript
{id, type, scriptName, scriptPath, isRunning, exitCode, output, createdAt}
```

**Features:**
- Max 5 tabs (1 Home + 4 execution)
- Home always open, not closeable
- Tab reuse when script already has tab
- Status indicators: ● (running), ✓ (success), ✗ (error)
- Close (X) button on execution tabs

---

### Component: HomeTabPage
**Files:** `renderer/index.html`, `renderer/pages/home-tab.js`
**Purpose:** Display and manage script list + import actions

**HTML Structure:**
```html
<div id="script-list-page" class="page active">
  <header class="page-header">
    <h1>📋 AutomataHub</h1>
    <p class="subtitle">Select a script to run</p>
  </header>
  
  <main class="page-content">
    <div id="scripts-container" class="scripts-grid">
      <!-- Script cards injected here -->
    </div>
    
    <div id="no-scripts" class="empty-state" style="display: none;">
      <p>No scripts found in /scripts folder</p>
      <small>Add executable files to get started</small>
    </div>
  </main>
</div>
```

**ScriptCard Component:**
```html
<div class="script-card">
  <div class="card-header">
    <h3 class="script-name">Script Name</h3>
    <span class="script-language">bash</span>
  </div>
  
  <p class="script-description">Description of what this script does</p>
  
  <div class="card-footer">
    <button class="btn btn-primary" data-script-path="/path">
      ▶ Run Script
    </button>
  </div>
</div>
```

**JavaScript Interface:**
```javascript
class HomeTabPage {
  constructor() {}
  
  async init() {
    // Initialize page on load
  }
  
  async loadScripts() {
    // Fetch and display scripts
    // Returns: Promise<void>
  }
  
  renderScripts(scriptArray) {
    // Update DOM with script cards
    // Returns: void
  }
  
  createScriptCard(script) {
    // Generate single card HTML
    // Returns: HTMLElement
  }
  
  handleRunScript(scriptPath, scriptName) {
    // Open/reuse execution tab and start script
    // Returns: Promise<void>
  }
}
```

**Events:**
- Load home tab → Call `loadScripts()`
- Click "Run Script" → Call `handleRunScript(path, name)`
- Open home tab → Call `loadScripts()` for refresh

**Styling Classes:**
- `.script-card` - Main card container
- `.card-header` - Script title + language
- `.script-name` - Script name text
- `.script-language` - Language badge
- `.script-description` - Description paragraph
- `.card-footer` - Button container
- `.btn` / `.btn-primary` - Button styling
- `.scripts-grid` - Grid layout container

---

### Component: ExecutionTabPage
**Files:** `renderer/index.html`, `renderer/pages/execution-tab.js`
**Purpose:** Display execution progress and output in a tab

**HTML Structure:**
```html
<div id="execution-tab" class="tab-panel">
  <header class="page-header">
    <div class="header-left">
      <h1>▶ Running: <span id="script-title">Script Name</span></h1>
    </div>
    <span id="execution-status" class="status-badge status-running">
      ⏱ Running...
    </span>
  </header>
  
  <main class="page-content">
    <div id="terminal" class="terminal">
      <!-- Output lines rendered here -->
    </div>
  </main>
  
  <footer class="page-footer">
    <div class="footer-info">
      <span id="output-stats">Lines: 0 | Size: 0 KB</span>
    </div>
    <div class="footer-buttons">
      <button id="save-logs-btn" class="btn btn-success">
        💾 Save Logs
      </button>
      <button id="stop-btn" class="btn btn-secondary">■ Stop</button>
    </div>
  </footer>
</div>
```

**TerminalLine Component:**
```html
<div class="terminal-line" data-type="stdout">
  <span class="timestamp">[14:32:45]</span>
  <span class="content">Script output text</span>
</div>

<!-- Or for errors: -->
<div class="terminal-line terminal-error" data-type="stderr">
  <span class="timestamp">[14:32:46]</span>
  <span class="content">Error output text</span>
</div>
```

**JavaScript Interface:**
```javascript
class ExecutionTabPage {
  constructor() {}
  
  async init(scriptName, scriptPath, tabId) {
    // Initialize execution tab
    // Returns: Promise<void>
  }
  
  startExecution() {
    // Begin script execution
    // Returns: Promise<void>
  }
  
  appendOutput(text, isError = false) {
    // Add single line to terminal
    // Returns: void
  }
  
  clearTerminal() {
    // Clear all output
    // Returns: void
  }
  
  handleSaveLogs() {
    // Collect output and save to file
    // Returns: Promise<void>
  }
  
  onExecutionComplete(exitCode) {
    // Handle script completion
    // Returns: void
  }
}
```

**Events:**
- Initialize tab → Call `init(name, path, tabId)`
- Script output → Call `appendOutput(text, false)`
- Script error → Call `appendOutput(text, true)`
- Script complete → Call `onExecutionComplete(code)`
- Click "Save Logs" → Call `handleSaveLogs()`
- Click "Stop" → Call `handleStop(tabId)`

**Status States:**
- `.status-running` - Script running (spinner icon)
- `.status-success` - Completed with code 0 (checkmark)
- `.status-error` - Exited with error code (X icon)
- `.status-killed` - Process terminated (stop icon)

---

### Component: TerminalDisplay
**File:** `renderer/pages/execution-tab.js`, styled in `renderer/styles.css`
**Purpose:** Display script output with live streaming

**Features:**
- Real-time line appending
- Auto-scroll to bottom
- Distinct error styling
- Timestamp on each line
- Monospace font

**HTML Structure:**
```html
<div id="terminal" class="terminal">
  <div class="terminal-content">
    <!-- Lines appended here -->
  </div>
</div>
```

**Line Insertion:**
```javascript
function appendTerminalLine(text, isError = false) {
  const line = document.createElement('div');
  line.className = `terminal-line ${isError ? 'terminal-error' : ''}`;
  line.dataset.type = isError ? 'stderr' : 'stdout';
  
  const timestamp = new Date().toLocaleTimeString();
  line.innerHTML = `<span class="timestamp">[${timestamp}]</span> ${escapeHtml(text)}`;
  
  const terminal = document.getElementById('terminal');
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;  // Auto-scroll
}
```

**Styling:**
- Background: `#1e1e1e`
- Text color: `#e0e0e0`
- Error color: `#ff6b6b`
- Font: `Courier New, Monaco, monospace`
- Line height: `1.5`
- Max height: 500px, scrollable

---

### Component: UIUtilities
**File:** `renderer/ui.js`
**Purpose:** Shared UI helper functions

**Functions:**

```javascript
/**
 * Switch between pages
 * @param {string} pageName - 'script-list' or 'script-execution'
 */
function showPage(pageName) {}

/**
 * Display temporary notification
 * @param {string} message - Message text
 * @param {string} type - 'info', 'success', 'error', 'warning'
 * @param {number} duration - Auto-hide after ms (0 = manual)
 */
function showNotification(message, type = 'info', duration = 3000) {}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {}

/**
 * Format output text for display
 * @param {string} text - Raw output text
 * @returns {string} Formatted text
 */
function formatOutput(text) {}

/**
 * Create script card HTML element
 * @param {Object} script - Script object
 * @returns {HTMLElement} Card element
 */
function createScriptCard(script) {}

/**
 * Get formatted current timestamp
 * @returns {string} Timestamp string
 */
function getCurrentTimestamp() {}
```

**Notification Component:**
```html
<div id="notification" class="notification notification-info">
  <p>Message text here</p>
  <button class="notification-close">×</button>
</div>
```

---

## Styling Components

### Component: ThemeVariables
**File:** `renderer/styles.css` (CSS root)
**Purpose:** Define color and sizing variables

```css
:root {
  /* Colors */
  --color-bg-primary: #1a1a1a;
  --color-bg-secondary: #2a2a2a;
  --color-bg-tertiary: #3a3a3a;
  
  --color-text-primary: #e0e0e0;
  --color-text-secondary: #a0a0a0;
  --color-text-muted: #707070;
  
  --color-accent: #00d4ff;
  --color-success: #51cf66;
  --color-error: #ff6b6b;
  --color-warning: #ffd700;
  
  /* Fonts */
  --font-family-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-family-mono: "Courier New", Monaco, monospace;
  
  /* Sizes */
  --size-spacing-xs: 4px;
  --size-spacing-sm: 8px;
  --size-spacing-md: 16px;
  --size-spacing-lg: 24px;
  --size-spacing-xl: 32px;
  
  --size-border-radius: 4px;
  --size-border-radius-lg: 8px;
  
  --size-font-base: 14px;
  --size-font-large: 18px;
  --size-font-xlarge: 24px;
}
```

---

## Component Interaction Flow

```
[App Starts]
    ↓
[main.js creates BrowserWindow]
    ↓
[index.html loads]
    ↓
[home-tab.js initializes]
    ↓
[Requests scripts from main via IPC]
    ↓
[main.js returns script list]
    ↓
[HomeTabPage renders cards]
    ↓ (User clicks "Run Script")
[home-tab.js calls handleRunScript]
    ↓
[execution-tab.js initializes]
    ↓
[main.js spawns child process]
    ↓
[Output streamed via IPC]
    ↓
[execution-tab.js appends output lines]
    ↓
[Process exits]
    ↓
[main.js notifies completion]
    ↓
[execution-tab.js shows completion status]
    ↓ (User clicks "Save Logs")
[collectOutput() → saveLogs IPC]
    ↓
[main.js writes file to /logs]
    ↓
[Notification shown to user]
```

---

**Component Specification Version:** 1.1
**Last Updated:** March 13, 2026
