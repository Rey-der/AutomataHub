/**
 * backup-runner — Copies configured folders to a backup location.
 *
 * Reads a list of source folders and a destination from environment variables,
 * then recursively copies files. Skips files that already exist at the destination
 * with the same size and modification time.
 *
 * Configurable via environment variables:
 *   BACKUP_FOLDERS — comma-separated list of absolute folder paths to back up
 *   BACKUP_DEST   — destination directory (default: ~/Backups)
 *
 * Writes:
 *   - backup_history (one summary row per run)
 *   - automation_logs (start, progress, end)
 *   - execution_tracking (start -> finish)
 *   - errors (on failure)
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { openDatabase } = require('../_lib/db');
const { printJSON } = require('../_lib/output');
const { runTracked } = require('../_lib/tracker');

const SCRIPT_NAME = 'backup-runner';

/**
 * Recursively copies files from src to dest.
 * Skips files where dest already exists with same size + mtime.
 * Returns { copied, skipped }.
 */
function copyDir(src, dest) {
  let copied = 0;
  let skipped = 0;

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    // Skip hidden files and common junk
    if (entry.name.startsWith('.')) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      const sub = copyDir(srcPath, destPath);
      copied += sub.copied;
      skipped += sub.skipped;
    } else if (entry.isFile()) {
      const srcStat = fs.statSync(srcPath);

      if (fs.existsSync(destPath)) {
        const destStat = fs.statSync(destPath);
        // Skip if same size and same mtime (within 1 second)
        if (
          destStat.size === srcStat.size &&
          Math.abs(destStat.mtimeMs - srcStat.mtimeMs) < 1000
        ) {
          skipped++;
          continue;
        }
      }

      fs.copyFileSync(srcPath, destPath);
      // Preserve modification time
      fs.utimesSync(destPath, srcStat.atime, srcStat.mtime);
      copied++;
    }
  }

  return { copied, skipped };
}

(async () => {
  const db = await openDatabase();
  try {
    const foldersEnv = process.env.BACKUP_FOLDERS;
    const backupDest = process.env.BACKUP_DEST || path.join(os.homedir(), 'Backups');

    if (!foldersEnv) {
      console.error('ERROR: BACKUP_FOLDERS environment variable is not set.');
      console.error('Set it to a comma-separated list of folders to back up.');
      console.error('  e.g. BACKUP_FOLDERS="/Users/me/Documents,/Users/me/Projects"');
      process.exit(1);
    }

    const folders = foldersEnv.split(',').map(f => f.trim()).filter(Boolean);

    // Validate all source folders exist before starting
    for (const folder of folders) {
      if (!fs.existsSync(folder)) {
        console.error(`Source folder not found: ${folder}`);
        process.exit(1);
      }
    }

    const result = runTracked(db, SCRIPT_NAME, (log) => {
      log('INFO', `Backing up ${folders.length} folder(s) to ${backupDest}`);

      if (!fs.existsSync(backupDest)) {
        fs.mkdirSync(backupDest, { recursive: true });
      }

      let totalCopied = 0;
      let totalSkipped = 0;
      let status = 'SUCCESS';

      for (const folder of folders) {
        const folderName = path.basename(folder);
        const dest = path.join(backupDest, folderName);

        try {
          const { copied, skipped } = copyDir(folder, dest);
          totalCopied += copied;
          totalSkipped += skipped;
          log('INFO', `${folderName}: ${copied} copied, ${skipped} skipped`);
        } catch (err) {
          log('ERROR', `Failed to back up ${folderName}: ${err.message}`);
          status = 'PARTIAL';
        }
      }

      const folderNames = folders.map(f => path.basename(f));

      db.run(
        'INSERT INTO backup_history (folders, files_copied, files_skipped, backup_location, status) VALUES (?, ?, ?, ?, ?)',
        [JSON.stringify(folderNames), totalCopied, totalSkipped, backupDest, status]
      );

      log('SUCCESS', `Backup complete: ${totalCopied} copied, ${totalSkipped} skipped`,
        JSON.stringify({ folders: folderNames, files_copied: totalCopied, files_skipped: totalSkipped, backup_location: backupDest, status }));
      return { folders: folderNames, files_copied: totalCopied, files_skipped: totalSkipped, backup_location: backupDest, status };
    });

    console.log('Backup complete.\n');
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
