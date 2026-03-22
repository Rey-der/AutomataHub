/**
 * Script Runner — main-handlers (orchestrator)
 * Slim entry point: creates shared dependencies, wires handler modules.
 *
 * Handler domains:
 *   handlers/scripts.js      — script discovery, import, removal
 *   handlers/topics.js       — topic CRUD operations
 *   handlers/organization.js — script-topic associations
 *   handlers/execution.js    — script execution, queue, logs
 */

const path = require('node:path');
const fs = require('node:fs');

const { ScriptStore } = require('./core/script-store');
const { ScriptPersistence } = require('./core/script-persistence');
const { ScriptExecutor } = require('./monitoring/script-executor');
const { ScriptScheduler } = require('./monitoring/scheduler');

const scriptsHandler = require('./handlers/scripts');
const topicsHandler = require('./handlers/topics');
const organizationHandler = require('./handlers/organization');
const executionHandler = require('./handlers/execution');
const chainsHandler = require('./handlers/chains');
const schedulesHandler = require('./handlers/schedules');

let persistence = null;
let executor = null;
let scheduler = null;


function setup(config) {
  const { ipcBridge, send, mainWindow, paths } = config;

  // Load hub utilities
  const hubApp = path.join(paths.root, 'app');
  const { ERROR_MESSAGES, friendlyError } = require(path.join(hubApp, 'core', 'errors'));
  const { resolveInside, ensureDir } = require(path.join(hubApp, 'core', 'path-utils'));
  const { readJsonConfig } = require(path.join(hubApp, 'core', 'config-utils'));

  // All scripts directory
  const scriptsDir = path.join(__dirname, 'automation_scripts');

  // Resolve database path for automation scripts
  // Priority: SMART_DESKTOP_DB env var → data/ inside hub root (new canonical location)
  const scriptEnv = {};
  const envDbPath = process.env.SMART_DESKTOP_DB;
  let resolvedDb = null;

  if (envDbPath && fs.existsSync(envDbPath)) {
    resolvedDb = envDbPath;
  } else {
    const local = path.resolve(paths.root, 'data', 'smart_desktop.db');
    if (fs.existsSync(local)) {
      resolvedDb = local;
    }
  }

  if (resolvedDb) {
    scriptEnv.SMART_DESKTOP_DB = resolvedDb;
    console.log('[script-runner] Database resolved:', resolvedDb);
  } else {
    console.warn('[script-runner] SMART_DESKTOP_DB not found — scripts requiring DB access will fail.');
    console.warn('[script-runner]   Expected: ' + path.resolve(paths.root, 'data', 'smart_desktop.db'));
    console.warn('[script-runner]   Set SMART_DESKTOP_DB env var to override.');
  }

  // --- Shared Dependencies ---

  const store = new ScriptStore();
  
  persistence = new ScriptPersistence();
  persistence.init().then(() => {
    persistence.loadIntoStore(store);
    store.setPersistence(persistence);
    console.log('[script-runner] SQLite persistence ready');
  }).catch(err => {
    console.error('[script-runner] Persistence init failed — running in-memory only:', err.message);
    persistence = null;
    store.setPersistence(null);
  });

  executor = new ScriptExecutor(scriptsDir, {
    env: scriptEnv,
    resolveInside,
    friendlyError,
    ERROR_MESSAGES,
  });

  function emit(channel, data) {
    if (send) send(channel, data);
  }

  // --- Wire Handler Modules ---

  const deps = {
    store,
    persistence,
    executor,
    emit,
    send,
    mainWindow,
    paths,
    resolveInside,
    ensureDir,
    readJsonConfig,
    ERROR_MESSAGES,
    friendlyError,
  };

  const { getAvailableScripts } = scriptsHandler.register(ipcBridge, deps);
  topicsHandler.register(ipcBridge, deps);
  organizationHandler.register(ipcBridge, deps);
  executionHandler.register(ipcBridge, deps);
  chainsHandler.register(ipcBridge, deps);

  // Run initial script discovery so the store is populated for the scheduler
  try {
    getAvailableScripts(scriptsDir);
  } catch (err) {
    console.warn('[script-runner] Initial discovery for scheduler failed:', err.message);
  }

  // Start cron scheduler for scripts with a `schedule` field
  scheduler = new ScriptScheduler(executor, store, emit);
  scheduler.start();

  // Register schedules handler after scheduler is available
  schedulesHandler.register(ipcBridge, { ...deps, scheduler });

  console.log('[script-runner] Module setup complete');
}

function teardown() {
  if (scheduler) {
    scheduler.stop();
    scheduler = null;
  }
  if (executor) {
    executor.killAll();
    executor = null;
  }
  if (persistence) {
    persistence.close();
    persistence = null;
  }
  console.log('[script-runner] Module teardown complete');
}

module.exports = { setup, teardown };
