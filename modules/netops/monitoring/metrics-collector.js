/**
 * NetOps Metrics Collector — collects network, system, and buffer metrics.
 * 
 * This module provides simulated metrics collection (Phase 1).
 * Future phases can integrate with:
 * - SNMP (Simple Network Management Protocol) for device metrics
 * - SSH/WMI for system metrics
 * - Custom agents on monitored hosts
 */

const { randomInt } = require('node:crypto');

/**
 * Create a metrics collector instance.
 */
function createMetricsCollector() {
  return {
    /**
     * Simulate network metrics collection.
     * In Phase 2+, this would collect from SNMP or netflow data.
     */
    collectNetworkMetrics: function(hostname) {
      // Simulated data - will be replaced with real SNMP/netflow in Phase 2+
      const traffic_in = randomInt(10001) / 100; // MB/s, 0-100
      const traffic_out = randomInt(8001) / 100;
      const packets_in = randomInt(10000);
      const packets_out = randomInt(8000);

      return {
        hostname,
        traffic_in_mb: Number.parseFloat(traffic_in.toFixed(2)),
        traffic_out_mb: Number.parseFloat(traffic_out.toFixed(2)),
        packets_in,
        packets_out,
        timestamp: new Date().toISOString()
      };
    },

    /**
     * Simulate system metrics collection.
     * In Phase 2+, this would collect via SNMP, SSH, or Windows WMI.
     */
    collectSystemMetrics: function(hostname) {
      // Simulated data - will be replaced with real system queries in Phase 2+
      const cpu = randomInt(10001) / 100;
      const memory = randomInt(10001) / 100;
      const memoryUsed = Math.floor(memory * 32 / 100); // Assuming 32GB total
      
      return {
        hostname,
        cpu_percent: Number.parseFloat(cpu.toFixed(2)),
        memory_percent: Number.parseFloat(memory.toFixed(2)),
        memory_used_mb: memoryUsed,
        memory_total_mb: 32000,
        timestamp: new Date().toISOString()
      };
    },

    /**
     * Simulate buffer metrics collection.
     * In Phase 2+, this would collect from /proc/meminfo, Windows perf counters, or SNMP.
     */
    collectBufferMetrics: function(hostname) {
      // Simulated data - will be replaced with real buffer stats in Phase 2+
      const hits = randomInt(1000000);
      const misses = randomInt(100000);
      const total = hits + misses;
      const hitRate = total > 0 ? (hits / total * 100) : 0;

      // Simulate miss distribution
      const smallMiss = randomInt(1001) / 100;
      const mediumMiss = randomInt(5001) / 100;
      const largeMiss = randomInt(10001) / 100;

      return {
        hostname,
        buffer_hits: hits,
        buffer_misses: misses,
        hit_rate: Number.parseFloat(hitRate.toFixed(2)),
        small_miss_mb: Number.parseFloat(smallMiss.toFixed(2)),
        medium_miss_mb: Number.parseFloat(mediumMiss.toFixed(2)),
        large_miss_mb: Number.parseFloat(largeMiss.toFixed(2)),
        timestamp: new Date().toISOString()
      };
    },

    /**
     * Collect all metrics for a host.
     */
    collectAllMetrics: function(hostname) {
      return {
        network: this.collectNetworkMetrics(hostname),
        system: this.collectSystemMetrics(hostname),
        buffer: this.collectBufferMetrics(hostname),
        collectTime: Date.now()
      };
    }
  };
}

module.exports = { createMetricsCollector };
