# AutomataHub Publish Readiness To-Do List

**Last Audit:** March 15, 2026  
**Project Version:** 1.0.0  
**Target:** npm + electron release  

---

## CRITICAL ISSUES (Must fix before publishing)

### [CRITICAL-1] Remove legacy `execution-tab.js` from hub renderer

**File:** `renderer/pages/execution-tab.js`

**Problem:** This entire file is pre-extraction legacy code left over from before the Script Runner module was extracted. It contains:
- Calls to `window.api.runScript()`, `window.api.stopScript()`, `window.api.saveLogs()`, `window.api.clearTerminal()` which **do not exist** in the preload bridge
- Listeners on **un-namespaced channels** (`script-output`, `script-error`, `script-complete`, `queue-status`, `log-saved`) instead of module-namespaced versions (`script-runner:*`)
- Export of `window.executionTab = ExecutionTab` as a global, from the pre-module era
- Duplicate functionality with the Script Runner module's correct version at `node_modules/automatahub-script-runner/renderer/execution-tab.js`

**Action Items:**
- [ ] Verify that the Script Runner module's `execution-tab.js` is the correct, current implementation
- [ ] Remove the line loading `execution-tab.js` from `renderer/index.html`
- [ ] Delete `renderer/pages/execution-tab.js` entirely
- [ ] Test the app runs without errors after deletion
- [ ] Verify Script Runner tab renders correctly when opened
- [ ] Verify all IPC channels use the module-namespaced format (`script-runner:*`)

**Acceptance Criteria:**
- No references to `window.executionTab` anywhere in codebase
- No calls to `window.api.runScript()` without module namespace
- App loads and script runner module functions correctly
- No console errors about missing API methods

---

### [CRITICAL-2] Remove `script-executor.js` from hub core

**File:** `app/script-executor.js`

**Problem:** The 246-line script execution engine is a module's concern, not the hub's. It should only exist in the Script Runner module. Yet it sits in `app/` where it gets shipped as core hub code. The hub itself never directly uses it — only the Script Runner module's `main-handlers.js` requires it.

**Action Items:**
- [ ] Verify that `node_modules/automatahub-script-runner/` contains its own copy of the script execution logic
- [ ] Check if `app/script-executor.js` is referenced anywhere in `app/main.js`, `app/core/*`, or other hub files
- [ ] Confirm the Script Runner module's `main-handlers.js` has all necessary script execution code
- [ ] Delete `app/script-executor.js`
- [ ] Run the app and verify Script Runner still works
- [ ] Check for any require/import statements broken by deletion

**Acceptance Criteria:**
- No `app/script-executor.js` file exists
- Search confirms no references to it elsewhere in hub
- Script Runner executes scripts correctly
- No require() errors in console

---

### [CRITICAL-3] Fix `automatahub-script-runner` dependency path

**File:** `package.json` line 39

**Problem:** The dependency uses `"file:../script_runner"` which is a **local filesystem path**. This works only on the developer's machine and will break when the package is cloned/installed elsewhere.

**Current:**
```json
"dependencies": {
  "automatahub-script-runner": "file:../script_runner"
}
```

**Options:**
1. **Remove from dependencies** — The module should be discovered via `modules/` directory (local development) or installed independently
2. **Publish to npm** — Publish `automatahub-script-runner` as a real npm package and reference by version
3. **Copy into modules/** — Include the module source directly in `modules/script-runner/` instead of external dependency

**Action Items:**
- [ ] Decide on distribution strategy for the Script Runner module (option 1, 2, or 3)
- [ ] **If option 1 (remove):**
  - [ ] Delete the `"automatahub-script-runner"` from `dependencies`
  - [ ] Verify the module at `node_modules/automatahub-script-runner/` is removed after `npm install`
  - [ ] Confirm the hub dynamically discovers the module from `modules/` directory
  - [ ] Update README to document that module source should be in `modules/` or symlinked
- [ ] **If option 2 (npm publish):**
  - [ ] Publish `automatahub-script-runner` to npm registry
  - [ ] Update dependency to `"automatahub-script-runner": "^1.0.0"`
  - [ ] Update `package-lock.json` accordingly
  - [ ] Document the npm package in README
- [ ] **If option 3 (include in modules/):**
  - [ ] Copy `../script_runner` contents to `modules/script-runner/`
  - [ ] Remove the file dependency from `package.json`
  - [ ] Verify module discovery works from `modules/`
  - [ ] Delete the external directory after confirming it works
- [ ] Update `package-lock.json` to reflect the new dependency structure
- [ ] Update documentation (README, ARCHITECTURE, MODULE_GUIDE) accordingly

**Acceptance Criteria:**
- No `file:../` paths in `package.json`
- Project can be cloned to any directory and dependencies resolve correctly
- `npm install` succeeds without local path errors
- Module discovery still works

---

## HIGH PRIORITY ISSUES (Strongly recommended before publishing)

### [HIGH-1] Delete duplicate CSS file

**Files Involved:** `renderer/core.css` and `renderer/styles.css`

**Problem:** Both files are 100% identical (663 lines each, confirmed by diff). Only `renderer/core.css` is loaded by `index.html`. The `styles.css` is dead weight and creates confusion.

**Action Items:**
- [ ] Confirm `renderer/core.css` is the one loaded in `renderer/index.html`
- [ ] Verify no other files reference `renderer/styles.css`
- [ ] Delete `renderer/styles.css`
- [ ] Run the app and verify no CSS/styling issues
- [ ] Search codebase for any remaining references to `styles.css`

**Acceptance Criteria:**
- Only one CSS file exists in `renderer/`
- App styling appears identical to before removal
- No references to the deleted file in code or docs

---

### [HIGH-2] Remove committed test log file with old branding

**File:** `logs/hello_world_2026-03-13_21-28-50.txt`

**Problem:** This committed log file contains:
- Old branding: "Hello from Script Runner!" (pre-rebranding text)
- Absolute local filesystem path (leaks username)
- Test output that shouldn't ship in a published product

The `.gitignore` has `logs/*.txt` but this file was committed before that rule was added.

**Action Items:**
- [ ] Delete `logs/hello_world_2026-03-13_21-28-50.txt`
- [ ] Verify `.gitignore` includes `logs/*.txt` or `logs/**`
- [ ] Remove the file from git history:
  ```bash
  git rm --cached logs/hello_world_2026-03-13_21-28-50.txt
  git commit -m "Remove committed test log with old branding and local paths"
  ```
- [ ] Ensure `logs/.gitkeep` exists to keep the directory in git

**Acceptance Criteria:**
- Log file no longer exists
- `.gitignore` prevents future log file commits
- Directory tracking is preserved with `.gitkeep`

---

### [HIGH-3] Add missing CSS variable `--tab-bar-height`

**Files:** `renderer/core.css` (line 291)

**Problem:** Both CSS files reference `var(--tab-bar-height)` at line 291 in a `calc()` expression, but this variable is never defined in the `:root` CSS variables section. This will cause the value to be invalid and fall back to other values.

**Current code (line 291):**
```css
min-height: calc(100vh - var(--tab-bar-height) - 2 * var(--space-xl));
```

**Action Items:**
- [ ] Calculate the tab bar height (approximately 45-50px based on tab padding and font size)
- [ ] Add to the `:root` variable definition in `renderer/core.css`:
  ```css
  --tab-bar-height: 50px;
  --hub-tab-bar-height: var(--tab-bar-height);
  ```
- [ ] Apply the same change to `renderer/styles.css` (if it still exists after HIGH-1)
- [ ] Test home tab rendering to ensure layout is correct
- [ ] Verify the home content doesn't overflow incorrectly

**Acceptance Criteria:**
- CSS variable is defined in `:root`
- No console warnings about invalid CSS values
- Home tab layout appears correct with proper spacing

---

### [HIGH-4] Remove `SMART_DESKTOP_DB` reference from C# example

**Files:** 
- `scripts/hello-csharp/main.csx` (lines checking `SMART_DESKTOP_DB`)
- `scripts/hello-csharp/README.md` (references to the same)

**Problem:** The C# sample script checks for a `SMART_DESKTOP_DB` environment variable, which appears to be from a **completely different project**. This is confusing in AutomataHub examples.

**Action Items:**
- [ ] Replace the SMART_DESKTOP_DB logic with something project-relevant, OR
- [ ] Replace with generic environment variable examples, OR
- [ ] Simplify the C# script to focus on demonstrating basic script runners without environment variable checks
- [ ] Update `hello-csharp/README.md` to match the changes
- [ ] Consider adding a simple example showing AutomataHub root directory or similar

**Suggested replacement:** Show information about the AutomataHub runtime environment instead

**Acceptance Criteria:**
- No `SMART_DESKTOP_DB` references remain in example scripts
- Example is relevant to AutomataHub usage
- README description matches the actual script behavior

---

### [HIGH-5] Fix `innerHTML` security concerns in home tab

**File:** `renderer/pages/home-tab.js`

**Occurrences:**
- Line 135: `.innerHTML = [...]` with `<strong>`, `<br>`, `<code>` tags
- Line 249: `.innerHTML = '<span>...'` for GitHub prompt
- Line 283: `.innerHTML = cmdSpan.textContent + ynHtml`

**Problem:** Inline `.innerHTML` assignments conflict with the stated CSP policy (`script-src 'self'`) and the project's security guidelines which advocate for "no `eval()`" and safe DOM construction. While the content is static (not user input), the approach is inconsistent with the rest of the codebase which uses `createElement` and `textContent`.

**Action Items:**
- [ ] For line 135 (tooltip HTML): Convert to DOM construction
  - [ ] Create `<div>` element for tooltip
  - [ ] Create nested elements for strong, br, code
  - [ ] Use `.textContent` for text content instead of innerHTML
- [ ] For line 249 (GitHub prompt line): Convert to DOM construction
  - [ ] Create span elements as separate elements
  - [ ] Use `.appendChild()` instead of `.innerHTML`
- [ ] For line 283 (cursor animation): Convert safely
  - [ ] Create HTML elements programmatically
  - [ ] Append instead of innerHTML
- [ ] Verify tooltip functionality still works
- [ ] Verify GitHub prompt animation still works
- [ ] Run CSP-aware security audit to confirm compliance

**Acceptance Criteria:**
- No `.innerHTML` assignments with HTML strings in `home-tab.js`
- All DOM construction uses `createElement` and `appendChild`
- Tooltip tooltip and GitHub prompt appear and function identically
- No CSP policy violations

---

## MEDIUM PRIORITY ISSUES (Important for polish)

### [MEDIUM-1] Update `package.json` metadata

**File:** `package.json`

**Issues:**
- `"author": ""` — empty string should be filled
- `"keywords": []` — empty, should include relevant terms
- `"description"` — outdated, still says "Desktop app for managing and running local scripts" (pre-module era)
- No `"repository"` field
- No `"homepage"` field
- No `"engines"` field (docs require Node 18+)
- `"lint"` script is a placeholder: `"echo \"No lint configured yet\""`

**Action Items:**
- [ ] Set `"author"` to your name or organization
  - e.g., `"author": "Your Name <your.email@example.com>"`
- [ ] Add relevant `"keywords"`:
  ```json
  "keywords": [
    "electron",
    "automation",
    "script-runner",
    "modular",
    "darwin"
  ]
  ```
- [ ] Update `"description"` to reflect hub + plugin architecture:
  ```
  "Modular Electron desktop hub for automation tools with plugin system"
  ```
- [ ] Add `"repository"` field:
  ```json
  "repository": {
    "type": "git",
    "url": "https://github.com/your-org/automata-hub.git"
  }
  ```
- [ ] Add `"homepage"` field:
  ```json
  "homepage": "https://github.com/your-org/automata-hub#readme"
  ```
- [ ] Add `"engines"` field:
  ```json
  "engines": {
    "node": ">=18.0.0"
  }
  ```
- [ ] Decide on lint configuration:
  - [ ] Set up ESLint + Prettier, OR
  - [ ] Set up dedicated linter, OR
  - [ ] Remove lint script if not needed
- [ ] Update `package.json` if version should be incremented from 1.0.0

**Acceptance Criteria:**
- All metadata fields are properly filled
- Description accurately reflects the project
- Author/license information is present
- Engines specify Node 18+ requirement

---

### [MEDIUM-2] Exclude/remove docs archive and examples from distribution

**Files Affected:** `package.json` build config

**Problem:** The `build.files` array includes wildcard patterns that will bundle:
- `docs/archive/` — 8 outdated pre-module architecture documents
- `scripts/` — sample scripts (hello-world, hello-csharp)
- Archived documentation

**Current build config:**
```json
"files": [
  "app/**",
  "renderer/**",
  "resources/**",
  "scripts/**",
  "logs/.gitkeep"
]
```

**Action Items:**
- [ ] Decide on strategy for each included directory:
  - **`scripts/`**: Keep examples embedded? Acceptable for demoing platform, but bloats .dmg
  - **`docs/archive/`**: Should not be shipped (it's not included in files now but worth noting)
  - **`logs/`**: Only `.gitkeep` is intentional; ensure no `.txt` files make it into build
- [ ] **Option A (Keep scripts as examples):**
  - [ ] Keep `"scripts/**"` in files
  - [ ] Ensure log files are truly excluded
  - [ ] Document that example scripts are included in `README.md`
  - [ ] Keep scripts as simple, non-proprietary examples
- [ ] **Option B (Remove scripts from distribution):**
  - [ ] Remove `"scripts/**"` from files
  - [ ] Ensure users can still add their own scripts
  - [ ] Keep scripts in repo but tag `.gitignore` appropriately for publishing
- [ ] Ensure `.gitignore` prevents log files from being included in builds
- [ ] Ensure archived docs are in `.gitignore` or explicitly excluded

**Acceptance Criteria:**
- Decision made on scripts inclusion
- Build artifacts don't include old log files
- `.dmg` file is reasonably sized
- Sample script quality is high if included

---

### [MEDIUM-3] Fix MODULE_GUIDE.md broken/placeholder references

**File:** `modules/MODULE_GUIDE.md` line 669

**Problem:** Reference to script-runner module has a placeholder GitHub URL:
```
Source: [`script_runner/`](https://github.com/)
```

**Action Items:**
- [ ] Update the Link to actual script-runner repository:
  - [ ] If keeping as separate GitHub repo: `https://github.com/your-org/automatahub-script-runner`
  - [ ] If it's in same org/repo: point to `scripts/` or module docs
  - [ ] If npm-published: link to npm package page
- [ ] Update any other broken documentation links
- [ ] Update directory references from `script_runner/` to current naming (if paths changed)
- [ ] Search MODULE_GUIDE for other broken links

**Acceptance Criteria:**
- No placeholder URLs (`https://github.com/`)
- All documentation links are correct
- References to modules/scripts are accurate

---

### [MEDIUM-4] Reconcile version numbers

**Files:**
- `package.json` — version 1.0.0
- `DOCUMENTATION.md` — version 2.0.0

**Problem:** Version mismatch between npm package version and documentation version.

**Action Items:**
- [ ] Decide on single source of truth:
  - **Option A:** Update `DOCUMENTATION.md` to match `package.json`:
    - [ ] Change `Version 2.0.0` to `Version 1.0.0` in DOCUMENTATION.md
  - **Option B:** Update both to appropriate version for first publish (likely 1.0.0 for npm)
- [ ] Ensure version is consistent across:
  - [ ] `package.json`
  - [ ] `DOCUMENTATION.md`
  - [ ] `README.md` (if version reported there)
  - [ ] Git tags (once published)
- [ ] Document version update in `TODO.md` or commit message

**Acceptance Criteria:**
- Single consistent version across all files
- Version makes sense for release (1.0.0 is appropriate for first public release)

---

## LOW PRIORITY ISSUES (Nice-to-have improvements)

### [LOW-1] Improve npm scripts

**File:** `package.json` scripts section

**Current:**
```json
"scripts": {
  "start": "electron .",
  "dev": "electron .",
  "lint": "echo \"No lint configured yet\"",
  "build": "electron-builder"
}
```

**Action Items:**
- [ ] Make `dev` different from `start` (open DevTools, log to console, etc.):
  ```bash
  "dev": "ELECTRON_ENV=development electron . --enable-logging"
  ```
- [ ] Consider adding `watch` script if implementing hot reload
- [ ] If implementing linting, update lint script appropriately
- [ ] Consider adding `precommit` hook via husky (optional)

**Acceptance Criteria:**
- `npm start` runs clean production
- `npm run dev` has helpful debugging features
- Scripts match their documented purposes

---

### [LOW-2] Expand build targets beyond macOS

**File:** `package.json` build configuration

**Current state:** Only macOS target configured

**Note:** Documentation acknowledges macOS as primary target, so this is intentional. But before broader publishing, consider:

**Action Items (Optional):**
- [ ] If supporting Windows:
  - [ ] Add `"win"` target to build config
  - [ ] Update icon format for Windows
  - [ ] Test on Windows
- [ ] If supporting Linux:
  - [ ] Add `"linux"` target to build config
  - [ ] Ensure path handling is cross-platform
  - [ ] Test on Linux
- [ ] If staying macOS-only:
  - [ ] Clearly document in README and package description
  - [ ] Consider adding `"os": ["darwin"]` to package.json
  - [ ] Set `"category"` in build to reflect macOS-only

**Acceptance Criteria:**
- Clear documentation on supported platforms
- Build config matches supported platforms
- No breaking cross-platform issues

---

### [LOW-3] Add test framework and initial tests

**File:** Package (no dedicated test file yet)

**Current:** No tests configured

**Action Items (Optional):**
- [ ] Choose test framework (recommend Jest for Electron):
  - [ ] Install Jest: `npm install --save-dev jest`
  - [ ] Configure jest config in `package.json`
- [ ] Create test directory structure:
  - [ ] `tests/unit/` for unit tests
  - [ ] `tests/integration/` for integration tests
- [ ] Write basic tests for:
  - [ ] IPC handlers don't error on valid/invalid input
  - [ ] Module loading works
  - [ ] Tab manager creates/removes tabs correctly
- [ ] Add test script to package.json: `"test": "jest"`
- [ ] Reference test examples in SECURITY.md

**Acceptance Criteria:**
- Tests can run with `npm test`
- Core IPC and module loading tested
- Test coverage reported

---

## FUTURE FEATURES (v1.1.0+ - Post-Publishing Enhancements)

These features enable better module discovery and installation workflows. Defer implementation until after v1.0.0 publish.

### [FUTURE-1] Runtime Module Loading (Hot-Reload Without Restart)

**Goal:** Enable modules to load and unload without requiring app restart

**Problem Solved:** Currently, users must restart the app after adding a module to `modules/` folder

**Implementation:**
- [ ] Add filesystem watcher to `app/main.js` monitoring `modules/` directory
- [ ] Create `reloadModules()` function that:
  - [ ] Calls `teardown()` on all currently loaded modules
  - [ ] Clears the module registry
  - [ ] Removes all IPC handlers via `ipcBridge.removeAll()`
  - [ ] Re-discovers modules from disk via `discoverModules()`
  - [ ] Calls `setup()` on newly discovered modules
- [ ] Create IPC handler `hub:reload-modules` that triggers the above
- [ ] Send `modules-reloaded` event to renderer with updated module list
- [ ] Add renderer-side listener in `module-bootstrap.js`:
  ```javascript
  window.api.on('modules-reloaded', (modules) => {
    window._hub.modules = modules;
    // Notify all loaded tabs that module list changed
    // Optionally refresh home tab to show new modules
  });
  ```
- [ ] Test adding/removing module folders and verify automatic reload
- [ ] Test that old module state is cleaned up properly
- [ ] Test that new modules' IPC channels are properly registered

**Acceptance Criteria:**
- Placing new folder with manifest.json in `modules/` causes it to load within seconds
- Removing module folder removes it from available modules
- No app restart required
- No console errors about duplicate handlers or stale references
- Previous module's state is completely cleaned up

**Effort:** 2-3 hours

---

### [FUTURE-2] Drag-and-Drop Module Installation UI

**Goal:** Allow users to drag module folders directly into the app window to install them

**Problem Solved:** Currently, users must manually copy module folders to `modules/` directory

**Implementation:**
- [ ] Add drag-over zone styling to home tab:
  ```css
  .home-tab.drag-over {
    background: rgba(0, 122, 204, 0.1);
    border: 2px dashed var(--accent);
  }
  ```
- [ ] Add drag event listeners to home tab wrapper:
  - [ ] `dragover` → add `.drag-over` class, set `e.dataTransfer.dropEffect = 'copy'`
  - [ ] `dragleave` → remove `.drag-over` class
  - [ ] `drop` → handle module installation
- [ ] Create IPC handler `hub:install-module-folder` that:
  - [ ] Validates dropped folder contains `manifest.json`
  - [ ] Validates manifest has required fields (`id`, `name`)
  - [ ] Copies/symlinks folder to `modules/{moduleId}/`
  - [ ] Triggers `reloadModules()` (from FUTURE-1)
  - [ ] Returns success/error message
- [ ] In drop handler, show loading spinner while installing
- [ ] Show success notification with module name
- [ ] Show error notification with validation details if invalid
- [ ] Test dragging various folder types:
  - [ ] Valid module folder → should install
  - [ ] Folder without manifest.json → should show error
  - [ ] Folder with invalid manifest → should show error
  - [ ] Module with duplicate ID → should show error or allow overwrite

**Acceptance Criteria:**
- Dragging a valid module folder into home tab installs it
- Module appears immediately in home tab after installation
- Invalid folders show appropriate error messages
- No app crash or console errors
- Drag-over visual feedback is clear

**Effort:** 2-3 hours

---

### [FUTURE-3] "Install Module" Button and Folder Browser

**Goal:** Provide an alternative to drag-drop for users who prefer file picker dialog

**Problem Solved:** Some users prefer button-based workflow instead of drag-drop

**Implementation:**
- [ ] Add "Install Module" button to home tab header (near info icon)
- [ ] On button click, invoke `hub:open-module-browser` IPC handler
- [ ] Create main process handler that:
  - [ ] Opens `dialog.showOpenDialog()` with `properties: ['openDirectory']`
  - [ ] Returns selected folder path
- [ ] Pass selected folder to `hub:install-module-folder` (from FUTURE-2)
- [ ] Show loading state while installing
- [ ] Display success/error notifications
- [ ] Test on macOS and Windows (if supporting Windows)
- [ ] Verify dialog opens to sensible default directory

**Acceptance Criteria:**
- Button is visible and clickable in home header
- Clicking opens native folder browser dialog
- Selected folder is installed correctly
- Works on all supported platforms

**Effort:** 1 hour

---

### [FUTURE-4] Module Store / Download UI (Optional)

**Goal:** Enable users to browse and download modules from a central registry

**Problem Solved:** Discovery of available modules is currently manual

**Notes:**
- Consider whether to implement module registry/marketplace
- This is a larger feature requiring backend infrastructure
- Defer to much later version (v2.0.0+) if desired
- For v1.0.0, document manual installation in README instead

**If implementing:**
- [ ] Publish `automatahub-script-runner` and other modules to npm
- [ ] Create simple registry/index (could be JSON file in GitHub or npm search)
- [ ] Add "Browse Modules" button to home tab
- [ ] Show list of available modules with install buttons
- [ ] Handle npm package downloads and installation

**Effort:** 4-6 hours (requires external infrastructure)

---

### [FUTURE-5] Module Dependency Management

**Goal:** Allow modules to declare dependencies on other modules or npm packages

**Problem Solved:** Currently, each module must be self-contained; no way to reuse code

**Implementation:**
- [ ] Extend manifest.json schema:
  ```json
  {
    "id": "my-module",
    "dependencies": {
      "other-module": ">=1.0.0",  // another AutomataHub module
      "some-package": "^1.2.3"    // npm package
    }
  }
  ```
- [ ] Modify module loader to validate dependency graph
- [ ] Auto-install npm dependencies for each module
- [ ] Verify dependency versions match
- [ ] Handle circular dependency detection
- [ ] Provide clear error messages for missing dependencies

**Effort:** 3-4 hours

---

## Recommended Rollout for v1.1.0 (Post-Publish)

**Phase 1 (v1.1.0) — Core Runtime Loading:**
1. [FUTURE-1] Runtime module loading (hot-reload)
2. Update README with "Add modules to `modules/` folder and they load automatically"
3. Test thoroughly with various module scenarios

**Phase 2 (v1.2.0) — User-Friendly Installation:**
4. [FUTURE-2] Drag-and-drop UI
5. [FUTURE-3] File browser button
6. Improve UX with notifications and visual feedback

**Phase 3+ (v2.0.0) — Ecosystem:**
7. [FUTURE-4] Module store (if desired)
8. [FUTURE-5] Dependency management
9. Publish modules to npm registry

---

## Feature Implementation Checklist (When Ready)

- [ ] FUTURE-1: Runtime module loading
  - [ ] Filesystem watcher added
  - [ ] Reload logic implemented and tested
  - [ ] IPC handler created
  - [ ] Renderer listener added
  - [ ] Tested with add/remove scenarios
  
- [ ] FUTURE-2: Drag-and-drop UI
  - [ ] CSS styling added
  - [ ] Drop handler implemented
  - [ ] Module validation works
  - [ ] Error handling clear
  - [ ] Tested on all platforms
  
- [ ] FUTURE-3: Install button
  - [ ] Button added to UI
  - [ ] File browser opens correctly
  - [ ] Integration with FUTURE-2 works
  - [ ] Platform compatibility verified

---

## DOCUMENTATION & GIT READINESS

### [DOC-1] Update README.md for modular architecture

**File:** `README.md`

**Action Items:**
- [ ] Ensure README clearly describes:
  - [ ] Hub core vs. plugin modules
  - [ ] How to add new modules
  - [ ] Link to MODULE_GUIDE.md
  - [ ] Script storage location (`modules/script-runner` or user-installed)
- [ ] Update any references to old "Script Runner" branding
- [ ] Ensure installation instructions work for the new dependency model (after fixing CRITICAL-3)
- [ ] Add section for contributors with security policy reference

**Acceptance Criteria:**
- README accurately describes current architecture
- Installation instructions work
- Clear guidance on module development

---

### [DOC-2] Commit all staged changes

**Situation:** Git status shows significant uncommitted work:
- New directories: `app/core/`, `docs/archive/`, `modules/`
- New files: `renderer/core.css`, `renderer/module-bootstrap.js`
- Modifications to existing files throughout

**Action Items (in order):**
- [ ] When all CRITICAL and HIGH issues are fixed, stage changes:
  ```bash
  git add -A
  ```
- [ ] Review staged changes:
  ```bash
  git diff --cached
  ```
- [ ] Create descriptive commit message, e.g.:
  ```
  feat: finalize modular architecture and prepare for publishing
  
  - Remove legacy pre-extraction code (execution-tab.js, script-executor.js)
  - Extract script-executor to module (CRITICAL-2)
  - Fix dependency resolution (CRITICAL-3)
  - Remove duplicate CSS files
  - Add missing CSS variables
  - Update documentation and metadata
  - Clean up archived/legacy files
  ```
- [ ] Commit:
  ```bash
  git commit -m "feat: finalize modular architecture and prepare for publishing"
  ```
- [ ] Create version tag:
  ```bash
  git tag -a v1.0.0 -m "Release version 1.0.0"
  ```

**Acceptance Criteria:**
- All work is committed
- Git history is clean (single comprehensive commit or logical series of commits)
- Version tag exists

---

### [DOC-3] Final security audit before publishing

**Action Items:**
- [ ] Run through SECURITY.md checklist:
  - [ ] All input validation in place
  - [ ] Safe process execution (no `shell: true`)
  - [ ] No secrets in code, logs, or docs
  - [ ] IPC hardened with context isolation
  - [ ] Path traversal protections active
- [ ] Check for any lingering console debuggers or `debugger` statements
- [ ] Verify CSP headers are correctly set
- [ ] Run dependency vulnerability scan:
  ```bash
  npm audit
  ```
- [ ] Fix any high/critical vulnerabilities

**Acceptance Criteria:**
- No security violations found
- All dependencies scanned and approved
- No debug statements in production code

---

## SUMMARY OF EFFORT

### For v1.0.0 (Publish Ready)

| Priority | Count | Complexity | Estimated Time |
|----------|-------|-----------|-----------------|
| CRITICAL | 3 | High | 2-3 hours |
| HIGH | 5 | Medium | 3-4 hours |
| MEDIUM | 4 | Low-Medium | 2-3 hours |
| LOW | 3 | Low | 1-2 hours |
| **TOTAL (v1.0.0)** | **15** | — | **8-12 hours** |

### For v1.1.0+ (Future Enhancements)

| Feature | Count | Complexity | Estimated Time | Notes |
|---------|-------|-----------|-----------------|-------|
| Runtime module loading | 1 | Medium | 2-3 hours | Enables hot-reload without restart |
| Drag-and-drop UI | 1 | Medium | 2-3 hours | User-friendly module installation |
| Install button + browser | 1 | Low | 1 hour | Alternative to drag-drop |
| Module store | 1 | High | 4-6 hours | Optional; requires infrastructure |
| Dependency management | 1 | High | 3-4 hours | For code reuse between modules |
| **TOTAL (v1.1.0+)** | **5** | — | **12-20 hours** | Implemented after v1.0.0 launch |

---

## PUBLISH CHECKLIST (When ready)

- [ ] All CRITICAL issues fixed
- [ ] All HIGH issues fixed
- [ ] MEDIUM issues addressed (can defer LOW)
- [ ] Final security audit passed
- [ ] All changes committed and tagged
- [ ] README updated for users
- [ ] NPM metadata complete
- [ ] Build artifacts tested (.dmg created, size reasonable)
- [ ] Test run on clean machine
- [ ] GitHub/npm repository set up
- [ ] Publish to npm: `npm publish`
- [ ] Create GitHub release with tag
- [ ] Update CHANGELOG (if maintaining one)
- [ ] Create roadmap document for v1.1.0 (future features)

---

## ROADMAP DOCUMENT (Create after v1.0.0 release)

After v1.0.0 ships, create a public ROADMAP.md file documenting:
- [ ] v1.1.0 goals: Runtime module loading + UI improvements
- [ ] v1.2.0 goals: Module ecosystem enhancements
- [ ] Community contribution guidelines
- [ ] Feature request process

---

**Status:** 📋 Ready for fixes  
**Owner:** [Your name]  
**Last Updated:** March 15, 2026  
**Next Phase:** Post-publish features documented in FUTURE FEATURES section
