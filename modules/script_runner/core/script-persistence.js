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
    try {
      // Ensure directory exists
      if (!fs.existsSync(path.dirname(this.dbPath))) {
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
      }

      // Initialize sql.js
      this.SQL = await initSqlJs();

      // Load existing DB or create new
      if (fs.existsSync(this.dbPath)) {
        const buffer = fs.readFileSync(this.dbPath);
        this.db = new this.SQL.Database(buffer);
        console.log('[script-runner] Loaded database from:', this.dbPath);
      } else {
        this.db = new this.SQL.Database();
        console.log('[script-runner] Created new in-memory database');
      }

      // Create tables if needed
      this._createTables();

      // Periodic flush to disk
      this._startFlushTimer();

      console.log('[script-runner] Persistence initialized');
    } catch (err) {
      console.error('[script-runner] Persistence init failed:', err.message);
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

  async loadIntoStore(store) {
    try {
      const topicsResult = this.db.exec('SELECT * FROM topics');
      const assocResult = this.db.exec('SELECT * FROM script_topics');

      // sql.js returns query results as arrays of arrays with metadata
      if (topicsResult.length > 0) {
        const columns = topicsResult[0].columns;
        for (const row of topicsResult[0].values) {
          const topic = {};
          columns.forEach((col, idx) => {
            topic[col] = row[idx];
          });
          store.addTopic(topic);
        }
      }

      if (assocResult.length > 0) {
        const columns = assocResult[0].columns;
        for (const row of assocResult[0].values) {
          const assoc = {};
          columns.forEach((col, idx) => {
            assoc[col] = row[idx];
          });
          // Add to store if topic exists
          if (store.getTopic(assoc.topic_id)) {
            store.associations.set(`${assoc.script_id}:${assoc.topic_id}`, { position: assoc.position });
          }
        }
      }

      const topicsCount = topicsResult.length > 0 ? topicsResult[0].values.length : 0;
      const assocsCount = assocResult.length > 0 ? assocResult[0].values.length : 0;
      console.log(`[script-runner] Loaded ${topicsCount} topics, ${assocsCount} associations`);

      // Load user chains into store
      const chainsResult = this.db.exec('SELECT * FROM user_chains');
      if (chainsResult.length > 0) {
        const cols = chainsResult[0].columns;
        for (const row of chainsResult[0].values) {
          const chain = {};
          cols.forEach((col, idx) => { chain[col] = row[idx]; });
          chain.script_ids = JSON.parse(chain.script_ids || '[]');
          store.addChain(chain);
        }
      }
      const chainsCount = chainsResult.length > 0 ? chainsResult[0].values.length : 0;
      console.log(`[script-runner] Loaded ${chainsCount} user chains`);

      // Load schedules into store
      const schedulesResult = this.db.exec('SELECT * FROM schedules');
      if (schedulesResult.length > 0) {
        const cols = schedulesResult[0].columns;
        for (const row of schedulesResult[0].values) {
          const schedule = {};
          cols.forEach((col, idx) => { schedule[col] = row[idx]; });
          schedule.enabled = !!schedule.enabled;
          store.addSchedule(schedule);
        }
      }
      const schedulesCount = schedulesResult.length > 0 ? schedulesResult[0].values.length : 0;
      console.log(`[script-runner] Loaded ${schedulesCount} schedules`);
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
