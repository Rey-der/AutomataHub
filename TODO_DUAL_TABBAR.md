# Dual Tab Bar & Module Preferences — Implementation Plan

## Overview

Two tab bars: an **upper main bar** (always visible) and a **lower module bar** (contextual). Modules can be marked as **favorite** (heart — sorted to top) or **auto-start** (star — pinned to upper bar on launch).

---

## Step 1 — User Preferences Persistence ✅

Created a preferences system that saves/loads user settings to disk.

- [x] Created `app/core/user-prefs.js`
  - Reads/writes `user-prefs.json` from Electron's `app.getPath('userData')`
  - Exposes `getPrefs()`, `getModulePrefs(moduleId)`, `setModulePrefs(moduleId, updates)`
  - Default structure: `{ modules: { "<moduleId>": { favorite: false, autoStart: false } } }`
- [x] Registered IPC handlers in `app/main.js`
  - `prefs:get` — returns full prefs object
  - `prefs:get-module` — returns prefs for a single module
  - `prefs:set-module` — updates prefs for a single module
- [x] Exposed IPC channels in `app/preload.js`
  - `window.api.getPrefs()`, `window.api.getModulePrefs(moduleId)`, `window.api.setModulePrefs(moduleId, updates)`

---

## Step 2 — Update HTML Structure for Dual Tab Bars ✅

Modified the app shell and tab manager to support two separate tab bar containers.

- [x] Updated `renderer/index.html`
  - Replaced single `#tab-bar` with:
    - `#main-tab-bar` — upper bar (Home left + `#auto-start-tabs` container right)
    - `#module-tab-bar` — lower bar (hidden when empty)
  - `#tab-content` remains the shared content panel
- [x] Updated `renderer/tab-manager.js`
  - References both `#main-tab-bar` and `#module-tab-bar`
  - `createTab()` accepts `opts.target: 'main' | 'module'` (defaults to `'module'`)
  - Tab buttons route to correct bar (`autoStartTabs` for main, `moduleTabBar` for module)
  - `switchTab()` / `closeTab()` / `updateTabStatus()` query across both bars
  - `_updateModuleBarVisibility()` hides lower bar when empty

---

## Step 3 — Style Both Tab Bars in CSS ✅

- [x] Updated `renderer/core.css`
  - Grid layout updated to `auto auto 1fr` for two bars + content
  - `.main-tab-bar`: always visible, flexbox with left/right sections
  - `.module-tab-bar`: distinct background (`--surface-2`), smooth slide transition, hidden when empty
  - `.hidden` state uses `max-height: 0` + `opacity: 0` for animated show/hide

---

## Step 4 — Refactor TabManager for Dual Bars ✅ (completed in Step 2)

- [x] Updated `renderer/tab-manager.js`
  - `createTab()` accepts `opts.target: 'main' | 'module'` (defaults to `'module'`)
  - Tab buttons route to correct bar
  - `switchTab()` / `closeTab()` / `updateTabStatus()` query across both bars
  - `closeTab()` hides `#module-tab-bar` when empty
  - Home tab always targets `#main-tab-bar`

---

## Step 5 — Add Favorite & Auto-Start Toggles to Module Cards ✅

- [x] Updated `renderer/pages/home-tab.js`
  - Loads module prefs on render via `window.api.getPrefs()`
  - Heart icon (♥/♡) toggle on each card — red when active, toggles `favorite` pref
  - Star icon (★/☆) toggle on each card — gold when active, toggles `autoStart` pref
  - Both styled in top-right corner with hover effects
- [x] Added toggle styles in `renderer/core.css`

---

## Step 6 — Sort Module Cards ✅

- [x] Updated `renderer/pages/home-tab.js`
  - `sortModules()` sorts: favorites first, then alphabetical by name
  - `sortModuleGrid()` re-sorts DOM cards live when heart is toggled (no full re-render)

---

## Step 7 — Auto-Start Modules on Launch ✅

- [x] Updated `renderer/module-bootstrap.js`
  - After booting TabManager, reads prefs and auto-opens modules with `autoStart: true`
  - Creates tabs with `target: 'main'` and `reuseKey: 'autostart-<id>'`
  - Home tab remains active/selected after auto-starting

---

## Step 8 — Route Manually Opened Modules to Lower Bar ✅

- [x] Updated `renderer/pages/home-tab.js` → `handleOpenModule()`
  - Passes `target: 'module'` when creating tabs
  - Detects if module already has an open tab (auto-started or manual) and switches to it instead of duplicating

---

## Step 9 — Visual Polish & Edge Cases ✅

- [x] Duplicate tab handling: `handleOpenModule` checks `getTabsByType()` and switches to existing
- [x] Closing an auto-start tab doesn't affect the `autoStart` pref (it returns on next launch)
- [x] Active tab indicator works across both bars (`_getAllTabButtons()` queries both)
- [x] Lower bar slides in/out with CSS `max-height` + `opacity` transition
- [x] `.script-card` has `position: relative` for toggle positioning

---

## Step 10 — Test Full Flow

- [ ] Launch app → Home tab visible in upper bar, auto-start modules appear on the right
- [ ] Click auto-start tab → content switches, tab highlighted in upper bar
- [ ] Open module from home → tab appears in lower bar, content switches
- [ ] Toggle heart on module card → card moves to top of grid, persists on reload
- [ ] Toggle star on module card → module appears in upper bar on next launch
- [ ] Close module tab in lower bar → lower bar hides when empty
- [ ] Restart app → prefs restored (favorites sorted, auto-start tabs present)
