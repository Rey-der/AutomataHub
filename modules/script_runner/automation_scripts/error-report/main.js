/**
 * error-report — Displays recent errors with script name, timestamp, and message.
 *
 * Outputs JSON to stdout for script_runner display.
 * Default: last 20 errors. Pass a number as first arg to override.
 */

const { openDatabase } = require('../_lib/db');
const { printJSON } = require('../_lib/output');

async function main() {
  const db = await openDatabase();
  try {
    const limit = Number.parseInt(process.argv[2], 10) || 20;
    const rows = db.all(
      'SELECT * FROM errors ORDER BY timestamp DESC LIMIT ?', [limit]
    );

    if (rows.length === 0) {
      console.log('No errors found.');
    } else {
      console.log(`Last ${rows.length} errors:\n`);
      printJSON(rows);
    }
  } finally {
    db.close();
  }
}

main();
