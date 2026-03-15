# API Interface & IPC Protocol

> **Frozen at MVP v1.0.0** — This document reflects the shipped implementation.

## Overview

The application uses Electron's IPC (Inter-Process Communication) system to communicate between the Main Process and Renderer Process. All communication is routed through a secure Preload Bridge that enforces context isolation.

## Security Model

```
Renderer Process (Untrusted)
    ↓
Preload Bridge (Trusted)
    ↓
Main Process (Trusted)
```

**Security Principles:**
- Renderer cannot directly access Node.js APIs
- Preload validates and transforms all messages
- Context isolation enforced
- No `eval()` or dynamic code execution
- Input validation on all IPC calls

---

## Exposed API

### window.api Object

The Preload Bridge exposes a safe `window.api` object to the Renderer Process.

```javascript
// In renderer process, available as:
const api = window.api;
```

---

## API Methods

### 1. getScripts()

**Purpose:** Load list of available scripts

**Type:** Async Invoke

**Parameters:** None

**Returns:**
```javascript
Promise<Array<{
  id: string,
  name: string,
  path: string,
  description: string,
  language: string
}>>
```

**Usage:**
```javascript
const scripts = await window.api.getScripts();
console.log(scripts);
// Output:
// [
//   {
//     id: "backup.sh",
//     name: "backup",
//     path: "/full/path/to/scripts/backup.sh",
//     description: "Backup production database",
//     language: "bash"
//   },
//   ...
// ]
```

**Error Handling:**
```javascript
try {
  const scripts = await window.api.getScripts();
} catch (error) {
  console.error('Failed to load scripts:', error.message);
}
```

**Main Process Handler:**
```javascript
ipcMain.handle('get-scripts', async () => {
  // Returns Array<ScriptObject>
});
```

---

### 2. runScript(path, name, tabId)

**Purpose:** Execute a script and begin streaming output with queue management

**Type:** Async Invoke + Events

**Parameters:**
- `path` (string) - Absolute path to script file
- `name` (string) - Human-readable script name
- `tabId` (string) - Tab ID where script is running

**Returns:**
```javascript
Promise<void>
```

**Usage:**
```javascript
await window.api.runScript('/full/path/to/script.sh', 'script-name', 'script-1');
// Script execution begins, output and queue events follow...
```

**Side Effects:**
- Child process spawned (or queued if another is running)
- Output events begin firing
- Queue status events fire if script is queued
- Must listen to script-output, script-error, script-complete, queue-status

**Main Process Behavior:**
- Checks if another script is running
- If running: Adds to execution queue, sends queue-status event
- If not: Spawns child process immediately
- Streams output with tabId to route to correct tab
- On completion: Starts next queued script if exists

**Error Handling:**
```javascript
try {
  await window.api.runScript(path, name, tabId);
} catch (error) {
  // Script not found, permission denied, etc.
  console.error('Failed to run script:', error.message);
}
```

**Main Process Handler:**
```javascript
ipcMain.handle('run-script', async (event, { path, name, tabId }) => {
  // Check if another script running
  // If yes: Add to queue, emit queue-status
  // If no: Spawn process, stream output with tabId
});
```

---

### 3. saveLogs(content, scriptName, timestamp, tabId)

**Purpose:** Save terminal output to a file with full timestamp

**Type:** Async Invoke

**Parameters:**
- `content` (string) - Complete terminal output text
- `scriptName` (string) - Script name for filename
- `timestamp` (string) - ISO timestamp string
- `tabId` (string) - Tab ID where saving happens

**Returns:**
```javascript
Promise<{
  success: boolean,
  filePath: string,
  message: string
}>
```

**Usage:**
```javascript
const result = await window.api.saveLogs(
  terminalContent,      // All terminal text
  'my-script',          // Script name
  new Date().toISOString(),
  'script-1'            // Tab ID
);

if (result.success) {
  console.log('Saved to:', result.filePath);
}
```

**Filename Generation:**
- Input: `scriptName = "backup-db"`, `timestamp = "2026-03-13T14:32:45.000Z"`
- Output filename: `backup-db_2026-03-13_14-32-45.txt`
- Full path: `/logs/backup-db_2026-03-13_14-32-45.txt`
- Note: Full timestamp (HH-MM-SS) allows multiple saves per day

**Error Handling:**
```javascript
try {
  const result = await window.api.saveLogs(content, name, timestamp, tabId);
  if (!result.success) {
    console.error('Save failed:', result.message);
  }
} catch (error) {
  console.error('Save error:', error.message);
}
```

**Main Process Handler:**
```javascript
ipcMain.handle('save-logs', async (event, { content, scriptName, timestamp, tabId }) => {
  // Create /logs directory if missing
  // Generate filename with HH-MM-SS timestamp
  // Write file
  // Return result
});
```

---

### 4. stopScript(tabId)

**Purpose:** Stop a running script

**Type:** Async Invoke

**Parameters:**
- `tabId` (string) - Tab ID of the script to stop

**Returns:** `Promise<void>`

**Usage:**
```javascript
await window.api.stopScript('script-1');
```

**Main Process Behavior:**
- If the tabId matches the currently running script: sends SIGTERM, waits 5s, then SIGKILL
- If queued: removes from queue

---

### 5. clearTerminal(tabId)

**Purpose:** Clear terminal output for a tab

**Type:** Async Invoke

**Parameters:**
- `tabId` (string) - Tab ID to clear

**Returns:** `Promise<void>`

---

### 6. openFolderPicker()

**Purpose:** Open native folder picker dialog for importing scripts

**Type:** Async Invoke

**Parameters:** None

**Returns:**
```javascript
Promise<{
  valid: boolean,
  folderPath: string,
  folderName: string,
  executables: string[],
  error?: string
} | null>
```

---

### 7. validateDroppedFolder(folderPath)

**Purpose:** Validate a drag-and-dropped folder for script import

**Type:** Async Invoke

**Parameters:**
- `folderPath` (string) - Absolute path to the dropped folder

**Returns:**
```javascript
Promise<{
  valid: boolean,
  folderPath: string,
  folderName: string,
  executables: string[],
  error?: string
}>
```

---

### 8. importScript(folderPath, mainScript)

**Purpose:** Import a validated script folder into the scripts directory

**Type:** Async Invoke

**Parameters:**
- `folderPath` (string) - Absolute path to the source folder
- `mainScript` (string) - Filename of the main executable

**Returns:**
```javascript
Promise<{ success: boolean, message: string }>
```

---

### 9. removeScript(scriptId)

**Purpose:** Remove a script folder from the scripts directory

**Type:** Async Invoke

**Parameters:**
- `scriptId` (string) - Script folder name to remove

**Returns:**
```javascript
Promise<{ success: boolean, message: string }>
```

---

### 10. getResourcesPath()

**Purpose:** Get the absolute path to the app resources directory

**Type:** Async Invoke

**Parameters:** None

**Returns:** `Promise<string>`

---

### 11. openExternalUrl(url)

**Purpose:** Open a URL in the user's default system browser

**Type:** Async Invoke

**Parameters:**
- `url` (string) - URL to open

**Returns:** `Promise<void>`

---

## Event Listeners

### 1. script-output

**Purpose:** Receive stdout from running script

**Type:** IPC On (one-way from Main to Renderer)

**Data:**
```javascript
{
  tabId: string,          // Tab ID to route output to
  text: string,           // Single line of output
  timestamp: string       // ISO timestamp
}
```

**Usage:**
```javascript
window.api.on('script-output', (data) => {
  console.log(`[${data.tabId}][${data.timestamp}] ${data.text}`);
  // Append to correct tab's terminal display
});
```

**Preload Exposure:**
```javascript
ipcRenderer.on('script-output', (event, data) => {
  // Handle output
});
```

---

### 2. script-error

**Purpose:** Receive stderr from running script

**Type:** IPC On (one-way from Main to Renderer)

**Data:**
```javascript
{
  tabId: string,          // Tab ID to route error to
  text: string,           // Single line of error text
  timestamp: string       // ISO timestamp
}
```

**Usage:**
```javascript
window.api.on('script-error', (data) => {
  console.error(`[${data.tabId}][${data.timestamp}] ${data.text}`);
  // Append to correct tab's terminal display with error styling
});
```

---

### 3. script-complete

**Purpose:** Notify when script finishes executing

**Type:** IPC On (one-way from Main to Renderer)

**Data:**
```javascript
{
  tabId: string,          // Tab ID where script was running
  exitCode: number,       // Exit code (0 = success)
  signal: string | null,  // Kill signal if applicable
  runtime: number         // Execution time in ms
}
```

**Usage:**
```javascript
window.api.on('script-complete', (data) => {
  if (data.exitCode === 0) {
    console.log(`[${data.tabId}] Completed in ${data.runtime}ms`);
    showNotification('Script completed!', 'success');
  } else {
    console.error(`[${data.tabId}] Failed with code ${data.exitCode}`);
    showNotification(`Script failed (exit code: ${data.exitCode})`, 'error');
  }
  // Update correct tab's button state
});
```

---

### 4. app-error

**Purpose:** Receive errors from main process

**Type:** IPC On (one-way from Main to Renderer)

**Data:**
```javascript
{
  message: string,        // Error description
  code: string,           // Error code (ENOENT, EACCES, etc.)
  context: string         // What operation failed
}
```

**Usage:**
```javascript
window.api.on('app-error', (data) => {
  console.error(`Error: ${data.message}`);
  showNotification(data.message, 'error');
});
```

---

### 5. queue-status

**Purpose:** Notify renderer of execution queue position changes

**Type:** IPC On (one-way from Main to Renderer)

**Data:**
```javascript
{
  position: number,                   // Queue position (1-based)
  queuedScripts: Array<{
    name: string,
    position: number,
    tabId: string
  }>
}
```

**Usage:**
```javascript
window.api.on('queue-status', (data) => {
  console.log(`Queued at position ${data.position}`);
});
```

---

### 6. log-saved

**Purpose:** Confirm log file was saved successfully

**Type:** IPC On (one-way from Main to Renderer)

**Data:**
```javascript
{
  tabId: string,          // Tab ID that requested the save
  filePath: string,       // Path to saved log file
  message: string         // Success message
}
```

**Usage:**
```javascript
window.api.on('log-saved', (data) => {
  showNotification(data.message, 'success');
});
```

---

## Preload Bridge Implementation

### Overview
The Preload Script (`app/preload.js`) provides secure access to IPC:

```javascript
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_CHANNELS = [
  'script-output',
  'script-error',
  'script-complete',
  'queue-status',
  'log-saved',
  'app-error'
];

contextBridge.exposeInMainWorld('api', {
  // Methods (invoke pattern with input validation)
  getScripts: () => ipcRenderer.invoke('get-scripts'),

  runScript: (scriptPath, name, tabId) => {
    if (typeof scriptPath !== 'string' || !scriptPath) return Promise.reject(new Error('Invalid scriptPath'));
    if (typeof tabId !== 'string' || !tabId) return Promise.reject(new Error('Invalid tabId'));
    return ipcRenderer.invoke('run-script', { scriptPath, name: String(name || ''), tabId });
  },

  saveLogs: (content, scriptName, timestamp, tabId) => {
    if (typeof content !== 'string' || !content) return Promise.reject(new Error('Invalid content'));
    if (typeof scriptName !== 'string' || !scriptName) return Promise.reject(new Error('Invalid scriptName'));
    return ipcRenderer.invoke('save-logs', { content, scriptName, timestamp, tabId });
  },

  stopScript: (tabId) => {
    if (typeof tabId !== 'string' || !tabId) return;
    return ipcRenderer.invoke('stop-script', { tabId });
  },

  clearTerminal: (tabId) => ipcRenderer.invoke('clear-terminal', { tabId }),
  openFolderPicker: () => ipcRenderer.invoke('open-folder-picker'),

  validateDroppedFolder: (folderPath) => {
    if (typeof folderPath !== 'string' || !folderPath) return Promise.resolve({ valid: false, error: 'Invalid folder path' });
    return ipcRenderer.invoke('validate-dropped-folder', { folderPath });
  },

  importScript: (folderPath, mainScript) => {
    if (typeof folderPath !== 'string' || !folderPath) return Promise.resolve({ success: false, message: 'Invalid folder path' });
    if (typeof mainScript !== 'string' || !mainScript) return Promise.resolve({ success: false, message: 'Invalid main script' });
    return ipcRenderer.invoke('import-script', { folderPath, mainScript });
  },

  removeScript: (scriptId) => {
    if (typeof scriptId !== 'string' || !scriptId) return Promise.resolve({ success: false, message: 'Invalid script ID' });
    return ipcRenderer.invoke('remove-script', { scriptId });
  },

  getResourcesPath: () => ipcRenderer.invoke('get-resources-path'),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),

  // Event listeners (channel-whitelisted)
  on: (event, callback) => {
    if (!ALLOWED_CHANNELS.includes(event)) return;
    ipcRenderer.on(event, (_event, data) => callback(data));
  },

  // Event removal (cleanup)
  off: (event, callback) => {
    if (!ALLOWED_CHANNELS.includes(event)) return;
    ipcRenderer.off(event, callback);
  }
});
```

### Key Security Features
- **Context Isolation:** Renderer can only call exposed methods
- **Channel Whitelist:** Only explicitly allowed IPC channels can be listened to
- **Input Validation:** Parameters validated before passing to main
- **Error Wrapping:** Errors converted to safe messages
- **Event Filtering:** Only safe events exposed

---

## Main Process Handler Implementation

### get-scripts Handler

```javascript
ipcMain.handle('get-scripts', async (event) => {
  try {
    const scriptsDir = path.join(__dirname, '../scripts');
    
    // Create directory if missing
    if (!fs.existsSync(scriptsDir)) {
      fs.mkdirSync(scriptsDir, { recursive: true });
      return [];
    }
    
    // Read directory
    const files = fs.readdirSync(scriptsDir);
    const scripts = [];
    
    for (const file of files) {
      const filePath = path.join(scriptsDir, file);
      const stats = fs.statSync(filePath);
      
      // Skip directories
      if (stats.isDirectory()) continue;
      
      // Get file info
      const ext = path.extname(file);
      const name = path.basename(file, ext);
      
      // Detect language
      const language = detectLanguage(ext, filePath);
      
      // Read first line for description
      const description = getFileDescription(filePath);
      
      scripts.push({
        id: file,
        name: name,
        path: filePath,
        description: description,
        language: language
      });
    }
    
    // Sort by name
    scripts.sort((a, b) => a.name.localeCompare(b.name));
    
    return scripts;
  } catch (error) {
    console.error('Error getting scripts:', error);
    throw error;
  }
});
```

### run-script Handler

```javascript
ipcMain.handle('run-script', async (event, { path, name }) => {
  try {
    // Validate script exists
    if (!fs.existsSync(path)) {
      throw new Error(`Script not found: ${path}`);
    }
    
    // Get shell
    const shell = getShell(path);
    
    // Create child process
    const child = spawn(shell, [path], {
      cwd: dirname(path),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    });
    
    // Track process
    this.currentProcess = child;
    
    // Handle output
    child.stdout.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        event.sender.send('script-output', {
          text: text,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    child.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        event.sender.send('script-error', {
          text: text,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    // Handle completion
    const startTime = Date.now();
    child.on('exit', (code, signal) => {
      event.sender.send('script-complete', {
        exitCode: code,
        signal: signal,
        runtime: Date.now() - startTime
      });
      this.currentProcess = null;
    });
    
    // Handle errors
    child.on('error', (error) => {
      event.sender.send('app-error', {
        message: error.message,
        code: error.code,
        context: 'Script execution'
      });
      this.currentProcess = null;
    });
    
  } catch (error) {
    event.sender.send('app-error', {
      message: error.message,
      code: error.code,
      context: 'Script spawn'
    });
    throw error;
  }
});
```

### save-logs Handler

```javascript
ipcMain.handle('save-logs', async (event, { content, scriptName, timestamp, tabId }) => {
  try {
    const logsDir = path.join(__dirname, '../logs');
    
    // Create logs directory if missing
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    // Generate filename with full timestamp (allows multiple saves per day)
    const dateObj = new Date(timestamp);
    const dateStr = dateObj.toISOString().slice(0, 10);  // YYYY-MM-DD
    const timeStr = dateObj.toTimeString().slice(0, 8)   // HH:MM:SS
      .replace(/:/g, '-');  // Convert : to - for filename
    
    const safeName = scriptName
      .replace(/[^a-z0-9-_]/gi, '_')
      .toLowerCase();
    const filename = `${safeName}_${dateStr}_${timeStr}.txt`;
    const filePath = path.join(logsDir, filename);
    
    // Format output with metadata
    const header = `
================================================================================
SCRIPT EXECUTION LOG
================================================================================
Script: ${scriptName}
Date & Time: ${dateObj.toLocaleString()}
Tab ID: ${tabId}
================================================================================
`;
    
    const footer = `
================================================================================
End of Log
================================================================================
`;
    
    const fileContent = header + '\n' + content + '\n' + footer;
    
    // Write file
    fs.writeFileSync(filePath, fileContent, 'utf8');
    
    return {
      success: true,
      filePath: filePath,
      message: 'Logs saved successfully'
    };
    
  } catch (error) {
    return {
      success: false,
      filePath: '',
      message: error.message
    };
  }
});
```

---

## Error Handling

### Standard Error Codes

| Code | Meaning | Recovery |
|---|---|---|
| ENOENT | File/directory not found | Check path, create directory |
| EACCES | Permission denied | Request elevated privileges |
| EISDIR | Is a directory | Use file, not directory |
| EEXIST | File already exists | Overwrite or append to filename |
| EIO | I/O error | Retry operation |

### Error Flow

```
Main Process Error
    ↓
Wrapped in app-error event
    ↓
Sent to Renderer via IPC
    ↓
Renderer listens to 'app-error'
    ↓
Shows user-friendly notification
```

---

## Performance Considerations

### Output Streaming
- **Batching:** Events sent per-line, not per-character
- **Throttling:** Consider batching updates if >100 lines/sec
- **Buffering:** Main process doesn't buffer, streams directly

### Memory Management
- **Terminal Display:** Limit to 10MB of text (~1M lines)
- **Log Files:** No limit (unlimited disk write)
- **Process State:** Cleaned up after script completion

### Timeout Handling
- **Default:** No timeout on script execution
- **Future:** Configurable timeout to kill long-running scripts

---

## Example Usage Flow

```javascript
// 1. Load scripts on page load (Home tab)
async function initializePage() {
  try {
    const scripts = await window.api.getScripts();
    displayScripts(scripts);
  } catch (error) {
    showNotification(`Error loading scripts: ${error.message}`, 'error');
  }
}

// 2. Execute script when user clicks button (with tab context)
async function runScript(scriptPath, scriptName, tabId) {
  try {
    // Start execution with tabId
    await window.api.runScript(scriptPath, scriptName, tabId);
    
    // Set up listeners for this specific tab
    window.api.on('script-output', (data) => {
      if (data.tabId === tabId) {  // Only update our tab
        appendTerminalLine(data.text, false);
      }
    });
    
    window.api.on('script-error', (data) => {
      if (data.tabId === tabId) {  // Only update our tab
        appendTerminalLine(data.text, true);  // Red text
      }
    });
    
    // Track queue status
    window.api.on('queue-status', (data) => {
      if (data.position > 0) {
        showNotification(`Script queued at position ${data.position}`, 'info');
        updateTabStatus(tabId, 'queued');
      }
    });
    
    // Handle completion
    window.api.on('script-complete', (data) => {
      if (data.tabId === tabId) {
        if (data.exitCode === 0) {
          showNotification('Script completed!', 'success');
          updateTabStatus(tabId, 'success');
        } else {
          showNotification(`Script failed (${data.exitCode})`, 'error');
          updateTabStatus(tabId, 'error');
        }
        // Enable Save Logs button
        enableSaveLogsButton(tabId);
        // Show exit code and runtime
        displayExecutionStats(tabId, data.exitCode, data.runtime);
      }
    });
    
  } catch (error) {
    showNotification(`Error running script: ${error.message}`, 'error');
  }
}

// 3. Save logs when user clicks button (with tab and full timestamp)
async function saveLogs(tabId) {
  try {
    const content = collectTerminalContent(tabId);
    const scriptName = getScriptNameFromTab(tabId);
    const timestamp = new Date().toISOString();
    
    const result = await window.api.saveLogs(
      content,
      scriptName,
      timestamp,
      tabId  // Include tab ID
    );
    
    if (result.success) {
      showNotification(
        `Logs saved to ${result.filePath}`,
        'success'
      );
      // Button stays enabled for another save
    } else {
      showNotification(
        `Failed to save logs: ${result.message}`,
        'error'
      );
    }
  } catch (error) {
    showNotification(`Error saving logs: ${error.message}`, 'error');
  }
}

// 4. Handle tab switching
function switchTab(newTabId) {
  // Update active tab indicator
  updateActiveTab(newTabId);
  // Unload listeners from previous tab
  // Load listeners for new tab (if execution tab)
  if (newTabId !== 'home') {
    // Listeners will automatically filter by tabId
  }
}
```

---

**API Version:** 1.0
**Last Updated:** March 13, 2026
**Authentication:** None (single-user desktop app)
**Rate Limiting:** 100 requests/minute per IPC channel
