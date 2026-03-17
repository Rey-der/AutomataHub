/**
 * error-report — Displays recent errors with script name, timestamp, and message.
 *
 * Outputs JSON to stdout for script_runner display.
 * Default: last 20 errors. Pass a number as first arg to override.
 */

const path = require('path');

const dbPath = process.env.SMART_DESKTOP_DB;
if (!dbPath) {
  console.error('ERROR: SMART_DESKTOP_DB environment variable is not set.');
  process.exit(1);
}

const projectRoot = path.dirname(path.dirname(dbPath));
const error = require(path.join(projectRoot, 'src', 'models', 'error'));
const { printJSON } = require(path.join(projectRoot, 'src', 'utils', 'output'));
const { closeDb } = require(path.join(projectRoot, 'src', 'utils', 'db'));

try {
  const limit = parseInt(process.argv[2], 10) || 20;
  const rows = error.getRecent(limit);

  if (rows.length === 0) {
    console.log('No errors found.');
  } else {
    console.log(`Last ${rows.length} errors:\n`);
    printJSON(rows);
  }
} finally {
  closeDb();
}
