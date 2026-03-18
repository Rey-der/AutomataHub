/**
 * DiscoveredNetworksPanel — self-contained UI component for discovered networks.
 * Manages its own state, rendering, and event listeners.
 * Communicates with the parent dashboard via callbacks.
 */

(function() {
const API = globalThis.api;
globalThis.API = API;

class DiscoveredNetworksPanel {
  /**
   * @param {object} callbacks
   * @param {Function} callbacks.getHosts      — returns current monitored hosts array
   * @param {Function} callbacks.reloadHosts   — reloads monitored hosts (async)
   * @param {Function} callbacks.expandDetail  — opens detail/metrics view for a host
   * @param {Function} callbacks.showToast     — show notification
   * @param {Function} callbacks.showError     — show error notification
   */
  constructor(callbacks) {
    this.discoveredNetworks = [];
    this.expandedNetworkIds = new Set();
    this.cb = callbacks || {};
  }

  /**
   * Load data from backend and render into container.
   */
  async init(container) {
    this.container = container;
    await this.load();
  }

  /**
   * Fetch discovered networks from the backend and re-render.
   */
  async load() {
    try {
      const result = await API.invoke('netops:get-discovered-networks', {});
      this.discoveredNetworks = result.networks || [];
    } catch (err) {
      console.error('[net-discovered] Failed to load:', err);
    }
    this.render();
  }

  /**
   * Render the panel into the given container (or current container).
   */
  render(container) {
    if (container) this.container = container;
    if (!this.container) return;

    if (this.discoveredNetworks.length === 0) {
      this.container.innerHTML = '';
      this.container.style.display = 'none';
      return;
    }

    this.container.style.display = '';
    this.container.innerHTML = `
      <h3>Discovered Networks (${this.discoveredNetworks.length})</h3>
      <div class="discovered-networks-list">
        ${this.discoveredNetworks.map(net => `
          <div class="discovered-network-item">
            <div class="network-header">
              <div class="network-info">
                <strong>${_escDisc(net.name)}</strong>
                <span class="network-cidr">${_escDisc(net.cidr)}</span>
                <span class="network-stats">${net.online_count}/${net.host_count} online</span>
              </div>
              <div class="network-actions">
                <button class="btn btn-small rescan-network-btn" data-network-id="${net.id}" data-cidr="${net.cidr}">Rescan</button>
                <button class="btn btn-small expand-network-btn" data-network-id="${net.id}">Hosts</button>
                <button class="btn btn-small btn-danger remove-network-btn" data-network-id="${net.id}">Remove</button>
              </div>
            </div>
            <div class="network-hosts" id="network-hosts-${net.id}"
                 style="display: ${this.expandedNetworkIds.has(net.id) ? 'block' : 'none'}; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border);">
              <div class="hosts-loading">Loading hosts...</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    this._setupListeners();

    // Restore expanded networks
    for (const id of this.expandedNetworkIds) {
      const el = document.getElementById(`network-hosts-${id}`);
      if (el) this._loadHosts(id, el);
    }
  }

  // --- Event listeners ---

  _setupListeners() {
    // Expand / collapse hosts
    this.container.querySelectorAll('.expand-network-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const nid = Number(btn.dataset.networkId);
        const el = document.getElementById(`network-hosts-${nid}`);
        if (!el) return;

        if (this.expandedNetworkIds.has(nid)) {
          this.expandedNetworkIds.delete(nid);
          el.style.display = 'none';
        } else {
          this.expandedNetworkIds.add(nid);
          el.style.display = 'block';
          await this._loadHosts(nid, el);
        }
      });
    });

    // Remove network
    this.container.querySelectorAll('.remove-network-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const nid = Number(btn.dataset.networkId);
        const net = this.discoveredNetworks.find(n => n.id === nid);
        if (!net || !confirm(`Remove discovered network ${net.cidr}?`)) return;

        try {
          await API.invoke('netops:remove-discovered-network', { network_id: nid });
          this.discoveredNetworks = this.discoveredNetworks.filter(n => n.id !== nid);
          this.expandedNetworkIds.delete(nid);
          this.render();
          this._toast(`Network ${net.cidr} removed`);
        } catch (err) {
          this._error('Failed to remove network: ' + err.message);
        }
      });
    });

    // Rescan network
    this.container.querySelectorAll('.rescan-network-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cidr = btn.dataset.cidr;
        btn.disabled = true;
        btn.textContent = 'Scanning...';
        try {
          const result = await API.invoke('netops:scan-network', { cidr });
          if (result.success) {
            await this.load();
            this._toast(`Rescan of ${cidr} complete: ${result.discovered_count || 0} online`);
          } else {
            this._error('Rescan failed: ' + (result.error || 'Unknown'));
          }
        } catch (err) {
          this._error('Rescan error: ' + err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = 'Rescan';
        }
      });
    });
  }

  // --- Discovered hosts for a network ---

  async _loadHosts(networkId, container) {
    try {
      const result = await API.invoke('netops:get-discovered-hosts', { network_id: networkId });
      const hosts = result.hosts || [];

      container.innerHTML = `
        <div class="discovered-hosts-table">
          ${hosts.map(h => `
            <div class="discovered-host-row">
              <div class="host-info">
                <span class="host-ip">${_escDisc(h.ip)}</span>
                <span class="host-status status-${h.status}">${h.status.toUpperCase()}</span>
                ${h.latency_ms == null ? '' : `<span class="host-latency">${h.latency_ms}ms</span>`}
              </div>
              <div class="discovered-host-actions">
                <button class="btn btn-small btn-ping-disc" data-ip="${h.ip}" data-id="${h.id}">Ping</button>
                <button class="btn btn-small btn-detail-disc" data-ip="${h.ip}" data-id="${h.id}">Details</button>
                <button class="btn btn-small btn-add-disc" data-id="${h.id}" data-network-id="${networkId}" data-ip="${h.ip}">Add</button>
              </div>
            </div>
          `).join('')}
        </div>
      `;

      // Ping buttons
      container.querySelectorAll('.btn-ping-disc').forEach(btn => {
        btn.addEventListener('click', () => this._pingHost(btn.dataset.ip, btn));
      });

      // Detail buttons — auto-add to monitored + open metrics
      container.querySelectorAll('.btn-detail-disc').forEach(btn => {
        btn.addEventListener('click', () => this._openDetail(btn.dataset.ip, Number(btn.dataset.id), btn));
      });

      // Add buttons
      container.querySelectorAll('.btn-add-disc').forEach(btn => {
        btn.addEventListener('click', () =>
          this._addHost(Number(btn.dataset.id), Number(btn.dataset.networkId), btn.dataset.ip, btn)
        );
      });
    } catch (err) {
      container.innerHTML = `<div style="color: var(--error);">Failed to load hosts: ${err.message}</div>`;
    }
  }

  // --- Host actions ---

  async _pingHost(ip, btn) {
    btn.disabled = true;
    btn.textContent = 'Pinging...';
    try {
      const result = await API.invoke('netops:ping-host', { hostname: ip });
      const status = result.success ? 'online' : 'offline';
      const latency = result.latency || null;

      // Update row in-place
      const row = btn.closest('.discovered-host-row');
      if (row) {
        const statusEl = row.querySelector('.host-status');
        if (statusEl) {
          statusEl.className = `host-status status-${status}`;
          statusEl.textContent = status.toUpperCase();
        }
        const latencyEl = row.querySelector('.host-latency');
        if (latencyEl) {
          latencyEl.textContent = latency ? `${latency}ms` : '';
        } else if (latency) {
          const info = row.querySelector('.host-info');
          if (info) {
            const span = document.createElement('span');
            span.className = 'host-latency';
            span.textContent = `${latency}ms`;
            info.appendChild(span);
          }
        }
      }

      const latStr = latency ? ` (${latency}ms)` : '';
      this._toast(`${ip} is ${status}${latStr}`);
    } catch (err) {
      this._error('Ping failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Ping';
    }
  }

  async _openDetail(ip, hostId, btn) {
    const hosts = this.cb.getHosts ? this.cb.getHosts() : [];
    let monitored = hosts.find(h => h.ip === ip || h.hostname === ip);

    if (!monitored) {
      btn.textContent = 'Loading...';
      btn.disabled = true;
      try {
        const result = await API.invoke('netops:add-discovered-host', { host_id: hostId, ip });
        if (result.success && this.cb.reloadHosts) {
          await this.cb.reloadHosts();
          const updated = this.cb.getHosts ? this.cb.getHosts() : [];
          monitored = updated.find(h => h.ip === ip || h.hostname === ip);
        }
      } catch (err) {
        this._error('Failed to add host: ' + err.message);
        btn.textContent = 'Details';
        btn.disabled = false;
        return;
      }
      btn.textContent = 'Details';
      btn.disabled = false;
    }

    if (monitored && this.cb.expandDetail) {
      this.cb.expandDetail(monitored);
    } else {
      this._toast(`Could not open details for ${ip}`);
    }
  }

  async _addHost(hostId, networkId, ip, btn) {
    btn.disabled = true;
    btn.textContent = 'Adding...';
    try {
      const result = await API.invoke('netops:add-discovered-host', {
        host_id: hostId,
        network_id: networkId,
        ip,
      });
      if (result.success) {
        btn.textContent = '\u2713 Added';
        if (this.cb.reloadHosts) await this.cb.reloadHosts();
        this._toast(`${ip} added to monitored hosts`);
      } else {
        this._error('Failed to add: ' + (result.error || 'Unknown'));
        btn.textContent = 'Add';
        btn.disabled = false;
      }
    } catch (err) {
      this._error('Error: ' + err.message);
      btn.textContent = 'Add';
      btn.disabled = false;
    }
  }

  // --- Helpers ---

  destroy() {
    this.container = null;
  }

  _toast(msg, type) {
    if (this.cb.showToast) this.cb.showToast(msg, type);
  }

  _error(msg) {
    if (this.cb.showError) this.cb.showError(msg);
  }
}

/** Simple HTML escape (panel-local to avoid load-order issues). */
function _escDisc(text) {
  const el = document.createElement('span');
  el.textContent = text || '';
  return el.innerHTML;
}

globalThis.DiscoveredNetworksPanel = DiscoveredNetworksPanel;

})();
