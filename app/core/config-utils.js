/**
 * Config Utilities — safe JSON config reading with fallback defaults.
 * Shared across the hub core and all modules.
 */

const fs = require('fs');

/**
 * Read a JSON config file and return its parsed contents.
 * Returns the fallback value if the file doesn't exist or is malformed.
 *
 * @param {string} filePath — absolute path to the JSON file
 * @param {object} fallback — default value if reading fails
 * @param {Function} [onError] — optional callback on parse error: (filePath, err) => void
 * @returns {object}
 */
function readJsonConfig(filePath, fallback = {}, onError) {
  if (!fs.existsSync(filePath)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    if (typeof onError === 'function') {
      onError(filePath, err);
    }
    return fallback;
  }
}

module.exports = { readJsonConfig };
