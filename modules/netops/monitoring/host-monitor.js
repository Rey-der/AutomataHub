/**
 * NetOps Host Monitor — network reachability checks.
 * Dispatches per-host protocol checks (tcp, icmp, http, https, dns).
 * Unified result shape: { online, latency_ms, protocol, detail }
 */

const net = require('node:net');

const tcpProto  = require('./protocols/tcp');
const icmpProto = require('./protocols/icmp');
const httpProto = require('./protocols/http');
const dnsProto  = require('./protocols/dns');

const DEFAULT_TIMEOUT = 5000;

const PROTOCOL_MAP = {
  tcp:   tcpProto,
  ping:  icmpProto,
  icmp:  icmpProto,
  http:  httpProto,
  https: httpProto,
  dns:   dnsProto,
};

/**
 * Fallback chains: if the primary protocol reports offline, try the next
 * protocol(s) before declaring the host down.  DNS has no fallback because
 * its semantics are different (record lookup, not reachability).
 */
const FALLBACK_CHAIN = {
  http:  [httpProto, tcpProto, icmpProto],
  https: [httpProto, tcpProto, icmpProto],
  tcp:   [tcpProto, icmpProto],
  ping:  [icmpProto, tcpProto],
  icmp:  [icmpProto, tcpProto],
  dns:   [dnsProto],
};

const HANDLER_NAMES = new Map([
  [tcpProto, 'TCP'],
  [icmpProto, 'ICMP'],
  [httpProto, 'HTTP'],
  [dnsProto, 'DNS'],
]);

class HostMonitor {
  constructor(timeout = DEFAULT_TIMEOUT) {
    this.timeout = timeout;
  }

  /**
   * Check a host using its configured protocol.
   * If the primary check reports offline, walk the fallback chain so a host
   * isn't marked down just because one protocol doesn't respond.
   * @param {string} hostname
   * @param {object} [hostConfig] - full host object with protocol, port, etc.
   * @returns {{ success: boolean, latency: number|null, online: boolean, latency_ms: number|null, protocol: string, detail: object }}
   */
  async ping(hostname, hostConfig) {
    const proto = hostConfig?.protocol || 'tcp';
    // Prefer the IP field for actual network checks — hostname may be a
    // friendly label (e.g. "Google DNS") rather than a resolvable address.
    const addr = hostConfig?.ip || hostname;

    const host = {
      hostname: addr,
      port: hostConfig?.port || 0,
      protocol: proto,
      url: hostConfig?.url || null,
      expected_status: hostConfig?.expected_status || null,
      keyword: hostConfig?.keyword || null,
      expected_ip: hostConfig?.expected_ip || null,
      record_type: hostConfig?.record_type || 'A',
    };

    const chain = FALLBACK_CHAIN[proto] || [PROTOCOL_MAP[proto] || tcpProto];
    let lastResult = null;

    for (const handler of chain) {
      const hName = HANDLER_NAMES.get(handler) || 'unknown';
      try {
        const result = await handler.check(host, { timeout: this.timeout });
        if (result.online) {
          const usedProto = result.detail?.protocol || proto;
          return {
            success: true,
            latency: result.latency_ms,
            online: true,
            latency_ms: result.latency_ms,
            protocol: usedProto,
            detail: { ...result.detail, primaryProtocol: proto },
          };
        }
        lastResult = result;
      } catch (fallbackErr) {
        console.error(`[netops:monitor] ${addr} ${hName} threw:`, fallbackErr.message);
      }
    }

    // All protocols in the chain failed — return the last failure result
    lastResult = lastResult || { online: false, latency_ms: null, detail: {} };
    return {
      success: false,
      latency: lastResult.latency_ms,
      online: false,
      latency_ms: lastResult.latency_ms,
      protocol: proto,
      detail: { ...lastResult.detail, primaryProtocol: proto, fallbackExhausted: true },
    };
  }

  /**
   * Check if a specific port is open on a host.
   * @returns {boolean}
   */
  async checkPort(hostname, port) {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: hostname, port, timeout: this.timeout });
      const timer = setTimeout(() => { socket.destroy(); resolve(false); }, this.timeout);

      socket.on('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
      socket.on('error', () => { clearTimeout(timer); resolve(false); });
    });
  }
}

module.exports = { HostMonitor };
