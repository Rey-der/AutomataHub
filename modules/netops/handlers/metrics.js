/**
 * NetOps Handlers — Metrics queries, aggregates, events, heartbeat, uptime.
 */

const TIME_RANGE_MS = {
  '1h': 3_600_000,
  '6h': 21_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
};

function getTimeRangeCutoff(timeRange) {
  return new Date(Date.now() - (TIME_RANGE_MS[timeRange] || TIME_RANGE_MS['24h']));
}

function register(ipcBridge, { store }) {

  ipcBridge.handle('netops:get-network-metrics', async (_e, args) => {
    const { host_id, timeRange = '24h', limit = 288 } = args || {};
    if (!host_id) return { error: 'Missing host_id', metrics: [] };
    return { success: true, metrics: store.getMetrics('network', host_id, getTimeRangeCutoff(timeRange), limit) };
  });

  ipcBridge.handle('netops:get-system-metrics', async (_e, args) => {
    const { host_id, timeRange = '24h', limit = 288 } = args || {};
    if (!host_id) return { error: 'Missing host_id', metrics: [] };
    return { success: true, metrics: store.getMetrics('system', host_id, getTimeRangeCutoff(timeRange), limit) };
  });

  ipcBridge.handle('netops:get-buffer-metrics', async (_e, args) => {
    const { host_id, timeRange = '24h', limit = 288 } = args || {};
    if (!host_id) return { error: 'Missing host_id', metrics: [] };
    return { success: true, metrics: store.getMetrics('buffer', host_id, getTimeRangeCutoff(timeRange), limit) };
  });

  ipcBridge.handle('netops:get-aggregate-metrics', async (_e, args) => {
    const { host_id, timeRange = '24h' } = args || {};
    if (!host_id) return { error: 'Missing host_id' };
    return { success: true, ...store.getAggregateMetrics(host_id, getTimeRangeCutoff(timeRange)) };
  });

  ipcBridge.handle('netops:get-recent-events', async (_e, args) => {
    const { limit = 10 } = args || {};
    return { success: true, events: store.getRecentEvents(limit) };
  });

  ipcBridge.handle('netops:get-uptime-stats', async (_e, args) => {
    const { host_id, timeRange = '24h' } = args || {};
    if (!host_id) return { error: 'Missing host_id' };
    return { success: true, ...store.getUptimeStats(host_id, getTimeRangeCutoff(timeRange)) };
  });

  ipcBridge.handle('netops:get-heartbeat', async (_e, args) => {
    const { host_id, count = 30 } = args || {};
    if (!host_id) return { error: 'Missing host_id', beats: [] };
    return { success: true, beats: store.getHeartbeat(host_id, count) };
  });
}

module.exports = { register };
