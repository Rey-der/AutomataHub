/**
 * NetOps Data Store — centralized in-memory data management.
 * All monitored hosts, discovered networks, metrics, and status live here.
 * Future: swap arrays/maps for sql.js persistence.
 */
const { randomInt } = require('node:crypto');

const MAX_METRICS = 2880; // 24 hours at 30-second intervals

class NetOpsStore {
  constructor() {
    this.hosts = new Map();
    this.statusCache = new Map();
    this.history = [];
    this.statusChanges = [];
    this.networkMetrics = [];
    this.systemMetrics = [];
    this.bufferMetrics = [];
    this.discoveredNetworks = [];
    this.discoveredHosts = [];
    this.alertRules = new Map();
    this.alertHistory = [];
    this._db = null; // NetOpsPersistence instance (set after init)
  }

  /** Attach a persistence layer for write-through to SQLite. */
  setPersistence(db) { this._db = db; }

  // --- ID generation & normalisation ---

  generateId() {
    return Date.now() + randomInt(10000);
  }

  /** Normalise an id to Number so === comparisons succeed across IPC. */
  _nid(v) { return typeof v === 'string' ? Number(v) : v; }

  // --- Monitored hosts ---

  addHost(host) {
    this.hosts.set(host.id, host);
    if (this._db) this._db.insertHost(host);
  }

  removeHost(id) {
    id = this._nid(id);
    this.hosts.delete(id);
    this.statusCache.delete(id);
    if (this._db) this._db.deleteHost(id);
  }

  getHost(id) {
    return this.hosts.get(this._nid(id)) || null;
  }

  getAllHosts(enabledOnly = false) {
    const all = Array.from(this.hosts.values());
    return enabledOnly ? all.filter(h => h.enabled) : all;
  }

  updateHost(id, updates) {
    id = this._nid(id);
    const host = this.hosts.get(id);
    if (!host) return null;
    Object.assign(host, updates);
    if (this._db) this._db.updateHost(id, updates);
    return host;
  }

  // --- Status cache ---

  setStatus(hostId, data) {
    hostId = this._nid(hostId);
    const prev = this.statusCache.get(hostId);
    this.statusCache.set(hostId, data);

    // Keep the host object's last_status / last_check in sync
    const host = this.hosts.get(hostId);
    if (host) {
      host.last_status = data.status;
      host.last_check = data.timestamp || new Date().toISOString();
    }

    // Track heartbeat (last N checks per host)
    if (!this._heartbeats) this._heartbeats = new Map();
    const hb = this._heartbeats.get(hostId) || [];
    hb.push({ status: data.status, latency_ms: data.latency_ms, timestamp: data.timestamp });
    while (hb.length > 100) hb.shift();
    this._heartbeats.set(hostId, hb);

    return prev;
  }

  getStatus(hostId) {
    return this.statusCache.get(this._nid(hostId)) || null;
  }

  // --- History ---

  addHistory(entry) {
    this.history.push(entry);
    if (this._db) this._db.insertStatusEntry(entry);
  }

  getHistory(hostId, limit = 100) {
    hostId = this._nid(hostId);
    return this.history
      .filter(h => h.host_id === hostId)
      .toSorted((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  // --- Status changes (event feed) ---

  addStatusChange(event) {
    this.statusChanges.push(event);
    while (this.statusChanges.length > 500) this.statusChanges.shift();
  }

  getRecentEvents(limit = 10) {
    return this.statusChanges
      .toSorted((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  // --- Heartbeat data ---

  getHeartbeat(hostId, count = 30) {
    if (!this._heartbeats) return [];
    const hb = this._heartbeats.get(this._nid(hostId)) || [];
    return hb.slice(-count);
  }

  // --- Uptime stats ---

  getUptimeStats(hostId, cutoffTime) {
    hostId = this._nid(hostId);
    const entries = this.history.filter(
      h => h.host_id === hostId && new Date(h.timestamp) > cutoffTime
    );
    if (entries.length === 0) return { uptime_percent: 0, total_checks: 0, online_checks: 0 };
    const online = entries.filter(e => e.status === 'online').length;
    return {
      uptime_percent: Number.parseFloat(((online / entries.length) * 100).toFixed(2)),
      total_checks: entries.length,
      online_checks: online,
    };
  }

  // --- Discovered networks ---

  addDiscoveredNetwork(network) {
    this.discoveredNetworks.push(network);
    if (this._db) this._db.insertDiscoveredNetwork(network);
  }

  findDiscoveredNetwork(cidr) {
    return this.discoveredNetworks.find(n => n.cidr === cidr) || null;
  }

  getDiscoveredNetworks() {
    return this.discoveredNetworks.map(net => ({
      id: net.id,
      cidr: net.cidr,
      name: net.name,
      discovered_at: net.discovered_at,
      host_count: this.discoveredHosts.filter(h => h.network_id === net.id).length,
      online_count: this.discoveredHosts.filter(h => h.network_id === net.id && h.status === 'online').length,
    }));
  }

  removeDiscoveredNetwork(networkId) {
    const idx = this.discoveredNetworks.findIndex(n => n.id === networkId);
    if (idx === -1) return null;

    const network = this.discoveredNetworks[idx];
    this.discoveredNetworks.splice(idx, 1);

    let hostCount = 0;
    for (let i = this.discoveredHosts.length - 1; i >= 0; i--) {
      if (this.discoveredHosts[i].network_id === networkId) {
        this.discoveredHosts.splice(i, 1);
        hostCount++;
      }
    }

    if (this._db) this._db.deleteDiscoveredNetwork(networkId);
    return { network, hostCount };
  }

  // --- Discovered hosts ---

  getDiscoveredHosts(networkId) {
    return this.discoveredHosts.filter(h => h.network_id === networkId);
  }

  findDiscoveredHost(predicate) {
    return this.discoveredHosts.find(h => predicate(h)) || null;
  }

  addDiscoveredHost(host) {
    this.discoveredHosts.push(host);
    if (this._db) this._db.insertDiscoveredHost(host);
  }

  updateDiscoveredHost(host, updates) {
    Object.assign(host, updates);
    if (this._db) this._db.updateDiscoveredHost(host.id, updates);
  }

  // --- Alert rules ---

  addAlertRule(rule) {
    this.alertRules.set(rule.id, rule);
    if (this._db) this._db.insertAlertRule(rule);
  }

  getAlertRule(ruleId) {
    return this.alertRules.get(ruleId) || null;
  }

  getAlertRules(hostId) {
    const all = Array.from(this.alertRules.values()).filter(r => r.enabled);
    if (!hostId) return all;
    hostId = this._nid(hostId);
    // Return rules that target this host OR are global (host_id === null)
    return all.filter(r => r.host_id === hostId || r.host_id == null);
  }

  getAllAlertRules() {
    return Array.from(this.alertRules.values());
  }

  updateAlertRule(ruleId, updates) {
    const rule = this.alertRules.get(ruleId);
    if (!rule) return null;
    Object.assign(rule, updates);
    if (this._db) this._db.updateAlertRule(ruleId, updates);
    return rule;
  }

  removeAlertRule(ruleId) {
    this.alertRules.delete(ruleId);
    if (this._db) this._db.deleteAlertRule(ruleId);
  }

  // --- Alert history ---

  addAlert(alert) {
    this.alertHistory.push(alert);
    while (this.alertHistory.length > 1000) this.alertHistory.shift();
    if (this._db) this._db.insertAlert(alert);
  }

  getAlertHistory({ host_id, severity, limit = 100, unacknowledged } = {}) {
    let items = this.alertHistory;
    if (host_id) { host_id = this._nid(host_id); items = items.filter(a => a.host_id === host_id); }
    if (severity) items = items.filter(a => a.severity === severity);
    if (unacknowledged) items = items.filter(a => !a.acknowledged);
    return items
      .toSorted((a, b) => new Date(b.triggered_at) - new Date(a.triggered_at))
      .slice(0, limit);
  }

  acknowledgeAlert(alertId) {
    const alert = this.alertHistory.find(a => a.id === alertId);
    if (!alert) return null;
    alert.acknowledged = 1;
    if (this._db) this._db.acknowledgeAlert(alertId);
    return alert;
  }

  getOpenAlert(ruleId, hostId) {
    hostId = this._nid(hostId);
    return this.alertHistory.find(
      a => a.rule_id === ruleId && a.host_id === hostId && !a.resolved_at,
    ) || null;
  }

  resolveAlert(alertId, resolvedAt) {
    const alert = this.alertHistory.find(a => a.id === alertId);
    if (!alert) return null;
    alert.resolved_at = resolvedAt;
    if (this._db) this._db.resolveAlert(alertId, resolvedAt);
    return alert;
  }

  getActiveAlertCount() {
    return this.alertHistory.filter(a => !a.resolved_at && !a.acknowledged).length;
  }

  // --- Metrics ---

  /** Push a metric and trim to MAX_METRICS to bound memory usage. */
  pushMetric(type, data) {
    const arr = this._metricsArray(type);
    data.id = arr.length + 1;
    arr.push(data);
    while (arr.length > MAX_METRICS) arr.shift();
    if (this._db) this._db.insertMetric(type, data);
    return data;
  }

  getMetrics(type, hostId, cutoffTime, limit = 288) {
    hostId = this._nid(hostId);
    return this._metricsArray(type)
      .filter(m => m.host_id === hostId && new Date(m.timestamp) > cutoffTime)
      .toSorted((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .slice(-limit);
  }

  getAggregateMetrics(hostId, cutoffTime) {
    hostId = this._nid(hostId);
    const net = this._filtered('network', hostId, cutoffTime);
    const sys = this._filtered('system', hostId, cutoffTime);
    const buf = this._filtered('buffer', hostId, cutoffTime);

    const network = net.length > 0 ? {
      avg_traffic_in:   this._avg(net, 'traffic_in_mb'),
      avg_traffic_out:  this._avg(net, 'traffic_out_mb'),
      peak_traffic_in:  this._max(net, 'traffic_in_mb'),
      peak_traffic_out: this._max(net, 'traffic_out_mb'),
    } : {};

    const system = sys.length > 0 ? {
      avg_cpu_percent:    this._avg(sys, 'cpu_percent'),
      max_cpu_percent:    this._max(sys, 'cpu_percent'),
      avg_memory_percent: this._avg(sys, 'memory_percent'),
      max_memory_percent: this._max(sys, 'memory_percent'),
    } : {};

    const buffer = buf.length > 0 ? {
      avg_hit_rate:      this._avg(buf, 'hit_rate'),
      min_hit_rate:      this._min(buf, 'hit_rate'),
      total_small_miss:  this._sum(buf, 'small_miss_mb'),
      total_medium_miss: this._sum(buf, 'medium_miss_mb'),
      total_large_miss:  this._sum(buf, 'large_miss_mb'),
    } : {};

    const latestStatus = this.statusCache.get(hostId);
    return { network, system, buffer, avg_latency_ms: latestStatus?.latency_ms || 0 };
  }

  // --- Private helpers ---

  _metricsArray(type) {
    const map = { network: this.networkMetrics, system: this.systemMetrics, buffer: this.bufferMetrics };
    const arr = map[type];
    if (!arr) throw new Error(`Unknown metrics type: ${type}`);
    return arr;
  }

  _filtered(type, hostId, cutoff) {
    hostId = this._nid(hostId);
    return this._metricsArray(type).filter(m => m.host_id === hostId && new Date(m.timestamp) > cutoff);
  }

  _avg(arr, field) { return Number.parseFloat((arr.reduce((s, m) => s + m[field], 0) / arr.length).toFixed(2)); }
  _max(arr, field) { return Number.parseFloat(Math.max(...arr.map(m => m[field])).toFixed(2)); }
  _min(arr, field) { return Number.parseFloat(Math.min(...arr.map(m => m[field])).toFixed(2)); }
  _sum(arr, field) { return Number.parseFloat(arr.reduce((s, m) => s + m[field], 0).toFixed(2)); }
}

module.exports = { NetOpsStore };
