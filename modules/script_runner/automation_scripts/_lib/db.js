/**
 * Shared database helper for automation scripts.
 *
 * Uses sql.js (WASM) instead of better-sqlite3 because child processes
 * spawned by the script executor run in regular Node.js, not Electron,
 * and the native better-sqlite3 binary is compiled for Electron's target.
 *
 * Usage:
 *   const { openDatabase } = require('../_lib/db');
 *   (async () => {
 *     const db = await openDatabase();
 *     const rows = db.all('SELECT * FROM errors');
 *     db.close();
 *   })();
 */

const fs = require('node:fs');
const path = require('node:path');

const TABLE_SCHEMAS = `
  CREATE TABLE IF NOT EXISTS automation_logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    script    TEXT    NOT NULL,
    status    TEXT    NOT NULL CHECK (status IN ('INFO', 'SUCCESS', 'ERROR')),
    message   TEXT    NOT NULL,
    metadata  TEXT
  );

  CREATE TABLE IF NOT EXISTS backup_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    backup_date     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    folders         TEXT    NOT NULL,
    files_copied    INTEGER NOT NULL DEFAULT 0,
    files_skipped   INTEGER NOT NULL DEFAULT 0,
    backup_location TEXT    NOT NULL,
    status          TEXT    NOT NULL CHECK (status IN ('SUCCESS', 'PARTIAL', 'FAIL'))
  );

  CREATE TABLE IF NOT EXISTS errors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    script      TEXT NOT NULL,
    timestamp   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    message     TEXT NOT NULL,
    stack_trace TEXT
  );

  CREATE TABLE IF NOT EXISTS execution_tracking (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    script        TEXT NOT NULL,
    start_time    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    end_time      TEXT,
    status        TEXT CHECK (status IN ('SUCCESS', 'FAIL')),
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS file_processing_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT NOT NULL,
    dest_path   TEXT,
    file_type   TEXT NOT NULL,
    script      TEXT NOT NULL,
    operation   TEXT NOT NULL CHECK (operation IN ('sort', 'move', 'skip', 'delete', 'backup')),
    timestamp   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor               TEXT NOT NULL,
    amount               REAL NOT NULL,
    invoice_date         TEXT NOT NULL,
    file_path            TEXT NOT NULL,
    processing_timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`;

/**
 * Opens the SQLite database from SMART_DESKTOP_DB env var.
 * Creates tables if they don't exist.
 *
 * Returns an object with: all(), get(), run(), save(), close()
 */
async function openDatabase() {
  const dbPath = process.env.SMART_DESKTOP_DB;
  if (!dbPath) {
    console.error('ERROR: SMART_DESKTOP_DB environment variable is not set.');
    process.exit(1);
  }

  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  let db;
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new SQL.Database();
  }

  db.run(TABLE_SCHEMAS);

  function save() {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }

  // Save after creating tables (in case new tables were added)
  save();

  return {
    /**
     * Execute a query and return all matching rows as objects.
     */
    all(sql, params) {
      const stmt = db.prepare(sql);
      if (params) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },

    /**
     * Execute a query and return the first matching row as an object, or null.
     */
    get(sql, params) {
      const stmt = db.prepare(sql);
      if (params) stmt.bind(params);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return row;
    },

    /**
     * Execute a statement (INSERT, UPDATE, DELETE, etc.).
     */
    run(sql, params) {
      db.run(sql, params);
    },

    /**
     * Write the in-memory database back to disk.
     * Must be called after any write operations.
     */
    save,

    /**
     * Close the database. Does NOT auto-save.
     */
    close() {
      db.close();
    },
  };
}

module.exports = { openDatabase };
