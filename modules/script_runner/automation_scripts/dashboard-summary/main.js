/**
 * dashboard-summary — Aggregated stats for the AutomataHub dashboard.
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

const { openDatabase } = require('../_lib/db');
const { printJSON } = require('../_lib/output');

(async () => {
  const db = await openDatabase();
  try {
    const today = new Date().toISOString().slice(0, 10);

    const filesSortedToday = (db.get(
      "SELECT COUNT(*) AS count FROM file_processing_records WHERE timestamp LIKE ? || '%'", [today]
    ) || { count: 0 }).count;

    const totalInvoices = (db.get(
      'SELECT COUNT(*) AS count FROM invoices'
    ) || { count: 0 }).count;

    const automationsToday = (db.get(
      "SELECT COUNT(*) AS count FROM automation_logs WHERE timestamp LIKE ? || '%'", [today]
    ) || { count: 0 }).count;

    const errorsToday = (db.get(
      "SELECT COUNT(*) AS count FROM errors WHERE timestamp LIKE ? || '%'", [today]
    ) || { count: 0 }).count;

    const lastBackup = db.get(
      'SELECT backup_date, status, files_copied, files_skipped FROM backup_history ORDER BY backup_date DESC LIMIT 1'
    ) || null;

    const executionsToday = (db.get(
      "SELECT COUNT(*) AS count FROM execution_tracking WHERE start_time LIKE ? || '%'", [today]
    ) || { count: 0 }).count;

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
    db.close();
  }
})();
