/**
 * download-sorter — Sorts files in ~/Downloads into categorised subfolders.
 *
 * Categories (by extension):
 *   Images:    .jpg .jpeg .png .gif .webp .svg .bmp .ico .tiff
 *   Documents: .pdf .doc .docx .xls .xlsx .ppt .pptx .txt .rtf .odt .csv
 *   Archives:  .zip .tar .gz .7z .rar .bz2 .xz .dmg .iso
 *   Audio:     .mp3 .wav .flac .aac .ogg .m4a .wma
 *   Video:     .mp4 .mkv .avi .mov .wmv .flv .webm
 *   Code:      .js .ts .py .rb .go .rs .java .c .cpp .h .css .html .json .xml .yaml .yml .sh .md
 *   Other:     everything else
 *
 * Writes:
 *   - file_processing_records (one per file)
 *   - automation_logs (start, per-category summary, end)
 *   - execution_tracking (start -> finish)
 *   - errors (on failure)
 *
 * Configurable via environment variables:
 *   DOWNLOADS_DIR  — source folder (default: ~/Downloads)
 *   DRY_RUN=1      — print what would happen without moving files
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { openDatabase } = require('../_lib/db');
const { printJSON } = require('../_lib/output');
const { runTracked } = require('../_lib/tracker');

const SCRIPT_NAME = 'download-sorter';

const CATEGORIES = {
  Images:    ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff'],
  Documents: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.odt', '.csv'],
  Archives:  ['.zip', '.tar', '.gz', '.7z', '.rar', '.bz2', '.xz', '.dmg', '.iso'],
  Audio:     ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma'],
  Video:     ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm'],
  Code:      ['.js', '.ts', '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.css', '.html', '.json', '.xml', '.yaml', '.yml', '.sh', '.md'],
};

function categorise(ext) {
  const lower = ext.toLowerCase();
  for (const [category, exts] of Object.entries(CATEGORIES)) {
    if (exts.includes(lower)) return category;
  }
  return 'Other';
}

(async () => {
  const db = await openDatabase();
  try {
    const downloadsDir = process.env.DOWNLOADS_DIR || path.join(os.homedir(), 'Downloads');
    const dryRun = process.env.DRY_RUN === '1';

    if (!fs.existsSync(downloadsDir)) {
      console.log(`Downloads directory not found: ${downloadsDir}`);
      db.save();
      process.exit(0);
    }

    const result = runTracked(db, SCRIPT_NAME, (log) => {
      log('INFO', `Scanning ${downloadsDir}` + (dryRun ? ' (DRY RUN)' : ''));

      const entries = fs.readdirSync(downloadsDir, { withFileTypes: true });
      const files = entries.filter(e => e.isFile() && !e.name.startsWith('.'));

      if (files.length === 0) {
        log('INFO', 'No files to sort.');
        return { sorted: 0, skipped: 0 };
      }

      let sorted = 0;
      let skipped = 0;
      const categoryCounts = {};

      for (const file of files) {
        const ext = path.extname(file.name);
        const category = categorise(ext);
        const sourcePath = path.join(downloadsDir, file.name);
        const destDir = path.join(downloadsDir, category);
        const destPath = path.join(destDir, file.name);

        // Skip if destination already exists
        if (fs.existsSync(destPath)) {
          db.run(
            'INSERT INTO file_processing_records (source_path, file_type, script, operation) VALUES (?, ?, ?, ?)',
            [sourcePath, ext || 'none', SCRIPT_NAME, 'skip']
          );
          skipped++;
          continue;
        }

        if (!dryRun) {
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }
          fs.renameSync(sourcePath, destPath);
        }

        db.run(
          'INSERT INTO file_processing_records (source_path, dest_path, file_type, script, operation) VALUES (?, ?, ?, ?, ?)',
          [sourcePath, destPath, ext || 'none', SCRIPT_NAME, 'sort']
        );

        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
        sorted++;
      }

      log('SUCCESS', `Sorted ${sorted} files, skipped ${skipped}`, JSON.stringify({ categoryCounts, skipped }));
      return { sorted, skipped, categoryCounts };
    });

    console.log(dryRun ? 'DRY RUN — no files moved.\n' : 'Sort complete.\n');
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
