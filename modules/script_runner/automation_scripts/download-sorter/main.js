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
 *   - execution_tracking (start → finish)
 *   - errors (on failure)
 *
 * Configurable via environment variables:
 *   DOWNLOADS_DIR  — source folder (default: ~/Downloads)
 *   DRY_RUN=1      — print what would happen without moving files
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
const { fileProcessingSchema } = require(path.join(projectRoot, 'src', 'utils', 'validate'));
const fileProcessing = require(path.join(projectRoot, 'src', 'models', 'fileProcessing'));
const errorModel = require(path.join(projectRoot, 'src', 'models', 'error'));
const { printJSON } = require(path.join(projectRoot, 'src', 'utils', 'output'));
const { closeDb } = require(path.join(projectRoot, 'src', 'utils', 'db'));

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

try {
  const downloadsDir = process.env.DOWNLOADS_DIR || path.join(os.homedir(), 'Downloads');
  const dryRun = process.env.DRY_RUN === '1';

  if (!fs.existsSync(downloadsDir)) {
    console.error(`Downloads directory not found: ${downloadsDir}`);
    process.exit(1);
  }

  const result = runTracked(SCRIPT_NAME, (log) => {
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
        const payload = { source_path: sourcePath, file_type: ext || 'none', script: SCRIPT_NAME, operation: 'skip' };
        fileProcessingSchema.parse(payload);
        fileProcessing.insert(payload);
        skipped++;
        continue;
      }

      if (!dryRun) {
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        fs.renameSync(sourcePath, destPath);
      }

      const payload = {
        source_path: sourcePath,
        dest_path: destPath,
        file_type: ext || 'none',
        script: SCRIPT_NAME,
        operation: 'sort',
      };
      fileProcessingSchema.parse(payload);
      fileProcessing.insert(payload);

      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      sorted++;
    }

    log('SUCCESS', `Sorted ${sorted} files, skipped ${skipped}`, JSON.stringify({ categoryCounts, skipped }));
    return { sorted, skipped, categoryCounts };
  });

  console.log(dryRun ? 'DRY RUN — no files moved.\n' : 'Sort complete.\n');
  printJSON(result);
} catch (err) {
  errorModel.insert({ script: SCRIPT_NAME, message: err.message, stack_trace: err.stack });
  console.error('FATAL:', err.message);
  process.exit(1);
} finally {
  closeDb();
}
