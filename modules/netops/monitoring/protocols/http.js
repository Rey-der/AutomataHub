/**
 * HTTP/HTTPS Protocol Check — GET request with status, timing, keyword, and TLS cert info.
 */

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const DEFAULT_TIMEOUT = 10000;
const MAX_BODY_BYTES = 1024 * 64; // 64 KB for keyword search

/**
 * @param {object} host  - { hostname, port, protocol, expected_status, keyword, url }
 * @param {object} opts  - { timeout }
 * @returns {{ online: boolean, latency_ms: number|null, detail: object }}
 */
async function check(host, opts = {}) {
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  const proto = (host.protocol === 'https') ? 'https' : 'http';
  const port = host.port || (proto === 'https' ? 443 : 80);

  // Build URL: if user provided a full URL, use it; otherwise construct from hostname
  let urlStr = host.url;
  if (!urlStr) {
    urlStr = `${proto}://${host.hostname}:${port}/`;
  } else if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
    urlStr = `${proto}://${urlStr}`;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(urlStr);
  } catch {
    return { online: false, latency_ms: null, detail: { error: 'Invalid URL' } };
  }

  const expectedStatus = host.expected_status || null; // null = accept 2xx
  const keyword = host.keyword || null;
  const start = process.hrtime.bigint();

  return new Promise((resolve) => {
    const lib = parsedUrl.protocol === 'https:' ? https : http;

    const reqOpts = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      timeout,
      rejectUnauthorized: false, // Still check cert info, but don't fail on self-signed
      headers: { 'User-Agent': 'NetOps-Monitor/1.0' },
    };

    const timer = setTimeout(() => {
      req.destroy();
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      resolve({
        online: false,
        latency_ms: Math.round(elapsed),
        detail: { error: 'Timeout', timeout_ms: timeout },
      });
    }, timeout);

    const req = lib.request(reqOpts, (res) => {
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      const latency_ms = Math.round(elapsed);

      // Cert info (HTTPS only)
      let certExpiry = null;
      if (res.socket && typeof res.socket.getPeerCertificate === 'function') {
        try {
          const cert = res.socket.getPeerCertificate();
          if (cert?.valid_to) certExpiry = cert.valid_to;
        } catch { /* ignore */ }
      }

      const statusCode = res.statusCode;
      const isExpectedStatus = expectedStatus
        ? statusCode === expectedStatus
        : statusCode >= 200 && statusCode < 300;

      // Collect body for keyword search (limited)
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        if (size < MAX_BODY_BYTES) {
          chunks.push(chunk);
          size += chunk.length;
        }
      });

      res.on('end', () => {
        clearTimeout(timer);
        let keywordFound = null;
        if (keyword) {
          const body = Buffer.concat(chunks).toString('utf-8').substring(0, MAX_BODY_BYTES);
          keywordFound = body.includes(keyword);
        }

        const online = isExpectedStatus && (keyword ? keywordFound : true);
        resolve({
          online,
          latency_ms,
          detail: {
            status_code: statusCode,
            response_time_ms: latency_ms,
            cert_expiry_date: certExpiry,
            keyword_found: keywordFound,
          },
        });
      });

      res.on('error', () => {
        clearTimeout(timer);
        resolve({
          online: false,
          latency_ms,
          detail: { status_code: statusCode, error: 'Response read error' },
        });
      });
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      resolve({
        online: false,
        latency_ms: Math.round(elapsed),
        detail: { error: err.message },
      });
    });

    req.end();
  });
}

module.exports = { check };
