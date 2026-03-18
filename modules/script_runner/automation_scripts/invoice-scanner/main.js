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
 *   - execution_tracking (start → finish)
 *   - errors (on failure)
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const dbPath = process.env.SMART_DESKTOP_DB;
if (!dbPath) {
  console.error('ERROR: SMART_DESKTOP_DB environment variable is not set.');
  process.exit(1);
}

const projectRoot = path.dirname(path.dirname(dbPath));
const { runTracked } = require(path.join(projectRoot, 'src', 'utils', 'logger'));
const { invoiceSchema } = require(path.join(projectRoot, 'src', 'utils', 'validate'));
const invoice = require(path.join(projectRoot, 'src', 'models', 'invoice'));
const errorModel = require(path.join(projectRoot, 'src', 'models', 'error'));
const { printJSON } = require(path.join(projectRoot, 'src', 'utils', 'output'));
const { closeDb } = require(path.join(projectRoot, 'src', 'utils', 'db'));

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
 * Matches: $123.45, €123,45, 123.45, 1,234.56
 */
function extractAmount(text) {
  const patterns = [
    /[$€£]\s?(\d(?:[,\d]*\d)?(?:\.\d+)?)/,
    /(\d(?:[,\d]*\d)?\.\d{2})\b/,
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) {
      const cleaned = m[1].replaceAll(',', '');
      const num = Number.parseFloat(cleaned);
      if (num > 0) return num;
    }
  }
  return null;
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

try {
  const invoiceDir = process.env.INVOICE_DIR || path.join(os.homedir(), 'Documents', 'Invoices');

  if (!fs.existsSync(invoiceDir)) {
    console.log(`Invoice directory not found: ${invoiceDir}`);
    console.log('Set INVOICE_DIR or create ~/Documents/Invoices with PDF files.');
    process.exit(0);
  }

  const result = runTracked(SCRIPT_NAME, (log) => {
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

        const payload = {
          vendor,
          amount,
          invoice_date: invoiceDate || new Date().toISOString().slice(0, 10),
          file_path: filePath,
        };

        invoiceSchema.parse(payload);
        invoice.insert(payload);
        log('INFO', `Extracted: ${file} → ${vendor}, ${amount}`, JSON.stringify({ vendor, amount, invoiceDate }));
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
  errorModel.insert({ script: SCRIPT_NAME, message: err.message, stack_trace: err.stack });
  console.error('FATAL:', err.message);
  process.exit(1);
} finally {
  closeDb();
}
