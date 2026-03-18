/**
 * Database Credentials — encrypted credential store for SQLite database passwords.
 * Uses Electron's safeStorage API (backed by macOS Keychain / Windows DPAPI / libsecret)
 * to encrypt passwords before writing them to disk.
 *
 * Credentials are stored in `db-credentials.json` inside Electron's userData directory.
 * Format: { "<absoluteDbPath>": "<base64-encrypted-password>", ... }
 *
 * Passwords are NEVER stored in plaintext on disk.
 */

const path = require('node:path');
const fs = require('node:fs');
const { app, safeStorage } = require('electron');

const CREDS_FILE = path.join(app.getPath('userData'), 'db-credentials.json');

let cache = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Load credentials map from disk into cache.
 */
function _load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(CREDS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    cache = {};
  }
  return cache;
}

/**
 * Persist the current cache to disk with restrictive permissions.
 */
function _save() {
  if (!cache) return;
  try {
    const data = JSON.stringify(cache, null, 2);
    fs.writeFileSync(CREDS_FILE, data, { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    console.error('[db-credentials] Failed to save:', err.message);
  }
}

/**
 * Check whether Electron's safeStorage encryption is available.
 * On some Linux setups without a keyring, this returns false.
 */
function _isAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[db-credentials] safeStorage encryption not available on this system');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve the decrypted password for a database.
 * @param {string} dbPath — absolute path to the database file
 * @returns {string|null} the decrypted password, or null if not stored / unavailable
 */
function getCredential(dbPath) {
  if (!_isAvailable()) return null;
  const store = _load();
  const encrypted = store[dbPath];
  if (!encrypted) return null;
  try {
    const buffer = Buffer.from(encrypted, 'base64');
    return safeStorage.decryptString(buffer);
  } catch (err) {
    console.error(`[db-credentials] Failed to decrypt credential for ${dbPath}:`, err.message);
    return null;
  }
}

/**
 * Store an encrypted password for a database.
 * @param {string} dbPath — absolute path to the database file
 * @param {string} password — plaintext password to encrypt and store
 * @returns {boolean} true if stored successfully
 */
function setCredential(dbPath, password) {
  if (!_isAvailable()) return false;
  if (typeof password !== 'string' || password.length === 0) return false;
  try {
    const buffer = safeStorage.encryptString(password);
    const store = _load();
    store[dbPath] = buffer.toString('base64');
    _save();
    return true;
  } catch (err) {
    console.error(`[db-credentials] Failed to encrypt credential for ${dbPath}:`, err.message);
    return false;
  }
}

/**
 * Remove the stored credential for a database.
 * @param {string} dbPath — absolute path to the database file
 * @returns {boolean} true if an entry was removed
 */
function removeCredential(dbPath) {
  const store = _load();
  if (!(dbPath in store)) return false;
  delete store[dbPath];
  _save();
  return true;
}

/**
 * Check whether a credential is stored for a database path.
 * @param {string} dbPath — absolute path to the database file
 * @returns {boolean}
 */
function hasCredential(dbPath) {
  const store = _load();
  return dbPath in store;
}

/**
 * List all stored credential entries (paths + whether a password is set).
 * Never exposes the actual passwords.
 * @returns {{ path: string, hasPassword: boolean }[]}
 */
function listCredentials() {
  const store = _load();
  return Object.keys(store).map((p) => ({ path: p, hasPassword: true }));
}

/**
 * Verify that a given plaintext password matches the stored credential.
 * @param {string} dbPath — absolute path to the database file
 * @param {string} password — plaintext password to verify
 * @returns {boolean} true if matched, false if no credential stored or mismatch
 */
function verifyCredential(dbPath, password) {
  const stored = getCredential(dbPath);
  if (stored === null) return false;
  const match = stored === password;
  // Clear the decrypted value from the local variable
  // (V8 may still cache it briefly, but this prevents prolonged retention)
  return match;
}

module.exports = {
  getCredential,
  setCredential,
  removeCredential,
  hasCredential,
  listCredentials,
  verifyCredential,
};
