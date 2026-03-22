/**
 * Integration test — script discovery
 * Verifies that getAvailableScripts correctly discovers script folders,
 * ignores _lib and hidden files, and reads config metadata.
 *
 * Run with: node --test tests/script-discovery.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createStore, createTempDir, cleanup } = require('./helpers');

// We need the register function from handlers/scripts.js, but it expects
// an ipcBridge and deps. We build minimal stubs to extract getAvailableScripts.

function buildDeps(store, scriptsDir) {
  return {
    store,
    emit: () => {},
    send: () => {},
    mainWindow: null,
    paths: { root: path.resolve(__dirname, '..', '..', '..') },
    resolveInside: (target, base) => {
      const resolved = fs.realpathSync(target);
      const baseReal = fs.realpathSync(base);
      if (resolved !== baseReal && !resolved.startsWith(baseReal + path.sep)) {
        throw new Error('Path outside allowed directory');
      }
      return resolved;
    },
    ensureDir: (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); },
    readJsonConfig: (filePath, onError, fallback = {}) => {
      if (!fs.existsSync(filePath)) return fallback;
      try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
      catch (err) { if (typeof onError === 'function') onError(filePath, err); return fallback; }
    },
    ERROR_MESSAGES: {},
  };
}

describe('Script Discovery', () => {
  let scriptsDir;
  let getAvailableScripts;
  let store;

  before(() => {
    scriptsDir = createTempDir('sr-discovery');

    // 1. Valid script with config.json + main.js
    const validDir = path.join(scriptsDir, 'my-script');
    fs.mkdirSync(validDir, { recursive: true });
    fs.writeFileSync(path.join(validDir, 'config.json'), JSON.stringify({
      name: 'My Script',
      description: 'A test automation',
      mainScript: 'main.js',
    }));
    fs.writeFileSync(path.join(validDir, 'main.js'), 'console.log("hello");');

    // 2. Valid script with csharp subfolder variant
    const multiDir = path.join(scriptsDir, 'multi-lang');
    fs.mkdirSync(path.join(multiDir, 'csharp'), { recursive: true });
    fs.writeFileSync(path.join(multiDir, 'config.json'), JSON.stringify({
      name: 'Multi Language',
      description: 'JS + C#',
      mainScript: 'main.js',
    }));
    fs.writeFileSync(path.join(multiDir, 'main.js'), 'console.log("js");');
    fs.writeFileSync(path.join(multiDir, 'csharp', 'Program.cs'), 'class P { static void Main() {} }');

    // 3. _lib folder — must be ignored
    const libDir = path.join(scriptsDir, '_lib');
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, 'db.js'), 'module.exports = {};');

    // 4. .DS_Store file — must be ignored (not a directory)
    fs.writeFileSync(path.join(scriptsDir, '.DS_Store'), '');

    // 5. Empty folder (no executables) — must be ignored
    fs.mkdirSync(path.join(scriptsDir, 'empty-folder'), { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, 'empty-folder', 'README.md'), '# Nothing');

    // 6. Folder with no config but has an executable
    const noConfigDir = path.join(scriptsDir, 'no-config');
    fs.mkdirSync(noConfigDir, { recursive: true });
    fs.writeFileSync(path.join(noConfigDir, 'run.sh'), '#!/bin/bash\necho hi');

    // Build deps and register
    store = createStore();
    const ipcBridge = { handle: () => {} };
    const deps = buildDeps(store, scriptsDir);
    const scriptsModule = require('../handlers/scripts');
    const result = scriptsModule.register(ipcBridge, deps);
    getAvailableScripts = result.getAvailableScripts;
  });

  after(() => {
    cleanup();
  });

  it('discovers valid script folders', () => {
    const scripts = getAvailableScripts(scriptsDir);
    const ids = scripts.map(s => s.id);
    assert.ok(ids.includes('my-script'), 'should find my-script');
    assert.ok(ids.includes('multi-lang'), 'should find multi-lang');
  });

  it('reads config.json metadata', () => {
    getAvailableScripts(scriptsDir);
    const script = store.getScript('my-script');
    assert.equal(script.name, 'My Script');
    assert.equal(script.description, 'A test automation');
  });

  it('detects subfolder variants', () => {
    getAvailableScripts(scriptsDir);
    const script = store.getScript('multi-lang');
    assert.ok(script.variants.length >= 2, `should have at least 2 variants, got ${script.variants.length}`);
    const languages = script.variants.map(v => v.language);
    assert.ok(languages.includes('JS'), 'should have JS variant');
    assert.ok(languages.includes('C#'), 'should have C# variant');
  });

  it('ignores _lib folder', () => {
    const scripts = getAvailableScripts(scriptsDir);
    const ids = scripts.map(s => s.id);
    assert.ok(!ids.includes('_lib'), '_lib should not appear as a script');
  });

  it('ignores .DS_Store (not a directory)', () => {
    const scripts = getAvailableScripts(scriptsDir);
    const ids = scripts.map(s => s.id);
    assert.ok(!ids.includes('.DS_Store'), '.DS_Store should not appear');
  });

  it('ignores folders with no executables', () => {
    const scripts = getAvailableScripts(scriptsDir);
    const ids = scripts.map(s => s.id);
    assert.ok(!ids.includes('empty-folder'), 'empty-folder should not appear');
  });

  it('discovers scripts without config.json (falls back to folder name)', () => {
    const scripts = getAvailableScripts(scriptsDir);
    const noConfig = scripts.find(s => s.id === 'no-config');
    assert.ok(noConfig, 'should find no-config folder');
    assert.equal(noConfig.name, 'no-config');
  });

  it('populates store correctly', () => {
    getAvailableScripts(scriptsDir);
    const allScripts = store.getAllScripts();
    // Should have: my-script, multi-lang, no-config
    assert.ok(allScripts.length >= 3, `should have at least 3 scripts in store, got ${allScripts.length}`);
  });
});
