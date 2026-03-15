# Script Folder System & Import Rules

> **Frozen at MVP v1.0.0** — This document reflects the shipped implementation.

## Overview

The application uses a **folder-based script system** where each script lives in its own directory with metadata, resources, and optional sub-scripts. This replaces the old flat-file system for better organization and richer metadata support.

## Folder Structure Rules

### Required Structure
```
/scripts/
  ├── script-name/                    # Folder name (becomes script ID)
  │   ├── main-script.sh              # Main executable (user selects this on import)
  │   ├── config.json                 # Metadata (optional but recommended)
  │   ├── README.md                   # Explanation/documentation
  │   └── icon.png                    # Display icon (optional, PNG/JPG)
```

### Complete Example
```
/scripts/
  ├── backup-database/
  │   ├── backup.sh                   # Main script (bash executable)
  │   ├── config.json                 # Metadata configuration
  │   ├── README.md                   # Full explanation and usage
  │   ├── icon.png                    # Display icon (64x64 or 128x128)
  │   ├── helper-restore.sh           # Sub-script (accessible to main)
  │   ├── helper-validate.sh          # Sub-script
  │   └── templates/                  # Data folder (optional)
  │       ├── backup-schema.sql
  │       └── restore-guide.txt
  │
  ├── deploy-app/
  │   ├── deploy.py                   # Python script
  │   ├── config.json
  │   ├── README.md
  │   ├── icon.png
  │   ├── requirements.txt            # Python dependencies
  │   └── config/
  │       ├── prod-env.conf
  │       ├── staging-env.conf
  │       └── deploy-checklist.md
```

## Validation Rules

### Flexible Validation
The system uses **flexible validation** - folders don't require strict structure:

**Minimum Requirements:**
- [ ] Folder exists in `/scripts` directory
- [ ] Folder contains at least ONE executable file (.sh, .py, .js, .rb, etc.)
- [ ] User selects which file is the "main script"

**Optional Metadata (Can be Missing):**
- ❌ `config.json` - optional, will be created if missing
- ❌ `README.md` - optional, defaults to folder name if missing
- ❌ `icon.png` - optional, defaults to generic script icon

### What Qualifies as an Executable
- `.sh` - Bash/Shell scripts
- `.py`, `.py3` - Python scripts
- `.js`, `.mjs` - Node.js scripts
- `.rb` - Ruby scripts
- `.pl` - Perl scripts
- Any file with unix executable permission (`chmod +x`)
- On Windows: `.bat`, `.cmd`, `.exe`, `.ps1`, etc.

### Invalid Folders
The following folders will be **skipped/ignored**:
- Empty directories
- Directories with no executable files
- `node_modules`, `.git`, `.venv`, `__pycache__` (standard ignore patterns)
- Directories starting with `.` (hidden folders)
- System folders: `Trash`, `Applications`, `Library`, etc.

## Metadata Configuration (config.json)

### Structure
```json
{
  "name": "Backup Database",
  "description": "Backs up the production database to cloud storage",
  "version": "2.1.0",
  "author": "DevOps Team",
  "mainScript": "backup.sh",
  "tags": ["backup", "database", "automation"],
  "parameters": [
    {
      "name": "DATABASE",
      "description": "Database name to backup",
      "required": true,
      "default": "prod_db"
    },
    {
      "name": "RETENTION_DAYS",
      "description": "How many days to keep backups",
      "required": false,
      "default": "30"
    }
  ],
  "dependencies": [
    "backup-validate.sh",
    "helper-restore.sh"
  ],
  "timeout": 3600,
  "successExitCode": 0
}
```

### Field Specifications

| Field | Type | Required | Purpose |
|---|---|---|---|
| `name` | string | Optional | Display name (defaults to folder name) |
| `description` | string | Optional | Short description (defaults to 1st line of README) |
| `version` | string | Optional | Script version (e.g., "1.0.0") |
| `author` | string | Optional | Creator or maintainer name |
| `mainScript` | string | Recommended | Main executable file name (must match user selection) |
| `tags` | array[string] | Optional | Categories: ["backup", "deployment", "monitoring"] |
| `parameters` | array[object] | Optional | Input parameters with descriptions |
| `dependencies` | array[string] | Optional | List of sub-scripts this uses |
| `timeout` | number | Optional | Max execution time (seconds) |
| `successExitCode` | number | Optional | Expected exit code on success (default: 0) |

### Parameter Object
```json
{
  "name": "DATABASE_URL",
  "description": "Full connection string",
  "type": "string",
  "required": true,
  "default": "localhost:5432",
  "example": "prod.db.company.com:5432/maindb"
}
```

## README.md Format

### Recommended Structure
```markdown
# Script Name

## Description
Clear explanation of what the script does.

## Usage
```bash
./backup.sh DATABASE RETENTION_DAYS
```

## Parameters
- **DATABASE**: Database name (required)
- **RETENTION_DAYS**: Keep backups (default: 30)

## Sub-scripts
This script uses:
- `helper-restore.sh` - Restore from backup
- `helper-validate.sh` - Validate backup integrity

## Examples
```bash
# Backup production database
./backup.sh prod_db 30

# Backup with custom retention
./backup.sh staging_db 7
```

## Requirements
- PostgreSQL client tools installed
- AWS CLI configured
- Minimum 100GB free disk space

## Output
Creates backup file: `backups/db_YYYY-MM-DD_HH-MM-SS.tar.gz`

## Exit Codes
- 0: Success
- 1: Database connection failed
- 2: Backup file creation failed
- 3: Cloud upload failed

## Support
Contact: devops@company.com
```

### Extraction Rules
First line of README → Used as description if `config.json` missing
```markdown
# Backup Database Production
```
↓ Extracted as: `"Backup Database Production"`

## Import / Add Script Process

### Step-by-Step (User Flow)

#### 1. Home Tab Shows Import UI
```
┌────────────────────────────────────┐
│ 📂 Add Scripts                     │
├────────────────────────────────────┤
│ Drag script folders here            │
│ or                                 │
│ [📂 Open Finder]                   │
└────────────────────────────────────┘
```

#### 2. User Opens Finder / Drag & Drops
- **Option A:** Click `[📂 Open Finder]` button
  - Opens system file picker
  - User navigates to folder
  - User selects folder
  
- **Option B:** Drag folder into drop zone
  - Visually indicate drop zone is active
  - Accept folder on drop
  - Same validation as Option A

#### 3. Folder Validation
```
Validation Flow:
  ↓
Is it a folder?
  ├─ NO → Error: "Please select a folder"
  ↓ YES
Has executable files?
  ├─ NO → Error: "No scripts found in folder"
  ↓ YES
Show selection dialog:
  "Which file is the main script?"
  [backup.sh] [helper.sh] [validate.sh]
```

#### 4. User Selects Main Script
- Dialog shows all executables found
- User clicks on one (required)
- App validates choice
- Proceeds to metadata discovery

#### 5. Metadata Discovery
```
Look for metadata in this order:
  1. Check /scripts/script-name/config.json
  2. Check /scripts/script-name/README.md
  3. Check /scripts/script-name/icon.png (optional)
  4. Auto-generate defaults if missing
```

#### 6. Validation & Import
```
Validation Checklist:
  ✓ Folder structure valid
  ✓ Main script executable
  ✓ Metadata readable (if exists)
  ✓ No name conflicts
  ✓ Icon valid format (if exists)
  
If all pass: Import successful
If any fail: Show specific error
```

#### 7. Display in Home Tab
```
New script appears as card:
┌─────────────────────┐
│ Backup Database     │
│ Version: 2.1.0      │
│                     │
│ Backs up the prod.. │
│ Tags: backup, db    │
│                     │
│ [►  Run Script]     │
└─────────────────────┘
```

## IPC Events for Import System

### Main Process → Renderer
| Event | Data | Purpose |
|---|---|---|
| `scripts-scanned` | {foundFolders, invalidFolders} | Initial scan results |
| `folder-selected` | {path, executableFiles} | User selected folder |
| `validation-error` | {error, suggestions} | Import validation failed |
| `script-imported` | {scriptId, metadata} | Successfully imported |

### Renderer → Main
| Event | Data | Purpose |
|---|---|---|
| `get-scripts` | - | Load all scripts |
| `open-folder-picker` | {allowMultiple: false} | Show file picker |
| `drop-folder` | {path} | Validate dropped folder |
| `select-main-script` | {folderPath, selectedFile} | User chose main script |
| `import-script` | {folderPath, mainScript} | Start import process |
| `remove-script` | {scriptId} | Delete script folder |

## Script Discovery on Startup

### Scanning Process
1. **Scan `/scripts` Directory**
   - Find all folders (not files)
   - Skip hidden/system directories
   - Ignore standard package manager folders

2. **Validate Each Folder**
   - Check for executable files
   - Count valid scripts found
   - Mark invalid folders

3. **Load Metadata**
   - Read `config.json` if exists
   - Extract from `README.md` if exists
   - Load icon if exists

4. **Display in Home Tab**
   - Show valid scripts
   - Group by tags (optional, Phase 2)
   - Cache metadata for fast loading

### Example Scan Output
```json
{
  "validScripts": [
    {
      "id": "backup-database",
      "path": "/scripts/backup-database",
      "mainScript": "backup.sh",
      "name": "Backup Database",
      "description": "Backs up production database...",
      "version": "2.1.0",
      "tags": ["backup", "database"],
      "icon": "icon.png"
    }
  ],
  "invalidFolders": [
    {
      "path": "/scripts/node_modules",
      "reason": "Package manager folder (ignored)"
    },
    {
      "path": "/scripts/broken-script",
      "reason": "No executable files found"
    }
  ]
}
```

## File System Structure on Disk

### Example `/scripts` Directory After Setup
```
/scripts/
├── backup-database/              ← Script 1 folder
│   ├── backup.sh                 ← Main script
│   ├── config.json               ← Metadata
│   ├── README.md                 ← Explanation
│   ├── icon.png                  ← Display icon
│   ├── helper-restore.sh         ← Sub-script
│   └── templates/                ← Supporting files
│
├── deploy-production/            ← Script 2 folder
│   ├── deploy.py
│   ├── config.json
│   ├── README.md
│   └── icon.png
│
└── health-check-api/             ← Script 3 folder
    ├── check.sh
    ├── config.json
    └── helpers/
        ├── notify.sh
        └── log.sh
```

## Backward Compatibility

### Old System vs New System

**Old System (Deprecated):**
```
/scripts/
  backup.sh
  deploy.py
  cleanup.sh
```

**New System (Required):**
```
/scripts/
  backup/
    backup.sh
  deploy/
    deploy.py
  cleanup/
    cleanup.sh
```

**Migration Path:**
- Clean break - old loose scripts are **ignored**
- Users must manually organize scripts into folders
- Provide migration guide in documentation

## Error Handling & Messages

### Validation Errors

| Condition | Error Message | Solution |
|---|---|---|
| Empty folder | "Folder contains no script files" | Add executable file |
| Invalid icon | "Icon must be PNG/JPG < 1MB" | Replace with valid image |
| Duplicate name | "Script 'foo' already exists" | Rename folder |
| Missing main script | "Main script not found: backup.sh" | Update config.json |
| Invalid JSON | "config.json is malformed" | Fix JSON syntax |
| Path issues | "Cannot access folder permissions" | Check folder permissions |

## Naming Conventions

### Folder Names
- **Valid:** `backup-database`, `deploy_app`, `health-check`
- **Invalid:** `Backup Database`, `deploy app`, `health@check`
- **Rule:** Lowercase, hyphens/underscores only, no spaces
- **Auto-converted:** `Backup Database` → `backup-database`

### Icons
- **Preferred:** `icon.png` (transparent background)
- **Accepted:** `icon.jpg`, `icon.jpeg`, `icon.svg`
- **Sizes:** 64x64, 128x128, or 256x256 (app scales)

### Readme
- **Preferred:** `README.md`
- **Accepted:** `readme.md`, `EXPLANATION.md`, `HELP.md`
- **Format:** Markdown (HTML rendering supported)

## Implementation Checklist

### Main Process (`app/main.js`)
- [ ] Add `scriptFolderScanner()` function
- [ ] Implement folder validation logic
- [ ] Create metadata loader (JSON, README, icon)
- [ ] Add file picker handler
- [ ] Implement drag-drop folder handler
- [ ] Create script import function
- [ ] Add metadata caching layer

### Renderer (`renderer/pages/home-tab.js`)
- [ ] Create import drop zone UI
- [ ] Add "Open Finder" button
- [ ] Show visual feedback on drag-over
- [ ] Display validation messages
- [ ] Show script selection dialog
- [ ] Render script cards with metadata

### UI Components
- [ ] Import drop zone (with drag-over state)
- [ ] Executable file selector dialog
- [ ] Error message display
- [ ] Script card with icon + metadata

### Utilities
- [ ] Folder validator
- [ ] Metadata parser
- [ ] Icon loader (base64 encoding)
- [ ] Path sanitizer

---

**Document Version:** 1.0
**Created:** March 13, 2026
**Related:** ARCHITECTURE.md, FEATURES.md, COMPONENT_SPECS.md
