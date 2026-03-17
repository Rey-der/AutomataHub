/**
 * Script Runner — ScriptPersistence
 * SQLite persistence for topics and script-topic associations via sql.js.
 * Uses sql.js (WASM-based, no native compilation) for compatibility.
 * DB lives in memory with periodic flush to disk every 60s.
 */

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const initSqlJs = require('sql.js');

const DB_DIR = path.join(app.getPath('userData'), 'script-runner');
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
      console.log('[script-runner] Database flushed');
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
}

module.exports = { ScriptPersistence };
