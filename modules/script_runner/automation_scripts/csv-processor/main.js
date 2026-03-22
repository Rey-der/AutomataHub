/**
 * csv-processor — Reads CSV files, validates rows, and outputs structured reports.
 *
 * Processing pipeline:
 *   1. Scans CSV_INPUT_DIR for .csv files
 *   2. Parses each file using RFC 4180 rules (quoted fields, escaped quotes)
 *   3. Detects column headers from the first row
 *   4. Validates each data row:
 *      - Every header column must have a non-empty value
 *      - Columns whose header contains "amount", "price", "total", "qty",
 *        or "quantity" are checked for numeric values
 *   5. Stores a summary row per file in the csv_processing table
 *   6. Outputs a JSON report
 *
 * Configurable via environment variables:
 *   CSV_INPUT_DIR — folder to scan (default: ~/Documents/csv-input)
 *
 * Writes:
 *   - csv_processing (one per processed file)
 *   - automation_logs (start, per-file outcome, summary)
 *   - execution_tracking (start -> finish)
 *   - errors (on failure)
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { openDatabase } = require('../_lib/db');
const { printJSON } = require('../_lib/output');
const { runTracked } = require('../_lib/tracker');

const SCRIPT_NAME = 'csv-processor';

/**
 * Parses a single CSV line respecting RFC 4180 quoted fields.
 * Handles: commas inside quotes, escaped double-quotes ("").
 */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote ("") or end of quoted field
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        current += ch;
        i++;
      }
    } else if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ',') {
      fields.push(current.trim());
      current = '';
      i++;
    } else {
      current += ch;
      i++;
    }
  }

  fields.push(current.trim());
  return fields;
}

/** Column headers that indicate a numeric field (case-insensitive partial match). */
const NUMERIC_KEYWORDS = ['amount', 'price', 'total', 'qty', 'quantity'];

/**
 * Checks whether a column header implies a numeric value.
 */
function isNumericColumn(header) {
  const lower = header.toLowerCase();
  return NUMERIC_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Validates a single parsed row against the headers.
 * Returns { valid: true } or { valid: false, reason: string }.
 */
function validateRow(headers, fields) {
  if (fields.length !== headers.length) {
    return { valid: false, reason: `expected ${headers.length} columns, got ${fields.length}` };
  }

  for (let c = 0; c < headers.length; c++) {
    const value = fields[c];

    // All columns must be non-empty
    if (value === '') {
      return { valid: false, reason: `empty value in column "${headers[c]}"` };
    }

    // Numeric columns must contain a valid number
    if (isNumericColumn(headers[c]) && isNaN(Number(value))) {
      return { valid: false, reason: `non-numeric value "${value}" in column "${headers[c]}"` };
    }
  }

  return { valid: true };
}

/**
 * Processes a single CSV file: parses, validates, records in DB.
 * Returns { filename, rows_total, rows_valid, rows_invalid }.
 */
function processFile(filePath, db, log) {
  const filename = path.basename(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(l => l.trim() !== '');

  if (lines.length === 0) {
    log('INFO', `Skipped ${filename}: empty file`);
    return { filename, rows_total: 0, rows_valid: 0, rows_invalid: 0 };
  }

  const headers = parseCsvLine(lines[0]);
  let valid = 0;
  let invalid = 0;

  for (let r = 1; r < lines.length; r++) {
    const fields = parseCsvLine(lines[r]);
    const result = validateRow(headers, fields);
    if (result.valid) {
      valid++;
    } else {
      invalid++;
    }
  }

  const rowsTotal = lines.length - 1; // exclude header row

  db.run(
    'INSERT INTO csv_processing (filename, rows_total, rows_valid, rows_invalid) VALUES (?, ?, ?, ?)',
    [filename, rowsTotal, valid, invalid]
  );

  log('INFO', `Processed ${filename}: ${valid} valid, ${invalid} invalid of ${rowsTotal} rows`,
    JSON.stringify({ filename, rows_total: rowsTotal, rows_valid: valid, rows_invalid: invalid }));

  return { filename, rows_total: rowsTotal, rows_valid: valid, rows_invalid: invalid };
}

(async () => {
  const db = await openDatabase();
  try {
    const inputDir = process.env.CSV_INPUT_DIR
      || path.join(os.homedir(), 'Documents', 'csv-input');

    if (!fs.existsSync(inputDir)) {
      console.log(`CSV input directory not found: ${inputDir}`);
      console.log('Set CSV_INPUT_DIR or create ~/Documents/csv-input with .csv files.');
      process.exit(0);
    }

    const result = runTracked(db, SCRIPT_NAME, (log) => {
      log('INFO', `Scanning ${inputDir}`);

      const files = fs.readdirSync(inputDir)
        .filter(f => f.toLowerCase().endsWith('.csv'));

      if (files.length === 0) {
        log('INFO', 'No CSV files found.');
        return { processed: 0, files: [] };
      }

      const fileSummaries = [];

      for (const file of files) {
        const filePath = path.join(inputDir, file);
        try {
          const summary = processFile(filePath, db, log);
          fileSummaries.push(summary);
        } catch (err) {
          log('ERROR', `Failed to process ${file}: ${err.message}`);
          fileSummaries.push({
            filename: file,
            rows_total: 0,
            rows_valid: 0,
            rows_invalid: 0,
            error: err.message,
          });
        }
      }

      const totalValid = fileSummaries.reduce((s, f) => s + f.rows_valid, 0);
      const totalInvalid = fileSummaries.reduce((s, f) => s + f.rows_invalid, 0);

      log('SUCCESS', `Processed ${files.length} files: ${totalValid} valid rows, ${totalInvalid} invalid rows`);
      return { processed: files.length, totalValid, totalInvalid, files: fileSummaries };
    });

    console.log('CSV processing complete.\n');
    printJSON(result);
  } catch (err) {
    db.run(
      'INSERT INTO errors (script, message, stack_trace) VALUES (?, ?, ?)',
      [SCRIPT_NAME, err.message, err.stack]
    );
    db.save();
    console.error('FATAL:', err.message);
    process.exit(1);
  } finally {
    db.close();
  }
})();
