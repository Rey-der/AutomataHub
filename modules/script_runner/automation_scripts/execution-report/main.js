/**
 * execution-report — Displays recent script executions with duration and status.
 *
 * Outputs JSON to stdout for script_runner display.
 * Default: last 20 executions. Pass a number as first arg to override.
 */

const path = require('path');

const dbPath = process.env.SMART_DESKTOP_DB;
if (!dbPath) {
  console.error('ERROR: SMART_DESKTOP_DB environment variable is not set.');
  process.exit(1);
}

const projectRoot = path.dirname(path.dirname(dbPath));
const { getDb, closeDb } = require(path.join(projectRoot, 'src', 'utils', 'db'));
const { printJSON } = require(path.join(projectRoot, 'src', 'utils', 'output'));

try {
  const db = getDb();
  const limit = parseInt(process.argv[2], 10) || 20;

  const rows = db.prepare(`
    SELECT
      id,
      script,
      start_time,
      end_time,
      status,
      error_message,
      CASE
        WHEN end_time IS NOT NULL
        THEN ROUND((julianday(end_time) - julianday(start_time)) * 86400, 1)
        ELSE NULL
      END AS duration_seconds
    FROM execution_tracking
    ORDER BY start_time DESC
    LIMIT ?
  `).all(limit);

  if (rows.length === 0) {
    console.log('No execution records found.');
  } else {
    console.log(`Last ${rows.length} script executions:\n`);
    printJSON(rows);
  }
} finally {
  closeDb();
}
