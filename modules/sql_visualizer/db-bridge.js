/**
 * SQL Visualizer — database bridge.
 * Wraps better-sqlite3 (or falls back to sql.js) with safe helpers for table introspection,
 * paginated queries, and ad-hoc SELECT execution.
 */

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

let sql = null; // sql.js fallback
let sqlJsReady = false; // flag to track if sql.js is loaded

async function _loadSqlJs() { // NOSONAR — CJS module, top-level await not available
  try {
    const initSqlJs = require('sql.js');
    sql = await initSqlJs();
    sqlJsReady = true;
  } catch (e) {
    // sql.js not available - log but don't fail
    console.debug('[db-bridge] sql.js initialization:', e.message);
  }
}

const sqlJsPromise = _loadSqlJs(); // NOSONAR — CJS module, top-level await not available

const path = require('node:path');
const fs = require('node:fs');

let _db = null;
let _dbPath = null;
let _schema = null; // cached { tableName: [{ name, type, pk }] }
let _usesSqlJs = false; // flag to track if using sql.js fallback

// --- Connection ---

function open(dbPath, opts) {
  if (_db) close();

  if (!Database) {
    throw new Error('better-sqlite3 not available. Please install it.');
  }

  if (!dbPath || !fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath || '(no path)'}`);
  }

  try {
    _db = new Database(dbPath, { readonly: false, fileMustExist: true });
    // If a password is provided, apply PRAGMA key (SQLCipher compat, future-proof)
    // Hex-encode to avoid any injection risk — only [0-9a-f] reaches the PRAGMA
    if (opts?.password) {
      const hex = Buffer.from(opts.password, 'utf-8').toString('hex');
      _db.pragma(`key="x'${hex}'"`);
    }
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _dbPath = dbPath;
    _schema = null; // invalidate cache
  } catch (err) {
    _db = null;
    throw new Error(`Failed to open database: ${err.message}`);
  }
}

/**
 * Create an in-memory sql.js database with sample schema and data.
 */
function _createInMemoryDb() {
  if (!sql) return;
  _usesSqlJs = true;
  _db = new sql.Database();
  
  // Create sample schema
  _db.run(`
    CREATE TABLE IF NOT EXISTS automation_logs (
      id INTEGER PRIMARY KEY,
      timestamp TEXT,
      script TEXT,
      status TEXT,
      message TEXT,
      metadata TEXT
    )
  `);
  
  _db.run(`
    CREATE TABLE IF NOT EXISTS execution_tracking (
      id INTEGER PRIMARY KEY,
      script TEXT,
      start_time TEXT,
      end_time TEXT,
      status TEXT,
      error_message TEXT
    )
  `);
  
  _db.run(`
    CREATE TABLE IF NOT EXISTS errors (
      id INTEGER PRIMARY KEY,
      timestamp TEXT,
      script TEXT,
      message TEXT,
      stack_trace TEXT
    )
  `);
  
  // Add sample data
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  
  // Sample automation logs
  _db.run(`
    INSERT INTO automation_logs (timestamp, script, status, message, metadata) VALUES
    ('${now}', 'backup-runner', 'SUCCESS', 'Backup completed successfully', '{"size": "2.4 GB"}'),
    ('${yesterday}', 'invoice-scanner', 'SUCCESS', 'Scanned 25 invoices', '{"count": 25}'),
    ('${new Date(Date.now() - 172800000).toISOString()}', 'download-sorter', 'SUCCESS', 'Sorted 143 files', '{"count": 143}')
  `);
  
  // Sample execution tracking
  _db.run(`
    INSERT INTO execution_tracking (script, start_time, end_time, status, error_message) VALUES
    ('backup-runner', '${yesterday}', '${new Date(Date.now() - 86300000).toISOString()}', 'SUCCESS', NULL),
    ('invoice-scanner', '${yesterday}', '${new Date(Date.now() - 85800000).toISOString()}', 'SUCCESS', NULL),
    ('download-sorter', '${new Date(Date.now() - 172800000).toISOString()}', '${new Date(Date.now() - 172200000).toISOString()}', 'SUCCESS', NULL)
  `);
  
  // Sample errors
  _db.run(`
    INSERT INTO errors (timestamp, script, message, stack_trace) VALUES
    ('${new Date(Date.now() - 604800000).toISOString()}', 'log-query', 'Connection timeout', 'at connect() (db.js:45:12)'),
    ('${new Date(Date.now() - 1209600000).toISOString()}', 'dashboard-summary', 'Invalid JSON', 'Error: Unexpected token in JSON at position 0')
  `);
  
  _schema = null;
}

/**
 * Initialize sql.js asynchronously and create in-memory database.
 */
async function initSqlJsFallback() {
  if (_db) return; // Already initialized
  
  // Wait for sql.js to be loaded
  await sqlJsPromise;
  
  if (sql) {
    _createInMemoryDb();
    _dbPath = '(in-memory)';
    return;
  }
  
  throw new Error('sql.js not available');
}

/**
 * Initialize sql.js and load data from a real SQLite file.
 * Useful when better-sqlite3 fails but we still have the db file.
 */
async function initSqlJsFallbackWithFile(dbPath, opts) {
  if (_db) return; // Already initialized
  
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }

  // Wait for sql.js to be loaded
  await sqlJsPromise;
  
  if (!sql) {
    throw new Error('sql.js not available');
  }

  try {
    // Read the binary database file
    const fileBuffer = fs.readFileSync(dbPath);
    
    // Load it into sql.js
    _db = new sql.Database(fileBuffer);
    _usesSqlJs = true;
    _dbPath = dbPath;
    _schema = null; // invalidate cache
    
    return;
  } catch (err) {
    throw new Error(`Failed to load database file into sql.js: ${err.message}`);
  }
}

function close() {
  if (_db) {
    try { 
      _db.close();
    } catch { /* already closed */ }
    _db = null;
    _dbPath = null;
    _schema = null;
    _usesSqlJs = false;
  }
}

function getDbPath() {
  return _dbPath;
}

function isConnected() {
  return _db !== null;
}

// --- Schema introspection ---

/**
 * Returns the cached schema map. Rebuilds on first call or after invalidation.
 * { tableName: [ { name, type, notnull, dflt_value, pk } ] }
 */
function _getSchema() {
  if (_schema) return _schema;
  if (!_db) throw new Error('Database not connected');

  _schema = {};
  const tables = getTables();
  for (const t of tables) {
    if (_usesSqlJs) {
      const result = _db.exec(`PRAGMA table_info("${t}")`);
      _schema[t] = result.length > 0 ? _parseTableInfo(result[0]) : [];
    } else {
      _schema[t] = _db.pragma(`table_info("${t}")`);
    }
  }
  return _schema;
}

/**
 * Parse PRAGMA table_info result from sql.js format to match better-sqlite3.
 */
function _parseTableInfo(result) {
  if (!result?.values) return [];
  const cid = result.columns.indexOf('cid');
  const name = result.columns.indexOf('name');
  const type = result.columns.indexOf('type');
  const notnull = result.columns.indexOf('notnull');
  const dflt_value = result.columns.indexOf('dflt_value');
  const pk = result.columns.indexOf('pk');
  
  return result.values.map((row) => ({
    cid: row[cid],
    name: row[name],
    type: row[type],
    notnull: row[notnull],
    dflt_value: row[dflt_value],
    pk: row[pk]
  }));
}

/**
 * Validate that a table name exists in the actual schema.
 */
function _assertTable(table) {
  const schema = _getSchema();
  if (!schema[table]) {
    throw new Error(`Unknown table: ${table}`);
  }
}

/**
 * Validate that a column exists in the given table.
 */
function _assertColumn(table, column) {
  _assertTable(table);
  const cols = _getSchema()[table];
  if (!cols.some((c) => c.name === column)) {
    throw new Error(`Unknown column "${column}" in table "${table}"`);
  }
}

// --- Public helpers ---

/**
 * List all user tables (excludes sqlite_ internal tables).
 */
function getTables() {
  if (!_db) throw new Error('Database not connected');
  
  if (_usesSqlJs) {
    const result = _db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    if (result.length === 0) return [];
    const columns = result[0].columns;
    const values = result[0].values;
    const nameIdx = columns.indexOf('name');
    return values.map((row) => row[nameIdx]);
  }
  
  const rows = _db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();
  return rows.map((r) => r.name);
}

/**
 * Get column info for a table.
 */
function getTableInfo(table) {
  _assertTable(table);
  return _getSchema()[table];
}

/**
 * Row count for a single table.
 */
function getRowCount(table) {
  _assertTable(table);
  if (_usesSqlJs) {
    const result = _db.exec(`SELECT COUNT(*) AS count FROM "${table}"`);
    if (result.length === 0) return 0;
    const countIdx = result[0].columns.indexOf('count');
    return result[0].values[0][countIdx];
  }
  const row = _db.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get();
  return row.count;
}

/**
 * Dashboard stats: row count + latest timestamp per table.
 * Tries common timestamp columns (timestamp, start_time, backup_date, processing_timestamp).
 */
function _getLatestTimestamp(table, colNames) {
  const TIMESTAMP_COLS = ['timestamp', 'start_time', 'backup_date', 'processing_timestamp', 'invoice_date'];
  for (const tsCol of TIMESTAMP_COLS) {
    if (!colNames.has(tsCol)) continue;
    if (_usesSqlJs) {
      const result = _db.exec(`SELECT "${tsCol}" AS ts FROM "${table}" ORDER BY "${tsCol}" DESC LIMIT 1`);
      if (result.length > 0 && result[0].values.length > 0) return result[0].values[0][0];
    } else {
      const row = _db.prepare(`SELECT "${tsCol}" AS ts FROM "${table}" ORDER BY "${tsCol}" DESC LIMIT 1`).get();
      if (row?.ts) return row.ts;
    }
    break;
  }
  return null;
}

function getTableStats() {
  const tables = getTables();
  const stats = [];

  for (const table of tables) {
    const count = getRowCount(table);
    const cols = _getSchema()[table];
    const colNames = new Set(cols.map((c) => c.name));
    const latest = _getLatestTimestamp(table, colNames);
    stats.push({ table, count, latest });
  }

  return stats;
}

const _ALLOWED_OPS = new Set(['LIKE', '=', '!=', '>', '<', '>=', '<=']);

function _buildOrderClause(table, opts) {
  if (!opts.sortCol) return '';
  _assertColumn(table, opts.sortCol);
  const dir = opts.sortDir === 'DESC' ? 'DESC' : 'ASC';
  return ` ORDER BY "${opts.sortCol}" ${dir}`;
}

function _buildSqlJsWhere(table, filters) {
  if (!Array.isArray(filters) || filters.length === 0) return '';
  const conditions = [];
  for (const f of filters) {
    if (!f.column || f.value === undefined) continue;
    _assertColumn(table, f.column);
    const op = _ALLOWED_OPS.has(f.operator) ? f.operator : '=';
    if (op === 'LIKE') {
      const escapedVal = String(f.value).replaceAll("'", "''");
      conditions.push(`"${f.column}" LIKE '%${escapedVal}%'`);
    } else {
      const val = typeof f.value === 'number' ? f.value : `'${String(f.value).replaceAll("'", "''")}'`;
      conditions.push(`"${f.column}" ${op} ${val}`);
    }
  }
  return conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
}

function _sqlJsResultToObjects(result) {
  if (result.length === 0) return [];
  const columns = result[0].columns;
  return result[0].values.map((row) => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

function _querySqlJs(table, opts, limit, offset) {
  const orderClause = _buildOrderClause(table, opts);
  const whereClause = _buildSqlJsWhere(table, opts.filters);

  const countResult = _db.exec(`SELECT COUNT(*) AS total FROM "${table}"${whereClause}`);
  const total = countResult.length > 0 ? countResult[0].values[0][0] : 0;

  const result = _db.exec(`SELECT * FROM "${table}"${whereClause}${orderClause} LIMIT ${limit} OFFSET ${offset}`);
  return { rows: _sqlJsResultToObjects(result), total };
}

function _buildNativeWhere(table, filters) {
  const params = {};
  if (!Array.isArray(filters) || filters.length === 0) return { whereClause: '', params };
  const conditions = [];
  for (let i = 0; i < filters.length; i++) {
    const f = filters[i];
    if (!f.column || f.value === undefined) continue;
    _assertColumn(table, f.column);
    const op = _ALLOWED_OPS.has(f.operator) ? f.operator : '=';
    const paramKey = `filter_${i}`;
    if (op === 'LIKE') {
      conditions.push(`"${f.column}" LIKE @${paramKey}`);
      params[paramKey] = `%${f.value}%`;
    } else {
      conditions.push(`"${f.column}" ${op} @${paramKey}`);
      params[paramKey] = f.value;
    }
  }
  const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

/**
 * Paginated, sorted, filtered read from a table.
 *
 * @param {string} table
 * @param {object} opts
 * @param {number} opts.offset — default 0
 * @param {number} opts.limit — default 25, max 500
 * @param {string} opts.sortCol — column name to sort by
 * @param {'ASC'|'DESC'} opts.sortDir — sort direction
 * @param {object[]} opts.filters — [ { column, operator, value } ]
 *   operator: 'LIKE', '=', '!=', '>', '<', '>=', '<='
 * @returns {{ rows: object[], total: number }}
 */
function queryRows(table, opts = {}) {
  _assertTable(table);

  const offset = Math.max(0, Number.parseInt(opts.offset, 10) || 0);
  const limit = Math.min(500, Math.max(1, Number.parseInt(opts.limit, 10) || 25));

  if (_usesSqlJs) {
    return _querySqlJs(table, opts, limit, offset);
  }

  const orderClause = _buildOrderClause(table, opts);
  const { whereClause, params } = _buildNativeWhere(table, opts.filters);

  const totalRow = _db.prepare(`SELECT COUNT(*) AS total FROM "${table}"${whereClause}`).get(params);
  const total = totalRow.total;

  const rows = _db.prepare(
    `SELECT * FROM "${table}"${whereClause}${orderClause} LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit, offset });

  return { rows, total };
}

const FORBIDDEN_SQL_KEYWORDS = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'REPLACE',
  'TRUNCATE', 'ATTACH', 'DETACH', 'VACUUM', 'REINDEX', 'ANALYZE',
  'LOAD_EXTENSION', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE',
]);

function normalizeReadOnlySql(sql) {
  let normalized = sql.trim();
  while (normalized.endsWith(';')) {
    normalized = normalized.slice(0, -1).trimEnd();
  }
  if (!normalized) throw new Error('Query must be a non-empty string');
  return normalized;
}

function getLeadingKeyword(sql) {
  let keyword = '';
  for (const char of sql) {
    const isLetter = (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char === '_';
    if (!isLetter) break;
    keyword += char;
  }
  return keyword.toUpperCase();
}

function getSqlKeywords(sql) {
  const keywords = [];
  let current = '';

  for (const char of sql) {
    const isLetter = (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char === '_';
    if (isLetter) {
      current += char.toUpperCase();
      continue;
    }
    if (current) {
      keywords.push(current);
      current = '';
    }
  }

  if (current) keywords.push(current);
  return keywords;
}

function validateReadOnlySql(sql) {
  const normalized = normalizeReadOnlySql(sql);
  const leadingKeyword = getLeadingKeyword(normalized);
  if (!['SELECT', 'WITH', 'PRAGMA'].includes(leadingKeyword)) {
    throw new Error('Only SELECT, WITH, and PRAGMA queries are allowed');
  }
  if (normalized.includes('--') || normalized.includes('/*') || normalized.includes('*/')) {
    throw new Error('SQL comments are not allowed');
  }
  if (normalized.includes(';')) {
    throw new Error('Only a single SQL statement is allowed');
  }
  if (getSqlKeywords(normalized).some((keyword) => FORBIDDEN_SQL_KEYWORDS.has(keyword))) {
    throw new Error('Query contains forbidden statements');
  }
  return normalized;
}

/**
 * Execute an arbitrary read-only SQL query.
 * Only SELECT and PRAGMA statements are allowed.
 *
 * @param {string} sql — the SQL string to execute
 * @returns {{ columns: string[], rows: object[], rowCount: number }}
 */
function runReadOnlyQuery(sql) {
  if (!_db) throw new Error('Database not connected');
  if (!sql || typeof sql !== 'string') throw new Error('Query must be a non-empty string');

  const trimmed = validateReadOnlySql(sql);

  if (_usesSqlJs) {
    // For sql.js, just execute the query
    try {
      const result = _db.exec(trimmed);
      if (result.length === 0) return { columns: [], rows: [], rowCount: 0 };
      
      const columns = result[0].columns;
      const rows = result[0].values.map((row) => {
        const obj = {};
        columns.forEach((col, i) => {
          obj[col] = row[i];
        });
        return obj;
      });
      
      return { columns, rows, rowCount: rows.length };
    } catch (err) {
      throw new Error(`Query error: ${err.message}`);
    }
  }

  // Execute in a read-only transaction for better-sqlite3
  const prevQueryOnly = _db.pragma('query_only');
  _db.pragma('query_only = ON');

  try {
    const stmt = _db.prepare(trimmed);
    if (!stmt.reader) {
      throw new Error('Only read-only statements are allowed');
    }
    const rows = stmt.all();
    const columns = stmt.columns().map((c) => c.name);
    return { columns, rows, rowCount: rows.length };
  } finally {
    // Restore previous state
    _db.pragma(`query_only = ${prevQueryOnly[0]?.query_only ?? 'OFF'}`);
  }
}

/**
 * Export query results as a CSV string.
 *
 * @param {string} sql — SELECT query
 * @returns {string} CSV text
 */
function exportCsv(sql) {
  const result = runReadOnlyQuery(sql);

  const escapeField = (val) => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replaceAll('"', '""')}"`;
    }
    return s;
  };

  const header = result.columns.map(escapeField).join(',');
  const lines = result.rows.map((row) =>
    result.columns.map((col) => escapeField(row[col])).join(',')
  );

  return [header, ...lines].join('\n');
}

module.exports = {
  open,
  close,
  getDbPath,
  isConnected,
  getTables,
  getTableInfo,
  getRowCount,
  getTableStats,
  queryRows,
  runReadOnlyQuery,
  exportCsv,
  initSqlJsFallback,
  initSqlJsFallbackWithFile,
};
