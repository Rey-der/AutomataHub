/**
 * Script Runner — ScriptPersistence
 * SQLite persistence for topics and script-topic associations via sql.js.
 * Uses sql.js (WASM-based, no native compilation) for compatibility.
 * DB lives in memory with periodic flush to disk every 60s.
 */

const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');

const DB_DIR = path.dirname(__dirname);  // modules/script_runner/
const DB_FILE = path.join(DB_DIR, 'script-runner.sqlite');

const FLUSH_INTERVAL_MS = 60_000;
const SCHEMA_VERSION = 1;

class ScriptPersistence {
  constructor(dbPath = null) {
    this.dbPath = dbPath || DB_FILE;
    this.db = null;
    this.SQL = null;
    this._dirty = false;
    this._flushTimer = null;
  }

  async init() {
    const dbDir = path.dirname(this.dbPath);

    try {
      // Ensure directory exists
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Initialize sql.js
      this.SQL = await initSqlJs();

      // Load existing DB or create new
      if (fs.existsSync(this.dbPath)) {
        try {
          fs.accessSync(this.dbPath, fs.constants.R_OK | fs.constants.W_OK);
        } catch (accessErr) {
          console.error('[script-runner] DB file exists but is not readable/writable:', this.dbPath);
          console.error('[script-runner]   Permission error:', accessErr.message);
          throw accessErr;
        }

        const stat = fs.statSync(this.dbPath);
        if (stat.size === 0) {
          console.warn('[script-runner] DB file is 0 bytes (corrupt/empty), creating fresh database');
          this.db = new this.SQL.Database();
        } else {
          const buffer = fs.readFileSync(this.dbPath);
          this.db = new this.SQL.Database(buffer);
        }
        console.log('[script-runner] Loaded database from:', this.dbPath, `(${stat.size} bytes)`);
      } else {
        this.db = new this.SQL.Database();
        console.log('[script-runner] Created new in-memory database (will flush to', this.dbPath + ')');
      }

      // Create tables if needed
      this._createTables();

      // Periodic flush to disk
      this._startFlushTimer();

      console.log('[script-runner] Persistence initialized');
    } catch (err) {
      console.error('[script-runner] Persistence init failed:', err.message);
      console.error('[script-runner]   DB path:', this.dbPath);
      console.error('[script-runner]   Directory exists:', fs.existsSync(dbDir));
      if (fs.existsSync(this.dbPath)) {
        try {
          const stat = fs.statSync(this.dbPath);
          console.error('[script-runner]   File size:', stat.size, 'bytes');
          console.error('[script-runner]   File mode:', '0o' + (stat.mode & 0o777).toString(8));
        } catch { /* stat failed — already logging the root error */ }
      } else {
        console.error('[script-runner]   DB file does not exist');
      }
      throw err;
    }
  }

  _createTables() {
    try {
      // Topics table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS topics (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT,
          color TEXT DEFAULT '#4A90E2',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      // Script-topic associations
      this.db.run(`
        CREATE TABLE IF NOT EXISTS script_topics (
          script_id TEXT NOT NULL,
          topic_id TEXT NOT NULL,
          position INTEGER DEFAULT 0,
          PRIMARY KEY (script_id, topic_id),
          FOREIGN KEY (topic_id) REFERENCES topics(id)
        )
      `);

      // Script execution hashes (for versioning / "Modified" detection)
      this.db.run(`
        CREATE TABLE IF NOT EXISTS execution_hashes (
          script_id   TEXT PRIMARY KEY,
          script_hash TEXT NOT NULL,
          executed_at TEXT NOT NULL
        )
      `);

      // User-defined chains (ordered sequences of scripts)
      this.db.run(`
        CREATE TABLE IF NOT EXISTS user_chains (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL UNIQUE,
          script_ids TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);

      // User-defined schedules
      this.db.run(`
        CREATE TABLE IF NOT EXISTS schedules (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          target_type TEXT NOT NULL DEFAULT 'script',
          target_id   TEXT NOT NULL,
          cron        TEXT NOT NULL,
          enabled     INTEGER NOT NULL DEFAULT 1,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        )
      `);

      console.log('[script-runner] Tables created/verified');
    } catch (err) {
      console.error('[script-runner] Failed to create tables:', err.message);
      throw err;
    }
  }

  // --- Flush to disk ---

  _startFlushTimer() {
    this._flushTimer = setInterval(() => {
      if (this._dirty) {
        this.flush();
      }
    }, FLUSH_INTERVAL_MS);
  }

  flush() {
    if (!this.db || !this.SQL) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
      this._dirty = false;
    } catch (err) {
      console.error('[script-runner] Flush failed:', err.message);
    }
  }

  close() {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    if (this._dirty) {
      this.flush();
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    console.log('[script-runner] Persistence closed');
  }

  // --- Load Data into Store ---

  _parseRows(result) {
    if (result.length === 0) return [];
    const columns = result[0].columns;
    return result[0].values.map((row) => {
      const obj = {};
      columns.forEach((col, idx) => { obj[col] = row[idx]; });
      return obj;
    });
  }

  async loadIntoStore(store) {
    try {
      const topics = this._parseRows(this.db.exec('SELECT * FROM topics'));
      const assocs = this._parseRows(this.db.exec('SELECT * FROM script_topics'));

      for (const topic of topics) {
        store.addTopic(topic);
      }

      for (const assoc of assocs) {
        if (store.getTopic(assoc.topic_id)) {
          store.associations.set(`${assoc.script_id}:${assoc.topic_id}`, { position: assoc.position });
        }
      }

      console.log(`[script-runner] Loaded ${topics.length} topics, ${assocs.length} associations`);

      // Load user chains into store
      const chains = this._parseRows(this.db.exec('SELECT * FROM user_chains'));
      for (const chain of chains) {
        chain.script_ids = JSON.parse(chain.script_ids || '[]');
        store.addChain(chain);
      }
      console.log(`[script-runner] Loaded ${chains.length} user chains`);

      // Load schedules into store
      const schedules = this._parseRows(this.db.exec('SELECT * FROM schedules'));
      for (const schedule of schedules) {
        schedule.enabled = !!schedule.enabled;
        store.addSchedule(schedule);
      }
      console.log(`[script-runner] Loaded ${schedules.length} schedules`);
    } catch (err) {
      console.error('[script-runner] Failed to load from database:', err.message);
      throw err;
    }
  }

  // --- Save Operations ---

  saveTopic(topic) {
    if (!this.db) throw new Error('[script-runner] Database not initialized');
    const { id, name, description, color } = topic;
    const created_at = topic.created_at || new Date().toISOString();
    const updated_at = topic.updated_at || new Date().toISOString();

    try {
      this.db.run(
        `INSERT OR REPLACE INTO topics (id, name, description, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, name, description || null, color || '#4A90E2', created_at, updated_at]
      );
      this._dirty = true;
    } catch (err) {
      console.error('[script-runner] saveTopic error:', err.message);
      throw err;
    }
  }

  removeTopic(topicId) {
    if (!this.db) throw new Error('[script-runner] Database not initialized');
    try {
      this.db.run('DELETE FROM script_topics WHERE topic_id = ?', [topicId]);
      this.db.run('DELETE FROM topics WHERE id = ?', [topicId]);
      this._dirty = true;
    } catch (err) {
      console.error('[script-runner] removeTopic error:', err.message);
      throw err;
    }
  }

  saveAssociation(scriptId, topicId, position) {
    if (!this.db) throw new Error('[script-runner] Database not initialized');
    try {
      this.db.run(
        `INSERT OR REPLACE INTO script_topics (script_id, topic_id, position)
         VALUES (?, ?, ?)`,
        [scriptId, topicId, position]
      );
      this._dirty = true;
    } catch (err) {
      console.error('[script-runner] saveAssociation error:', err.message);
      throw err;
    }
  }

  removeAssociation(scriptId, topicId) {
    if (!this.db) throw new Error('[script-runner] Database not initialized');
    try {
      this.db.run(
        'DELETE FROM script_topics WHERE script_id = ? AND topic_id = ?',
        [scriptId, topicId]
      );
      this._dirty = true;
    } catch (err) {
      console.error('[script-runner] removeAssociation error:', err.message);
      throw err;
    }
  }

  // --- User Chain Persistence ---

  saveChain(chain) {
    if (!this.db) throw new Error('[script-runner] Database not initialized');
    const { id, name, script_ids, created_at, updated_at } = chain;
    try {
      this.db.run(
        `INSERT OR REPLACE INTO user_chains (id, name, script_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [id, name, JSON.stringify(script_ids || []), created_at, updated_at]
      );
      this._dirty = true;
    } catch (err) {
      console.error('[script-runner] saveChain error:', err.message);
      throw err;
    }
  }

  removeChain(chainId) {
    if (!this.db) throw new Error('[script-runner] Database not initialized');
    try {
      this.db.run('DELETE FROM user_chains WHERE id = ?', [chainId]);
      this._dirty = true;
    } catch (err) {
      console.error('[script-runner] removeChain error:', err.message);
      throw err;
    }
  }

  // --- Script Hash Tracking ---

  saveSchedule(schedule) {
    if (!this.db) throw new Error('[script-runner] Database not initialized');
    const { id, name, target_type, target_id, cron, enabled, created_at, updated_at } = schedule;
    try {
      this.db.run(
        `INSERT OR REPLACE INTO schedules (id, name, target_type, target_id, cron, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name, target_type, target_id, cron, enabled ? 1 : 0, created_at, updated_at]
      );
      this._dirty = true;
    } catch (err) {
      console.error('[script-runner] saveSchedule error:', err.message);
      throw err;
    }
  }

  removeSchedule(scheduleId) {
    if (!this.db) throw new Error('[script-runner] Database not initialized');
    try {
      this.db.run('DELETE FROM schedules WHERE id = ?', [scheduleId]);
      this._dirty = true;
    } catch (err) {
      console.error('[script-runner] removeSchedule error:', err.message);
      throw err;
    }
  }

  saveScriptHash(scriptId, hash) {
    if (!this.db) return;
    try {
      this.db.run(
        `INSERT OR REPLACE INTO execution_hashes (script_id, script_hash, executed_at)
         VALUES (?, ?, ?)`,
        [scriptId, hash, new Date().toISOString()]
      );
      this._dirty = true;
    } catch (err) {
      console.error('[script-runner] saveScriptHash error:', err.message);
    }
  }

  getLastScriptHash(scriptId) {
    if (!this.db) return null;
    try {
      const result = this.db.exec(
        'SELECT script_hash FROM execution_hashes WHERE script_id = ?',
        [scriptId]
      );
      if (result.length > 0 && result[0].values.length > 0) {
        return result[0].values[0][0];
      }
      return null;
    } catch (err) {
      console.error('[script-runner] getLastScriptHash error:', err.message);
      return null;
    }
  }

  getAllLastHashes() {
    if (!this.db) return new Map();
    try {
      const result = this.db.exec('SELECT script_id, script_hash FROM execution_hashes');
      const map = new Map();
      if (result.length > 0) {
        for (const row of result[0].values) {
          map.set(row[0], row[1]);
        }
      }
      return map;
    } catch (err) {
      console.error('[script-runner] getAllLastHashes error:', err.message);
      return new Map();
    }
  }
}

module.exports = { ScriptPersistence };
