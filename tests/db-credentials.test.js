/**
 * Unit tests for app/core/db-credentials.js
 * Run with: node --test tests/db-credentials.test.js
 *
 * Mocks Electron's safeStorage API since tests run in plain Node.
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('node:module');

// --- Mock Electron ---

const TMP_DIR = path.join(os.tmpdir(), `dbcred-test-${Date.now()}`);
fs.mkdirSync(TMP_DIR, { recursive: true });

const CREDS_FILE = path.join(TMP_DIR, 'db-credentials.json');

// Simple XOR-based reversible "encryption" for testing (NOT real crypto)
function fakeEncrypt(str) {
  return Buffer.from(str.split('').map((c, i) => c.charCodeAt(0) ^ ((i + 42) % 256)));
}
function fakeDecrypt(buf) {
  return Array.from(buf).map((b, i) => String.fromCharCode(b ^ ((i + 42) % 256))).join('');
}

const electronMock = {
  app: {
    getPath: (name) => {
      if (name === 'userData') return TMP_DIR;
      return TMP_DIR;
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (str) => fakeEncrypt(str),
    decryptString: (buf) => fakeDecrypt(buf),
  },
};

// Intercept require('electron') to return our mock
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'electron') return 'electron';
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
require.cache.electron = { id: 'electron', filename: 'electron', loaded: true, exports: electronMock };

// Now require the module under test (after mock is in place)
// Clear any previous cached version first
const credModulePath = path.resolve(__dirname, '..', 'app', 'core', 'db-credentials.js');
delete require.cache[credModulePath];
const dbCredentials = require(credModulePath);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function clearCreds() {
  try { fs.unlinkSync(CREDS_FILE); } catch { /* ignore */ }
  // Force cache reload by re-requiring
  delete require.cache[credModulePath];
  // Re-requiring won't help because we need to clear the module's internal cache.
  // Instead, we'll remove all credentials manually.
  const creds = dbCredentials.listCredentials();
  for (const c of creds) {
    dbCredentials.removeCredential(c.path);
  }
}

describe('db-credentials', () => {

  beforeEach(() => {
    clearCreds();
  });

  after(() => {
    // Restore require hooks
    Module._resolveFilename = originalResolveFilename;
    delete require.cache.electron;
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('setCredential returns true on success', () => {
    const ok = dbCredentials.setCredential('/test/db.sqlite', 'mypassword');
    assert.equal(ok, true);
  });

  it('getCredential round-trips a set password', () => {
    dbCredentials.setCredential('/test/db.sqlite', 's3cret');
    const pw = dbCredentials.getCredential('/test/db.sqlite');
    assert.equal(pw, 's3cret');
  });

  it('getCredential returns null for unknown path', () => {
    const pw = dbCredentials.getCredential('/nope/nothing.db');
    assert.equal(pw, null);
  });

  it('hasCredential reflects stored state', () => {
    assert.equal(dbCredentials.hasCredential('/test/db.sqlite'), false);
    dbCredentials.setCredential('/test/db.sqlite', 'pw');
    assert.equal(dbCredentials.hasCredential('/test/db.sqlite'), true);
  });

  it('removeCredential deletes a stored credential', () => {
    dbCredentials.setCredential('/test/db.sqlite', 'pw');
    const removed = dbCredentials.removeCredential('/test/db.sqlite');
    assert.equal(removed, true);
    assert.equal(dbCredentials.hasCredential('/test/db.sqlite'), false);
    assert.equal(dbCredentials.getCredential('/test/db.sqlite'), null);
  });

  it('removeCredential returns false for non-existent', () => {
    const removed = dbCredentials.removeCredential('/nope/nada.db');
    assert.equal(removed, false);
  });

  it('verifyCredential matches correct password', () => {
    dbCredentials.setCredential('/test/db.sqlite', 'correct');
    assert.equal(dbCredentials.verifyCredential('/test/db.sqlite', 'correct'), true);
    assert.equal(dbCredentials.verifyCredential('/test/db.sqlite', 'wrong'), false);
  });

  it('verifyCredential returns false for unknown path', () => {
    assert.equal(dbCredentials.verifyCredential('/nope/nada.db', 'any'), false);
  });

  it('listCredentials returns entries with hasPassword only', () => {
    dbCredentials.setCredential('/a/one.db', 'pw1');
    dbCredentials.setCredential('/b/two.db', 'pw2');
    const list = dbCredentials.listCredentials();
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 2);
    for (const entry of list) {
      assert.equal(typeof entry.path, 'string');
      assert.equal(entry.hasPassword, true);
      // Must NOT expose the actual password
      assert.equal(entry.password, undefined);
    }
  });

  it('setCredential rejects empty password', () => {
    const ok = dbCredentials.setCredential('/test/db.sqlite', '');
    assert.equal(ok, false);
  });

  it('change password round-trip (set → verify old → set new → verify new)', () => {
    dbCredentials.setCredential('/test/db.sqlite', 'old_pw');
    assert.equal(dbCredentials.verifyCredential('/test/db.sqlite', 'old_pw'), true);

    // Simulate change: verify old, then set new
    dbCredentials.setCredential('/test/db.sqlite', 'new_pw');
    assert.equal(dbCredentials.verifyCredential('/test/db.sqlite', 'old_pw'), false);
    assert.equal(dbCredentials.verifyCredential('/test/db.sqlite', 'new_pw'), true);
  });

  it('persists credentials to disk', () => {
    dbCredentials.setCredential('/persist/test.db', 'disk_pw');
    assert.ok(fs.existsSync(CREDS_FILE), 'credentials file should exist');
    const raw = fs.readFileSync(CREDS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    assert.ok('/persist/test.db' in parsed, 'db path should be a key');
    // The value should be base64-encoded, NOT the plaintext password
    assert.notEqual(parsed['/persist/test.db'], 'disk_pw');
  });
});
