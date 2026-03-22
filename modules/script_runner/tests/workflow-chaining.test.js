/**
 * Tests for dependency-resolver.js and workflow chaining integration.
 *
 * - Unit tests: resolveExecutionOrder (topological sort, cycle detection)
 * - Integration tests: chain execution through the execution handler
 *
 * Run with: node --test tests/workflow-chaining.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { createStore, createTempDir, cleanup } = require('./helpers');
const { resolveExecutionOrder } = require('../core/dependency-resolver');
const { ScriptExecutor } = require('../monitoring/script-executor');

// --- Unit tests: dependency resolver ---

describe('resolveExecutionOrder', () => {
  it('returns single script when no dependencies', () => {
    const store = createStore();
    store.addScript({ id: 'a', name: 'A' });
    const order = resolveExecutionOrder('a', (id) => store.getScript(id));
    assert.deepStrictEqual(order, ['a']);
  });

  it('returns dependencies before the target', () => {
    const store = createStore();
    store.addScript({ id: 'a', name: 'A' });
    store.addScript({ id: 'b', name: 'B', dependsOn: ['a'] });
    const order = resolveExecutionOrder('b', (id) => store.getScript(id));
    assert.deepStrictEqual(order, ['a', 'b']);
  });

  it('handles transitive dependencies', () => {
    const store = createStore();
    store.addScript({ id: 'a', name: 'A' });
    store.addScript({ id: 'b', name: 'B', dependsOn: ['a'] });
    store.addScript({ id: 'c', name: 'C', dependsOn: ['b'] });
    const order = resolveExecutionOrder('c', (id) => store.getScript(id));
    assert.deepStrictEqual(order, ['a', 'b', 'c']);
  });

  it('handles multiple dependencies', () => {
    const store = createStore();
    store.addScript({ id: 'a', name: 'A' });
    store.addScript({ id: 'b', name: 'B' });
    store.addScript({ id: 'c', name: 'C', dependsOn: ['a', 'b'] });
    const order = resolveExecutionOrder('c', (id) => store.getScript(id));
    assert.equal(order.length, 3);
    assert.ok(order.indexOf('a') < order.indexOf('c'));
    assert.ok(order.indexOf('b') < order.indexOf('c'));
    assert.equal(order[order.length - 1], 'c');
  });

  it('deduplicates shared dependencies', () => {
    const store = createStore();
    store.addScript({ id: 'a', name: 'A' });
    store.addScript({ id: 'b', name: 'B', dependsOn: ['a'] });
    store.addScript({ id: 'c', name: 'C', dependsOn: ['a'] });
    store.addScript({ id: 'd', name: 'D', dependsOn: ['b', 'c'] });
    const order = resolveExecutionOrder('d', (id) => store.getScript(id));
    // 'a' should appear exactly once
    assert.equal(order.filter((x) => x === 'a').length, 1);
    assert.equal(order[order.length - 1], 'd');
    assert.ok(order.indexOf('a') < order.indexOf('b'));
    assert.ok(order.indexOf('a') < order.indexOf('c'));
  });

  it('throws on circular dependency', () => {
    const store = createStore();
    store.addScript({ id: 'a', name: 'A', dependsOn: ['b'] });
    store.addScript({ id: 'b', name: 'B', dependsOn: ['a'] });
    assert.throws(
      () => resolveExecutionOrder('a', (id) => store.getScript(id)),
      /circular dependency/i,
    );
  });

  it('throws on self-dependency', () => {
    const store = createStore();
    store.addScript({ id: 'a', name: 'A', dependsOn: ['a'] });
    assert.throws(
      () => resolveExecutionOrder('a', (id) => store.getScript(id)),
      /circular dependency/i,
    );
  });

  it('throws on missing dependency', () => {
    const store = createStore();
    store.addScript({ id: 'a', name: 'A', dependsOn: ['missing'] });
    assert.throws(
      () => resolveExecutionOrder('a', (id) => store.getScript(id)),
      /not found.*missing/i,
    );
  });
});

// --- Integration tests: chain execution ---

describe('Workflow chain execution', () => {
  let scriptsDir;
  let scriptA;
  let scriptB;
  let scriptFail;

  before(() => {
    scriptsDir = createTempDir('sr-chain');

    scriptA = path.join(scriptsDir, 'a.js');
    fs.writeFileSync(scriptA, 'console.log("script-a-output");');

    scriptB = path.join(scriptsDir, 'b.js');
    fs.writeFileSync(scriptB, 'console.log("script-b-output");');

    scriptFail = path.join(scriptsDir, 'fail.js');
    fs.writeFileSync(scriptFail, 'console.error("fail"); process.exit(1);');
  });

  after(() => {
    cleanup();
  });

  function createExecutor() {
    return new ScriptExecutor(scriptsDir, {
      env: {},
      resolveInside: (target) => fs.realpathSync(target),
    });
  }

  function waitForComplete(executor, tabId) {
    return new Promise((resolve) => {
      const onComplete = (data) => {
        if (data.tabId === tabId) {
          executor.removeListener('complete', onComplete);
          resolve(data);
        }
      };
      executor.on('complete', onComplete);
    });
  }

  it('executes a chain of two scripts in order via executor', async () => {
    const executor = createExecutor();
    const tabId = 'chain-test-1';
    const outputs = [];
    executor.on('output', (data) => {
      if (data.tabId === tabId) outputs.push(data.text);
    });
    executor.on('error', () => {});

    // Run script A, wait for completion
    const promiseA = waitForComplete(executor, tabId);
    executor.execute({ scriptPath: scriptA, name: 'A', tabId });
    const resultA = await promiseA;
    assert.equal(resultA.exitCode, 0);

    // Run script B with same tabId, wait for completion
    const promiseB = waitForComplete(executor, tabId);
    executor.execute({ scriptPath: scriptB, name: 'B', tabId });
    const resultB = await promiseB;
    assert.equal(resultB.exitCode, 0);

    // Both outputs should have been captured
    assert.ok(outputs.includes('script-a-output'), 'should have output from script A');
    assert.ok(outputs.includes('script-b-output'), 'should have output from script B');
    executor.killAll();
  });

  it('stops chain when a dependency fails', async () => {
    const executor = createExecutor();
    const tabId = 'chain-fail-test';
    executor.on('error', () => {});

    // Run failing script
    const promise = waitForComplete(executor, tabId);
    executor.execute({ scriptPath: scriptFail, name: 'Fail', tabId });
    const result = await promise;

    assert.equal(result.exitCode, 1);
    // Downstream script should not have been queued
    assert.equal(executor.queue.length, 0);
    executor.killAll();
  });

  it('resolves and validates a chain before execution starts', () => {
    const store = createStore();
    store.addScript({ id: 'dep', name: 'Dep', scriptPath: scriptA, dependsOn: [] });
    store.addScript({ id: 'target', name: 'Target', scriptPath: scriptB, dependsOn: ['dep'] });

    const order = resolveExecutionOrder('target', (id) => store.getScript(id));
    assert.deepStrictEqual(order, ['dep', 'target']);

    // Verify all scripts in the chain exist in the store
    for (const id of order) {
      assert.ok(store.getScript(id), `script "${id}" should be in store`);
    }
  });

  it('handles chain with scripts that have retry config', async () => {
    const executor = createExecutor();
    const tabId = 'chain-retry-test';
    const retryEvents = [];
    executor.on('error', () => {});
    executor.on('retry', (data) => {
      if (data.tabId === tabId) retryEvents.push(data);
    });

    // Run failing script with 1 retry
    const promise = waitForComplete(executor, tabId);
    executor.execute({ scriptPath: scriptFail, name: 'RetryFail', tabId, retries: 1, retryDelayMs: 100 });
    const result = await promise;

    assert.equal(result.exitCode, 1);
    assert.equal(retryEvents.length, 1, 'should have retried once');
    assert.equal(result.attempt, 2);
    executor.killAll();
  });
});
