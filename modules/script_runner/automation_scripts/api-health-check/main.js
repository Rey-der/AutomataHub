/**
 * api-health-check — Pings HTTP endpoints and records status, latency, and errors.
 *
 * Environment variables:
 *   HEALTH_CHECK_URLS    — comma-separated list of URLs to probe
 *   HEALTH_CHECK_TIMEOUT — request timeout in milliseconds (default: 10000)
 *
 * Writes:
 *   - automation_logs (one row per endpoint + summary)
 *   - execution_tracking (start → finish)
 *   - errors (on failure)
 */

const { openDatabase } = require('../_lib/db');
const { printJSON } = require('../_lib/output');
const http = require('node:http');
const https = require('node:https');

function probeEndpoint(url, timeoutMs) {
  const mod = url.startsWith('https') ? https : http;
  const start = Date.now();

  return new Promise((resolve) => {
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({
        url,
        status: res.statusCode,
        latency_ms: Date.now() - start,
        error: null,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ url, status: 'TIMEOUT', latency_ms: Date.now() - start, error: 'Request timed out' });
    });

    req.on('error', (err) => {
      resolve({ url, status: 'ERROR', latency_ms: Date.now() - start, error: err.message });
    });
  });
}

function log(db, script, level, message) {
  db.run(
    'INSERT INTO automation_logs (script, status, message) VALUES (?, ?, ?)',
    [script, level, message]
  );
}

async function main() {
  const urlsEnv = process.env.HEALTH_CHECK_URLS;
  if (!urlsEnv) {
    console.log('No endpoints configured.\n');
    console.log('Set the HEALTH_CHECK_URLS environment variable to a comma-separated list of URLs.');
    console.log('  Example: https://example.com,https://api.example.com/health');
    process.exit(0);
  }

  const timeoutMs = Number.parseInt(process.env.HEALTH_CHECK_TIMEOUT, 10) || 10000;
  const urls = urlsEnv.split(',').map(u => u.trim()).filter(Boolean);
  const scriptName = 'api-health-check';

  const db = await openDatabase();

  db.run('INSERT INTO execution_tracking (script) VALUES (?)', [scriptName]);
  const row = db.get('SELECT last_insert_rowid() AS id');
  const trackId = row ? row.id : null;

  log(db, scriptName, 'INFO', `Checking ${urls.length} endpoint(s), timeout ${timeoutMs}ms`);

  try {
    const results = [];
    let healthy = 0;
    let unhealthy = 0;

    for (const url of urls) {
      const entry = await probeEndpoint(url, timeoutMs);
      results.push(entry);

      const ok = typeof entry.status === 'number' && entry.status >= 200 && entry.status < 400;
      if (ok) healthy++;
      else unhealthy++;

      log(db, scriptName, ok ? 'INFO' : 'ERROR', `${url} — ${entry.status} (${entry.latency_ms}ms)`);
    }

    log(db, scriptName, 'SUCCESS', `Done: ${healthy} healthy, ${unhealthy} unhealthy`);

    if (trackId) {
      db.run(
        "UPDATE execution_tracking SET end_time = datetime('now', 'localtime'), status = ? WHERE id = ?",
        [unhealthy === 0 ? 'SUCCESS' : 'PARTIAL', trackId]
      );
    }

    console.log('Health Check Results:\n');
    printJSON({ healthy, unhealthy, endpoints: results });
  } catch (err) {
    db.run('INSERT INTO errors (script, message, stack_trace) VALUES (?, ?, ?)',
      [scriptName, err.message, err.stack || '']);

    if (trackId) {
      db.run(
        "UPDATE execution_tracking SET end_time = datetime('now', 'localtime'), status = 'FAIL', error_message = ? WHERE id = ?",
        [err.message, trackId]
      );
    }

    console.error(`FATAL: ${err.message}`);
    process.exitCode = 1;
  } finally {
    db.save();
    db.close();
  }
}

main();
