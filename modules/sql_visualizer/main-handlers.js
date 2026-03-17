/**
 * SQL Visualizer — main-process handlers.
 * Registers IPC handlers for database introspection, paginated queries,
 * ad-hoc SQL execution, and CSV export.
 */

const path = require('node:path');
const fs = require('node:fs');

const dbBridge = require(path.join(__dirname, 'db-bridge'));
const analyzer = require(path.join(__dirname, 'query-analyzer'));

// Hub utilities — resolved at setup() time via paths.root
let ERROR_MESSAGES, friendlyError;

/**
 * Resolve the database file path.
 * Priority: SMART_DESKTOP_DB env var → ../smart_desktop_sql/data/smart_desktop.db relative to hub root.
 */
function resolveDbPath(hubRoot) {
  const envPath = process.env.SMART_DESKTOP_DB;
  if (envPath && fs.existsSync(envPath)) return envPath;

  // Fallback: sibling project relative to hub
  const sibling = path.resolve(hubRoot, '..', 'smart_desktop_sql', 'data', 'smart_desktop.db');
  if (fs.existsSync(sibling)) return sibling;

  // Fallback: sibling project relative to modules workspace
  const fromModules = path.resolve(__dirname, '..', '..', 'smart_desktop_sql', 'data', 'smart_desktop.db');
  if (fs.existsSync(fromModules)) return fromModules;

  return null;
}

// --- Module setup/teardown ---

function setup(ctx) {
  const { ipcBridge, paths } = ctx;

  // Resolve hub utilities
  const hubApp = path.join(paths.root, 'app');
  ({ ERROR_MESSAGES, friendlyError } = require(path.join(hubApp, 'core', 'errors')));

  // Open database connection
  const dbPath = resolveDbPath(paths.root);
  if (!dbPath) {
    console.error('[sql-visualizer] Database not found at expected locations.');
    console.error('  Expected: ' + path.resolve(paths.root, '..', 'smart_desktop_sql', 'data', 'smart_desktop.db'));
    console.error('  Set SMART_DESKTOP_DB env var to override.');
    // Try sql.js fallback
    dbBridge.initSqlJsFallback().then(() => {
      if (dbBridge.isConnected()) {
        console.log('[sql-visualizer] Using in-memory database (sql.js fallback)');
      }
    });
  } else {
    try {
      dbBridge.open(dbPath);
      console.log(`[sql-visualizer] Connected to database: ${dbPath}`);
    } catch (err) {
      console.error(`[sql-visualizer] Failed to open database with better-sqlite3: ${err.message}`);
      console.error('  Attempting sql.js fallback with direct data loading...');
      // Try sql.js fallback, but load actual data from the real database file
      dbBridge.initSqlJsFallbackWithFile(dbPath).then(() => {
        if (dbBridge.isConnected()) {
          console.log('[sql-visualizer] Using sql.js with data from ' + dbPath);
        } else {
          console.error('[sql-visualizer] Both better-sqlite3 and sql.js fallback failed');
        }
      }).catch(err => {
        console.error('[sql-visualizer] sql.js fallback error:', err.message);
      });
    }
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
      message: dbBridge.isConnected() ? 'Connected' : 'Database not available. better-sqlite3 not installed.'
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
}

function teardown() {
  dbBridge.close();
}

module.exports = { setup, teardown };
