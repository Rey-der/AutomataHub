/**
 * NetOps Handlers — Network scanning, discovery, discovered host management.
 */

function register(ipcBridge, { store, scanner, emit, send }) {

  ipcBridge.handle('netops:scan-network', async (_e, args) => {
    const { cidr, port, name } = args || {};
    if (!cidr) throw new Error('Missing CIDR range');
    return scanner.scan(cidr, port, name, send);
  });

  ipcBridge.handle('netops:get-discovered-networks', async () => {
    return { success: true, networks: store.getDiscoveredNetworks() };
  });

  ipcBridge.handle('netops:get-discovered-hosts', async (_e, args) => {
    const { network_id } = args || {};
    if (!network_id) return { success: false, error: 'Missing network_id', hosts: [] };
    return { success: true, hosts: store.getDiscoveredHosts(network_id) };
  });

  ipcBridge.handle('netops:remove-discovered-network', async (_e, args) => {
    const { network_id } = args || {};
    if (!network_id) return { success: false, error: 'Missing network_id' };
    const result = store.removeDiscoveredNetwork(network_id);
    if (!result) return { success: false, error: 'Network not found' };
    console.log(`[netops] Removed network ${result.network.cidr} (${result.hostCount} hosts)`);
    return { success: true, removed_network: result.network.cidr, removed_hosts: result.hostCount };
  });

  ipcBridge.handle('netops:add-discovered-host', async (_e, args) => {
    const { host_id, hostname, ip } = args || {};
    if (!host_id) return { success: false, error: 'Missing host_id' };

    const discovered = store.findDiscoveredHost(h => h.id === host_id);
    if (!discovered) return { success: false, error: 'Discovered host not found' };

    const mid = store.generateId();
    store.addHost({
      id: mid, hostname: hostname || discovered.hostname || discovered.ip,
      ip: discovered.ip, port: 0, protocol: 'ping', alias: null,
      enabled: 1, last_status: discovered.status, last_check: discovered.discovered_at,
    });

    emit('netops:status-update', {
      host_id: mid, status: discovered.status,
      latency_ms: discovered.latency_ms, timestamp: new Date().toISOString(),
    });

    console.log(`[netops] Added discovered host ${discovered.ip} to monitored`);
    return { success: true, host_id: mid };
  });
}

module.exports = { register };
