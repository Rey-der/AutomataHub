/**
 * User Preferences — persistent storage for user settings (favorites, auto-start, etc.)
 * Stores data in `user-prefs.json` inside Electron's userData directory.
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const PREFS_FILE = path.join(app.getPath('userData'), 'user-prefs.json');

const DEFAULT_PREFS = {
  modules: {}
};

const DEFAULT_MODULE_PREFS = {
  favorite: false,
  autoStart: false
};

let cache = null;

/**
 * Read prefs from disk. Returns cached copy after first read.
 */
function loadPrefs() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(PREFS_FILE, 'utf-8');
    cache = JSON.parse(raw);
    if (!cache || typeof cache !== 'object') cache = { ...DEFAULT_PREFS };
    if (!cache.modules || typeof cache.modules !== 'object') cache.modules = {};
  } catch {
    cache = { ...DEFAULT_PREFS };
  }
  return cache;
}

/**
 * Write current prefs to disk.
 */
function savePrefs() {
  if (!cache) return;
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    console.error('[user-prefs] Failed to save:', err.message);
  }
}

/**
 * Get the full prefs object.
 */
function getPrefs() {
  return loadPrefs();
}

/**
 * Get prefs for a specific module, with defaults applied.
 */
function getModulePrefs(moduleId) {
  const prefs = loadPrefs();
  return { ...DEFAULT_MODULE_PREFS, ...prefs.modules[moduleId] };
}

/**
 * Update prefs for a specific module and persist.
 */
function setModulePrefs(moduleId, updates) {
  const prefs = loadPrefs();
  prefs.modules[moduleId] = { ...DEFAULT_MODULE_PREFS, ...prefs.modules[moduleId], ...updates };
  savePrefs();
  return prefs.modules[moduleId];
}

module.exports = { getPrefs, getModulePrefs, setModulePrefs };
