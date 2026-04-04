/**
 * NetOps Metrics Collector — collects real system metrics from the local machine.
 * Uses Node.js `os` module for CPU and memory data.
 * Metrics are only meaningful for the host running AutomataHub.
 */

const os = require('node:os');

/** Previous CPU sample for delta-based usage calculation. */
let _prevCpuTimes = null;

/**
 * Read aggregate CPU times across all cores.
 */
function _readCpuTimes() {
  const cpus = os.cpus();
  const totals = { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
  for (const cpu of cpus) {
    totals.user += cpu.times.user;
    totals.nice += cpu.times.nice;
    totals.sys  += cpu.times.sys;
    totals.idle += cpu.times.idle;
    totals.irq  += cpu.times.irq;
  }
  return totals;
}

/**
 * Calculate CPU usage percentage from two samples.
 * Returns 0 on the first call (no previous sample yet).
 */
function _cpuPercent() {
  const current = _readCpuTimes();
  if (!_prevCpuTimes) {
    _prevCpuTimes = current;
    return 0;
  }

  const dUser = current.user - _prevCpuTimes.user;
  const dNice = current.nice - _prevCpuTimes.nice;
  const dSys  = current.sys  - _prevCpuTimes.sys;
  const dIdle = current.idle - _prevCpuTimes.idle;
  const dIrq  = current.irq  - _prevCpuTimes.irq;

  const total = dUser + dNice + dSys + dIdle + dIrq;
  _prevCpuTimes = current;

  if (total === 0) return 0;
  return Number.parseFloat((((total - dIdle) / total) * 100).toFixed(2));
}

/**
 * Create a metrics collector that reads real OS data.
 */
function createMetricsCollector() {
  return {
    /**
     * Collect real CPU and memory metrics from the local machine.
     */
    collectSystemMetrics: function(_hostname) {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memPercent = (usedMem / totalMem) * 100;

      return {
        hostname: os.hostname(),
        cpu_percent: _cpuPercent(),
        memory_percent: Number.parseFloat(memPercent.toFixed(2)),
        memory_used_mb: Math.round(usedMem / (1024 * 1024)),
        memory_total_mb: Math.round(totalMem / (1024 * 1024)),
        timestamp: new Date().toISOString(),
      };
    },

    /**
     * Collect all available metrics for a host.
     * Only system metrics (CPU + memory) are collected from real OS APIs.
     */
    collectAllMetrics: function(hostname) {
      return {
        system: this.collectSystemMetrics(hostname),
        collectTime: Date.now(),
      };
    },
  };
}

module.exports = { createMetricsCollector };
