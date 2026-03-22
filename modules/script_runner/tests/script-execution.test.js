/**
 * Integration test — script execution + tracking
 * Verifies that ScriptExecutor runs scripts, emits correct events,
 * and that execution tracking records appear in the database.
 *
 * Run with: node --test tests/script-execution.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createTempDir, cleanup } = require('./helpers');
const { ScriptExecutor } = require('../monitoring/script-executor');

function waitForComplete(executor, tabId) {
  return new Promise((resolve) => {
    executor.on('complete', (data) => {
      if (data.tabId === tabId) resolve(data);
    });
  });
}

describe('ScriptExecutor', () => {
  let scriptsDir;
  let successScript;
  let failScript;
  let outputScript;

  before(() => {
    scriptsDir = createTempDir('sr-exec');

    // Script that succeeds (exit 0)
    successScript = path.join(scriptsDir, 'success.js');
    fs.writeFileSync(successScript, 'console.log("hello from success");');

    // Script that fails (exit 1)
    failScript = path.join(scriptsDir, 'fail.js');
    fs.writeFileSync(failScript, 'console.error("something went wrong"); process.exit(1);');

    // Script that produces multi-line output
    outputScript = path.join(scriptsDir, 'output.js');
    fs.writeFileSync(outputScript, 'console.log("line1"); console.log("line2"); console.log("line3");');
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

  it('runs a successful script and emits complete with exit code 0', async () => {
    const executor = createExecutor();
    const tabId = 'test-success';
    const promise = waitForComplete(executor, tabId);

    executor.execute({ scriptPath: successScript, name: 'success.js', tabId });
    const result = await promise;

    assert.equal(result.exitCode, 0);
    assert.equal(result.signal, null);
    assert.ok(result.runtime >= 0);
    executor.killAll();
  });

  it('runs a failing script and emits complete with exit code 1', async () => {
    const executor = createExecutor();
    const tabId = 'test-fail';
    executor.on('error', () => {});
    const promise = waitForComplete(executor, tabId);

    executor.execute({ scriptPath: failScript, name: 'fail.js', tabId });
    const result = await promise;

    assert.equal(result.exitCode, 1);
    executor.killAll();
  });

  it('emits output events for stdout', async () => {
    const executor = createExecutor();
    const tabId = 'test-output';
    const outputs = [];

    executor.on('output', (data) => {
      if (data.tabId === tabId) outputs.push(data.text);
    });

    const promise = waitForComplete(executor, tabId);
    executor.execute({ scriptPath: outputScript, name: 'output.js', tabId });
    await promise;

    assert.ok(outputs.length >= 3, `should have at least 3 output lines, got ${outputs.length}`);
    assert.ok(outputs.includes('line1'));
    assert.ok(outputs.includes('line2'));
    assert.ok(outputs.includes('line3'));
    executor.killAll();
  });

  it('emits error events for stderr', async () => {
    const executor = createExecutor();
    const tabId = 'test-stderr';
    const errors = [];

    executor.on('error', (data) => {
      if (data.tabId === tabId) errors.push(data.text);
    });

    const promise = waitForComplete(executor, tabId);
    executor.execute({ scriptPath: failScript, name: 'fail.js', tabId });
    await promise;

    assert.ok(errors.some(e => e.includes('something went wrong')), 'should capture stderr output');
    executor.killAll();
  });

  it('queues jobs when one is already running', async () => {
    const executor = createExecutor();
    const queueEvents = [];

    executor.on('queue-status', (data) => queueEvents.push(data));

    const p1 = waitForComplete(executor, 'job1');
    const p2 = waitForComplete(executor, 'job2');

    executor.execute({ scriptPath: outputScript, name: 'output.js', tabId: 'job1' });
    executor.execute({ scriptPath: successScript, name: 'success.js', tabId: 'job2' });

    await Promise.all([p1, p2]);

    assert.ok(queueEvents.length > 0, 'should have emitted queue-status events');
    assert.equal(queueEvents[0].tabId, 'job2');
    assert.equal(queueEvents[0].position, 1);
    executor.killAll();
  });

  it('stops a running script', async () => {
    const executor = createExecutor();
    const tabId = 'test-stop';

    // Script that runs for a long time
    const longScript = path.join(scriptsDir, 'long.js');
    fs.writeFileSync(longScript, 'setTimeout(() => {}, 30000);');

    const promise = waitForComplete(executor, tabId);
    executor.execute({ scriptPath: longScript, name: 'long.js', tabId });

    // Give it a moment to start, then stop
    await new Promise(r => setTimeout(r, 200));
    executor.stop(tabId);

    const result = await promise;
    assert.ok(result.signal || result.exitCode !== 0, 'should have been terminated');
    executor.killAll();
  });

  it('retries a failed script when retries > 0', async () => {
    const executor = createExecutor();
    const tabId = 'test-retry';
    const retryEvents = [];

    executor.on('error', () => {});
    executor.on('retry', (data) => {
      if (data.tabId === tabId) retryEvents.push(data);
    });

    const promise = waitForComplete(executor, tabId);
    executor.execute({
      scriptPath: failScript,
      name: 'fail.js',
      tabId,
      retries: 1,
      retryDelayMs: 100,
    });

    const result = await promise;

    assert.equal(retryEvents.length, 1, 'should have retried once');
    assert.equal(retryEvents[0].attempt, 1);
    assert.equal(retryEvents[0].maxAttempts, 2);
    assert.equal(result.exitCode, 1);
    assert.equal(result.attempt, 2);
    assert.equal(result.maxAttempts, 2);
    executor.killAll();
  });

  it('emits complete with correct fields', async () => {
    const executor = createExecutor();
    const tabId = 'test-fields';
    const promise = waitForComplete(executor, tabId);

    executor.execute({ scriptPath: successScript, name: 'success.js', tabId });
    const result = await promise;

    assert.equal(typeof result.tabId, 'string');
    assert.equal(typeof result.exitCode, 'number');
    assert.equal(typeof result.runtime, 'number');
    assert.ok('signal' in result);
    executor.killAll();
  });

  it('handles non-existent script gracefully', async () => {
    const executor = createExecutor();
    const tabId = 'test-missing';
    const errors = [];

    executor.on('error', (data) => {
      if (data.tabId === tabId) errors.push(data.text);
    });

    const promise = waitForComplete(executor, tabId);
    executor.execute({ scriptPath: path.join(scriptsDir, 'nonexistent.js'), name: 'missing', tabId });
    const result = await promise;

    assert.equal(result.exitCode, 1);
    assert.ok(errors.length > 0, 'should emit an error event');
    executor.killAll();
  });
});
