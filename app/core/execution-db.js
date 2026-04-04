/**
 * Execution DB — schema + write API for the hub-level smart_desktop.db.
 *
 * Creates the RPA analytics tables (execution_tracking, automation_logs,
 * errors) on first use so the SQL Monitor analytics engine can query real data.
 *
 * Uses better-sqlite3 directly (not sql.js) because it writes to an on-disk
 * file that SQL Monitor reads through db-bridge.
 */

const fs = require('node:fs');
const path = require('node:path');

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

const SCHEMA_VERSION = 1;

class ExecutionDb {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  // ------------------------------------------------------------------
  //  Lifecycle
  // ------------------------------------------------------------------

  init() {
    if (!Database) {
      console.warn('[execution-db] better-sqlite3 not available — execution tracking disabled');
      return false;
    }
    if (!this.dbPath) {
      console.warn('[execution-db] No database path — execution tracking disabled');
      return false;
    }

    // Ensure the parent directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    try {
      this.db = new Database(this.dbPath, { fileMustExist: false });
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this._migrate();
      return true;
    } catch (err) {
      console.error('[execution-db] Failed to open:', err.message);
      this.db = null;
      return false;
    }
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ------------------------------------------------------------------
  //  Schema migration
  // ------------------------------------------------------------------

  _getColumnNames(table) {
    return new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
  }

  _migrateExecutionTracking() {
    const hasTable = this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='execution_tracking'"
    ).get();

    if (hasTable) {
      this.db.exec(`
        ALTER TABLE execution_tracking RENAME TO _execution_tracking_v0;

        CREATE TABLE execution_tracking (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          script          TEXT    NOT NULL,
          variant         TEXT    DEFAULT 'js',
          start_time      TEXT    NOT NULL,
          end_time        TEXT,
          status          TEXT,
          exit_code       INTEGER,
          error_message   TEXT,
          trigger_source  TEXT    DEFAULT 'manual',
          chain_id        TEXT,
          chain_step      INTEGER,
          schedule_id     TEXT,
          attempt         INTEGER DEFAULT 1,
          max_attempts    INTEGER DEFAULT 1,
          runtime_ms      INTEGER,
          stdout_lines    INTEGER DEFAULT 0,
          stderr_lines    INTEGER DEFAULT 0,
          script_hash     TEXT,
          created_at      TEXT    DEFAULT (datetime('now','localtime'))
        );

        INSERT INTO execution_tracking (id, script, start_time, end_time, status, error_message)
          SELECT id, script, start_time, end_time, status, error_message
          FROM _execution_tracking_v0;

        DROP TABLE _execution_tracking_v0;
      `);
    } else {
      this.db.exec(`
        CREATE TABLE execution_tracking (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          script          TEXT    NOT NULL,
          variant         TEXT    DEFAULT 'js',
          start_time      TEXT    NOT NULL,
          end_time        TEXT,
          status          TEXT,
          exit_code       INTEGER,
          error_message   TEXT,
          trigger_source  TEXT    DEFAULT 'manual',
          chain_id        TEXT,
          chain_step      INTEGER,
          schedule_id     TEXT,
          attempt         INTEGER DEFAULT 1,
          max_attempts    INTEGER DEFAULT 1,
          runtime_ms      INTEGER,
          stdout_lines    INTEGER DEFAULT 0,
          stderr_lines    INTEGER DEFAULT 0,
          script_hash     TEXT,
          created_at      TEXT    DEFAULT (datetime('now','localtime'))
        );
      `);
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_exec_script  ON execution_tracking(script);
      CREATE INDEX IF NOT EXISTS idx_exec_start   ON execution_tracking(start_time);
      CREATE INDEX IF NOT EXISTS idx_exec_status  ON execution_tracking(status);
      CREATE INDEX IF NOT EXISTS idx_exec_trigger ON execution_tracking(trigger_source);
    `);
  }

  _migrateAutomationLogs() {
    const hasTable = this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='automation_logs'"
    ).get();

    if (hasTable) {
      const cols = this._getColumnNames('automation_logs');
      if (!cols.has('level'))        this.db.exec("ALTER TABLE automation_logs ADD COLUMN level TEXT DEFAULT 'INFO'");
      if (!cols.has('execution_id')) this.db.exec('ALTER TABLE automation_logs ADD COLUMN execution_id INTEGER REFERENCES execution_tracking(id) ON DELETE SET NULL');
    } else {
      this.db.exec(`
        CREATE TABLE automation_logs (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp       TEXT    NOT NULL,
          script          TEXT    NOT NULL,
          level           TEXT    DEFAULT 'INFO',
          status          TEXT,
          message         TEXT,
          metadata        TEXT,
          execution_id    INTEGER REFERENCES execution_tracking(id) ON DELETE SET NULL,
          created_at      TEXT    DEFAULT (datetime('now','localtime'))
        );
      `);
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON automation_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_script    ON automation_logs(script);
      CREATE INDEX IF NOT EXISTS idx_logs_execution ON automation_logs(execution_id);
    `);
  }

  _migrateErrors() {
    const hasTable = this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='errors'"
    ).get();

    if (hasTable) {
      const cols = this._getColumnNames('errors');
      if (!cols.has('error_code'))   this.db.exec('ALTER TABLE errors ADD COLUMN error_code TEXT');
      if (!cols.has('severity'))     this.db.exec("ALTER TABLE errors ADD COLUMN severity TEXT DEFAULT 'error'");
      if (!cols.has('execution_id')) this.db.exec('ALTER TABLE errors ADD COLUMN execution_id INTEGER REFERENCES execution_tracking(id) ON DELETE SET NULL');
    } else {
      this.db.exec(`
        CREATE TABLE errors (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp       TEXT    NOT NULL,
          script          TEXT    NOT NULL,
          message         TEXT    NOT NULL,
          stack_trace     TEXT,
          error_code      TEXT,
          severity        TEXT    DEFAULT 'error',
          execution_id    INTEGER REFERENCES execution_tracking(id) ON DELETE SET NULL,
          created_at      TEXT    DEFAULT (datetime('now','localtime'))
        );
      `);
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_errors_timestamp ON errors(timestamp);
      CREATE INDEX IF NOT EXISTS idx_errors_script    ON errors(script);
      CREATE INDEX IF NOT EXISTS idx_errors_execution ON errors(execution_id);
    `);
  }

  _migrate() {
    const version = this.db.pragma('user_version', { simple: true });

    if (version < 1) {
      this.db.exec('BEGIN');
      try {
        this._migrateExecutionTracking();
        this._migrateAutomationLogs();
        this._migrateErrors();

        // --- schedule_audit (new table) ---
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS schedule_audit (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            schedule_id     TEXT    NOT NULL,
            script          TEXT    NOT NULL,
            cron            TEXT,
            fired_at        TEXT    NOT NULL,
            result_status   TEXT,
            execution_id    INTEGER REFERENCES execution_tracking(id) ON DELETE SET NULL,
            created_at      TEXT    DEFAULT (datetime('now','localtime'))
          );
          CREATE INDEX IF NOT EXISTS idx_sched_script ON schedule_audit(script);
          CREATE INDEX IF NOT EXISTS idx_sched_fired  ON schedule_audit(fired_at);
        `);

        this.db.exec('PRAGMA user_version = 1');
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }
  }

  // ------------------------------------------------------------------
  //  Write API
  // ------------------------------------------------------------------

  /**
   * Insert a new execution record when a script starts.
   * Returns the row id for later updates.
   */
  insertExecution({ script, variant, startTime, triggerSource, chainId, chainStep, scheduleId, attempt, maxAttempts, scriptHash }) {
    if (!this.db) return null;
    try {
      const stmt = this.db.prepare(`
        INSERT INTO execution_tracking
          (script, variant, start_time, status, trigger_source, chain_id, chain_step, schedule_id, attempt, max_attempts, script_hash)
        VALUES (?, ?, ?, 'RUNNING', ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        script, variant || 'js', startTime,
        triggerSource || 'manual',
        chainId || null, chainStep || null, scheduleId || null,
        attempt || 1, maxAttempts || 1, scriptHash || null,
      );
      return result.lastInsertRowid;
    } catch (err) {
      console.error('[execution-db] insertExecution failed:', err.message);
      return null;
    }
  }

  /**
   * Update an execution record when a script completes.
   */
  completeExecution(rowId, { endTime, status, exitCode, errorMessage, runtimeMs, stdoutLines, stderrLines }) {
    if (!this.db || !rowId) return;
    try {
      this.db.prepare(`
        UPDATE execution_tracking
        SET end_time = ?, status = ?, exit_code = ?, error_message = ?,
            runtime_ms = ?, stdout_lines = ?, stderr_lines = ?
        WHERE id = ?
      `).run(endTime, status, exitCode, errorMessage || null, runtimeMs, stdoutLines || 0, stderrLines || 0, rowId);
    } catch (err) {
      console.error('[execution-db] completeExecution failed:', err.message);
    }
  }

  /**
   * Insert log entry.
   */
  insertLog({ timestamp, script, level, status, message, metadata, executionId }) {
    if (!this.db) return;
    try {
      this.db.prepare(`
        INSERT INTO automation_logs (timestamp, script, level, status, message, metadata, execution_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(timestamp, script, level || 'INFO', status || null, message, metadata || null, executionId || null);
    } catch (err) {
      console.error('[execution-db] insertLog failed:', err.message);
    }
  }

  /**
   * Insert error entry.
   */
  insertError({ timestamp, script, message, stackTrace, errorCode, severity, executionId }) {
    if (!this.db) return;
    try {
      this.db.prepare(`
        INSERT INTO errors (timestamp, script, message, stack_trace, error_code, severity, execution_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(timestamp, script, message, stackTrace || null, errorCode || null, severity || 'error', executionId || null);
    } catch (err) {
      console.error('[execution-db] insertError failed:', err.message);
    }
  }
}

module.exports = { ExecutionDb };
