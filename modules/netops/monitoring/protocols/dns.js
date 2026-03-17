/**
 * DNS Protocol Check — resolve a domain and optionally compare against expected IP.
 * Supports A, AAAA, MX, CNAME record types.
 */

const dns = require('node:dns').promises;

const DEFAULT_TIMEOUT = 5000;

const RESOLVERS = {
  A:     (hostname) => dns.resolve4(hostname),
  AAAA:  (hostname) => dns.resolve6(hostname),
  MX:    (hostname) => dns.resolveMx(hostname),
  CNAME: (hostname) => dns.resolveCname(hostname),
};

/**
 * @param {object} host  - { hostname, expected_ip, record_type }
 * @param {object} opts  - { timeout }
 * @returns {{ online: boolean, latency_ms: number|null, detail: object }}
 */
async function check(host, opts = {}) {
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  const hostname = host.hostname;
  const recordType = (host.record_type || 'A').toUpperCase();
  const expectedIp = host.expected_ip || null;

  const resolver = RESOLVERS[recordType] || RESOLVERS.A;
  const start = Date.now();

  try {
    const result = await Promise.race([
      resolver(hostname),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('DNS timeout')), timeout)
      ),
    ]);

    const latency_ms = Date.now() - start;

    // Format resolved addresses
    let addresses;
    if (recordType === 'MX') {
      addresses = result.map(r => `${r.priority} ${r.exchange}`);
    } else {
      addresses = Array.isArray(result) ? result : [result];
    }

    // Compare against expected IP if specified
    let ipMatch = null;
    if (expectedIp && (recordType === 'A' || recordType === 'AAAA')) {
      ipMatch = addresses.includes(expectedIp);
    }

    const online = ipMatch !== null ? ipMatch : addresses.length > 0;

    return {
      online,
      latency_ms,
      detail: {
        record_type: recordType,
        addresses,
        expected_ip: expectedIp,
        ip_match: ipMatch,
        resolution_time_ms: latency_ms,
      },
    };
  } catch (err) {
    return {
      online: false,
      latency_ms: Date.now() - start,
      detail: {
        record_type: recordType,
        error: err.message,
      },
    };
  }
}

module.exports = { check };
