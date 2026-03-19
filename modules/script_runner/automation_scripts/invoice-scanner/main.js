/**
 * invoice-scanner — Scans a folder for PDF invoices and extracts basic data.
 *
 * Extraction strategy (text-based):
 *   1. Reads PDF files from the configured folder
 *   2. Extracts text content and searches for:
 *      - Vendor name (from filename or first non-empty line)
 *      - Amount (first currency-like pattern: $123.45, €123,45, or plain 123.45)
 *      - Date (first YYYY-MM-DD or DD.MM.YYYY or DD/MM/YYYY pattern)
 *   3. Writes extracted data to the invoices table
 *
 * Note: This is a lightweight scanner — it reads the raw PDF bytes
 * looking for text streams. For production OCR, integrate a proper
 * PDF library. This works for text-based PDFs (not scanned images).
 *
 * Configurable via environment variables:
 *   INVOICE_DIR — folder to scan (default: ~/Documents/Invoices)
 *
 * Writes:
 *   - invoices (one per successfully extracted file)
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

const SCRIPT_NAME = 'invoice-scanner';

/**
 * Extracts readable text from a PDF buffer by finding text streams.
 * This is a lightweight approach — works for text-based PDFs only.
 */
function extractTextFromPdf(buffer) {
  const text = buffer.toString('latin1');
  const chunks = [];

  // Find text blocks between BT (Begin Text) and ET (End Text) operators
  let pos = 0;
  while (pos < text.length) {
    const btIdx = text.indexOf('BT', pos);
    if (btIdx === -1) break;
    const etIdx = text.indexOf('ET', btIdx + 2);
    if (etIdx === -1) break;
    const block = text.substring(btIdx + 2, etIdx);

    // Extract strings inside parentheses (Tj/TJ operators)
    let i = 0;
    while (i < block.length) {
      const open = block.indexOf('(', i);
      if (open === -1) break;
      const close = block.indexOf(')', open + 1);
      if (close === -1) break;
      chunks.push(block.substring(open + 1, close));
      i = close + 1;
    }
    pos = etIdx + 2;
  }
  return chunks.join(' ').trim();
}

/**
 * Tries to find a monetary amount in text.
 * Matches: $123.45, €1,234.56, 123.45 (standalone with 2 decimals)
 *
 * Uses character scanning instead of regex to avoid backtracking risks.
 */
function extractAmount(text) {
  return findCurrencyAmount(text) ?? findStandaloneAmount(text);
}

/** Strategy 1: currency symbol followed by a numeric amount. */
function findCurrencyAmount(text) {
  const currencyChars = '$€£';
  for (let i = 0; i < text.length; i++) {
    if (!currencyChars.includes(text[i])) continue;
    let start = i + 1;
    if (start < text.length && text[start] === ' ') start++;
    const num = readAmountAt(text, start);
    if (num > 0) return num;
  }
  return null;
}

/** Strategy 2: standalone number with exactly 2 decimal places (e.g. 1,234.56). */
function findStandaloneAmount(text) {
  for (let i = 0; i < text.length; i++) {
    const c = text.codePointAt(i);
    if (c < 48 || c > 57) continue;
    if (i > 0 && text.codePointAt(i - 1) >= 48 && text.codePointAt(i - 1) <= 57) continue;
    const { value, decimals } = readAmountDetailedAt(text, i);
    if (value > 0 && decimals === 2) return value;
  }
  return null;
}

/**
 * Reads a numeric amount (digits, comma thousands-separators, optional decimal)
 * starting at position pos. Returns the parsed float or null.
 */
function readAmountAt(text, pos) {
  return readAmountDetailedAt(text, pos).value;
}

function readAmountDetailedAt(text, pos) {
  let num = '';
  let decimals = -1;
  let i = pos;
  while (i < text.length) {
    const ch = text[i];
    if (ch >= '0' && ch <= '9') {
      num += ch;
      if (decimals >= 0) decimals++;
      i++;
    } else if (ch === ',' && decimals < 0) {
      i++; // skip comma (thousands separator, before decimal point only)
    } else if (ch === '.' && decimals < 0) {
      num += '.';
      decimals = 0;
      i++;
    } else {
      break;
    }
  }
  if (num.length === 0) return { value: null, decimals: 0 };
  return { value: Number.parseFloat(num), decimals: Math.max(decimals, 0) };
}

/**
 * Tries to find a date in text.
 * Matches: YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY
 */
function extractDate(text) {
  // YYYY-MM-DD
  const iso = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];

  // DD.MM.YYYY or DD/MM/YYYY
  const dmy = text.match(/(\d{2})[./](\d{2})[./](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;

  return null;
}

/**
 * Derives a vendor name from the filename.
 * "amazon_invoice_2026.pdf" → "amazon"
 */
function vendorFromFilename(filename) {
  const base = path.basename(filename, '.pdf');
  // Take the first word/segment (split on _ - space or digits)
  const parts = base.split(/[_\-\s\d]+/).filter(Boolean);
  if (parts.length > 0) {
    return parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
  }
  return base;
}

(async () => {
  const db = await openDatabase();
  try {
    const invoiceDir = process.env.INVOICE_DIR || path.join(os.homedir(), 'Documents', 'Invoices');

    if (!fs.existsSync(invoiceDir)) {
      console.log(`Invoice directory not found: ${invoiceDir}`);
      console.log('Set INVOICE_DIR or create ~/Documents/Invoices with PDF files.');
      process.exit(0);
    }

    const result = runTracked(db, SCRIPT_NAME, (log) => {
      log('INFO', `Scanning ${invoiceDir}`);

      const files = fs.readdirSync(invoiceDir)
        .filter(f => f.toLowerCase().endsWith('.pdf'));

      if (files.length === 0) {
        log('INFO', 'No PDF files found.');
        return { scanned: 0, extracted: 0, failed: 0 };
      }

      let extracted = 0;
      let failed = 0;

      for (const file of files) {
        const filePath = path.join(invoiceDir, file);

        try {
          const buffer = fs.readFileSync(filePath);
          const text = extractTextFromPdf(buffer);

          const vendor = vendorFromFilename(file);
          const amount = extractAmount(text);
          const invoiceDate = extractDate(text);

          if (!amount) {
            log('INFO', `Skipped ${file}: no amount found`);
            failed++;
            continue;
          }

          db.run(
            'INSERT INTO invoices (vendor, amount, invoice_date, file_path) VALUES (?, ?, ?, ?)',
            [vendor, amount, invoiceDate || new Date().toISOString().slice(0, 10), filePath]
          );
          log('INFO', `Extracted: ${file} -> ${vendor}, ${amount}`, JSON.stringify({ vendor, amount, invoiceDate }));
          extracted++;
        } catch (err) {
          log('ERROR', `Failed to process ${file}: ${err.message}`);
          failed++;
        }
      }

      log('SUCCESS', `Scanned ${files.length} PDFs: ${extracted} extracted, ${failed} failed`);
      return { scanned: files.length, extracted, failed };
    });

    console.log('Invoice scan complete.\n');
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
