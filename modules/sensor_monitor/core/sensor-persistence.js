/**
 * SensorPersistence — SQLite-backed storage for sensor data.
 * Uses sql.js (WASM) for Electron compatibility.
 */

const path = require('node:path');
const fs = require('node:fs');

const DB_FILENAME = 'sensor-monitor.sqlite';

class SensorPersistence {
  constructor() {
    this._db = null;
    this._dbPath = null;
  }

  async init(userDataDir) {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();

    const dir = userDataDir || path.join(__dirname, '..');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this._dbPath = path.join(dir, DB_FILENAME);
    if (fs.existsSync(this._dbPath)) {
      const buf = fs.readFileSync(this._dbPath);
      this._db = new SQL.Database(buf);
    } else {
      this._db = new SQL.Database();
    }

    this._createTables();
    console.log(`[sensor-monitor] Database ready at ${this._dbPath}`);
  }

  _createTables() {
    this._db.run(`
      CREATE TABLE IF NOT EXISTS sensors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'generic',
        host TEXT NOT NULL,
        port INTEGER,
        protocol TEXT NOT NULL DEFAULT 'snmp',
        unit TEXT DEFAULT '',
        interval_s INTEGER DEFAULT 60,
        enabled INTEGER DEFAULT 1,
        status TEXT DEFAULT 'unknown',
        last_value REAL,
        last_seen TEXT,
        added_at TEXT NOT NULL,
        metadata TEXT DEFAULT '{}'
      )
    `);

    this._db.run(`
      CREATE TABLE IF NOT EXISTS readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sensor_id TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT DEFAULT '',
        timestamp TEXT NOT NULL,
        FOREIGN KEY (sensor_id) REFERENCES sensors(id)
      )
    `);

    this._db.run(
      'CREATE INDEX IF NOT EXISTS idx_readings_sensor ON readings(sensor_id, timestamp)'
    );

    this._db.run(`
      CREATE TABLE IF NOT EXISTS thresholds (
        id TEXT PRIMARY KEY,
        sensor_id TEXT NOT NULL,
        metric TEXT DEFAULT 'value',
        operator TEXT DEFAULT '>',
        value REAL NOT NULL,
        severity TEXT DEFAULT 'warning',
        enabled INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY (sensor_id) REFERENCES sensors(id)
      )
    `);

    this._db.run(`
      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        sensor_id TEXT NOT NULL,
        threshold_id TEXT,
        message TEXT NOT NULL,
        severity TEXT DEFAULT 'warning',
        value REAL,
        acknowledged INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (sensor_id) REFERENCES sensors(id)
      )
    `);

    this._db.run(
      'CREATE INDEX IF NOT EXISTS idx_alerts_sensor ON alerts(sensor_id, created_at)'
    );
  }

  _save() {
    if (!this._db || !this._dbPath) return;
    const data = this._db.export();
    fs.writeFileSync(this._dbPath, Buffer.from(data));
  }

  // --- Sensors ---

  upsertSensor(s) {
    this._db.run(
      `INSERT OR REPLACE INTO sensors (id, name, type, host, port, protocol, unit, interval_s, enabled, status, last_value, last_seen, added_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.id, s.name, s.type, s.host, s.port, s.protocol, s.unit, s.interval_s,
       s.enabled ? 1 : 0, s.status, s.last_value, s.last_seen, s.added_at,
       JSON.stringify(s.metadata || {})]
    );
    this._save();
  }

  removeSensor(id) {
    this._db.run('DELETE FROM readings WHERE sensor_id = ?', [id]);
    this._db.run('DELETE FROM thresholds WHERE sensor_id = ?', [id]);
    this._db.run('DELETE FROM alerts WHERE sensor_id = ?', [id]);
    this._db.run('DELETE FROM sensors WHERE id = ?', [id]);
    this._save();
  }

  loadAllSensors() {
    const stmt = this._db.prepare('SELECT * FROM sensors');
    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      row.enabled = row.enabled === 1;
      row.metadata = JSON.parse(row.metadata || '{}');
      rows.push(row);
    }
    stmt.free();
    return rows;
  }

  // --- Readings ---

  insertReading(r) {
    this._db.run(
      'INSERT INTO readings (sensor_id, value, unit, timestamp) VALUES (?, ?, ?, ?)',
      [r.sensor_id, r.value, r.unit, r.timestamp]
    );
    this._save();
  }

  getReadings(sensorId, limit = 100) {
    const stmt = this._db.prepare(
      'SELECT * FROM readings WHERE sensor_id = ? ORDER BY timestamp DESC LIMIT ?'
    );
    stmt.bind([sensorId, limit]);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows.reverse();
  }

  // --- Thresholds ---

  upsertThreshold(t) {
    this._db.run(
      `INSERT OR REPLACE INTO thresholds (id, sensor_id, metric, operator, value, severity, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.id, t.sensor_id, t.metric, t.operator, t.value, t.severity, t.enabled ? 1 : 0, t.created_at]
    );
    this._save();
  }

  removeThreshold(id) {
    this._db.run('DELETE FROM thresholds WHERE id = ?', [id]);
    this._save();
  }

  loadAllThresholds() {
    const stmt = this._db.prepare('SELECT * FROM thresholds');
    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      row.enabled = row.enabled === 1;
      rows.push(row);
    }
    stmt.free();
    return rows;
  }

  // --- Alerts ---

  insertAlert(a) {
    this._db.run(
      `INSERT INTO alerts (id, sensor_id, threshold_id, message, severity, value, acknowledged, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [a.id, a.sensor_id, a.threshold_id, a.message, a.severity, a.value, a.acknowledged ? 1 : 0, a.created_at]
    );
    this._save();
  }

  acknowledgeAlert(id) {
    this._db.run('UPDATE alerts SET acknowledged = 1 WHERE id = ?', [id]);
    this._save();
  }

  loadAllAlerts(limit = 500) {
    const stmt = this._db.prepare(
      'SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?'
    );
    stmt.bind([limit]);
    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      row.acknowledged = row.acknowledged === 1;
      rows.push(row);
    }
    stmt.free();
    return rows.reverse();
  }

  close() {
    if (this._db) {
      this._save();
      this._db.close();
      this._db = null;
    }
  }
}

module.exports = { SensorPersistence };
