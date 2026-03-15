# AutomataHub - Project Overview

> **Frozen at MVP v1.0.0** — This document reflects the shipped implementation.

## Project Summary

**AutomataHub** is a modular Electron-based desktop hub for automation tools. Users can browse available scripts, run them with a single click, monitor live output in a terminal-style display, and save execution logs for future reference.

## Project Goals

1. **Simplify Script Execution** - Eliminate the need to use command-line tools for running scripts
2. **Real-time Monitoring** - Display script output live as it executes
3. **Log Management** - Automatically capture and save execution logs with timestamps
4. **User-Friendly Interface** - Provide a clean, dark-themed UI that's easy to navigate
5. **Extensibility** - Support any executable scripts (bash, Python, Node.js, etc.)

## Target Users

- Developers needing to run routine automation tasks
- DevOps professionals managing multiple scripts
- Power users who prefer GUI over command-line

## Key Technologies

| Technology | Purpose | Version |
|---|---|---|
| Electron | Desktop application framework | Latest |
| Node.js | Backend runtime & child process management | 16+ |
| HTML5 | Page markup | - |
| CSS3 | Styling (dark theme) | - |
| Vanilla JavaScript | Logic & DOM manipulation | ES6+ |
| child_process.spawn | Script execution & output streaming | Node.js built-in |

## Core Features

1. **Script Discovery** - Auto-scan `/scripts` for script folders with executable files
2. **Script Import** - Add script folders via drag-and-drop or Finder/Explorer picker
3. **Tab-Based Execution** - Home tab + execution tabs (max 4 script tabs)
4. **Live Execution** - Stream stdout/stderr in real-time with tab-specific routing
5. **Log Saving** - Export execution output with full timestamp
6. **Error Handling** - Graceful handling of validation and execution errors

## Success Criteria

- ✓ Application launches without errors
- ✓ Scripts are discovered and displayed from `/scripts` script-folder structure
- ✓ Script execution streams live output to the correct tab terminal
- ✓ Logs saved with correct naming format: `script-name_YYYY-MM-DD_HH-MM-SS.txt`
- ✓ UI is responsive and dark-themed
- ✓ Error handling is robust (invalid scripts, permission issues, etc.)
- ✓ Code is modular and well-commented

## Scope

### In Scope
- Electron app with single-window tab-based navigation
- Script folder discovery and import
- Script execution with queueing
- Live output streaming
- Log saving functionality
- Basic error handling
- Dark-themed UI with CSS

### Out of Scope (Future Enhancements)
- Script editing interface
- Scheduled/cron execution
- Environment variable configuration
- Advanced process management beyond stop/queue controls
- Cloud sync or remote script execution
- User authentication
- Database for script metadata

## Timeline & Phases

**Phase 1: Planning** (Current)
- Define architecture and design
- Plan component structure
- Document specifications

**Phase 2: Implementation**
- Set up Electron project structure
- Implement main process (IPC, file system, queue)
- Build renderer tab UI (Home + execution tabs)
- Create script folder import and validation logic
- Create script execution logic
- Implement logging system

**Phase 3: Testing & Polish**
- Test all features
- Bug fixes
- UI refinement
- Performance optimization

**Phase 4: Documentation**
- User guide
- Developer documentation
- Setup instructions

---

**Project Start Date:** March 13, 2026
**Estimated Completion:** 3-4 weeks
