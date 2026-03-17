/**
 * invoice-query — Displays stored invoices.
 *
 * Filterable by vendor or date range via environment variables:
 *   VENDOR=Amazon        → filter by vendor name
 *   FROM=2026-01-01      → date range start (inclusive)
 *   TO=2026-12-31        → date range end (inclusive)
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
const invoice = require(path.join(projectRoot, 'src', 'models', 'invoice'));
const { printJSON } = require(path.join(projectRoot, 'src', 'utils', 'output'));
const { closeDb } = require(path.join(projectRoot, 'src', 'utils', 'db'));

try {
  const vendor = process.env.VENDOR;
  const from = process.env.FROM;
  const to = process.env.TO;

  let rows;
  let label;

  if (vendor) {
    rows = invoice.getByVendor(vendor);
    label = `Invoices from vendor "${vendor}"`;
  } else if (from && to) {
    rows = invoice.getByDateRange(from, to);
    label = `Invoices from ${from} to ${to}`;
  } else {
    rows = invoice.getAll();
    label = 'All invoices';
  }

  if (rows.length === 0) {
    console.log(`${label}: none found.`);
  } else {
    console.log(`${label} (${rows.length}):\n`);
    printJSON(rows);
  }
} finally {
  closeDb();
}
