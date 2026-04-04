/**
 * Unit tests for modules/netops/core/data-store.js
 * Run with: node --test modules/netops/tests/data-store.test.js
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { NetOpsStore } = require('../core/data-store');

describe('NetOpsStore', () => {
  let store;

  beforeEach(() => {
    store = new NetOpsStore();
  });

  // ── Host CRUD ──────────────────────────────────────────────────

  describe('hosts', () => {
    it('adds and retrieves a host', () => {
      store.addHost({ id: 1, hostname: '10.0.0.1', enabled: true });
      assert.equal(store.getHost(1).hostname, '10.0.0.1');
    });

    it('returns null for unknown host', () => {
      assert.equal(store.getHost(999), null);
    });

    it('removes a host and its status cache', () => {
      store.addHost({ id: 1, hostname: '10.0.0.1', enabled: true });
      store.setStatus(1, { status: 'online', latency_ms: 5, timestamp: new Date().toISOString() });
      store.removeHost(1);
      assert.equal(store.getHost(1), null);
      assert.equal(store.getStatus(1), null);
    });

    it('getAllHosts filters by enabled', () => {
      store.addHost({ id: 1, hostname: 'a', enabled: true });
      store.addHost({ id: 2, hostname: 'b', enabled: false });
      assert.equal(store.getAllHosts().length, 2);
      assert.equal(store.getAllHosts(true).length, 1);
    });

    it('updateHost merges fields', () => {
      store.addHost({ id: 1, hostname: 'a', alias: '' });
      store.updateHost(1, { alias: 'web-server' });
      assert.equal(store.getHost(1).alias, 'web-server');
      assert.equal(store.getHost(1).hostname, 'a');
    });

    it('updateHost returns null for missing host', () => {
      assert.equal(store.updateHost(999, { alias: 'x' }), null);
    });

    it('normalises string id to number', () => {
      store.addHost({ id: 5, hostname: 'x' });
      assert.equal(store.getHost('5').hostname, 'x');
    });
  });

  // ── Status & heartbeat ────────────────────────────────────────

  describe('status & heartbeat', () => {
    it('tracks heartbeat segments via setStatus', () => {
      store.addHost({ id: 1, hostname: 'h' });
      for (let i = 0; i < 5; i++) {
        store.setStatus(1, { status: 'online', latency_ms: i, timestamp: new Date().toISOString() });
      }
      const beats = store.getHeartbeat(1, 3);
      assert.equal(beats.length, 3);
      assert.equal(beats[0].latency_ms, 2);
    });

    it('syncs host.last_status on setStatus', () => {
      store.addHost({ id: 1, hostname: 'h', last_status: 'unknown' });
      store.setStatus(1, { status: 'offline', latency_ms: null, timestamp: new Date().toISOString() });
      assert.equal(store.getHost(1).last_status, 'offline');
    });

    it('returns empty beats for unknown host', () => {
      assert.deepEqual(store.getHeartbeat(99), []);
    });
  });

  // ── History & uptime ──────────────────────────────────────────

  describe('history & uptime', () => {
    it('computes uptime percentage from history', () => {
      store.addHost({ id: 1, hostname: 'h' });
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        store.addHistory({
          host_id: 1,
          status: i < 8 ? 'online' : 'offline',
          timestamp: new Date(now - i * 1000).toISOString(),
        });
      }
      const stats = store.getUptimeStats(1, new Date(now - 20_000));
      assert.equal(stats.total_checks, 10);
      assert.equal(stats.online_checks, 8);
      assert.equal(stats.uptime_percent, 80);
    });

    it('returns zero uptime when no history', () => {
      const stats = store.getUptimeStats(1, new Date(0));
      assert.equal(stats.uptime_percent, 0);
      assert.equal(stats.total_checks, 0);
    });

    it('getHistory returns most recent first', () => {
      const now = Date.now();
      store.addHistory({ host_id: 1, status: 'online', timestamp: new Date(now - 5000).toISOString() });
      store.addHistory({ host_id: 1, status: 'offline', timestamp: new Date(now).toISOString() });
      const hist = store.getHistory(1, 10);
      assert.equal(hist[0].status, 'offline');
    });
  });

  // ── Events (status changes) ───────────────────────────────────

  describe('events', () => {
    it('stores and retrieves recent events', () => {
      store.addStatusChange({ host_id: 1, from: 'online', to: 'offline', timestamp: new Date().toISOString() });
      const events = store.getRecentEvents(5);
      assert.equal(events.length, 1);
      assert.equal(events[0].to, 'offline');
    });

    it('caps status changes at 500', () => {
      for (let i = 0; i < 510; i++) {
        store.addStatusChange({ host_id: 1, i, timestamp: new Date().toISOString() });
      }
      // Internal array should have been trimmed
      assert.ok(store.statusChanges.length <= 500);
    });
  });

  // ── Metrics ───────────────────────────────────────────────────

  describe('metrics', () => {
    it('pushes and queries system metrics', () => {
      const now = Date.now();
      store.pushMetric('system', { host_id: 1, cpu_percent: 42, memory_percent: 60, timestamp: new Date(now).toISOString() });
      store.pushMetric('system', { host_id: 1, cpu_percent: 55, memory_percent: 70, timestamp: new Date(now + 1000).toISOString() });

      const metrics = store.getMetrics('system', 1, new Date(now - 1000), 100);
      assert.equal(metrics.length, 2);
    });

    it('getAggregateMetrics computes averages and maxes', () => {
      const now = Date.now();
      store.pushMetric('system', { host_id: 1, cpu_percent: 40, memory_percent: 50, timestamp: new Date(now).toISOString() });
      store.pushMetric('system', { host_id: 1, cpu_percent: 60, memory_percent: 70, timestamp: new Date(now + 1000).toISOString() });

      const agg = store.getAggregateMetrics(1, new Date(now - 1000));
      assert.equal(agg.system.avg_cpu_percent, 50);
      assert.equal(agg.system.max_cpu_percent, 60);
      assert.equal(agg.system.avg_memory_percent, 60);
      assert.equal(agg.system.max_memory_percent, 70);
    });

    it('throws on unknown metric type', () => {
      assert.throws(() => store.pushMetric('buffer', {}), /Unknown metrics type/);
    });
  });

  // ── Alert rules ───────────────────────────────────────────────

  describe('alert rules', () => {
    it('adds and retrieves a rule', () => {
      store.addAlertRule({ id: 1, host_id: 10, metric: 'status', operator: 'changes_to', threshold: 'offline', enabled: 1 });
      const rules = store.getAlertRules(10);
      assert.equal(rules.length, 1);
      assert.equal(rules[0].metric, 'status');
    });

    it('includes global rules (host_id == null) in getAlertRules', () => {
      store.addAlertRule({ id: 1, host_id: null, metric: 'latency_ms', operator: '>', threshold: '100', enabled: 1 });
      const rules = store.getAlertRules(42);
      assert.equal(rules.length, 1);
    });

    it('updates a rule', () => {
      store.addAlertRule({ id: 1, host_id: 10, threshold: '100', enabled: 1 });
      store.updateAlertRule(1, { threshold: '200' });
      assert.equal(store.getAlertRule(1).threshold, '200');
    });

    it('removes a rule', () => {
      store.addAlertRule({ id: 1, host_id: 10, enabled: 1 });
      store.removeAlertRule(1);
      assert.equal(store.getAllAlertRules().length, 0);
    });
  });

  // ── Alert history ─────────────────────────────────────────────

  describe('alert history', () => {
    it('adds alert and tracks active count', () => {
      store.addAlert({ id: 1, rule_id: 10, host_id: 1, severity: 'critical', acknowledged: 0, resolved_at: null, triggered_at: new Date().toISOString() });
      assert.equal(store.getActiveAlertCount(), 1);
    });

    it('acknowledgeAlert marks alert', () => {
      store.addAlert({ id: 1, rule_id: 10, host_id: 1, severity: 'critical', acknowledged: 0, resolved_at: null, triggered_at: new Date().toISOString() });
      store.acknowledgeAlert(1);
      assert.equal(store.getActiveAlertCount(), 0);
    });

    it('resolveAlert sets resolved_at', () => {
      store.addAlert({ id: 1, rule_id: 10, host_id: 1, severity: 'warning', acknowledged: 0, resolved_at: null, triggered_at: new Date().toISOString() });
      store.resolveAlert(1, new Date().toISOString());
      assert.equal(store.getActiveAlertCount(), 0);
    });

    it('getAlertHistory filters by severity', () => {
      store.addAlert({ id: 1, rule_id: 10, host_id: 1, severity: 'warning', acknowledged: 0, triggered_at: new Date().toISOString() });
      store.addAlert({ id: 2, rule_id: 11, host_id: 1, severity: 'critical', acknowledged: 0, triggered_at: new Date().toISOString() });
      const critical = store.getAlertHistory({ severity: 'critical' });
      assert.equal(critical.length, 1);
      assert.equal(critical[0].severity, 'critical');
    });

    it('caps history at 1000 entries', () => {
      for (let i = 0; i < 1010; i++) {
        store.addAlert({ id: i, rule_id: 1, host_id: 1, severity: 'warning', triggered_at: new Date().toISOString() });
      }
      assert.ok(store.alertHistory.length <= 1000);
    });
  });

  // ── Discovered networks ───────────────────────────────────────

  describe('discovered networks', () => {
    it('adds and finds network by CIDR', () => {
      store.addDiscoveredNetwork({ id: 1, cidr: '192.168.1.0/24', name: 'LAN', discovered_at: new Date().toISOString() });
      assert.equal(store.findDiscoveredNetwork('192.168.1.0/24').name, 'LAN');
    });

    it('computes host_count and online_count', () => {
      store.addDiscoveredNetwork({ id: 1, cidr: '10.0.0.0/24', name: 'Net' });
      store.addDiscoveredHost({ ip: '10.0.0.1', network_id: 1, status: 'online' });
      store.addDiscoveredHost({ ip: '10.0.0.2', network_id: 1, status: 'offline' });
      const nets = store.getDiscoveredNetworks();
      assert.equal(nets[0].host_count, 2);
      assert.equal(nets[0].online_count, 1);
    });

    it('removeDiscoveredNetwork cascades to hosts', () => {
      store.addDiscoveredNetwork({ id: 1, cidr: '10.0.0.0/24' });
      store.addDiscoveredHost({ ip: '10.0.0.1', network_id: 1 });
      const result = store.removeDiscoveredNetwork(1);
      assert.equal(result.hostCount, 1);
      assert.equal(store.getDiscoveredHosts(1).length, 0);
    });
  });
});
