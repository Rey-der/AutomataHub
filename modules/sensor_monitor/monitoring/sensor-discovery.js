/**
 * SensorDiscovery — discovers sensors on a network range.
 *
 * Strategy: for each IP in the target range, probe common sensor ports
 * (SNMP 161, Modbus 502, MQTT 1883, HTTP 80/8080) with TCP connect checks.
 * Found open ports are classified by protocol and returned as candidate sensors.
 *
 * This is a lightweight discovery — no actual SNMP walks or protocol handshakes.
 * Real protocol interaction happens during polling.
 */

const net = require('node:net');
const os = require('node:os');

const PROBE_PORTS = [
  { port: 161, protocol: 'snmp', type: 'network' },
  { port: 502, protocol: 'modbus', type: 'industrial' },
  { port: 1883, protocol: 'mqtt', type: 'iot' },
  { port: 8883, protocol: 'mqtts', type: 'iot' },
  { port: 80, protocol: 'http', type: 'web-sensor' },
  { port: 8080, protocol: 'http', type: 'web-sensor' },
  { port: 443, protocol: 'https', type: 'web-sensor' },
  { port: 47808, protocol: 'bacnet', type: 'building' },
];

const CONNECT_TIMEOUT_MS = 1500;

/**
 * Probe a single host:port with a TCP connect.
 * @returns {Promise<boolean>} true if port is open
 */
function probePort(host, port, timeoutMs = CONNECT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;

    const finish = (open) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(open);
    };

    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

/**
 * Expand a CIDR-like range into individual IPs.
 * Supports: "192.168.1.0/24", "10.0.0.1-10.0.0.10", or a single IP.
 */
function expandRange(range) {
  const cidrMatch = range.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
  if (cidrMatch) {
    const baseIp = cidrMatch[1];
    const prefix = parseInt(cidrMatch[2], 10);
    if (prefix < 16 || prefix > 30) return [baseIp]; // safety: no huge scans

    const base = ipToNum(baseIp);
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    const network = (base & mask) >>> 0;
    const broadcast = (network | ~mask) >>> 0;
    const ips = [];
    for (let n = network + 1; n < broadcast && ips.length < 1024; n++) {
      ips.push(numToIp(n));
    }
    return ips;
  }

  const rangeMatch = range.match(/^(\d+\.\d+\.\d+\.)(\d+)-\1(\d+)$/);
  if (rangeMatch) {
    const prefix = rangeMatch[1];
    const start = parseInt(rangeMatch[2], 10);
    const end = Math.min(parseInt(rangeMatch[3], 10), start + 255);
    const ips = [];
    for (let i = start; i <= end; i++) ips.push(`${prefix}${i}`);
    return ips;
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(range)) return [range];
  return [];
}

function ipToNum(ip) {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function numToIp(num) {
  return [(num >>> 24) & 0xff, (num >>> 16) & 0xff, (num >>> 8) & 0xff, num & 0xff].join('.');
}

/**
 * Get the local network's subnet (first non-internal IPv4 interface).
 * Returns e.g. "192.168.1.0/24"
 */
function getLocalSubnet() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const ip = iface.address;
        const parts = ip.split('.');
        return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
      }
    }
  }
  return '192.168.1.0/24';
}

/**
 * Discover sensors in a network range.
 * @param {string} range — CIDR, range, or single IP
 * @param {Function} onProgress — (progress) => void (0-1)
 * @returns {Promise<Array>} discovered sensor candidates
 */
async function discoverSensors(range, onProgress) {
  const ips = expandRange(range || getLocalSubnet());
  const total = ips.length * PROBE_PORTS.length;
  let completed = 0;
  const results = [];

  // Process IPs in batches to avoid overwhelming the network
  const BATCH_SIZE = 16;
  for (let i = 0; i < ips.length; i += BATCH_SIZE) {
    const batch = ips.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.flatMap((ip) =>
      PROBE_PORTS.map(async (probe) => {
        const open = await probePort(ip, probe.port);
        completed++;
        if (onProgress) onProgress(completed / total);
        if (open) {
          results.push({
            host: ip,
            port: probe.port,
            protocol: probe.protocol,
            type: probe.type,
            name: `${probe.protocol.toUpperCase()} Sensor @ ${ip}:${probe.port}`,
          });
        }
      })
    );
    await Promise.all(batchPromises);
  }

  return results;
}

module.exports = { discoverSensors, probePort, expandRange, getLocalSubnet, PROBE_PORTS };
