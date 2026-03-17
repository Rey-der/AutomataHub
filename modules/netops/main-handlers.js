/**
 * NetOps Monitor — main-process entry point.
 * Slim orchestrator: creates shared dependencies, wires handler modules,
 * and manages the periodic monitoring interval.
 *
 * Handler domains:
 *   handlers/hosts.js    — host CRUD, ping, port check, history
 *   handlers/scanning.js — network scanning, discovery management
 *   handlers/metrics.js  — metrics queries, aggregates, events, heartbeat
 *   handlers/storage.js  — backup, restore, retention, DB management
 */

const { NetOpsStore } = require('./core/data-store');
const { NetOpsPersistence } = require('./core/persistence');
const { HostMonitor } = require('./monitoring/host-monitor');
const { NetworkScanner } = require('./monitoring/network-scanner');
const { AlertEngine } = require('./core/alert-engine');

const hostsHandler = require('./handlers/hosts');
const scanningHandler = require('./handlers/scanning');
const metricsHandler = require('./handlers/metrics');
const storageHandler = require('./handlers/storage');
const alertsHandler = require('./handlers/alerts');

let persistence = null;

function setup(config) {
  const { ipcBridge, send, mainWindow } = config;

  // --- Shared dependencies ---
  const store = new NetOpsStore();
  const monitor = new HostMonitor();
  const scanner = new NetworkScanner(store, monitor);
  const { createMetricsCollector } = require('./monitoring/metrics-collector');
  const collector = createMetricsCollector();

  // --- Alert engine (created early, wired after persistence loads) ---
  let alertEngine = null;

  // --- SQLite persistence (async init) ---
  persistence = new NetOpsPersistence();
  persistence.init().then(() => {
    persistence.loadIntoStore(store);
    store.setPersistence(persistence);
    // Initialize alert engine now that persistence + store are ready
    alertEngine = new AlertEngine(store, persistence, emit);
    alertsHandler.register(ipcBridge, { alertEngine, store });
    console.log('[netops] SQLite persistence ready');
  }).catch(err => {
    console.error('[netops] Persistence init failed — running in-memory only:', err.message);
    persistence = null;
    // Still create alert engine for in-memory operation
    alertEngine = new AlertEngine(store, null, emit);
    alertsHandler.register(ipcBridge, { alertEngine, store });
  });

  function emit(channel, data) {
    if (send) send(channel, data);
  }

  function collectAndStoreMetrics(hostId, hostname) {
    try {
      const m = collector.collectAllMetrics(hostname);
      const now = new Date().toISOString();
      if (m.network) {
        store.pushMetric('network', { host_id: hostId, timestamp: m.network.timestamp, traffic_in_mb: m.network.traffic_in_mb, traffic_out_mb: m.network.traffic_out_mb, packets_in: m.network.packets_in, packets_out: m.network.packets_out, created_at: now });
      }
      if (m.system) {
        store.pushMetric('system', { host_id: hostId, timestamp: m.system.timestamp, cpu_percent: m.system.cpu_percent, memory_percent: m.system.memory_percent, memory_used_mb: m.system.memory_used_mb, memory_total_mb: m.system.memory_total_mb, created_at: now });
      }
      if (m.buffer) {
        store.pushMetric('buffer', { host_id: hostId, timestamp: m.buffer.timestamp, buffer_hits: m.buffer.buffer_hits, buffer_misses: m.buffer.buffer_misses, hit_rate: m.buffer.hit_rate, small_miss_mb: m.buffer.small_miss_mb, medium_miss_mb: m.buffer.medium_miss_mb, large_miss_mb: m.buffer.large_miss_mb, created_at: now });
      }
      emit('netops:metrics-updated', { host_id: hostId, metrics: m });
    } catch (err) {
      console.error(`[netops] Metrics error for ${hostname}:`, err.message);
    }
  }

  async function pingAndUpdate(hostId, hostname, hostConfig) {
    const result = await monitor.ping(hostname, hostConfig);
    const status = result.online ? 'online' : 'offline';
    const latency_ms = result.latency_ms ?? result.latency ?? null;
    const ts = new Date().toISOString();

    const prev = store.setStatus(hostId, { status, latency_ms, timestamp: ts, protocol: result.protocol, detail: result.detail });
    store.addHistory({ host_id: hostId, status, latency_ms, timestamp: ts });

    const statusChanged = prev != null && prev.status !== status;
    if (statusChanged) {
      const event = { host_id: hostId, hostname, old_status: prev.status, new_status: status, latency_ms, timestamp: ts };
      store.addStatusChange(event);
      emit('netops:status-change', event);
    }

    emit('netops:status-update', { host_id: hostId, status, latency_ms, timestamp: ts, statusChanged, protocol: result.protocol, detail: result.detail });

    // Evaluate alert rules
    if (alertEngine) {
      alertEngine.evaluate(hostId, { status, latency_ms, timestamp: ts, detail: result.detail });
    }

    return { status, latency_ms, statusChanged };
  }

  // --- Wire handler modules ---
  const deps = { store, monitor, scanner, collector, emit, send, pingAndUpdate, collectAndStoreMetrics, persistence, mainWindow };
  hostsHandler.register(ipcBridge, deps);
  scanningHandler.register(ipcBridge, deps);
  metricsHandler.register(ipcBridge, deps);
  storageHandler.register(ipcBridge, deps);

  // --- Periodic monitoring (30s) ---
  setInterval(async () => {
    for (const host of store.getAllHosts(true)) {
      try { await pingAndUpdate(host.id, host.hostname, host); } catch (err) {
        console.error(`[netops] Ping error for ${host.hostname}:`, err.message);
      }
      collectAndStoreMetrics(host.id, host.hostname);
    }
  }, 30_000);

  console.log('[netops] Monitoring started (30s interval)');
}

function teardown() {
  if (persistence) {
    persistence.close();
    persistence = null;
    console.log('[netops] Persistence closed');
  }
}

module.exports = { setup, teardown };
