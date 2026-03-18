/**
 * Unit tests for app/core/db-scanner.js
 * Run with: node --test tests/db-scanner.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { scanForDatabases } = require('../app/core/db-scanner');

// Build a temp project tree for scanning
const TMP_ROOT = path.join(os.tmpdir(), `dbscanner-test-${Date.now()}`);
const TMP_USERDATA = path.join(os.tmpdir(), `dbscanner-ud-${Date.now()}`);

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function touch(filePath) {
  mkdirp(path.dirname(filePath));
  fs.writeFileSync(filePath, '');
}

describe('db-scanner', () => {

  before(() => {
    // data/ — hub databases
    touch(path.join(TMP_ROOT, 'data', 'app.db'));
    touch(path.join(TMP_ROOT, 'data', 'nested', 'deep.sqlite'));

    // modules/my_mod/ — module databases with manifest
    mkdirp(path.join(TMP_ROOT, 'modules', 'my_mod'));
    fs.writeFileSync(
      path.join(TMP_ROOT, 'modules', 'my_mod', 'manifest.json'),
      JSON.stringify({ id: 'my_mod', name: 'My Module' })
    );
    touch(path.join(TMP_ROOT, 'modules', 'my_mod', 'store.sqlite3'));

    // modules/other/ — no manifest, falls back to folder name
    touch(path.join(TMP_ROOT, 'modules', 'other', 'data.db'));

    // Root-level stray DB
    touch(path.join(TMP_ROOT, 'stray.db'));

    // Ignored dirs — should NOT be discovered
    touch(path.join(TMP_ROOT, 'node_modules', 'pkg', 'bad.db'));
    touch(path.join(TMP_ROOT, '.git', 'objects', 'bad.sqlite'));
    touch(path.join(TMP_ROOT, 'logs', 'bad.db'));

    // Non-db file — should NOT be discovered
    touch(path.join(TMP_ROOT, 'data', 'readme.txt'));

    // userData directories (simulating Electron userData)
    touch(path.join(TMP_USERDATA, 'netops', 'netops.sqlite'));
    touch(path.join(TMP_USERDATA, 'script-runner', 'script-runner.sqlite'));
  });

  after(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    fs.rmSync(TMP_USERDATA, { recursive: true, force: true });
  });

  it('discovers hub databases in data/', () => {
    const results = scanForDatabases(TMP_ROOT);
    const hubDbs = results.filter(r => r.source === 'hub');
    const relPaths = hubDbs.map(r => r.relativePath);
    assert.ok(relPaths.some(p => p.includes('app.db')), 'should find app.db');
    assert.ok(relPaths.some(p => p.includes('deep.sqlite')), 'should find nested deep.sqlite');
  });

  it('discovers module databases with correct source', () => {
    const results = scanForDatabases(TMP_ROOT);
    const modDbs = results.filter(r => r.source.startsWith('module:'));

    const myMod = modDbs.find(r => r.source === 'module:my_mod');
    assert.ok(myMod, 'should find my_mod database');
    assert.ok(myMod.relativePath.includes('store.sqlite3'));

    const other = modDbs.find(r => r.source === 'module:other');
    assert.ok(other, 'should find other module database');
  });

  it('discovers root-level stray databases', () => {
    const results = scanForDatabases(TMP_ROOT);
    const project = results.filter(r => r.source === 'project');
    assert.ok(project.some(r => r.relativePath === 'stray.db'), 'should find stray.db at root');
  });

  it('skips node_modules, .git, and logs', () => {
    const results = scanForDatabases(TMP_ROOT);
    const allPaths = results.map(r => r.path);
    for (const p of allPaths) {
      assert.ok(!p.includes('node_modules'), `should skip node_modules: ${p}`);
      assert.ok(!p.includes('.git'), `should skip .git: ${p}`);
      assert.ok(!p.includes(path.join('logs', 'bad.db')), `should skip logs: ${p}`);
    }
  });

  it('ignores non-database files', () => {
    const results = scanForDatabases(TMP_ROOT);
    const allPaths = results.map(r => r.relativePath);
    assert.ok(!allPaths.some(p => p.includes('readme.txt')), 'should not include .txt files');
  });

  it('deduplicates paths', () => {
    const results = scanForDatabases(TMP_ROOT);
    const paths = results.map(r => r.path);
    const unique = new Set(paths);
    assert.equal(paths.length, unique.size, 'should have no duplicate paths');
  });

  it('returns expected fields on each result', () => {
    const results = scanForDatabases(TMP_ROOT);
    assert.ok(results.length > 0, 'should have results');
    for (const r of results) {
      assert.equal(typeof r.path, 'string');
      assert.equal(typeof r.relativePath, 'string');
      assert.equal(typeof r.source, 'string');
      assert.equal(typeof r.sizeBytes, 'number');
      assert.ok(path.isAbsolute(r.path), 'path should be absolute');
    }
  });

  it('discovers databases in userData directory', () => {
    const results = scanForDatabases(TMP_ROOT, undefined, TMP_USERDATA);
    const udDbs = results.filter(r => r.path.startsWith(TMP_USERDATA));
    assert.ok(udDbs.length >= 2, `should find at least 2 userData DBs, found ${udDbs.length}`);

    const netops = udDbs.find(r => r.path.includes('netops.sqlite'));
    assert.ok(netops, 'should find netops.sqlite');
    assert.equal(netops.source, 'module:netops');

    const sr = udDbs.find(r => r.path.includes('script-runner.sqlite'));
    assert.ok(sr, 'should find script-runner.sqlite');
    assert.equal(sr.source, 'module:script-runner');
  });
});
