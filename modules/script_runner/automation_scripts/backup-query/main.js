/**
 * backup-query — Displays backup history, most recent first.
 *
 * Outputs JSON to stdout for script_runner display.
 */

const { openDatabase } = require('../_lib/db');
const { printJSON } = require('../_lib/output');

(async () => {
  const db = await openDatabase();
  try {
    const rows = db.all('SELECT * FROM backup_history ORDER BY backup_date DESC');

    if (rows.length === 0) {
      console.log('No backup history found.');
    } else {
      console.log(`Backup history (${rows.length} entries):\n`);
      printJSON(rows);
    }
  } finally {
    db.close();
  }
})();
