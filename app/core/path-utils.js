/**
 * Path Utilities — safe path resolution and containment checks.
 * Shared across the hub core and all modules.
 */

const path = require('path');
const fs = require('fs');

/**
 * Resolve a path and verify it is inside the given base directory.
 * Returns the resolved absolute path.
 * Throws if the path escapes the base.
 *
 * @param {string} targetPath — path to validate
 * @param {string} baseDir — allowed parent directory
 * @returns {string} resolved absolute path
 */
function resolveInside(targetPath, baseDir) {
  const resolved = fs.realpathSync(targetPath);
  const baseReal = fs.realpathSync(baseDir);
  if (resolved !== baseReal && !resolved.startsWith(baseReal + path.sep)) {
    throw new Error(`Path "${targetPath}" is outside the allowed directory`);
  }
  return resolved;
}

/**
 * Check whether a resolved path is inside a base directory (no throw).
 *
 * @param {string} targetPath — path to check (must exist)
 * @param {string} baseDir — allowed parent directory (must exist)
 * @returns {boolean}
 */
function isInside(targetPath, baseDir) {
  try {
    resolveInside(targetPath, baseDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 *
 * @param {string} dirPath
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

module.exports = { resolveInside, isInside, ensureDir };
