/**
 * NetOps Network Scanner — CIDR range scanning and host discovery.
 * Scans IP ranges, auto-pings each host, and persists results to the store.
 */

class NetworkScanner {
  constructor(store, monitor) {
    this.store = store;
    this.monitor = monitor;
    this.activeScan = null;
  }

  /**
   * Scan a CIDR range, ping each host, and save discovered hosts.
   * @param {string} cidr - CIDR notation or single IP
   * @param {number|null} port - Optional port to check
   * @param {string|null} name - Optional network display name
   * @param {Function|null} send - Push event emitter
   */
  async scan(cidr, port, name, send) {
    // Cancel any running scan
    if (this.activeScan) this.activeScan.stop = true;

    const results = [];
    this.activeScan = { stop: false };

    const existing = this.store.findDiscoveredNetwork(cidr);
    let networkId;

    if (existing) {
      networkId = existing.id;
    } else {
      networkId = this.store.generateId();
      this.store.addDiscoveredNetwork({
        id: networkId,
        cidr,
        name: name || cidr,
        discovered_at: new Date().toISOString(),
      });
    }

    const ips = NetworkScanner.parseCIDR(cidr);
    let completed = 0;

    for (const ip of ips) {
      if (this.activeScan.stop) break;

      try {
        const ping = await this.monitor.ping(ip);
        const result = {
          ip,
          hostname: ip,
          status: ping.success ? 'online' : 'offline',
          latency: ping.latency || null,
          openPorts: [],
        };

        if (port && ping.success && await this.monitor.checkPort(ip, port)) {
          result.openPorts.push(port);
        }

        results.push(result);

        // Save or update discovered host
        const existingHost = this.store.findDiscoveredHost(
          h => h.network_id === networkId && h.ip === ip
        );
        const record = {
          id: existingHost?.id || this.store.generateId(),
          network_id: networkId,
          ip,
          hostname: ip,
          status: result.status,
          latency_ms: result.latency,
          discovered_at: existingHost?.discovered_at || new Date().toISOString(),
        };

        if (existingHost) {
          this.store.updateDiscoveredHost(existingHost, record);
        } else {
          this.store.addDiscoveredHost(record);
        }
      } catch (err) {
        results.push({ ip, status: 'error', latency: null, error: err.message });
      }

      completed++;
      if (send) {
        send('netops:scan-progress', {
          progress: Math.round((completed / ips.length) * 100),
          scanned: completed,
          total: ips.length,
        });
      }
    }

    this.activeScan = null;
    return {
      success: true,
      results,
      scanned: completed,
      total: ips.length,
      network_id: networkId,
      discovered_count: results.filter(r => r.status === 'online').length,
    };
  }

  /**
   * Parse CIDR notation to an array of usable IP addresses.
   * Handles single IPs, /32, and standard subnet masks.
   */
  static parseCIDR(cidr) {
    if (!cidr.includes('/')) return [cidr];

    const [ipPart, maskStr] = cidr.split('/');
    const mask = parseInt(maskStr, 10);
    if (mask < 0 || mask > 32) throw new Error('Invalid CIDR mask: ' + maskStr);
    if (mask === 32) return [ipPart];

    const parts = ipPart.split('.').map(p => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(p => p < 0 || p > 255)) {
      throw new Error('Invalid IP address: ' + ipPart);
    }

    const ip = (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
    const hostBits = 32 - mask;
    const hostMask = (1 << hostBits) - 1;
    const network = ip & ~hostMask;
    const broadcast = network | hostMask;

    const ips = [];
    for (let i = network + 1; i < broadcast; i++) {
      ips.push(
        `${(i >>> 24) & 0xFF}.${(i >>> 16) & 0xFF}.${(i >>> 8) & 0xFF}.${i & 0xFF}`
      );
    }
    return ips.length > 0 ? ips : [ipPart];
  }
}

module.exports = { NetworkScanner };
