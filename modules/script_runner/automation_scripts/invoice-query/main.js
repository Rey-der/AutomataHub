/**
 * invoice-query — Displays stored invoices.
 *
 * Filterable by vendor or date range via environment variables:
 *   VENDOR=Amazon        — filter by vendor name
 *   FROM=2026-01-01      — date range start (inclusive)
 *   TO=2026-12-31        — date range end (inclusive)
 *
 * Outputs JSON to stdout for script_runner display.
 */

const { openDatabase } = require('../_lib/db');
const { printJSON } = require('../_lib/output');

(async () => {
  const db = await openDatabase();
  try {
    const vendor = process.env.VENDOR;
    const from = process.env.FROM;
    const to = process.env.TO;

    let rows;
    let label;

    if (vendor) {
      rows = db.all('SELECT * FROM invoices WHERE vendor LIKE ? ORDER BY invoice_date DESC', [`%${vendor}%`]);
      label = `Invoices from vendor "${vendor}"`;
    } else if (from && to) {
      rows = db.all('SELECT * FROM invoices WHERE invoice_date BETWEEN ? AND ? ORDER BY invoice_date DESC', [from, to]);
      label = `Invoices from ${from} to ${to}`;
    } else {
      rows = db.all('SELECT * FROM invoices ORDER BY invoice_date DESC');
      label = 'All invoices';
    }

    if (rows.length === 0) {
      console.log(`${label}: none found.`);
    } else {
      console.log(`${label} (${rows.length}):\n`);
      printJSON(rows);
    }
  } finally {
    db.close();
  }
})();
