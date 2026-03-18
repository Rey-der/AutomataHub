/**
 * Database Scanner — discovers SQLite database files across the project tree.
 * Scans `data/`, each module directory, and the project root for .db, .sqlite,
 * and .sqlite3 files.  Skips `node_modules/`, `.git/`, and `logs/`.
 *
 * Each result includes the absolute path, a workspace-relative path, the source
 * (hub, module, or project), and the file size in bytes.
 */

const path = require('node:path');
const fs = require('node:fs');

const DB_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'logs']);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect database files under `dir`, up to `maxDepth` levels.
 * @param {string} dir — directory to scan
 * @param {number} maxDepth — remaining recursion depth
 * @returns {string[]} absolute paths of discovered database files
 */
function _walk(dir, maxDepth) {
  if (maxDepth <= 0) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(..._walk(fullPath, maxDepth - 1));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (DB_EXTENSIONS.has(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

/**
 * Read the module id from a manifest.json next to (or above) a db file.
 */
function _readModuleId(moduleDir) {
  const manifestPath = path.join(moduleDir, 'manifest.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    return manifest.id || null;
  } catch {
    return null;
  }
}

/**
 * Get file size in bytes, or 0 on error.
 */
function _fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan the project tree for SQLite database files.
 *
 * @param {string} rootDir — project root (e.g. path to AutomataHub)
 * @param {string} [modulesDir] — path to the modules/ folder (defaults to <rootDir>/modules)
 * @param {string} [userDataDir] — Electron userData path to scan for module databases stored outside the project tree
 * @returns {{ path: string, relativePath: string, source: string, sizeBytes: number }[]}
 */
function scanForDatabases(rootDir, modulesDir, userDataDir) {
  const modDir = modulesDir || path.join(rootDir, 'modules');
  const seen = new Set();
  const results = [];

  function addResult(absPath, source, baseDir) {
    const resolved = path.resolve(absPath);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    results.push({
      path: resolved,
      relativePath: path.relative(baseDir || rootDir, resolved),
      source,
      sizeBytes: _fileSize(resolved),
    });
  }

  // 1. Scan data/ directory (hub-level databases)
  const dataDir = path.join(rootDir, 'data');
  for (const dbPath of _walk(dataDir, 3)) {
    addResult(dbPath, 'hub');
  }

  // 2. Scan each module directory (in-project)
  if (fs.existsSync(modDir)) {
    let moduleEntries;
    try {
      moduleEntries = fs.readdirSync(modDir, { withFileTypes: true });
    } catch {
      moduleEntries = [];
    }
    for (const entry of moduleEntries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const thisModDir = path.join(modDir, entry.name);
      const moduleId = _readModuleId(thisModDir) || entry.name;
      for (const dbPath of _walk(thisModDir, 4)) {
        addResult(dbPath, `module:${moduleId}`);
      }
    }
  }

  // 3. Scan project root (top-level only, depth 1) for any stray DBs
  for (const dbPath of _walk(rootDir, 1)) {
    addResult(dbPath, 'project');
  }

  // 4. Scan Electron userData directory for module databases stored outside the project
  if (userDataDir && fs.existsSync(userDataDir)) {
    let udEntries;
    try {
      udEntries = fs.readdirSync(userDataDir, { withFileTypes: true });
    } catch {
      udEntries = [];
    }
    for (const entry of udEntries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const subDir = path.join(userDataDir, entry.name);
      for (const dbPath of _walk(subDir, 3)) {
        addResult(dbPath, `module:${entry.name}`, userDataDir);
      }
    }
  }

  return results;
}

module.exports = { scanForDatabases };
