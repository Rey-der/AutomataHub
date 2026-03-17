/**
 * backup-query — Displays backup history, most recent first.
 *
 * Outputs JSON to stdout for script_runner display.
 */

const path = require('path');

const dbPath = process.env.SMART_DESKTOP_DB;
if (!dbPath) {
  console.error('ERROR: SMART_DESKTOP_DB environment variable is not set.');
  process.exit(1);
}

const projectRoot = path.dirname(path.dirname(dbPath));
const backupHistory = require(path.join(projectRoot, 'src', 'models', 'backupHistory'));
const { printJSON } = require(path.join(projectRoot, 'src', 'utils', 'output'));
const { closeDb } = require(path.join(projectRoot, 'src', 'utils', 'db'));

try {
  const rows = backupHistory.getAll();

  if (rows.length === 0) {
    console.log('No backup history found.');
  } else {
    console.log(`Backup history (${rows.length} entries):\n`);
    printJSON(rows);
  }
} finally {
  closeDb();
}
