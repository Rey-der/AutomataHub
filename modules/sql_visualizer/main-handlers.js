/**
 * SQL Monitor — main-process handlers.
 * Registers IPC handlers for database introspection, paginated queries,
 * ad-hoc SQL execution, and CSV export.
 */

const path = require('node:path');
const fs = require('node:fs');
const { dialog } = require('electron');

const dbBridge = require(path.join(__dirname, 'db-bridge'));
const analyzer = require(path.join(__dirname, 'query-analyzer'));

// Hub utilities — resolved at setup() time via paths.root
let ERROR_MESSAGES, friendlyError;

// Multi-DB state
let _dbList = [];       // ordered list of known DB paths
let _activeDbPath = null;  // currently connected DB path
let _setModulePrefs = null;

function _saveDbList() {
  if (_setModulePrefs) {
    _setModulePrefs('sql-visualizer', { dbList: _dbList, activeDbPath: _activeDbPath });
  }
}

/**
 * Try opening a DB with better-sqlite3; fall back to sql.js if it fails.
 * This mirrors the startup logic so add/switch/remove all behave consistently.
 */
async function _openWithFallback(dbPath) {
  try {
    dbBridge.open(dbPath);
    console.log(`[sql-monitor] _openWithFallback: opened via better-sqlite3: ${dbPath}`);
    return { success: true };
  } catch (err) {
    const betterErr = err.message;
    console.error(`[sql-monitor] _openWithFallback: better-sqlite3 failed (${betterErr}) — trying sql.js fallback...`);
    try {
      await dbBridge.initSqlJsFallbackWithFile(dbPath);
      if (dbBridge.isConnected()) {
        console.log(`[sql-monitor] _openWithFallback: sql.js fallback succeeded for: ${dbPath}`);
        return { success: true, usedFallback: true };
      }
    } catch (err2) {
      const fallbackErr = err2.message;
      console.error(`[sql-monitor] _openWithFallback: sql.js fallback also failed: ${fallbackErr}`);
      return { success: false, error: `better-sqlite3: ${betterErr} | sql.js: ${fallbackErr}` };
    }
    return { success: false, error: betterErr };
  }
}

/**
 * Resolve the database file path for first-run auto-detection.
 * Priority: SMART_DESKTOP_DB env var → data/ inside hub root → legacy sibling path.
 */
function resolveDbPath(hubRoot) {
  const envPath = process.env.SMART_DESKTOP_DB;
  if (envPath && fs.existsSync(envPath)) return envPath;

  // Primary: data/ folder inside the hub root (new canonical location)
  const local = path.resolve(hubRoot, 'data', 'smart_desktop.db');
  if (fs.existsSync(local)) return local;

  return null;
}

// --- Module setup/teardown ---

function setup(ctx) {
  const { ipcBridge, paths } = ctx;

  // Resolve hub utilities
  const hubApp = path.join(paths.root, 'app');
  ({ ERROR_MESSAGES, friendlyError } = require(path.join(hubApp, 'core', 'errors')));

  // Load saved DB list from user preferences
  const userPrefsModule = require(path.join(hubApp, 'core', 'user-prefs'));
  _setModulePrefs = userPrefsModule.setModulePrefs;
  const savedPrefs = userPrefsModule.getModulePrefs('sql-visualizer');
  const isFirstRun = !Array.isArray(savedPrefs.dbList); // dbList undefined = never saved before
  _dbList = isFirstRun ? [] : [...savedPrefs.dbList];
  _activeDbPath = savedPrefs.activeDbPath || null;

  // Open database connection:
  // - If we have a saved active DB or a saved list, use those (respects user removals).
  // - On first run only, auto-detect via resolveDbPath so the DB appears in the connector.
  const dbPath = _activeDbPath
    || (_dbList.length > 0 ? _dbList[0] : null)
    || (isFirstRun ? resolveDbPath(paths.root) : null);
  if (dbPath) {
    try {
      dbBridge.open(dbPath);
      console.log(`[sql-monitor] Connected to database: ${dbPath}`);
      _activeDbPath = dbPath;
      if (!_dbList.includes(dbPath)) _dbList.push(dbPath);
      _saveDbList();
    } catch (err) {
      console.error(`[sql-monitor] Failed to open database with better-sqlite3: ${err.message}`);
      console.error('  Attempting sql.js fallback with direct data loading...');
      // Try sql.js fallback, but load actual data from the real database file
      dbBridge.initSqlJsFallbackWithFile(dbPath).then(() => {
        if (dbBridge.isConnected()) {
          // Keep _activeDbPath and _dbList in sync for the fallback case
          _activeDbPath = dbPath;
          if (!_dbList.includes(dbPath)) _dbList.push(dbPath);
          _saveDbList();
          console.log('[sql-monitor] Using sql.js with data from ' + dbPath);
        } else {
          console.error('[sql-monitor] Both better-sqlite3 and sql.js fallback failed');
        }
      }).catch(err2 => {
        console.error('[sql-monitor] sql.js fallback error:', err2.message);
      });
    }
  } else {
    console.log('[sql-monitor] No database configured. Use the DB connector in the UI to add one.');
  }

  // --- IPC Handlers ---

  ipcBridge.handle('sql-visualizer:get-tables', () => {
    if (!dbBridge.isConnected()) {
      return [];
    }
    try {
      return dbBridge.getTables();
    } catch (err) {
      console.error('[sql-visualizer] get-tables error:', err);
      return [];
    }
  });

  ipcBridge.handle('sql-visualizer:get-table-info', (_event, args) => {
    if (!dbBridge.isConnected()) {
      return [];
    }
    const { table } = args || {};
    if (!table || typeof table !== 'string') throw new Error('Missing table name');
    try {
      return dbBridge.getTableInfo(table);
    } catch (err) {
      console.error('[sql-visualizer] get-table-info error:', err);
      return [];
    }
  });

  ipcBridge.handle('sql-visualizer:get-table-stats', () => {
    if (!dbBridge.isConnected()) {
      return [];
    }
    try {
      return dbBridge.getTableStats();
    } catch (err) {
      console.error('[sql-visualizer] get-table-stats error:', err);
      return [];
    }
  });

  ipcBridge.handle('sql-visualizer:query-rows', (_event, args) => {
    if (!dbBridge.isConnected()) {
      return { rows: [], total: 0 };
    }
    const { table, offset, limit, sortCol, sortDir, filters } = args || {};
    if (!table || typeof table !== 'string') throw new Error('Missing table name');
    try {
      return dbBridge.queryRows(table, { offset, limit, sortCol, sortDir, filters });
    } catch (err) {
      console.error('[sql-visualizer] query-rows error:', err);
      return { rows: [], total: 0 };
    }
  });

  ipcBridge.handle('sql-visualizer:run-query', (_event, args) => {
    if (!dbBridge.isConnected()) {
      return { rows: [], error: 'Database not connected' };
    }
    const { sql } = args || {};
    if (!sql || typeof sql !== 'string') throw new Error('Missing SQL query');
    try {
      return dbBridge.runReadOnlyQuery(sql);
    } catch (err) {
      console.error('[sql-visualizer] run-query error:', err);
      return { rows: [], error: err.message };
    }
  });

  ipcBridge.handle('sql-visualizer:get-row-count', (_event, args) => {
    if (!dbBridge.isConnected()) {
      return 0;
    }
    const { table } = args || {};
    if (!table || typeof table !== 'string') throw new Error('Missing table name');
    try {
      return dbBridge.getRowCount(table);
    } catch (err) {
      console.error('[sql-visualizer] get-row-count error:', err);
      return 0;
    }
  });

  ipcBridge.handle('sql-visualizer:export-csv', (_event, args) => {
    if (!dbBridge.isConnected()) {
      return '';
    }
    const { sql } = args || {};
    if (!sql || typeof sql !== 'string') throw new Error('Missing SQL query');
    try {
      return dbBridge.exportCsv(sql);
    } catch (err) {
      console.error('[sql-visualizer] export-csv error:', err);
      return '';
    }
  });

  ipcBridge.handle('sql-visualizer:get-db-path', () => {
    return dbBridge.getDbPath() || '(not connected)';
  });

  ipcBridge.handle('sql-visualizer:get-db-status', () => {
    return {
      connected: dbBridge.isConnected(),
      path: dbBridge.getDbPath() || null,
      message: dbBridge.isConnected() ? 'Connected' : 'No database connected. Add one via the connector.'
    };
  });

  // --- Phase 2: Analytics IPC Handlers ---

  ipcBridge.handle('sql-visualizer:get-execution-timeline', (_event, args) => {
    if (!dbBridge.isConnected()) {
      return [];
    }
    const { timeRange } = args || {};
    try {
      return analyzer.getExecutionTimeline(timeRange || 'week');
    } catch (err) {
      console.error('[sql-visualizer] get-execution-timeline error:', err);
      return [];
    }
  });

  ipcBridge.handle('sql-visualizer:get-script-health', () => {
    try {
      return analyzer.getScriptHealthStats();
    } catch (err) {
      console.error('[sql-visualizer] get-script-health error:', err);
      return [];
    }
  });

  ipcBridge.handle('sql-visualizer:get-performance-stats', (_event, args) => {
    const { script } = args || {};
    try {
      return analyzer.getPerformanceStats(script || null);
    } catch (err) {
      throw new Error(friendlyError(err));
    }
  });

  ipcBridge.handle('sql-visualizer:get-activity-heatmap', (_event, args) => {
    const { timeRange, script } = args || {};
    try {
      return analyzer.getActivityHeatmap(timeRange || 'week', script || null);
    } catch (err) {
      throw new Error(friendlyError(err));
    }
  });

  ipcBridge.handle('sql-visualizer:get-error-patterns', () => {
    try {
      return analyzer.getErrorPatterns();
    } catch (err) {
      console.error('[sql-visualizer] get-error-patterns error:', err);
      return [];
    }
  });

  ipcBridge.handle('sql-visualizer:get-integrity-report', () => {
    if (!dbBridge.isConnected()) {
      return { issues: [], passed: 0, warnings: 0, errors: 0 };
    }
    try {
      return analyzer.getIntegrityReport();
    } catch (err) {
      console.error('[sql-visualizer] get-integrity-report error:', err);
      return { issues: [], passed: 0, warnings: 0, errors: 0 };
    }
  });

  ipcBridge.handle('sql-visualizer:get-db-health', () => {
    try {
      return analyzer.getDbHealth();
    } catch (err) {
      console.error('[sql-visualizer] get-db-health error:', err);
      return {};
    }
  });

  ipcBridge.handle('sql-visualizer:get-correlated-records', (_event, args) => {
    const { executionId } = args || {};
    if (!executionId) throw new Error('Missing executionId');
    try {
      return analyzer.getCorrelatedRecords(executionId);
    } catch (err) {
      throw new Error(friendlyError(err));
    }
  });

  // --- Multi-DB Management ---

  ipcBridge.handle('sql-visualizer:get-db-list', () => {
    return { dbs: [..._dbList], active: _activeDbPath };
  });

  ipcBridge.handle('sql-visualizer:add-db', async () => {
    const win = ctx.mainWindow();
    const result = await dialog.showOpenDialog(win || undefined, {
      title: 'Select SQLite Database',
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const chosen = result.filePaths[0];
    if (!fs.existsSync(chosen)) return { success: false, error: 'File not found' };
    if (!_dbList.includes(chosen)) {
      _dbList.push(chosen);
    }
    // Connect if not already connected to this exact DB.
    // Use dbBridge.getDbPath() as the source of truth — _activeDbPath can be out of sync
    // when the sql.js fallback path was used during setup.
    const alreadyConnected = dbBridge.isConnected() && dbBridge.getDbPath() === chosen;
    let openError = null;
    if (!alreadyConnected) {
      const openResult = await _openWithFallback(chosen);
      if (openResult.success) {
        _activeDbPath = chosen;
      } else {
        openError = openResult.error;
      }
    } else {
      // Ensure _activeDbPath is in sync even if we skip the open
      _activeDbPath = chosen;
    }
    _saveDbList();
    return { path: chosen, dbs: [..._dbList], active: _activeDbPath, autoSwitched: !alreadyConnected, openError };
  });

  ipcBridge.handle('sql-visualizer:remove-db', async (_event, args) => {
    const { path: pathToRemove } = args || {};
    if (!pathToRemove) return { success: false, error: 'No path provided' };
    _dbList = _dbList.filter((p) => p !== pathToRemove);
    // Check both _activeDbPath AND dbBridge.getDbPath() — they can be out of sync
    // when the sql.js fallback was used during setup (fallback connects but doesn't set _activeDbPath).
    const isBridgeConnectedToThis = dbBridge.getDbPath() === pathToRemove;
    const isTrackedAsActive = _activeDbPath === pathToRemove;
    if (isTrackedAsActive || isBridgeConnectedToThis) {
      _activeDbPath = _dbList[0] || null;
      if (_activeDbPath) {
        const openResult = await _openWithFallback(_activeDbPath);
        if (!openResult.success) {
          dbBridge.close();
          _activeDbPath = null;
        }
      } else {
        dbBridge.close();
      }
    }
    _saveDbList();
    return { dbs: [..._dbList], active: _activeDbPath, connected: dbBridge.isConnected() };
  });

  ipcBridge.handle('sql-visualizer:switch-db', async (_event, args) => {
    const { path: newPath } = args || {};
    if (!newPath) return { success: false, error: 'No path provided' };
    if (!fs.existsSync(newPath)) return { success: false, error: `File not found: ${newPath}` };
    const openResult = await _openWithFallback(newPath);
    if (openResult.success) {
      _activeDbPath = newPath;
      if (!_dbList.includes(newPath)) _dbList.push(newPath);
      _saveDbList();
      return { success: true, connected: true, path: newPath, dbs: [..._dbList], active: _activeDbPath };
    } else {
      return { success: false, error: openResult.error };
    }
  });
}

function teardown() {
  dbBridge.close();
}

module.exports = { setup, teardown };
