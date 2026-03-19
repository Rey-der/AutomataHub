/**
 * execution-report — Displays recent script executions with duration and status.
 *
 * Outputs JSON to stdout for script_runner display.
 * Default: last 20 executions. Pass a number as first arg to override.
 */

const { openDatabase } = require('../_lib/db');
const { printJSON } = require('../_lib/output');

(async () => {
  const db = await openDatabase();
  try {
    const limit = Number.parseInt(process.argv[2], 10) || 20;

    const rows = db.all(`
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
    `, [limit]);

    if (rows.length === 0) {
      console.log('No execution records found.');
    } else {
      console.log(`Last ${rows.length} script executions:\n`);
      printJSON(rows);
    }
  } finally {
    db.close();
  }
})();
