/**
 * Unit tests for modules/netops/core/alert-engine.js
 * Run with: node --test modules/netops/tests/alert-engine.test.js
 *
 * Mocks Electron's Notification API since tests run in plain Node.js.
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// --- Mock Electron (alert-engine imports Notification) ---
const electronMock = {
  Notification: class Notification {
    constructor() { this.shown = false; }
    show() { this.shown = true; }
  },
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'electron') return 'electron';
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
require.cache.electron = { id: 'electron', filename: 'electron', loaded: true, exports: electronMock };

const { NetOpsStore } = require('../core/data-store');
const { AlertEngine } = require('../core/alert-engine');

after(() => {
  Module._resolveFilename = originalResolveFilename;
  delete require.cache.electron;
});

describe('AlertEngine', () => {
  let store;
  let engine;
  let emitted;

  beforeEach(() => {
    store = new NetOpsStore();
    emitted = [];
    engine = new AlertEngine(store, null, (channel, data) => emitted.push({ channel, data }));
  });

  // ── Rule CRUD ─────────────────────────────────────────────────

  describe('rule management', () => {
    it('adds a rule with generated id', () => {
      const rule = engine.addRule({ metric: 'latency_ms', operator: '>', threshold: '100' });
      assert.ok(rule.id > 0);
      assert.equal(rule.metric, 'latency_ms');
      assert.equal(rule.severity, 'warning');
    });

    it('deletes a rule', () => {
      const rule = engine.addRule({ metric: 'status', operator: '==', threshold: 'offline' });
      engine.deleteRule(rule.id);
      assert.equal(store.getAllAlertRules().length, 0);
    });
  });

  // ── Evaluation — threshold operators ──────────────────────────

  describe('evaluate', () => {
    it('fires alert when latency exceeds threshold', () => {
      store.addHost({ id: 1, hostname: 'h' });
      engine.addRule({ host_id: 1, metric: 'latency_ms', operator: '>', threshold: '100', severity: 'warning' });

      engine.evaluate(1, { status: 'online', latency_ms: 200 });

      assert.ok(emitted.some(e => e.channel === 'netops:alert-triggered'));
      assert.equal(store.getActiveAlertCount(), 1);
    });

    it('does not fire when threshold not exceeded', () => {
      store.addHost({ id: 1, hostname: 'h' });
      engine.addRule({ host_id: 1, metric: 'latency_ms', operator: '>', threshold: '100' });

      engine.evaluate(1, { status: 'online', latency_ms: 50 });

      assert.equal(emitted.length, 0);
      assert.equal(store.getActiveAlertCount(), 0);
    });

    it('fires on status changes_to offline', () => {
      store.addHost({ id: 1, hostname: 'h' });
      engine.addRule({ host_id: 1, metric: 'status', operator: 'changes_to', threshold: 'offline' });

      // First eval: status online — sets previous value
      engine.evaluate(1, { status: 'online', latency_ms: 10 });
      assert.equal(emitted.length, 0);

      // Second eval: status offline — triggers change
      engine.evaluate(1, { status: 'offline', latency_ms: null });
      assert.ok(emitted.some(e => e.channel === 'netops:alert-triggered'));
    });

    it('does not re-fire changes_to when value stays the same', () => {
      store.addHost({ id: 1, hostname: 'h' });
      engine.addRule({ host_id: 1, metric: 'status', operator: 'changes_to', threshold: 'offline' });

      engine.evaluate(1, { status: 'online' });
      engine.evaluate(1, { status: 'offline' });
      const triggered = emitted.filter(e => e.channel === 'netops:alert-triggered').length;

      // Same value again — should not re-fire (may auto-resolve instead)
      engine.evaluate(1, { status: 'offline' });
      assert.equal(
        emitted.filter(e => e.channel === 'netops:alert-triggered').length,
        triggered,
      );
    });

    it('respects cooldown period', () => {
      store.addHost({ id: 1, hostname: 'h' });
      engine.addRule({ host_id: 1, metric: 'latency_ms', operator: '>', threshold: '50', cooldown_min: 60 });

      engine.evaluate(1, { status: 'online', latency_ms: 100 });
      const first = emitted.length;

      // Immediate re-evaluation — should be in cooldown
      engine.evaluate(1, { status: 'online', latency_ms: 200 });
      assert.equal(emitted.length, first, 'should not fire again during cooldown');
    });

    it('skips disabled rules', () => {
      store.addHost({ id: 1, hostname: 'h' });
      const rule = engine.addRule({ host_id: 1, metric: 'latency_ms', operator: '>', threshold: '50' });
      engine.updateRule(rule.id, { enabled: 0 });

      engine.evaluate(1, { status: 'online', latency_ms: 100 });
      assert.equal(emitted.length, 0);
    });

    it('evaluates global rules (host_id null) against any host', () => {
      store.addHost({ id: 1, hostname: 'h' });
      engine.addRule({ host_id: null, metric: 'latency_ms', operator: '>', threshold: '100' });

      engine.evaluate(1, { status: 'online', latency_ms: 200 });
      assert.ok(emitted.some(e => e.channel === 'netops:alert-triggered'));
    });

    it('handles != operator', () => {
      store.addHost({ id: 1, hostname: 'h' });
      engine.addRule({ host_id: 1, metric: 'status', operator: '!=', threshold: 'online' });

      engine.evaluate(1, { status: 'offline' });
      assert.ok(emitted.some(e => e.channel === 'netops:alert-triggered'));
    });

    it('handles < operator', () => {
      store.addHost({ id: 1, hostname: 'h' });
      engine.addRule({ host_id: 1, metric: 'latency_ms', operator: '<', threshold: '10' });

      engine.evaluate(1, { status: 'online', latency_ms: 5 });
      assert.ok(emitted.some(e => e.channel === 'netops:alert-triggered'));
    });
  });

  // ── Alert acknowledgement ─────────────────────────────────────

  describe('acknowledgeAlert', () => {
    it('reduces active count', () => {
      store.addHost({ id: 1, hostname: 'h' });
      engine.addRule({ host_id: 1, metric: 'latency_ms', operator: '>', threshold: '50' });
      engine.evaluate(1, { status: 'online', latency_ms: 100 });
      assert.equal(engine.getActiveCount(), 1);

      const alerts = engine.getAlerts();
      engine.acknowledgeAlert(alerts[0].id);
      assert.equal(engine.getActiveCount(), 0);
    });
  });
});
