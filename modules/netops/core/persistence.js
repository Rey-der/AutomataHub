/**
 * NetOps Persistence — SQLite storage via sql.js (in-memory DB + file flush).
 *
 * sql.js runs entirely in JS/WASM with no native add-ons, so it works
 * regardless of Electron's Node ABI version.  The tradeoff is that the DB
 * lives in memory and must be explicitly exported to disk:
 *   • periodic flush every 60 s (if dirty)
 *   • flush on close / app-quit
 *
 * Schema is versioned with PRAGMA user_version — future migrations just add
 * another `if (version < N)` block in _migrate().
 */

const fs = require('node:fs');
const path = require('node:path');

const DB_DIR = path.dirname(__dirname);  // modules/netops/
const DB_FILE = path.join(DB_DIR, 'netops.sqlite');

const SCHEMA_VERSION = 4;

const FLUSH_INTERVAL_MS = 60_000;

/** Whitelist of columns that may be SET via updateHost(). */
const HOST_COLUMNS = new Set([
  'hostname', 'ip', 'port', 'protocol', 'alias',
  'enabled', 'last_status', 'last_check',
  'url', 'expected_status', 'keyword', 'expected_ip', 'record_type',
]);

class NetOpsPersistence {
  constructor(dbPath) {
    this.dbPath = dbPath || DB_FILE;
    this.db = null;
    this._dirty = false;
    this._flushTimer = null;
    this._pruneTimer = null;
    this.retentionRawDays = 7;
    this.retentionAvgDays = 30;
  }

  // -------------------------------------------------------------------
  //  Lifecycle
  // -------------------------------------------------------------------

  async init() {
    if (!fs.existsSync(path.dirname(this.dbPath))) {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }

    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();

    if (fs.existsSync(this.dbPath)) {
      const buf = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buf);
    } else {
      this.db = new SQL.Database();
    }

    this._migrate();

    // Periodic flush
    this._flushTimer = setInterval(() => {
      if (this._dirty) this.flush();
    }, FLUSH_INTERVAL_MS);

    // Daily prune (also runs once at startup)
    this.prune();
    this._pruneTimer = setInterval(() => this.prune(), 86_400_000);
  }

  close() {
    if (this._flushTimer) { clearInterval(this._flushTimer); this._flushTimer = null; }
    if (this._pruneTimer) { clearInterval(this._pruneTimer); this._pruneTimer = null; }
    this.flush();
    if (this.db) { this.db.close(); this.db = null; }
  }

  // -------------------------------------------------------------------
  //  Schema migration
  // -------------------------------------------------------------------

  _migrate() {
    const rows = this.db.exec('PRAGMA user_version');
    const version = rows.length ? rows[0].values[0][0] : 0;

    if (version < 1) {
      this.db.run(`CREATE TABLE IF NOT EXISTS monitored_hosts (
        id INTEGER PRIMARY KEY,
        hostname TEXT NOT NULL,
        ip TEXT,
        port INTEGER DEFAULT 0,
        protocol TEXT DEFAULT 'ping',
        alias TEXT,
        enabled INTEGER DEFAULT 1,
        last_status TEXT DEFAULT 'unknown',
        last_check TEXT
      )`);

      this.db.run(`CREATE TABLE IF NOT EXISTS status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        latency_ms REAL,
        timestamp TEXT NOT NULL
      )`);
      this.db.run('CREATE INDEX IF NOT EXISTS idx_sh_host_ts ON status_history(host_id, timestamp)');

      this.db.run(`CREATE TABLE IF NOT EXISTS discovered_networks (
        id INTEGER PRIMARY KEY,
        cidr TEXT NOT NULL,
        name TEXT,
        discovered_at TEXT
      )`);

      this.db.run(`CREATE TABLE IF NOT EXISTS discovered_hosts (
        id INTEGER PRIMARY KEY,
        network_id INTEGER NOT NULL,
        hostname TEXT,
        ip TEXT NOT NULL,
        port INTEGER DEFAULT 0,
        status TEXT DEFAULT 'unknown',
        latency_ms REAL,
        discovered_at TEXT
      )`);

      this.db.run(`CREATE TABLE IF NOT EXISTS metrics_network (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        traffic_in_mb REAL,
        traffic_out_mb REAL,
        packets_in INTEGER,
        packets_out INTEGER,
        created_at TEXT
      )`);
      this.db.run('CREATE INDEX IF NOT EXISTS idx_mn_host_ts ON metrics_network(host_id, timestamp)');

      this.db.run(`CREATE TABLE IF NOT EXISTS metrics_system (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        cpu_percent REAL,
        memory_percent REAL,
        memory_used_mb REAL,
        memory_total_mb REAL,
        created_at TEXT
      )`);
      this.db.run('CREATE INDEX IF NOT EXISTS idx_ms_host_ts ON metrics_system(host_id, timestamp)');

      this.db.run(`CREATE TABLE IF NOT EXISTS metrics_buffer (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        buffer_hits INTEGER,
        buffer_misses INTEGER,
        hit_rate REAL,
        small_miss_mb REAL,
        medium_miss_mb REAL,
        large_miss_mb REAL,
        created_at TEXT
      )`);
      this.db.run('CREATE INDEX IF NOT EXISTS idx_mb_host_ts ON metrics_buffer(host_id, timestamp)');

      this.db.run(`CREATE TABLE IF NOT EXISTS metrics_hourly (
        host_id INTEGER NOT NULL,
        metric_type TEXT NOT NULL,
        hour TEXT NOT NULL,
        avg_json TEXT NOT NULL,
        sample_count INTEGER NOT NULL,
        PRIMARY KEY (host_id, metric_type, hour)
      )`);

      this.db.run('PRAGMA user_version = 1');
    }

    if (version < 2) {
      // Phase 9: protocol-specific fields on monitored_hosts
      const addCol = (col, type, dflt) => {
        try { this.db.run(`ALTER TABLE monitored_hosts ADD COLUMN ${col} ${type} DEFAULT ${dflt}`); } catch { /* column may already exist */ }
      };
      addCol('url', 'TEXT', 'NULL');
      addCol('expected_status', 'INTEGER', 'NULL');
      addCol('keyword', 'TEXT', 'NULL');
      addCol('expected_ip', 'TEXT', 'NULL');
      addCol('record_type', 'TEXT', "'A'");
      this.db.run('PRAGMA user_version = 2');
    }

    if (version < 3) {
      // Phase 10: alert rules + alert history
      this.db.run(`CREATE TABLE IF NOT EXISTS alert_rules (
        id INTEGER PRIMARY KEY,
        host_id INTEGER,
        metric TEXT NOT NULL,
        operator TEXT NOT NULL,
        threshold TEXT NOT NULL,
        severity TEXT DEFAULT 'warning',
        enabled INTEGER DEFAULT 1,
        cooldown_min INTEGER DEFAULT 5,
        created_at TEXT
      )`);
      this.db.run('CREATE INDEX IF NOT EXISTS idx_ar_host ON alert_rules(host_id)');

      this.db.run(`CREATE TABLE IF NOT EXISTS alert_history (
        id INTEGER PRIMARY KEY,
        rule_id INTEGER NOT NULL,
        host_id INTEGER NOT NULL,
        triggered_at TEXT NOT NULL,
        resolved_at TEXT,
        acknowledged INTEGER DEFAULT 0,
        severity TEXT NOT NULL,
        message TEXT
      )`);
      this.db.run('CREATE INDEX IF NOT EXISTS idx_ah_host ON alert_history(host_id, triggered_at)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_ah_resolved ON alert_history(resolved_at)');

      this.db.run('PRAGMA user_version = 3');
    }

    if (version < 4) {
      // Phase 11: enriched host metadata, discovery details, uptime + incidents

      const addCol = (table, col, type, dflt) => {
        try { this.db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type} DEFAULT ${dflt}`); } catch { /* column may already exist */ }
      };

      // monitored_hosts — grouping, tagging, cert tracking, operational notes
      addCol('monitored_hosts', 'group_name', 'TEXT', 'NULL');
      addCol('monitored_hosts', 'tags', 'TEXT', 'NULL');
      addCol('monitored_hosts', 'last_latency_ms', 'REAL', 'NULL');
      addCol('monitored_hosts', 'uptime_streak', 'INTEGER', '0');
      addCol('monitored_hosts', 'cert_issuer', 'TEXT', 'NULL');
      addCol('monitored_hosts', 'cert_subject', 'TEXT', 'NULL');
      addCol('monitored_hosts', 'cert_expiry', 'TEXT', 'NULL');
      addCol('monitored_hosts', 'cert_days_left', 'INTEGER', 'NULL');
      addCol('monitored_hosts', 'created_at', 'TEXT', 'NULL');
      addCol('monitored_hosts', 'updated_at', 'TEXT', 'NULL');
      addCol('monitored_hosts', 'notes', 'TEXT', 'NULL');

      // status_history — protocol-specific response details
      addCol('status_history', 'status_code', 'INTEGER', 'NULL');
      addCol('status_history', 'response_size', 'INTEGER', 'NULL');
      addCol('status_history', 'keyword_found', 'INTEGER', 'NULL');
      addCol('status_history', 'resolved_ip', 'TEXT', 'NULL');
      addCol('status_history', 'dns_latency_ms', 'REAL', 'NULL');
      addCol('status_history', 'error_message', 'TEXT', 'NULL');

      // metrics_network — packet loss and jitter
      addCol('metrics_network', 'packet_loss_pct', 'REAL', 'NULL');
      addCol('metrics_network', 'jitter_ms', 'REAL', 'NULL');

      // metrics_system — disk, load average, process count
      addCol('metrics_system', 'disk_percent', 'REAL', 'NULL');
      addCol('metrics_system', 'disk_used_gb', 'REAL', 'NULL');
      addCol('metrics_system', 'disk_total_gb', 'REAL', 'NULL');
      addCol('metrics_system', 'load_avg_1m', 'REAL', 'NULL');
      addCol('metrics_system', 'load_avg_5m', 'REAL', 'NULL');
      addCol('metrics_system', 'process_count', 'INTEGER', 'NULL');

      // metrics_hourly — min/max envelopes
      addCol('metrics_hourly', 'min_json', 'TEXT', 'NULL');
      addCol('metrics_hourly', 'max_json', 'TEXT', 'NULL');

      // discovered_networks — enriched scan metadata
      addCol('discovered_networks', 'gateway', 'TEXT', 'NULL');
      addCol('discovered_networks', 'subnet_mask', 'TEXT', 'NULL');
      addCol('discovered_networks', 'host_count', 'INTEGER', '0');
      addCol('discovered_networks', 'last_scanned', 'TEXT', 'NULL');

      // discovered_hosts — enriched discovery details
      addCol('discovered_hosts', 'mac_address', 'TEXT', 'NULL');
      addCol('discovered_hosts', 'os_fingerprint', 'TEXT', 'NULL');
      addCol('discovered_hosts', 'open_ports', 'TEXT', 'NULL');
      addCol('discovered_hosts', 'services', 'TEXT', 'NULL');
      addCol('discovered_hosts', 'last_seen', 'TEXT', 'NULL');

      // alert_rules — friendly name and notification config
      addCol('alert_rules', 'name', 'TEXT', 'NULL');
      addCol('alert_rules', 'notification', 'TEXT', 'NULL');

      // alert_history — enriched alert lifecycle
      addCol('alert_history', 'metric_value', 'TEXT', 'NULL');
      addCol('alert_history', 'acknowledged_at', 'TEXT', 'NULL');
      addCol('alert_history', 'acknowledged_by', 'TEXT', 'NULL');
      addCol('alert_history', 'duration_min', 'REAL', 'NULL');

      // New table: uptime_daily — pre-computed daily SLA percentages
      this.db.run(`CREATE TABLE IF NOT EXISTS uptime_daily (
        host_id    TEXT NOT NULL,
        date       TEXT NOT NULL,
        total_checks   INTEGER NOT NULL,
        online_checks  INTEGER NOT NULL,
        uptime_pct     REAL NOT NULL,
        avg_latency_ms REAL,
        max_latency_ms REAL,
        min_latency_ms REAL,
        downtime_events INTEGER DEFAULT 0,
        PRIMARY KEY (host_id, date)
      )`);

      // New table: incidents — outage tracking
      this.db.run(`CREATE TABLE IF NOT EXISTS incidents (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id     TEXT NOT NULL,
        started_at  TEXT NOT NULL,
        resolved_at TEXT,
        duration_min REAL,
        root_cause  TEXT,
        impact      TEXT DEFAULT 'unknown',
        created_at  TEXT
      )`);
      this.db.run('CREATE INDEX IF NOT EXISTS idx_incident_host ON incidents(host_id)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_incident_active ON incidents(resolved_at)');

      this.db.run('PRAGMA user_version = 4');
    }

    this._dirty = true;
  }

  // -------------------------------------------------------------------
  //  Load persisted data into the in-memory store on startup
  // -------------------------------------------------------------------

  loadIntoStore(store) {
    // Hosts
    const hosts = this._all('SELECT * FROM monitored_hosts');
    for (const h of hosts) store.addHost(h);

    // Recent status history (last 7 days, keep memory bounded)
    const hCutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const history = this._all(
      'SELECT * FROM status_history WHERE timestamp > ? ORDER BY timestamp ASC', [hCutoff],
    );
    for (const e of history) store.addHistory(e);

    // Discovered networks + hosts
    for (const n of this._all('SELECT * FROM discovered_networks')) store.addDiscoveredNetwork(n);
    for (const d of this._all('SELECT * FROM discovered_hosts'))    store.addDiscoveredHost(d);

    // Recent metrics (last 24 h into memory — older data stays in SQLite)
    const mCutoff = new Date(Date.now() - 86_400_000).toISOString();
    for (const type of ['network', 'system', 'buffer']) {
      const rows = this._all(
        `SELECT * FROM metrics_${type} WHERE timestamp > ? ORDER BY timestamp ASC`, [mCutoff],
      );
      for (const r of rows) store.pushMetric(type, r);
    }

    console.log(
      `[netops] DB loaded: ${hosts.length} hosts, ${history.length} history, ` +
      `${this._all('SELECT * FROM discovered_networks').length} networks`,
    );

    // Alert rules + recent alert history
    for (const r of this._all('SELECT * FROM alert_rules')) store.addAlertRule(r);
    const alertCutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    for (const a of this._all(
      'SELECT * FROM alert_history WHERE triggered_at > ? ORDER BY triggered_at ASC', [alertCutoff],
    )) {
      store.addAlert(a);
    }
  }

  // -------------------------------------------------------------------
  //  Write-through helpers (called by data-store on mutations)
  // -------------------------------------------------------------------

  insertHost(host) {
    this.db.run(
      `INSERT OR REPLACE INTO monitored_hosts
       (id, hostname, ip, port, protocol, alias, enabled, last_status, last_check,
        url, expected_status, keyword, expected_ip, record_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [host.id, host.hostname, host.ip, host.port, host.protocol,
       host.alias, host.enabled, host.last_status, host.last_check,
       host.url || null, host.expected_status || null, host.keyword || null,
       host.expected_ip || null, host.record_type || 'A'],
    );
    this._dirty = true;
  }

  deleteHost(id) {
    this.db.run('DELETE FROM monitored_hosts WHERE id = ?', [id]);
    this.db.run('DELETE FROM status_history WHERE host_id = ?', [id]);
    this.db.run('DELETE FROM metrics_network WHERE host_id = ?', [id]);
    this.db.run('DELETE FROM metrics_system WHERE host_id = ?', [id]);
    this.db.run('DELETE FROM metrics_buffer WHERE host_id = ?', [id]);
    this.db.run('DELETE FROM metrics_hourly WHERE host_id = ?', [id]);
    this._dirty = true;
  }

  updateHost(id, updates) {
    const fields = Object.keys(updates).filter(k => HOST_COLUMNS.has(k));
    if (fields.length === 0) return;
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updates[f]);
    values.push(id);
    this.db.run(`UPDATE monitored_hosts SET ${setClause} WHERE id = ?`, values);
    this._dirty = true;
  }

  insertStatusEntry(entry) {
    this.db.run(
      'INSERT INTO status_history (host_id, status, latency_ms, timestamp) VALUES (?, ?, ?, ?)',
      [entry.host_id, entry.status, entry.latency_ms, entry.timestamp],
    );
    this._dirty = true;
  }

  insertMetric(type, data) {
    const schema = {
      network: ['host_id', 'timestamp', 'traffic_in_mb', 'traffic_out_mb', 'packets_in', 'packets_out', 'created_at'],
      system:  ['host_id', 'timestamp', 'cpu_percent', 'memory_percent', 'memory_used_mb', 'memory_total_mb', 'created_at'],
      buffer:  ['host_id', 'timestamp', 'buffer_hits', 'buffer_misses', 'hit_rate', 'small_miss_mb', 'medium_miss_mb', 'large_miss_mb', 'created_at'],
    };
    const cols = schema[type];
    if (!cols) return;
    const ph = cols.map(() => '?').join(', ');
    const vals = cols.map(c => data[c] ?? null);
    this.db.run(`INSERT INTO metrics_${type} (${cols.join(', ')}) VALUES (${ph})`, vals);
    this._dirty = true;
  }

  insertDiscoveredNetwork(net) {
    this.db.run(
      'INSERT OR REPLACE INTO discovered_networks (id, cidr, name, discovered_at) VALUES (?, ?, ?, ?)',
      [net.id, net.cidr, net.name, net.discovered_at],
    );
    this._dirty = true;
  }

  insertDiscoveredHost(host) {
    this.db.run(
      `INSERT OR REPLACE INTO discovered_hosts
       (id, network_id, hostname, ip, port, status, latency_ms, discovered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [host.id, host.network_id, host.hostname, host.ip,
       host.port || 0, host.status, host.latency_ms, host.discovered_at],
    );
    this._dirty = true;
  }

  updateDiscoveredHost(id, updates) {
    const allowed = new Set(['hostname', 'ip', 'port', 'status', 'latency_ms', 'discovered_at']);
    const fields = Object.keys(updates).filter(k => allowed.has(k));
    if (fields.length === 0) return;
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => updates[f]);
    values.push(id);
    this.db.run(`UPDATE discovered_hosts SET ${setClause} WHERE id = ?`, values);
    this._dirty = true;
  }

  deleteDiscoveredNetwork(networkId) {
    this.db.run('DELETE FROM discovered_hosts WHERE network_id = ?', [networkId]);
    this.db.run('DELETE FROM discovered_networks WHERE id = ?', [networkId]);
    this._dirty = true;
  }

  // -------------------------------------------------------------------
  //  Alert rules write-through
  // -------------------------------------------------------------------

  insertAlertRule(rule) {
    this.db.run(
      `INSERT OR REPLACE INTO alert_rules
       (id, host_id, metric, operator, threshold, severity, enabled, cooldown_min, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [rule.id, rule.host_id, rule.metric, rule.operator,
       String(rule.threshold), rule.severity, rule.enabled,
       rule.cooldown_min, rule.created_at],
    );
    this._dirty = true;
  }

  updateAlertRule(id, updates) {
    const allowed = new Set([
      'host_id', 'metric', 'operator', 'threshold',
      'severity', 'enabled', 'cooldown_min',
    ]);
    const fields = Object.keys(updates).filter(k => allowed.has(k));
    if (fields.length === 0) return;
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => f === 'threshold' ? String(updates[f]) : updates[f]);
    values.push(id);
    this.db.run(`UPDATE alert_rules SET ${setClause} WHERE id = ?`, values);
    this._dirty = true;
  }

  deleteAlertRule(id) {
    this.db.run('DELETE FROM alert_rules WHERE id = ?', [id]);
    this.db.run('DELETE FROM alert_history WHERE rule_id = ?', [id]);
    this._dirty = true;
  }

  insertAlert(alert) {
    this.db.run(
      `INSERT OR REPLACE INTO alert_history
       (id, rule_id, host_id, triggered_at, resolved_at, acknowledged, severity, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [alert.id, alert.rule_id, alert.host_id, alert.triggered_at,
       alert.resolved_at, alert.acknowledged, alert.severity, alert.message],
    );
    this._dirty = true;
  }

  acknowledgeAlert(id) {
    this.db.run('UPDATE alert_history SET acknowledged = 1 WHERE id = ?', [id]);
    this._dirty = true;
  }

  resolveAlert(id, resolvedAt) {
    this.db.run('UPDATE alert_history SET resolved_at = ? WHERE id = ?', [resolvedAt, id]);
    this._dirty = true;
  }

  // -------------------------------------------------------------------
  //  Data retention
  // -------------------------------------------------------------------

  prune() {
    const rawCutoff = new Date(Date.now() - this.retentionRawDays * 86_400_000).toISOString();
    const avgCutoff = new Date(Date.now() - this.retentionAvgDays * 86_400_000).toISOString();

    // Aggregate metrics into hourly buckets before pruning raw rows
    for (const type of ['network', 'system', 'buffer']) {
      this._aggregateHourly(type, rawCutoff);
    }

    // Prune raw data
    this.db.run('DELETE FROM status_history WHERE timestamp < ?', [rawCutoff]);
    this.db.run('DELETE FROM metrics_network WHERE timestamp < ?', [rawCutoff]);
    this.db.run('DELETE FROM metrics_system  WHERE timestamp < ?', [rawCutoff]);
    this.db.run('DELETE FROM metrics_buffer  WHERE timestamp < ?', [rawCutoff]);

    // Prune old hourly averages
    this.db.run('DELETE FROM metrics_hourly WHERE hour < ?', [avgCutoff]);

    this._dirty = true;
    console.log(`[netops] Prune complete (raw ${this.retentionRawDays}d / hourly ${this.retentionAvgDays}d)`);
  }

  _aggregateHourly(type, cutoff) {
    const table = `metrics_${type}`;
    const rows = this._all(
      `SELECT * FROM ${table} WHERE timestamp < ? ORDER BY host_id, timestamp`, [cutoff],
    );
    if (rows.length === 0) return;

    const numericFields = {
      network: ['traffic_in_mb', 'traffic_out_mb', 'packets_in', 'packets_out'],
      system:  ['cpu_percent', 'memory_percent', 'memory_used_mb', 'memory_total_mb'],
      buffer:  ['buffer_hits', 'buffer_misses', 'hit_rate', 'small_miss_mb', 'medium_miss_mb', 'large_miss_mb'],
    };
    const fields = numericFields[type] || [];

    // Group by host_id + hour
    const groups = new Map();
    for (const row of rows) {
      const hour = row.timestamp.substring(0, 13) + ':00:00';
      const key = `${row.host_id}|${hour}`;
      if (!groups.has(key)) groups.set(key, { host_id: row.host_id, hour, rows: [] });
      groups.get(key).rows.push(row);
    }

    for (const [, g] of groups) {
      const n = g.rows.length;
      const avg = {};
      for (const f of fields) {
        const sum = g.rows.reduce((s, r) => s + (r[f] || 0), 0);
        avg[f] = Number.parseFloat((sum / n).toFixed(2));
      }
      this.db.run(
        `INSERT OR REPLACE INTO metrics_hourly (host_id, metric_type, hour, avg_json, sample_count)
         VALUES (?, ?, ?, ?, ?)`,
        [g.host_id, type, g.hour, JSON.stringify(avg), n],
      );
    }
  }

  // -------------------------------------------------------------------
  //  Backup / restore
  // -------------------------------------------------------------------

  exportJson() {
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      hosts: this._all('SELECT * FROM monitored_hosts'),
      networks: this._all('SELECT * FROM discovered_networks'),
      discoveredHosts: this._all('SELECT * FROM discovered_hosts'),
    };
  }

  importJson(data, mode = 'merge') {
    if (data?.version !== 1) throw new Error('Invalid backup format');

    if (mode === 'replace') {
      this.db.run('DELETE FROM monitored_hosts');
      this.db.run('DELETE FROM discovered_networks');
      this.db.run('DELETE FROM discovered_hosts');
    }

    let hostCount = 0;
    let netCount = 0;

    if (Array.isArray(data.hosts)) {
      for (const h of data.hosts) {
        this.db.run(
          `INSERT OR REPLACE INTO monitored_hosts
           (id, hostname, ip, port, protocol, alias, enabled, last_status, last_check)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [h.id, h.hostname, h.ip, h.port, h.protocol,
           h.alias, h.enabled ?? 1, h.last_status ?? 'unknown', h.last_check],
        );
        hostCount++;
      }
    }

    if (Array.isArray(data.networks)) {
      for (const n of data.networks) {
        this.db.run(
          'INSERT OR REPLACE INTO discovered_networks (id, cidr, name, discovered_at) VALUES (?, ?, ?, ?)',
          [n.id, n.cidr, n.name, n.discovered_at],
        );
        netCount++;
      }
    }

    if (Array.isArray(data.discoveredHosts)) {
      for (const dh of data.discoveredHosts) {
        this.db.run(
          `INSERT OR REPLACE INTO discovered_hosts
           (id, network_id, hostname, ip, port, status, latency_ms, discovered_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [dh.id, dh.network_id, dh.hostname, dh.ip,
           dh.port || 0, dh.status, dh.latency_ms, dh.discovered_at],
        );
      }
    }

    this._dirty = true;
    return { hostCount, netCount };
  }

  backupTo(targetPath) {
    this.flush();
    fs.copyFileSync(this.dbPath, targetPath);
  }

  // -------------------------------------------------------------------
  //  Flush / disk I/O
  // -------------------------------------------------------------------

  flush() {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.dbPath, Buffer.from(data));
      this._dirty = false;
    } catch (err) {
      console.error('[netops] DB flush error:', err.message);
    }
  }

  // -------------------------------------------------------------------
  //  Internal helpers
  // -------------------------------------------------------------------

  _all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
}

module.exports = { NetOpsPersistence };
