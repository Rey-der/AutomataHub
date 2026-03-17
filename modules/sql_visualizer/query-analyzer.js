/**
 * SQL Visualizer — RPA analytics engine.
 * Computes script health, performance stats, error patterns, activity heatmaps,
 * execution timelines, integrity checks, and DB health metrics.
 *
 * Operates on the same better-sqlite3 connection managed by db-bridge.js.
 */

const dbBridge = require('./db-bridge');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely run a read-only query and return rows (empty array on error).
 */
function _query(sql) {
  const result = dbBridge.runReadOnlyQuery(sql);
  return result.rows;
}

// ---------------------------------------------------------------------------
// Script Health
// ---------------------------------------------------------------------------

/**
 * Per-script success rate, current streak, and last-run status.
 * Returns an array of { script, total, successes, failures, successRate,
 *   lastStatus, lastRun, currentStreak, streakType }.
 */
function getScriptHealthStats() {
  if (!dbBridge.isConnected()) {
    return [];
  }
  // Aggregate counts
  const stats = _query(`
    SELECT
      script,
      COUNT(*)                                        AS total,
      SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN status = 'FAIL'    THEN 1 ELSE 0 END) AS failures,
      MAX(start_time)                                 AS lastRun
    FROM execution_tracking
    WHERE status IS NOT NULL
    GROUP BY script
    ORDER BY script
  `);

  // Last status per script
  const lastRows = _query(`
    SELECT script, status
    FROM execution_tracking
    WHERE status IS NOT NULL
    ORDER BY start_time DESC
  `);

  const lastStatusMap = {};
  for (const r of lastRows) {
    if (!lastStatusMap[r.script]) lastStatusMap[r.script] = r.status;
  }

  // Streak per script (consecutive same-status from most recent)
  const allExecs = _query(`
    SELECT script, status
    FROM execution_tracking
    WHERE status IS NOT NULL
    ORDER BY start_time DESC
  `);

  const streakMap = {}; // script → { count, type }
  for (const r of allExecs) {
    if (!streakMap[r.script]) {
      streakMap[r.script] = { count: 1, type: r.status };
    } else if (streakMap[r.script].type === r.status) {
      streakMap[r.script].count++;
    }
    // Stop counting once streak breaks (but we iterate all — Map already has value)
  }

  return stats.map((s) => {
    const rate = s.total > 0 ? Math.round((s.successes / s.total) * 100) : 0;
    const streak = streakMap[s.script] || { count: 0, type: null };
    let health = 'healthy';
    if (rate < 50) health = 'critical';
    else if (rate < 80) health = 'degraded';

    return {
      script: s.script,
      total: s.total,
      successes: s.successes,
      failures: s.failures,
      successRate: rate,
      lastStatus: lastStatusMap[s.script] || null,
      lastRun: s.lastRun,
      currentStreak: streak.count,
      streakType: streak.type,
      health,
    };
  });
}

// ---------------------------------------------------------------------------
// Performance Stats
// ---------------------------------------------------------------------------

/**
 * Runtime statistics.  If `script` is provided, scopes to that script only.
 * Returns { script|'all', count, avgMs, minMs, maxMs, medianMs, p95Ms, runs[] }.
 * `runs` contains { id, script, start_time, end_time, durationMs, status }.
 */
function getPerformanceStats(script) {
  const filter = script ? `AND script = '${_escLiteral(script)}'` : '';

  const runs = _query(`
    SELECT id, script, start_time, end_time, status
    FROM execution_tracking
    WHERE end_time IS NOT NULL AND status IS NOT NULL ${filter}
    ORDER BY start_time DESC
  `);

  const durations = runs.map((r) => {
    const ms = new Date(r.end_time) - new Date(r.start_time);
    return { ...r, durationMs: ms >= 0 ? ms : 0 };
  });

  if (durations.length === 0) {
    return { script: script || 'all', count: 0, avgMs: 0, minMs: 0, maxMs: 0, medianMs: 0, p95Ms: 0, runs: [] };
  }

  const sorted = durations.map((d) => d.durationMs).sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / sorted.length);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];

  return {
    script: script || 'all',
    count: durations.length,
    avgMs: avg,
    minMs: min,
    maxMs: max,
    medianMs: median,
    p95Ms: p95,
    runs: durations.slice(0, 200), // cap for transport
  };
}

// ---------------------------------------------------------------------------
// Error Patterns
// ---------------------------------------------------------------------------

/**
 * Cluster error messages by similarity and rank by frequency.
 * Returns [ { pattern, count, scripts[], latestTimestamp, examples[] } ].
 */
function getErrorPatterns() {
  const errors = _query(`
    SELECT id, script, timestamp, message
    FROM errors
    ORDER BY timestamp DESC
  `);

  // Group by normalized message (strip numbers, paths, UUIDs)
  const groups = {};
  for (const e of errors) {
    const key = _normalizeErrorMessage(e.message);
    if (!groups[key]) {
      groups[key] = { pattern: key, count: 0, scripts: new Set(), latestTimestamp: e.timestamp, examples: [] };
    }
    groups[key].count++;
    groups[key].scripts.add(e.script);
    if (groups[key].examples.length < 3) {
      groups[key].examples.push({ id: e.id, script: e.script, timestamp: e.timestamp, message: e.message });
    }
  }

  return Object.values(groups)
    .map((g) => ({ ...g, scripts: [...g.scripts] }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Normalize an error message for grouping: replace numbers, paths, UUIDs with placeholders.
 */
function _normalizeErrorMessage(msg) {
  return msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/\/[\w./-]+/g, '<PATH>')
    .replace(/\b\d{4,}\b/g, '<NUM>')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Activity Heatmap
// ---------------------------------------------------------------------------

/**
 * Hour-of-day × day-of-week aggregation of automation_logs.
 * Returns { cells: [ { day (0=Sun…6=Sat), hour (0–23), count } ], maxCount }.
 */
function getActivityHeatmap(timeRange, script) {
  const where = _buildTimeWhere('timestamp', timeRange, script);

  const rows = _query(`
    SELECT
      CAST(strftime('%w', timestamp) AS INTEGER) AS day,
      CAST(strftime('%H', timestamp) AS INTEGER) AS hour,
      COUNT(*) AS count
    FROM automation_logs
    ${where}
    GROUP BY day, hour
  `);

  // Fill the full 7×24 grid (missing cells = 0)
  const map = {};
  let maxCount = 0;
  for (const r of rows) {
    const key = `${r.day}-${r.hour}`;
    map[key] = r.count;
    if (r.count > maxCount) maxCount = r.count;
  }

  const cells = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      cells.push({ day, hour, count: map[`${day}-${hour}`] || 0 });
    }
  }

  return { cells, maxCount };
}

// ---------------------------------------------------------------------------
// Integrity Report
// ---------------------------------------------------------------------------

/**
 * Detect zombie runs (started but never finished), stale tables, and execution gaps.
 */
function getIntegrityReport() {
  // Zombie runs: started but no end_time and no status, older than 1 hour
  const zombies = _query(`
    SELECT id, script, start_time
    FROM execution_tracking
    WHERE end_time IS NULL AND status IS NULL
      AND datetime(start_time) < datetime('now', 'localtime', '-1 hour')
    ORDER BY start_time DESC
  `);

  // Last activity per table
  const tableActivity = [];
  const TIMESTAMP_MAP = {
    automation_logs: 'timestamp',
    execution_tracking: 'start_time',
    errors: 'timestamp',
    file_processing_records: 'timestamp',
    backup_history: 'backup_date',
    invoices: 'processing_timestamp',
  };

  for (const [table, col] of Object.entries(TIMESTAMP_MAP)) {
    try {
      const rows = _query(`SELECT MAX("${col}") AS latest FROM "${table}"`);
      const latest = rows[0]?.latest || null;
      const daysSince = latest
        ? Math.floor((Date.now() - new Date(latest).getTime()) / 86400000)
        : null;
      tableActivity.push({ table, latestActivity: latest, daysSince, stale: daysSince !== null && daysSince > 7 });
    } catch {
      tableActivity.push({ table, latestActivity: null, daysSince: null, stale: false });
    }
  }

  // Execution gaps: scripts that haven't run in >24h when they normally run daily
  const scriptFreq = _query(`
    SELECT script,
      COUNT(*) AS total,
      MAX(start_time) AS lastRun,
      ROUND(JULIANDAY('now', 'localtime') - JULIANDAY(MAX(start_time)), 1) AS daysSinceLast
    FROM execution_tracking
    GROUP BY script
  `);

  const gaps = scriptFreq.filter((s) => s.daysSinceLast > 1 && s.total > 2);

  return { zombies, tableActivity, gaps };
}

// ---------------------------------------------------------------------------
// Database Health
// ---------------------------------------------------------------------------

/**
 * Returns { fileSizeBytes, walSizeBytes, integrityOk, indexCount, tableCount, pageSize, pageCount }.
 */
function getDbHealth() {
  if (!dbBridge.isConnected()) {
    return { fileSizeBytes: 0, walSizeBytes: 0, integrityOk: false, indexCount: 0, tableCount: 0, pageSize: 0, pageCount: 0, lastModified: null };
  }

  const fs = require('fs');
  const dbPath = dbBridge.getDbPath();
  let fileSizeBytes = 0;
  let walSizeBytes = 0;
  let lastModified = null;

  if (dbPath) {
    try {
      const stat = fs.statSync(dbPath);
      fileSizeBytes = stat.size;
      lastModified = stat.mtime.toISOString();
    } catch { /* ignore */ }
    try { walSizeBytes = fs.statSync(dbPath + '-wal').size; } catch { /* no WAL */ }
  }

  let integrityOk = false;
  try {
    const rows = _query('PRAGMA integrity_check');
    integrityOk = rows.length === 1 && rows[0].integrity_check === 'ok';
  } catch { /* ignore */ }

  let pageSize = 0;
  let pageCount = 0;
  try {
    const ps = _query('PRAGMA page_size');
    pageSize = ps[0]?.page_size || 0;
    const pc = _query('PRAGMA page_count');
    pageCount = pc[0]?.page_count || 0;
  } catch { /* ignore */ }

  const tables = dbBridge.getTables();

  let indexCount = 0;
  try {
    const idx = _query("SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='index'");
    indexCount = idx[0]?.cnt || 0;
  } catch { /* ignore */ }

  return { fileSizeBytes, walSizeBytes, integrityOk, indexCount, tableCount: tables.length, pageSize, pageCount, lastModified };
}

// ---------------------------------------------------------------------------
// Correlated Records
// ---------------------------------------------------------------------------

/**
 * Given an execution_tracking id, find logs and errors that occurred during that
 * execution's time window for the same script.
 */
function getCorrelatedRecords(executionId) {
  const execs = _query(`
    SELECT id, script, start_time, end_time, status, error_message
    FROM execution_tracking
    WHERE id = ${parseInt(executionId, 10)}
  `);

  if (execs.length === 0) return { execution: null, logs: [], errors: [] };

  const exec = execs[0];
  const end = exec.end_time || "datetime('now', 'localtime')";

  const logs = _query(`
    SELECT id, timestamp, status, message, metadata
    FROM automation_logs
    WHERE script = '${_escLiteral(exec.script)}'
      AND timestamp >= '${_escLiteral(exec.start_time)}'
      AND timestamp <= '${_escLiteral(end)}'
    ORDER BY timestamp
  `);

  const errors = _query(`
    SELECT id, timestamp, message, stack_trace
    FROM errors
    WHERE script = '${_escLiteral(exec.script)}'
      AND timestamp >= '${_escLiteral(exec.start_time)}'
      AND timestamp <= '${_escLiteral(end)}'
    ORDER BY timestamp
  `);

  return { execution: exec, logs, errors };
}

// ---------------------------------------------------------------------------
// Execution Timeline
// ---------------------------------------------------------------------------

/**
 * All executions within a time range, with computed durations.
 * Returns [ { id, script, start_time, end_time, status, durationMs } ].
 */
function getExecutionTimeline(timeRange) {
  const where = _buildTimeWhere('start_time', timeRange);

  const rows = _query(`
    SELECT id, script, start_time, end_time, status, error_message
    FROM execution_tracking
    ${where}
    ORDER BY start_time ASC
  `);

  return rows.map((r) => {
    const durationMs = r.end_time ? Math.max(0, new Date(r.end_time) - new Date(r.start_time)) : null;
    return { ...r, durationMs };
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Escape a string for inclusion in a SQL literal (single-quote doubled).
 */
function _escLiteral(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/'/g, "''");
}

/**
 * Build a WHERE clause for a timestamp column given a timeRange and optional script.
 * @param {string} col — timestamp column name
 * @param {string} timeRange — 'hour' | 'today' | 'week' | 'month' | 'all'
 * @param {string} [script]
 */
function _buildTimeWhere(col, timeRange, script) {
  const conditions = [];

  switch (timeRange) {
    case 'hour':
      conditions.push(`"${col}" >= datetime('now', 'localtime', '-1 hour')`);
      break;
    case 'today':
      conditions.push(`date("${col}") = date('now', 'localtime')`);
      break;
    case 'week':
      conditions.push(`"${col}" >= datetime('now', 'localtime', '-7 days')`);
      break;
    case 'month':
      conditions.push(`"${col}" >= datetime('now', 'localtime', '-30 days')`);
      break;
    // 'all' — no time filter
  }

  if (script) {
    conditions.push(`script = '${_escLiteral(script)}'`);
  }

  return conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
}

module.exports = {
  getScriptHealthStats,
  getPerformanceStats,
  getErrorPatterns,
  getActivityHeatmap,
  getIntegrityReport,
  getDbHealth,
  getCorrelatedRecords,
  getExecutionTimeline,
};
