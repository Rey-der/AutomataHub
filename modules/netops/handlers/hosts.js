/**
 * NetOps Handlers — Host management, ping, port check, history, detail.
 */

function register(ipcBridge, { store, monitor, emit, pingAndUpdate, collectAndStoreMetrics }) {

  ipcBridge.handle('netops:add-host', async (_e, args) => {
    const { hostname, ip, port, protocol, alias, url, expected_status, keyword, expected_ip, record_type } = args || {};
    if (!hostname) throw new Error('Missing hostname');

    const id = store.generateId();
    store.addHost({
      id, hostname, ip: ip || null, port: port || 0,
      protocol: protocol || 'ping', alias: alias || null,
      enabled: 1, last_status: 'unknown', last_check: null,
      url: url || null,
      expected_status: expected_status || null,
      keyword: keyword || null,
      expected_ip: expected_ip || null,
      record_type: record_type || 'A',
    });

    const hostObj = store.getHost(id);
    try {
      await pingAndUpdate(id, hostname, hostObj);
    } catch { /* ignore initial ping failure */ }

    collectAndStoreMetrics(id, hostname);

    console.log('[netops] Added host:', hostname);
    return { success: true, host_id: id };
  });

  ipcBridge.handle('netops:remove-host', async (_e, args) => {
    const { host_id } = args || {};
    if (!host_id) throw new Error('Missing host_id');
    store.removeHost(host_id);
    console.log('[netops] Removed host:', host_id);
    return { success: true };
  });

  ipcBridge.handle('netops:get-monitored-hosts', async (_e, args) => {
    const { enabled_only } = args || {};
    return { hosts: store.getAllHosts(enabled_only) };
  });

  ipcBridge.handle('netops:ping-host', async (_e, args) => {
    const { hostname, host_id } = args || {};
    if (!hostname) throw new Error('Missing hostname');

    const hostObj = host_id ? store.getHost(host_id) : null;
    await pingAndUpdate(host_id, hostname, hostObj);
    const result = store.getStatus(host_id) || {};
    return { success: result.status === 'online', latency: result.latency_ms, online: result.status === 'online', latency_ms: result.latency_ms, protocol: result.protocol };
  });

  ipcBridge.handle('netops:check-port', async (_e, args) => {
    const { hostname, port } = args || {};
    if (!hostname || !port) throw new Error('Missing hostname or port');
    return { open: await monitor.checkPort(hostname, port) };
  });

  ipcBridge.handle('netops:get-status-history', async (_e, args) => {
    const { host_id, limit = 100 } = args || {};
    if (!host_id) throw new Error('Missing host_id');
    return { history: store.getHistory(host_id, limit) };
  });

  ipcBridge.handle('netops:get-host-detail', async (_e, args) => {
    const { host_id } = args || {};
    if (!host_id) throw new Error('Missing host_id');
    const host = store.getHost(host_id);
    if (!host) return { error: 'Host not found' };
    return { host, recent_status: store.getHistory(host_id, 10) };
  });

  ipcBridge.handle('netops:update-host-config', async (_e, args) => {
    const { host_id, ...updates } = args || {};
    if (!host_id) throw new Error('Missing host_id');
    const host = store.updateHost(host_id, updates);
    return host ? { success: true } : { success: false, error: 'Host not found' };
  });
}

module.exports = { register };
