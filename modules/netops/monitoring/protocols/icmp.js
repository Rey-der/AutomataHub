/**
 * ICMP Protocol Check — system `ping` command.
 * Falls back to TCP if ICMP is unavailable (permission denied, etc.).
 */

const { execFile } = require('node:child_process');
const tcpCheck = require('./tcp');

const PING_TIMEOUT_S = 3;
const PING_TIMEOUT_MS = PING_TIMEOUT_S * 1000;
const KILL_TIMEOUT_MS = 5000;

// Regex patterns for round-trip time extraction
const LATENCY_RE = {
  // macOS / Linux: "round-trip min/avg/max/stddev = 1.234/2.345/3.456/0.567 ms"
  unix: /=\s*[\d.]+\/([\d.]+)\//,
  // Windows: "Average = 2ms"
  win: /Average\s*=\s*(\d+)\s*ms/i,
  // Fallback: "time=1.23 ms" or "time<1ms"
  single: /time[=<]([\d.]+)\s*ms/i,
};

/**
 * @param {object} host  - { hostname }
 * @param {object} opts  - { timeout }
 * @returns {{ online: boolean, latency_ms: number|null, detail: object }}
 */
async function check(host, opts = {}) {
  const hostname = host.hostname;
  const start = Date.now();

  try {
    const latency = await runPing(hostname);
    return {
      online: true,
      latency_ms: latency,
      detail: { protocol: 'icmp' },
    };
  } catch (err) {
    // If permission denied or not available, fall back to TCP
    if (isPermanentFailure(err)) {
      const result = await Promise.resolve(tcpCheck.check(host, opts));
      result.detail = { ...result.detail, icmpFallback: true, icmpError: err.message };
      return result;
    }
    return {
      online: false,
      latency_ms: Date.now() - start,
      detail: { protocol: 'icmp', error: err.message },
    };
  }
}

function runPing(hostname) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    // -W on macOS expects milliseconds; on Linux expects seconds
    let args;
    if (isWin) {
      args = ['-n', '1', '-w', String(PING_TIMEOUT_MS), hostname];
    } else if (isMac) {
      args = ['-c', '1', '-W', String(PING_TIMEOUT_MS), hostname];
    } else {
      args = ['-c', '1', '-W', String(PING_TIMEOUT_S), hostname];
    }

    const child = execFile('ping', args, { timeout: KILL_TIMEOUT_MS }, (err, stdout) => {
      if (err) return reject(err);
      const latency = parseLatency(stdout);
      if (latency !== null) return resolve(latency);
      reject(new Error('Could not parse ping output'));
    });

    // Safety: kill if execFile timeout doesn't fire
    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already exited */ }
    }, KILL_TIMEOUT_MS + 1000);
    child.on('exit', () => clearTimeout(killTimer));
  });
}

function parseLatency(stdout) {
  for (const re of Object.values(LATENCY_RE)) {
    const m = stdout.match(re);
    if (m) return Number.parseFloat(m[1]);
  }
  return null;
}

function isPermanentFailure(err) {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('permission denied') ||
         msg.includes('operation not permitted') ||
         msg.includes('eacces') ||
         msg.includes('enoent');
}

module.exports = { check };
