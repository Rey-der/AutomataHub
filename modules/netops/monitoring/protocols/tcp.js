/**
 * TCP Protocol Check — connect to a host on specified port(s).
 * Extracted from the original HostMonitor.ping() logic.
 */

const net = require('net');

const DEFAULT_TIMEOUT = 5000;

/**
 * @param {object} host  - { hostname, port }
 * @param {object} opts  - { timeout }
 * @returns {{ online: boolean, latency_ms: number|null, detail: object }}
 */
async function check(host, opts = {}) {
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  const hostname = host.hostname;
  const ports = host.port ? [host.port] : [80, 443];
  const start = Date.now();

  return new Promise((resolve) => {
    let idx = 0;

    function tryNext() {
      if (idx >= ports.length) {
        return resolve({
          online: false,
          latency_ms: null,
          detail: { port: ports[ports.length - 1], error: 'All ports unreachable' },
        });
      }

      const port = ports[idx++];
      const socket = net.createConnection({ host: hostname, port, timeout });
      let done = false;

      const advance = () => {
        if (done) return;
        done = true;
        socket.destroy();
        tryNext();
      };

      const timer = setTimeout(advance, timeout);

      socket.on('connect', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.destroy();
        resolve({
          online: true,
          latency_ms: Date.now() - start,
          detail: { port },
        });
      });

      socket.on('error', () => {
        clearTimeout(timer);
        advance();
      });

      socket.on('timeout', () => {
        clearTimeout(timer);
        advance();
      });
    }

    tryNext();
  });
}

module.exports = { check };
