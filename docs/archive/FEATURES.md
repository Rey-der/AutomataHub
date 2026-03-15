# Feature Specifications

> **Frozen at MVP v1.0.0** — This document reflects the shipped implementation.

## Feature 1: Script Discovery & Tab-Based Display

### Overview
The application automatically scans the `/scripts` directory and displays all executable files as interactive buttons/cards in the "Home" tab. Users click a script button to create or reuse an execution tab.

### Requirements
- **Input:** `/scripts` directory
- **Output:** Array of script objects with name, path, and description
- **Trigger:** Application startup + renders on Home tab
- **Tab Behavior:** Click script button → creates new tab OR reuses existing tab (if already open)

### Detailed Steps
1. Main process scans `/scripts` folder on startup
2. For each script folder, extract:
   - Folder name (script name)
   - Full path to main executable
   - Description from config.json or README.md first line
   - Supported executable types: .sh, .py, .py3, .js, .mjs, .rb, .pl
3. Filter out invalid folders (no executables, hidden dirs, etc.)
4. Send list to renderer via IPC invoke `get-scripts` (renderer calls, main responds)
5. Renderer displays in Home tab as clickable script cards in grid layout
6. User clicks a script card:
   - If tab exists for this script: Switch to existing tab (preserve output)
   - If no tab exists (max 4 script tabs): Create new tab
   - If at max 5 tabs (home + 4 scripts): Show "Max tabs reached" message

### Data Structure
```javascript
{
  id: "backup-database",
  name: "Backup Database",
  path: "/path/to/AutomataHub/scripts/backup-database/backup.sh",
  description: "Backs up the production database to cloud storage",
  language: "bash"
}
```

### Error Handling
- Empty `/scripts` folder → Show "No scripts found" message on Home tab
- Unreadable folder → Show error notification
- Non-executable files → Skip silently
- Tab limit reached → Show message, don't create tab

### UI Components
- Home tab with script cards in grid layout
- Tab bar showing Home + up to 4 script tabs
- Tab indicators: running (dot), error/success (icon), close button (X)

---

## Feature 2: Script Execution with Command Queue

### Overview
Executes selected scripts as child processes and streams output in real-time. If another script is running, new execution requests are queued and run sequentially.

### Requirements
- **Input:** Selected script path + tab ID
- **Output:** Real-time stdout/stderr stream to terminal display in correct tab
- **Process Management:** Handle spawning, streaming, completion, and queue management
- **Concurrent Behavior:** Only one script runs at a time; others are queued

### Detailed Steps
1. User clicks "Run" button in execution tab
2. Renderer sends IPC event `run-script` with {scriptPath, scriptName, tabId}
3. Main process receives event
4. Main checks if another script is running:
   - **If running:** Queue this script, send queue-status event to renderer
   - **If not running:** Proceed to execute immediately
5. Main spawns child process using `child_process.spawn()`
   - Determine shell based on file extension
   - Set cwd to script directory
   - Pipe stdout and stderr
6. Attach listeners to:
   - `data` event on stdout stream → send with tabId
   - `data` event on stderr stream → send with tabId
   - `exit` event on child process → send with exit code, runtime
   - `error` event for execution failures
7. On data event: Send output chunk via IPC to renderer with tabId
8. Renderer appends output to correct tab's terminal display
9. On exit event: Notify renderer of completion with exit code
10. Main checks queue:
    - If queued scripts exist: Start first one automatically
    - If no queue: Disable Run button, enable Save Logs button

### Button State Management
```
Before execution:
  [Run Button] [DISABLED Stop Button]
  
During execution:
  [DISABLED Run Button] [Stop Button]
  
After execution completes:
  [Run Button] [DISABLED Stop Button]
  Save Logs button ENABLED
```

### Data Structure
```javascript
{
  scriptPath: "/path/to/script",
  scriptName: "backup-database",
  tabId: "script-1",
  startTime: Date,
  exitCode: 0 | 1 | null,
  endTime: Date,
  totalOutput: String,
  errorOutput: String,
  runtime: number  // milliseconds
}
```

### Queue Behavior
```javascript
// Example queue state
executionQueue = [
  {tabId: 'script-2', scriptName: 'deploy.py', position: 1},
  {tabId: 'script-3', scriptName: 'cleanup.sh', position: 2}
]
// Position 1 will run after current (position 0)
// User sees "Queued (position 1)" in their tab
```

### Error Handling
- Script not found → Show error notification, don't execute
- Permission denied → Show error notification
- Script crashes → Display exit code and error output in red
- Queue operations fail → Log and notify user

### IPC Events
- Renderer → Main: `run-script` {scriptPath, scriptName, tabId}
- Main → Renderer: `script-output` {tabId, text, timestamp}
- Main → Renderer: `script-error` {tabId, text, timestamp}
- Main → Renderer: `script-complete` {tabId, exitCode, runtime}
- Main → Renderer: `queue-status` {position, queuedScripts}

---

## Feature 3: Terminal Output Display

### Overview
Displays script output in a terminal-style window with real-time updates.

### Requirements
- **Input:** Output chunks from main process via IPC
- **Output:** Formatted terminal display
- **Styling:** Dark background, monospace font, color-coded output

### Detailed Components
1. **Terminal Container**
   - Dark background (#1e1e1e)
   - Monospace font (Courier New, Monaco)
   - Scrollable area
   - Preset height or fill remaining space

2. **Output Formatting**
   - Each chunk appended to a `<div>` with class `terminal-line`
   - Preserve whitespace and line breaks
   - Handle ANSI color codes (basic support)
   - Auto-scroll to bottom as output appears

3. **Visual Distinction**
   - **Normal Output:** White text (#e0e0e0)
   - **Error Output:** Red text (#ff6b6b)
   - **Warnings:** Yellow text (#ffd700)
   - **Info:** Green text (#51cf66)

4. **Performance**
   - Limit terminal display to last 1000 lines (head truncation)
   - Batch DOM updates to reduce reflows
   - Use `document.createElement` + `textContent` per line (safe against XSS AND supports color classes via CSS class per element)

### User Interactions
- Auto-scroll toggle (future)
- Clear terminal button (future)
- Copy to clipboard button (future)

### Example Output Display
```
[Terminal Window]
┌─────────────────────────────┐
│ $ Running: backup-database  │
│ [TIMESTAMP] Starting backup │
│ [TIMESTAMP] Connecting...   │
│ [ERROR] Connection failed   │
│ → Process exited (code 1)   │
└─────────────────────────────┘
```

---

## Feature 4: Log Saving with Timestamps

### Overview
Saves complete terminal output to a text file with timestamp. Users can save multiple times per day with unique timestamps.

### Requirements
- **Input:** Complete terminal output text from tab + script name + timestamp
- **Output:** Saved `.txt` file in `/logs` directory
- **Naming:** `{script-name}_{YYYY-MM-DD}_{HH-MM-SS}.txt`
- **Button State:** Enabled after script completes, remains enabled for multiple saves

### Detailed Steps
1. Script finishes executing
2. "Save Logs" button becomes ENABLED (styled distinctly)
3. User clicks "Save Logs" button
4. Renderer collects all terminal content from that tab
5. Renderer sends IPC event `save-logs` with:
   - tabId
   - Terminal output text
   - Script name
   - ISO timestamp string
6. Main process receives event
7. Generates filename: `script-name_2026-03-13_14-32-45.txt`
8. Creates `/logs` directory if it doesn't exist
9. Writes output to file
10. Sends IPC event `log-saved` with file path to renderer
11. Renderer displays success notification with file path
12. Save Logs button remains ENABLED
13. User can click "Save Logs" again if needed

### File Format
```
================================================================================
SCRIPT EXECUTION LOG
================================================================================
Script: backup-database
Date & Time: 2026-03-13 14:32:45 UTC
================================================================================

[14:32:45] Starting backup process...
[14:32:46] Connecting to database...
[14:32:48] Creating backup file...
[14:32:50] Uploading to cloud storage...
[14:32:55] Backup complete!

Exit Code: 0
Total Runtime: 10 seconds

================================================================================
End of Log
================================================================================
```

### Multiple Saves Example
```
User runs script
  ↓
Tab 1: backup-database_2026-03-13_14-32-45.txt (saved)
  ↓
User runs same script again 30 minutes later
  ↓
Tab 1: backup-database_2026-03-13_15-02-30.txt (saved)
  ↓
Both files exist independently in /logs folder
```

### Error Handling
- Cannot create /logs folder → Show error message
- Permission denied on write → Show error message
- Disk full → Show error message
- Success → Show confirmation with file location

### IPC Events
- Renderer → Main: `save-logs` {tabId, content, scriptName, timestamp}
- Main → Renderer: `log-saved` {tabId, filePath, message}

---

## Feature 5: Tab Management

### Overview
Manages multiple script execution tabs with a persistent Home tab. Users can have up to 5 tabs open simultaneously (1 Home + 4 execution tabs).

### Requirements
- **Home Tab:** Always present, cannot be closed
- **Execution Tabs:** Max 4 per session, reused if script already has a tab
- **Tab Indicator:** Shows script status (running, success, error)
- **Lifecycle:** Tabs close on app exit

### Tab States
```
[Home] [script-1 ●] [script-2 ✓] [script-3 ✗] [script-4]
       │             │             │             │
     Running      Success        Error       Idle
```

### Tab Creation/Reuse Logic
```
1. User clicks script in Home tab
2. Check if execution tab already exists for script:
   - YES: Switch to existing tab (preserve output)
   - NO:  Check if less than 4 script tabs open
         - YES: Create new tab, initialize
         - NO:  Show "Max tabs reached" message
Note: Terminal is cleared automatically when clicking Run, not on tab switch.
```

### Tab Indicators
- **Dot (●):** Script is currently running
- **Checkmark (✓):** Script completed successfully (exit code 0)
- **X/Error (✗):** Script failed (exit code ≠ 0)
- **Close Button (X):** Only appears on execution tabs, not Home tab

### Tab Switching
- Click tab header to switch to that tab
- Clicking close (X) button closes tab and returns focus to Home or previous tab
- Keyboard shortcut: Cmd+W to close tab

### IPC Events
- Renderer maintains tab state
- Tab ID included in all execution-related IPC events
- Main process tracks which script runs from which tab

---

## Feature 6: User Interface Design

### Overview
Tab-based dark-themed interface with script list in Home tab and execution views in script tabs.

### Layout Structure
```
┌─────────────────────────────────────────────┐
│ [🏠 Home] [🟢 backup.sh ●] [deploy.py ✓] ✕ │  ← Tab Bar (Top)
├─────────────────────────────────────────────┤
│                                             │
│  Home Tab Content OR Execution Tab Content  │  ← Tab Content Area
│                                             │
│  Execution tabs include per-tab toolbar:    │
│  [Run] [Stop] [Save Logs] [Clear]           │  ← Per-Tab Controls
└─────────────────────────────────────────────┘
```

### Home Tab Content
- Script cards in grid layout (3 columns)
- Each card shows: Name, Description, Language badge
- Click card to open execution tab

### Execution Tab Content
- Collapsible script description at top
- Terminal output display (dark background, monospace font)
- Exit code and execution time at bottom
- Timestamps on each output line

### Design Specifications

#### Color Scheme
| Element | Color | Usage |
|---|---|---|
| Background | #0d1117 | Main background |
| Surface | #1a1f2b | Cards, panels |
| Tab Bar | #111827 | Terminal-style dark |
| Primary Text | #e6edf3 | Normal text |
| Accent | #00d4ff | Buttons, highlights, running indicator |
| Success | #51cf66 | Success messages, completion indicator |
| Error | #ff6b6b | Error messages, failure indicator |
| Warning | #ffd700 | Warnings |

#### Typography
- Font Family: System fonts: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
- Terminal Font: Courier New, Monaco, monospace
- Base Size: 14px
- Heading Size: 24px (h1), 18px (h2)

#### Tab Bar Styling
- Height: 44px with padding
- Border bottom: 1px solid #30363d
- Active tab: Accent color (blue) underline
- Inactive tabs: Muted gray text
- Status indicators: Small colored dots or icons
- Close button: Appears on hover

#### Spacing
- Standard padding: 16px
- Card gap: 12px
- Section margin: 24px

#### Buttons
- Padding: 12px 24px
- Border radius: 4px
- Hover effect: Brightness +20%, cursor pointer
- Active effect: Background color darkens
- Font weight: 600

#### Cards
- Background: #1a1f2b
- Border radius: 8px
- Padding: 16px
- Shadow: None (flat design)
- Hover effect: Border highlight

### Responsive Design
- Minimum width: 800px
- Mobile support: Not required for MVP
- Flex layout for flexibility

### Accessibility
- Sufficient color contrast
- Keyboard navigation support
- Focus indicators visible
- ARIA labels where needed

---

## Feature 7: Script Import System

### Overview
Users can add new scripts to the application by importing folders from their file system. The system validates folder structure, extracts metadata, and displays scripts in the Home tab.

### Requirements
- **Input:** Script folder from user's file system (via Finder/drag-drop)
- **Output:** New script added to `/scripts` directory with validated structure
- **Validation:** Flexible - only requires executable file, metadata optional
- **Metadata:** Read from config.json, README.md, and icon.png if present

### Import Methods

#### Method 1: File Picker Button
1. User clicks `[📂 Open Finder]` button in Home tab
2. System opens file/folder picker
3. User navigates to script folder and selects it
4. Validation begins (see validation steps below)

#### Method 2: Drag & Drop Zone
1. User sees import drop zone in Home tab
2. Zone has visual indicator: "Drag script folders here"
3. User drags folder from Finder into drop zone
4. Visual feedback on drag-over (highlight, border change)
5. Validation begins on drop (see validation steps below)

### Validation Process

#### Step 1: Folder Structure Check
```javascript
Validate(folderPath):
  - Is folder readable? (YES/NO)
  - Contains executable files? (YES/NO)
  - Has duplicate name? (YES/NO)
  - Validate any config.json syntax? (YES/NO if exists)
```

#### Step 2: Executable Detection
Find all executable files:
- `.sh`, `.bash` - Shell scripts
- `.py`, `.py3` - Python scripts
- `.js`, `.mjs` - Node.js scripts
- `.rb` - Ruby scripts
- Files with unix executable permission
- On Windows: `.bat`, `.cmd`, `.exe`, `.ps1`

#### Step 3: Main Script Selection
If folder contains multiple executables:
1. Show dialog: "Which file is the main script?"
2. User selects one (required)
3. Continue with import

If only one executable:
1. Auto-select and proceed

If no executables:
1. Show error: "No script files found in folder"
2. Abort import

#### Step 4: Metadata Discovery
Look for metadata files in order:
1. Check for `config.json` (validate JSON syntax)
2. Check for `README.md` (extract first line as description)
3. Check for `icon.png`, `icon.jpg`, `icon.svg` (validate image)
4. If metadata exists: Parse and use
5. If metadata missing: Use defaults (folder name, generic icon)

#### Step 5: Final Validation
```javascript
ChecklistBefore import:
  ✓ Main script file exists and is executable
  ✓ Folder name is valid (no spaces, special chars)
  ✓ No duplicate script already imported
  ✓ Icon is valid format (if exists)
  ✓ config.json parses without errors (if exists)
  ✓ README.md is readable (if exists)
```

### Metadata Extraction

#### From config.json
```json
{
  "name": "Script Display Name",
  "description": "What this script does",
  "version": "1.0.0",
  "tags": ["category", "keyword"],
  "parameters": [...],
  "mainScript": "main.sh",
  "timeout": 3600
}
```
Extracted fields:
- Script name / display name
- Description (shows in script card)
- Version (shown as badge)
- Tags (for future filtering)
- Parameters (for future input UI)

#### From README.md
Extract first line (header or inline text):
```markdown
# Backup Database Script
```
↓ Extracted as: `"Backup Database Script"`

Used as description if `config.json` not present.

#### From icon.png
- Load image file
- Validate: PNG/JPG/SVG format, max 1MB
- Encode to base64 for display
- Show in script card

### UI/UX Flow

#### Import UI in Home Tab
```
┌─────────────────────────────────────┐
│ IMPORT SCRIPTS                      │
├─────────────────────────────────────┤
│ Drop script folders here            │
│ ║ Drag folder into this area ║       │
│ OR                                  │
│ [📂 Open Finder / Explorer]         │
└─────────────────────────────────────┘

[Script 1 Card]  [Script 2 Card]  [Script 3 Card]
```

#### Drop Zone Styling
- **Idle:** Dashed border, muted color, text centered
- **Drag-over:** Solid border, accent color (#00d4ff), background highlight
- **Invalid drop:** Border color changes to error (red)

#### Success Message
```
✓ Script imported successfully!
  Script: "Backup Database"
  Location: /scripts/backup-database
  Main script: backup.sh
```

#### Error Messages
```
✗ Import failed
  Reason: "No executable files found in folder"
  Solution: "Folder must contain at least one .sh, .py, or executable file"

✗ Import failed
  Reason: "Script with name 'backup' already exists"
  Solution: "Rename folder or configure different name in config.json"

✗ Import failed
  Reason: "config.json has invalid syntax"
  Solution: "Fix JSON formatting errors and retry"
```

### File System Operations

#### Import Location
All scripts imported to: `/scripts/{folder-name}/`

#### Copied Structure
```
User's location:              → Imported to:
~/Documents/my-backup/        → /scripts/my-backup/
  ├── backup.sh              → /scripts/my-backup/backup.sh
  ├── config.json            → /scripts/my-backup/config.json
  ├── README.md              → /scripts/my-backup/README.md
  ├── icon.png               → /scripts/my-backup/icon.png
  └── helpers/               → /scripts/my-backup/helpers/
```

All folder contents copied as-is.

#### Folder Naming Rules
- **Auto-converted:** Spaces → hyphens, uppercase → lowercase
- **Cleaned:** Special characters removed
- **Max length:** 64 characters
- **Examples:** `My Script Folder` → `my-script-folder`

### Script Display After Import
```
After successful import, script appears in Home tab:

┌──────────────────────┐
│ Backup Database      │  ← name from config.json
│ Version: 2.1.0       │  ← version from config.json
│ [Icon]               │  ← icon.png if present
│ Backs up the prod... │  ← description from config.json or README
│ Tags: backup, db     │  ← tags from config.json
│ [► Run Script]       │  ← Run button
└──────────────────────┘
```

### Data Structure

#### Import Request
```javascript
{
  folderPath: "/Users/username/Documents/script",
  mainScript: "backup.sh",
  timestamp: Date
}
```

#### Imported Script Object
```javascript
{
  id: "backup-database",
  path: "/scripts/backup-database",
  mainScript: "backup.sh",
  name: "Backup Database",
  description: "Backs up the production database...",
  version: "2.1.0",
  tags: ["backup", "database"],
  icon: "base64_encoded_image_data",
  importedAt: Date,
  importedFrom: "/original/path"
}
```

### IPC Events for Import

#### Renderer → Main
| Event | Data | Purpose |
|---|---|---|
| `open-folder-picker` | - | Open file picker dialog |
| `drop-folder` | {path} | Validate dropped folder |
| `import-script` | {folderPath, mainScript} | Start import process |
| `remove-script` | {scriptId} | Delete imported script |

#### Main → Renderer
| Event | Data | Purpose |
|---|---|---|
| `folder-selected` | {path, executableFiles} | Picker returned folder, show main script selector |
| `select-main-executable` | {path, executables} | Ask user to pick main executable |
| `validation-error` | {error, suggestion} | Import validation failed |
| `script-imported` | {scriptId, metadata} | Successfully imported script |
| `import-progress` | {status, message} | Real-time import status |

### Error Handling & Recovery

#### Validation Failures
| Scenario | Error | Recovery |
|---|---|---|
| No executables | "No script files found" | User must add .sh/.py file |
| Duplicate name | "Script 'foo' exists" | User renames folder and retries |
| Invalid JSON | "config.json syntax error" | User fixes JSON with editor |
| Bad image | "Icon must be PNG/JPG" | User provides valid image file |
| Permission denied | "Cannot read folder" | User grants folder permissions |

#### Atomic Import
- All files copied together (no partial imports)
- On any error: Roll back, no files saved
- On success: Full script available immediately

### Implementation Checklist
- [ ] File picker integration (open folder dialog)
- [ ] Drag-drop zone in Home tab UI
- [ ] Folder validation function
- [ ] Executable file detector
- [ ] Metadata parser (JSON, README, icon)
- [ ] Folder conflict check
- [ ] Copy folder to `/scripts` directory
- [ ] Icon base64 encoder
- [ ] Error message display
- [ ] Success notification
- [ ] Update script list after import
- [ ] IPC event handlers (import-script, drop-folder, etc.)

### Backward Compatibility
- Old flat-file system scripts are ignored
- Only folder-based scripts supported
- Users must organize scripts into folders to import
- Migration guide available in documentation

---

## Feature Completeness Matrix

| Feature | MVP | Phase 2 | Phase 3 |
|---|---|---|---|
| Script Discovery | ✓ | ✓ | ✓ |
| Script Display List | ✓ | ✓ | ✓ |
| Script Execution | ✓ | ✓ | ✓ |
| Live Output Streaming | ✓ | ✓ | ✓ |
| Error/Normal Output Distinction | ✓ | ✓ | ✓ |
| Log Saving | ✓ | ✓ | ✓ |
| Navigation (Tabs) | ✓ | ✓ | ✓ |
| Dark Theme UI | ✓ | ✓ | ✓ |
| Script Import (Drag-Drop + Finder) | ✓ | ✓ | ✓ |
| Folder Validation | ✓ | ✓ | ✓ |
| Metadata Extraction | ✓ | ✓ | ✓ |
| Script Search | | ✓ | ✓ |
| Script Filtering by Tags | | ✓ | ✓ |
| Stop/Kill Script | | ✓ | ✓ |
| Execution History | | | ✓ |
| Script Scheduling | | | ✓ |

---

**Feature Document Version:** 1.1
**Last Updated:** March 13, 2026
