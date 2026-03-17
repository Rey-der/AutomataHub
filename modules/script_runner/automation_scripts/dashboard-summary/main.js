/**
 * dashboard-summary — Aggregated stats for the Smart Desktop dashboard.
 *
 * Displays:
 *   - Files sorted today
 *   - Total invoices stored
 *   - Automations run today
 *   - Errors today
 *   - Last backup status
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
const { getDb, closeDb } = require(path.join(projectRoot, 'src', 'utils', 'db'));
const { printJSON } = require(path.join(projectRoot, 'src', 'utils', 'output'));

try {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const filesSortedToday = db.prepare(
    "SELECT COUNT(*) AS count FROM file_processing_records WHERE timestamp LIKE ? || '%'"
  ).get(today).count;

  const totalInvoices = db.prepare(
    'SELECT COUNT(*) AS count FROM invoices'
  ).get().count;

  const automationsToday = db.prepare(
    "SELECT COUNT(*) AS count FROM automation_logs WHERE timestamp LIKE ? || '%'"
  ).get(today).count;

  const errorsToday = db.prepare(
    "SELECT COUNT(*) AS count FROM errors WHERE timestamp LIKE ? || '%'"
  ).get(today).count;

  const lastBackup = db.prepare(
    'SELECT backup_date, status, files_copied, files_skipped FROM backup_history ORDER BY backup_date DESC LIMIT 1'
  ).get() || null;

  const executionsToday = db.prepare(
    "SELECT COUNT(*) AS count FROM execution_tracking WHERE start_time LIKE ? || '%'"
  ).get(today).count;

  const summary = {
    date: today,
    files_sorted_today: filesSortedToday,
    total_invoices: totalInvoices,
    automations_today: automationsToday,
    executions_today: executionsToday,
    errors_today: errorsToday,
    last_backup: lastBackup,
  };

  console.log('Dashboard Summary:\n');
  printJSON(summary);
} finally {
  closeDb();
}
