/**
 * Shared execution tracking helper for automation scripts.
 *
 * Wraps a script's main logic with:
 *   - An execution_tracking row (start → finish with status)
 *   - A log() callback that inserts into automation_logs
 *   - Automatic status update (SUCCESS / FAIL) on completion
 *   - Automatic db.save() after tracking writes
 *
 * Usage:
 *   const result = runTracked(db, 'my-script', (log) => {
 *     log('INFO', 'Starting...');
 *     // ... do work ...
 *     log('SUCCESS', 'Done');
 *     return { key: 'value' };
 *   });
 */

/**
 * @param {object} db    - Database handle from _lib/db.js
 * @param {string} name  - Script name for tracking
 * @param {function} fn  - Callback receiving a log(level, message, metadata?) function
 * @returns {*} Whatever fn returns
 */
function runTracked(db, name, fn) {
  // Insert execution start
  db.run('INSERT INTO execution_tracking (script) VALUES (?)', [name]);
  const row = db.get('SELECT last_insert_rowid() AS id');
  const trackId = row ? row.id : null;

  function log(level, message, metadata) {
    db.run(
      'INSERT INTO automation_logs (script, status, message, metadata) VALUES (?, ?, ?, ?)',
      [name, level, message, metadata || null]
    );
  }

  try {
    const result = fn(log);
    if (trackId) {
      db.run(
        "UPDATE execution_tracking SET end_time = datetime('now', 'localtime'), status = 'SUCCESS' WHERE id = ?",
        [trackId]
      );
    }
    db.save();
    return result;
  } catch (err) {
    if (trackId) {
      db.run(
        "UPDATE execution_tracking SET end_time = datetime('now', 'localtime'), status = 'FAIL', error_message = ? WHERE id = ?",
        [err.message, trackId]
      );
    }
    db.save();
    throw err;
  }
}

module.exports = { runTracked };
