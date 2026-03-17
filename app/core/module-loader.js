/**
 * Module Loader — discovers modules from two sources:
 *
 * 1. Local `modules/` directory (development) — each subfolder with a manifest.json
 * 2. Installed `node_modules/automatahub-*` packages (production/portfolio)
 *
 * Local modules take priority: if a module id exists in both sources,
 * the local version is used and the installed version is skipped.
 *
 * Each module folder must contain a manifest.json and optionally a main-handlers.js.
 */

const path = require('node:path');
const fs = require('node:fs');

const REQUIRED_MANIFEST_FIELDS = ['id', 'name'];

/**
 * Resolve renderer assets (scripts or styles) declared in a manifest.
 */
function resolveRendererAssets(manifest, modDir, key) {
  const assets = [];
  if (!Array.isArray(manifest[key])) return assets;

  for (const rel of manifest[key]) {
    const absPath = path.join(modDir, rel);
    if (fs.existsSync(absPath)) {
      assets.push(absPath);
    } else {
      console.warn(`[module-loader] Module "${manifest.id}": ${key} not found — ${rel}`);
    }
  }
  return assets;
}

/**
 * Parse and validate a manifest.json file. Returns the parsed object or null.
 */
function parseManifest(manifestPath, label) {
  if (!fs.existsSync(manifestPath)) {
    console.warn(`[module-loader] Skipping "${label}": no manifest.json`);
    return null;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const missing = REQUIRED_MANIFEST_FIELDS.filter((f) => !manifest[f]);
    if (missing.length > 0) {
      console.warn(`[module-loader] Skipping "${label}": manifest missing fields: ${missing.join(', ')}`);
      return null;
    }
    return manifest;
  } catch (err) {
    console.warn(`[module-loader] Skipping "${label}": malformed manifest.json — ${err.message}`);
    return null;
  }
}

/**
 * Load a single module from its directory. Returns a module descriptor or null.
 */
function loadModuleFromDir(modDir, label) {
  const manifestPath = path.join(modDir, 'manifest.json');
  const manifest = parseManifest(manifestPath, label);
  if (!manifest) return null;

  const mainEntryFile = manifest.mainEntry || 'main-handlers.js';
  const mainEntryPath = path.join(modDir, mainEntryFile);
  let handlers = {};

  if (fs.existsSync(mainEntryPath)) {
    try {
      handlers = require(mainEntryPath);
    } catch (err) {
      console.warn(`[module-loader] Skipping "${label}": failed to load ${mainEntryFile} — ${err.message}`);
      return null;
    }
  }

  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version || '0.0.0',
    description: manifest.description || '',
    ipcChannels: Array.isArray(manifest.ipcChannels) ? manifest.ipcChannels : [],
    tabTypes: Array.isArray(manifest.tabTypes) ? manifest.tabTypes : [],
    rendererScripts: resolveRendererAssets(manifest, modDir, 'rendererScripts'),
    rendererStyles: resolveRendererAssets(manifest, modDir, 'rendererStyles'),
    moduleDir: modDir,
    setup: typeof handlers.setup === 'function' ? handlers.setup : null,
    teardown: typeof handlers.teardown === 'function' ? handlers.teardown : null,
  };
}

/**
 * Scan the local modules/ directory for module folders.
 *
 * @param {string} modulesDir — absolute path to the modules/ folder
 * @returns {object[]} array of module descriptors
 */
function discoverModules(modulesDir) {
  if (!fs.existsSync(modulesDir)) {
    fs.mkdirSync(modulesDir, { recursive: true });
    return [];
  }

  const modules = [];
  let entries;
  try {
    entries = fs.readdirSync(modulesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const modDir = path.join(modulesDir, entry.name);
    const mod = loadModuleFromDir(modDir, entry.name);
    if (mod) modules.push(mod);
  }

  return modules;
}

/**
 * Scan node_modules/ for installed automatahub-* packages that contain a manifest.json.
 *
 * @param {string} nodeModulesDir — absolute path to the node_modules/ folder
 * @returns {object[]} array of module descriptors
 */
function discoverInstalledModules(nodeModulesDir) {
  if (!fs.existsSync(nodeModulesDir)) return [];

  const modules = [];
  let entries;
  try {
    entries = fs.readdirSync(nodeModulesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!entry.name.startsWith('automatahub-')) continue;

    const modDir = path.join(nodeModulesDir, entry.name);
    const manifestPath = path.join(modDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    const mod = loadModuleFromDir(modDir, entry.name);
    if (mod) modules.push(mod);
  }

  return modules;
}

module.exports = { discoverModules, discoverInstalledModules };
