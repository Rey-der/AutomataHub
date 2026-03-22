/**
 * Shared test helpers for Script Runner tests.
 *
 * Provides:
 *   - createStore()        — fresh in-memory ScriptStore
 *   - createPersistence()  — ScriptPersistence backed by a temp file
 *   - createTempDir()      — unique temp directory (auto-cleaned in cleanup)
 *   - cleanup()            — removes all temp artefacts
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { ScriptStore } = require('../core/script-store');
const { ScriptPersistence } = require('../core/script-persistence');

const _tempDirs = [];
const _tempFiles = [];

function createStore() {
  return new ScriptStore();
}

async function createPersistence(dbPath) {
  const target = dbPath || path.join(os.tmpdir(), `sr-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  _tempFiles.push(target);
  const p = new ScriptPersistence(target);
  await p.init();
  return p;
}

function createTempDir(prefix = 'sr-test') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  _tempDirs.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of _tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  _tempDirs.length = 0;
  for (const file of _tempFiles) {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  }
  _tempFiles.length = 0;
}

module.exports = { createStore, createPersistence, createTempDir, cleanup };
