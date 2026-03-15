# Development Plan & Roadmap

> **Frozen at MVP v1.0.0** — This document reflects the shipped implementation.

## Development Phases

### Phase 1: Project Setup ⚙️
**Duration:** 1-2 days | **Status:** Completed (Planning)

#### Tasks
- [x] Create project folder structure
- [x] Create documentation files
- [ ] Initialize Git repository
- [ ] Create `package.json` with dependencies
- [ ] Install Electron and dependencies
- [ ] Create `.gitignore` file
- [ ] Set up `.editorconfig` for code consistency

#### Deliverables
- Git repository ready
- Node dependencies installed
- Project structure in place

---

### Phase 2: Main Process Implementation 🔧
**Duration:** 3-5 days | **Status:** Not Started

#### Task 2.1: Electron Setup
- [ ] Create `app/main.js` with Electron app initialization
- [ ] Implement `createWindow()` function
- [ ] Set window properties (size, icon, etc.)
- [ ] Handle app `ready` event
- [ ] Handle window `closed` event
- [ ] Implement `app.quit()` on all windows closed

#### Task 2.2: IPC Setup
- [ ] Create `app/preload.js` with context bridge
- [ ] Expose `window.api` object to renderer
- [ ] Define safe IPC methods:
  - `getScripts()` → async
  - `runScript(path, name, tabId)` → async
  - `saveLogs(content, name, timestamp, tabId)` → async
  - `stopScript(tabId)` → async
  - `on(event, callback)` / `off(event, callback)` → listeners

#### Task 2.3: Script Discovery
- [ ] Implement `getScripts()` function
- [ ] Scan `/scripts` directory
- [ ] Discover script folders (not loose files)
- [ ] Filter folders with at least one executable file
- [ ] Extract metadata (name, description, version, tags, icon)
- [ ] Return script objects array
- [ ] Handle errors gracefully

#### Task 2.4: Script Execution
- [ ] Implement `runScript(path, name, tabId)` function
- [ ] Use `child_process.spawn()` to execute scripts
- [ ] Determine shell based on file extension
- [ ] Attach stdout/stderr listeners
- [ ] Stream output via IPC to renderer with `tabId`
- [ ] Handle process exit events
- [ ] Capture exit codes

#### Task 2.5: Execution Queue
- [ ] Create `app/script-executor.js`
- [ ] Enforce sequential execution (single running process)
- [ ] Queue additional run requests with tab context
- [ ] Emit `queue-status` updates to renderer
- [ ] Start next queued script automatically after completion

#### Task 2.6: Script Import (Folder-Based)
- [ ] Implement folder picker handler (`open-folder-picker`)
- [ ] Implement drop-folder validation handler (`drop-folder`)
- [ ] Detect executables and support main-script selection
- [ ] Parse optional metadata files (`config.json`, `README.md`, `icon.*`)
- [ ] Copy validated folder to `/scripts`
- [ ] Emit import success/error events

#### Task 2.7: Log Saving
- [ ] Implement `saveLogs()` function
- [ ] Create `/logs` directory if missing
- [ ] Generate filename with full timestamp (`YYYY-MM-DD_HH-MM-SS`)
- [ ] Write output to `.txt` file
- [ ] Return file path to renderer
- [ ] Handle errors (permissions, disk space)

#### Deliverables
- Main process fully functional
- IPC bridge working
- Script discovery working
- Script execution streaming output
- Logs saving to disk

---

### Phase 3: Renderer UI Implementation 🎨
**Duration:** 3-5 days | **Status:** Not Started

#### Task 3.1: Styling Foundation
- [ ] Create `renderer/styles.css`
- [ ] Define CSS variables for theme
- [ ] Implement dark theme colors
- [ ] Create base styles (reset, typography)
- [ ] Create utility classes
- [ ] Design button and card components
- [ ] Create terminal styling

#### Task 3.2: Tab Shell + Home Tab
- [ ] Create `renderer/index.html`
- [ ] Build tab bar (Home + max 4 script tabs)
- [ ] Create `renderer/tab-manager.js`
- [ ] Create `renderer/pages/home-tab.js`
- [ ] Load scripts on page load
- [ ] Render script cards dynamically
- [ ] Handle script card click → create/reuse execution tab
- [ ] Add import area (drag-drop + finder button)

#### Task 3.3: Execution Tab
- [ ] Create `renderer/pages/execution-tab.js`
- [ ] Set up execution tab view template
- [ ] Create terminal display container
- [ ] Add status indicator
- [ ] Add Save Logs button
- [ ] Add Run/Stop/Clear controls
- [ ] Listen for output streams
- [ ] Render output in terminal
- [ ] Handle Save Logs click
- [ ] Handle queue state display and tab status indicators

#### Task 3.4: Shared Utilities
- [ ] Create `renderer/ui.js`
- [ ] Implement `showPage()` function
- [ ] Implement `showNotification()` function
- [ ] Implement terminal utilities
- [ ] Implement output formatting

#### Deliverables
- Tab shell fully styled
- Home tab displays scripts and import controls
- Execution tabs show live output
- Navigation between tabs working
- All buttons functional

---

### Phase 4: Integration & Testing 🧪
**Duration:** 1-2 days | **Status:** Not Started

#### Task 4.1: End-to-End Testing
- [ ] Test app startup
- [ ] Test script discovery
- [ ] Test script execution
- [ ] Test output streaming
- [ ] Test log saving
- [ ] Test navigation
- [ ] Test error handling

#### Task 4.2: Example Scripts
- [ ] Create `scripts/example-script.sh`
  - Simple bash script with multiple output lines
  - Include delays to show streaming
  - Include error output example
- [ ] Create `scripts/example-python.py`
  - Simple Python script
  - Demonstrate terminal output
- [ ] Create `scripts/README.md`
  - Instructions for creating user scripts

#### Task 4.3: Bug Fixes & Polish
- [ ] Fix any UI bugs
- [ ] Improve responsiveness
- [ ] Add missing error messages
- [ ] Test error scenarios
- [ ] Performance optimization
- [ ] Code cleanup

#### Deliverables
- Fully functional application
- All features working
- Example scripts included
- Error handling robust

---

### Phase 5: Documentation & Packaging 📦
**Duration:** 1 day | **Status:** Not Started

#### Task 5.1: User Documentation
- [ ] Create comprehensive README.md
- [ ] Add installation instructions
- [ ] Add usage guide with screenshots
- [ ] Document example scripts
- [ ] Add troubleshooting section

#### Task 5.2: Developer Documentation
- [ ] Create developer setup guide in docs/
- [ ] Code comments in all files
- [ ] Architecture diagram in docs/
- [ ] API documentation in docs/

#### Task 5.3: Packaging
- [ ] Update `package.json` metadata
- [ ] Create build configuration
- [ ] Test building application
- [ ] Create installer/distribution

#### Deliverables
- Complete documentation
- Packaged application ready for distribution
- User and developer guides

---

## Development Checklist by Component

### Main Process (app/main.js)
- [ ] App initialization and window creation
- [ ] IPC event listeners setup
- [ ] Script discovery from `/scripts`
- [ ] Script execution with spawn
- [ ] Output streaming via IPC
- [ ] Log file writing
- [ ] Error handling and logging
- [ ] Process cleanup on exit

### Preload Bridge (app/preload.js)
- [ ] Context isolation enabled
- [ ] API methods exposed to window
- [ ] IPC invoke methods wrapped
- [ ] Error handling in bridge
- [ ] Security validation

### Home Tab (renderer/index.html + home-tab.js)
- [ ] Home tab loads on app start
- [ ] Requests scripts from main
- [ ] Renders script cards
- [ ] Handles script import via drag-drop and finder
- [ ] Opens/reuses execution tabs
- [ ] Displays validation and import errors

### Execution Tab (renderer/pages/execution-tab.js)
- [ ] Shows script name and status
- [ ] Terminal display container ready
- [ ] Listens for output streams
- [ ] Appends output in real-time
- [ ] Scrolls to bottom automatically
- [ ] Distinguishes stdout/stderr
- [ ] Collects complete output
- [ ] Handles Save Logs button
- [ ] Handles Stop and Clear actions
- [ ] Shows completion status

### Tab Manager (renderer/tab-manager.js)
- [ ] Create/switch/close tabs
- [ ] Enforce max tabs (Home + 4)
- [ ] Reuse existing tab for same script
- [ ] Update tab indicators (running/success/error)

### Styling (renderer/styles.css)
- [ ] Dark theme established
- [ ] All components styled
- [ ] Button styles and hover states
- [ ] Card styles
- [ ] Terminal styling
- [ ] Responsive layout
- [ ] Animations/transitions
- [ ] Color consistency

### Shared Utilities (renderer/ui.js)
- [ ] Tab utility helpers
- [ ] Notification system
- [ ] Terminal utilities
- [ ] Output formatting
- [ ] DOM helpers

---

## Sprint Schedule

### Sprint 1: Foundation
**Week 1 (Mar 13-17)**
- Project setup
- Main process setup
- IPC bridge creation
- Basic script-folder discovery

### Sprint 2: Core Features
**Week 1-2 (Mar 17-24)**
- Script execution
- Queue management
- Output streaming
- Log saving
- Tab shell + execution tabs

### Sprint 3: UI & Polish
**Week 2-3 (Mar 24-31)**
- Styling and theme
- Import UX (drag-drop + finder)
- Integration testing
- Bug fixes

### Sprint 4: Documentation
**Week 3-4 (Mar 31-Apr 7)**
- User documentation
- Developer documentation
- Example scripts
- Final packaging

---

## Dependencies Installation

### Required npm packages
```bash
npm install electron
npm install --save-dev electron-builder  # For packaging
```

### Node.js Version
- Minimum: 16.x
- Recommended: 18.x or later

### System Requirements
- macOS 10.13+, Windows 7+, or Ubuntu 18.04+
- 200MB disk space
- RAM: 512MB minimum

---

## Testing Strategy

### Manual Testing Checklist
- [ ] App launches without errors
- [ ] Script folders are discovered correctly
- [ ] All scripts display with correct info
- [ ] Running script opens/reuses execution tab
- [ ] Output streams live to the correct tab terminal
- [ ] Error output displays in red
- [ ] Save logs creates file with full timestamped name
- [ ] Import works via drag-drop and finder button
- [ ] Non-existent script shows error
- [ ] Permission denied handled gracefully

### Error Scenarios to Test
- [ ] Script doesn't exist
- [ ] Script not executable
- [ ] Permission denied
- [ ] Script crashes with error code
- [ ] Empty output
- [ ] Very large output (1000+ lines)
- [ ] Special characters in output
- [ ] Cannot write to logs folder

---

## Success Metrics

| Metric | Target | Status |
|---|---|---|
| All features implemented | 100% | Not Started |
| Code documented | 80%+ | Not Started |
| Example scripts working | 2+ | Not Started |
| Successful test runs | 100% | Not Started |
| Error handling coverage | 90%+ | Not Started |
| UI responsive | All devices | Not Started |

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Output streaming delays | Medium | Medium | Batch updates, monitor performance |
| Large script outputs crash app | Low | High | Limit buffer size, pagination |
| IPC communication fails silently | Low | High | Add IPC error handlers, logging |
| Path issues on different OS | Medium | Medium | Use path.join(), test on multiple OS |
| Permission issues on scripts | Medium | Low | Handle EACCES errors gracefully |

---

## Code Quality Standards

- **Comments:** JSDoc for all functions, inline for complex logic
- **Naming:** camelCase for variables, PascalCase for classes
- **Error Handling:** Try-catch with specific error messages
- **Async:** Use async/await consistently
- **Security:** Validate all IPC inputs, no eval()
- **Performance:** Debounce DOM updates, optimize loops
- **Testing:** Manual testing for all features

---

**Plan Version:** 1.1
**Created:** March 13, 2026
**Last Updated:** March 13, 2026
