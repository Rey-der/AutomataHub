/**
 * NetOps Dashboard — host grid, scanner, and detail view orchestration.
 * Discovered networks are handled by DiscoveredNetworksPanel (net-discovered.js).
 */

if (typeof API === 'undefined') {
  var API = window.api;
}

class NetDashboard {
  constructor() {
    this.hosts = [];
    this.statusMap = new Map();
    this.unsubscribe = null;
    this.autoRefreshInterval = null;
    this.expandedHostId = null;
    this.metricsInstance = null;
    this.discoveredPanel = null;
  }

  async init(el) {
    this.container = el;
    this.render();
    await this.loadHosts();

    // Initialize discovered networks panel
    this.discoveredPanel = new DiscoveredNetworksPanel({
      getHosts: () => this.hosts,
      reloadHosts: () => this._silentLoadHosts(),
      expandDetail: (host) => this.expandDetailSection(host),
      showToast: (msg, type) => this.showToast(msg, type),
      showError: (msg) => this.showError(msg),
    });
    const panelEl = this.container.querySelector('#discovered-networks-container');
    if (panelEl) await this.discoveredPanel.init(panelEl);

    this.setupRealtimeUpdates();
    this.startAutoRefresh();
  }

  // =====================================================================
  //  Data Loading
  // =====================================================================

  async loadHosts() {
    try {
      const result = await API.invoke('netops:get-monitored-hosts', { enabled_only: false });
      this.hosts = result.hosts || [];
      this.render();
      this._refreshPanel();
    } catch (err) {
      console.error('[net-dashboard] Failed to load hosts:', err);
      this.showError('Failed to load hosts: ' + err.message);
    }
  }

  /** Reload hosts without full re-render (used by discovered panel callbacks). */
  async _silentLoadHosts() {
    try {
      const result = await API.invoke('netops:get-monitored-hosts', { enabled_only: false });
      this.hosts = result.hosts || [];
    } catch (err) {
      console.error('[net-dashboard] Failed to reload hosts:', err);
    }
  }

  // =====================================================================
  //  Real-time Updates
  // =====================================================================

  setupRealtimeUpdates() {
    this.unsubscribe = API.on('netops:status-update', (data) => {
      const { host_id, status, latency_ms, timestamp } = data;
      this.statusMap.set(host_id, { status, latency_ms, timestamp });
      this.updateHostCard(host_id);
      this.updateStatusSummary();

      const card = document.querySelector(`[data-host-id="${host_id}"]`);
      if (card) {
        card.classList.add('status-changed');
        setTimeout(() => card.classList.remove('status-changed'), 1000);
      }
    });

    API.on('netops:status-change', (data) => {
      this.showStatusChangeNotification(data.hostname, data.old_status, data.new_status);
      this.updateHostCard(data.host_id);
    });
  }

  startAutoRefresh() {
    this.autoRefreshInterval = setInterval(() => this.loadHosts(), 30000);
  }

  // =====================================================================
  //  Rendering
  // =====================================================================

  render() {
    const counts = this.getStatusCounts();
    this.container.innerHTML = `
      <div class="net-dashboard">
        <div class="dashboard-header">
          <h2>Network Monitor</h2>
          <div class="status-summary">
            <span class="status-dot online"></span> ${counts.online} Online
            <span class="status-dot offline"></span> ${counts.offline} Offline
            <span class="status-dot unknown"></span> ${counts.unknown} Unknown
          </div>
        </div>

        <div class="scanner-panel">
          <h3>Quick Network Scan</h3>
          <div class="scanner-inputs">
            <input type="text" id="scanner-cidr" placeholder="CIDR range (e.g., 127.0.0.0/30, 192.168.1.0/24)" class="scanner-input" />
            <input type="number" id="scanner-port" placeholder="Port (optional)" class="scanner-port-input" min="1" max="65535" />
            <button id="scanner-btn" class="btn btn-scan">Scan Network</button>
          </div>
          <div id="scanner-progress" class="scanner-progress" style="display: none;">
            <div class="progress-bar"></div>
            <span id="progress-text">0%</span>
          </div>
        </div>

        <div id="discovered-networks-container" class="discovered-networks-panel"></div>

        <div class="host-grid">
          ${this.hosts.length === 0 ? this.renderNoHosts() : this.hosts.map(h => this.renderHostCard(h)).join('')}
        </div>

        <div id="host-detail-section" style="display: none; margin-top: 20px; padding: 20px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; max-height: 80vh; overflow-y: auto;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; position: sticky; top: 0; background: var(--surface); z-index: 10;">
            <h3 id="detail-host-name" style="margin: 0;">Host Details</h3>
            <button id="close-detail-btn" class="btn btn-small" style="padding: 6px 12px;">Close</button>
          </div>
          <div id="detail-metrics-container" style="min-height: 400px;"></div>
        </div>
      </div>
    `;

    this.setupEventListeners();
  }

  getStatusCounts() {
    const c = { online: 0, offline: 0, unknown: 0 };
    this.hosts.forEach(h => {
      const s = this.statusMap.get(h.id)?.status || h.last_status || 'unknown';
      if (s in c) c[s]++;
    });
    return c;
  }

  renderHostCard(host) {
    const cached = this.statusMap.get(host.id);
    const status = cached?.status || host.last_status || 'unknown';
    const latency = cached?.latency_ms;
    const lastCheck = host.last_check || 'Never';
    const latencyDisplay = latency != null
      ? (latency < 1000 ? `${latency}ms` : `${(latency / 1000).toFixed(1)}s`)
      : '\u2014';

    return `
      <div class="host-card status-${status}" data-host-id="${host.id}">
        <div class="card-header">
          <div>
            <h3 class="host-name">${escapeHtml(host.alias || host.hostname)}</h3>
            <p class="host-detail">${escapeHtml(host.hostname)}</p>
          </div>
          <div class="status-badge status-${status}">${status}</div>
        </div>
        <div class="card-metrics">
          <div class="metric"><span class="metric-label">Latency:</span><span class="metric-value">${latencyDisplay}</span></div>
          <div class="metric"><span class="metric-label">Last Check:</span><span class="metric-value">${lastCheck}</span></div>
          ${host.port ? `<div class="metric"><span class="metric-label">Port:</span><span class="metric-value">${host.port}</span></div>` : ''}
        </div>
        <div class="card-actions">
          <button class="btn btn-sm btn-ping" data-host-id="${host.id}">Ping Now</button>
          <button class="btn btn-sm btn-detail" data-host-id="${host.id}">Details</button>
          <button class="btn btn-sm btn-remove" data-host-id="${host.id}">Remove</button>
        </div>
      </div>
    `;
  }

  renderNoHosts() {
    return `
      <div class="empty-state">
        <p>No monitored hosts yet.</p>
        <p style="color: var(--text-secondary); font-size: 13px;">Use the Network Scan panel above to discover and add hosts.</p>
      </div>
    `;
  }

  // =====================================================================
  //  In-place Card Updates
  // =====================================================================

  updateStatusSummary() {
    const el = this.container.querySelector('.status-summary');
    if (!el) return;
    const c = this.getStatusCounts();
    el.innerHTML = `
      <span class="status-dot online"></span> ${c.online} Online
      <span class="status-dot offline"></span> ${c.offline} Offline
      <span class="status-dot unknown"></span> ${c.unknown} Unknown
    `;
  }

  updateHostCard(hostId) {
    const host = this.hosts.find(h => h.id === hostId);
    if (!host) return;
    const card = document.querySelector(`[data-host-id="${hostId}"]`);
    if (!card) return;

    const cached = this.statusMap.get(hostId);
    const status = cached?.status || host.last_status || 'unknown';
    const latency = cached?.latency_ms;

    const badge = card.querySelector('.status-badge');
    if (badge) { badge.className = `status-badge status-${status}`; badge.textContent = status; }

    card.className = `host-card status-${status}`;
    card.setAttribute('data-host-id', hostId);

    const metricVal = card.querySelector('.metric-value');
    if (metricVal) {
      metricVal.textContent = latency != null
        ? (latency < 1000 ? `${latency}ms` : `${(latency / 1000).toFixed(1)}s`)
        : '\u2014';
    }
  }

  // =====================================================================
  //  Scanner
  // =====================================================================

  async performScan() {
    const cidrInput = this.container.querySelector('#scanner-cidr');
    const portInput = this.container.querySelector('#scanner-port');
    const scanBtn = this.container.querySelector('#scanner-btn');

    const cidr = cidrInput.value.trim();
    const port = portInput.value ? parseInt(portInput.value) : null;
    if (!cidr) { this.showError('Please enter a CIDR range'); return; }

    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';

    try {
      const result = await API.invoke('netops:scan-network', { cidr, port });
      if (result.success && result.results) {
        const count = result.discovered_count || result.results.filter(r => r.status === 'online').length;
        this.showToast(`Scan complete: ${count} online discovered.`);
        if (this.discoveredPanel) await this.discoveredPanel.load();
        cidrInput.value = '';
        portInput.value = '';
      } else {
        this.showError('Scan failed: ' + (result.error || 'Unknown error'));
      }
    } catch (err) {
      this.showError('Scan error: ' + err.message);
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan Network';
    }
  }

  // =====================================================================
  //  Event Listeners
  // =====================================================================

  setupEventListeners() {
    const closeBtn = this.container.querySelector('#close-detail-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeDetailSection());

    const scanBtn = this.container.querySelector('#scanner-btn');
    if (scanBtn) scanBtn.addEventListener('click', () => this.performScan());

    const cidrInput = this.container.querySelector('#scanner-cidr');
    if (cidrInput) cidrInput.addEventListener('keypress', e => { if (e.key === 'Enter') this.performScan(); });

    // Monitored host — Ping
    this.container.querySelectorAll('.btn-ping').forEach(btn => {
      btn.addEventListener('click', async () => {
        const hostId = parseFloat(btn.dataset.hostId);
        const host = this.hosts.find(h => h.id == hostId);
        if (!host) return;

        btn.disabled = true;
        btn.textContent = 'Pinging...';
        try {
          const result = await API.invoke('netops:ping-host', { hostname: host.hostname, host_id: hostId });
          const status = result.success ? 'online' : 'offline';
          this.statusMap.set(hostId, { status, latency_ms: result.latency || null, timestamp: new Date().toISOString() });
          this.updateHostCard(hostId);
          this.updateStatusSummary();
          this.showToast(`${host.hostname} is ${status}${result.latency ? ` (${result.latency}ms)` : ''}`);
        } catch (err) {
          this.showError('Ping failed: ' + err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = 'Ping Now';
        }
      });
    });

    // Monitored host — Details
    this.container.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', () => {
        const hostId = parseFloat(btn.dataset.hostId);
        const host = this.hosts.find(h => h.id == hostId);
        if (host) this.expandDetailSection(host);
      });
    });

    // Monitored host — Remove
    this.container.querySelectorAll('.btn-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const hostId = parseFloat(btn.dataset.hostId);
        const host = this.hosts.find(h => h.id == hostId);
        if (!host || !confirm(`Remove ${host.hostname}?`)) return;

        try {
          await API.invoke('netops:remove-host', { host_id: hostId });
          this.hosts = this.hosts.filter(h => h.id !== hostId);
          this.statusMap.delete(hostId);
          this.render();
          this._refreshPanel();
          this.showToast(`${host.hostname} removed`);
        } catch (err) {
          this.showError('Failed to remove: ' + err.message);
        }
      });
    });
  }

  // =====================================================================
  //  Detail Section
  // =====================================================================

  expandDetailSection(host) {
    this.expandedHostId = host.id;
    const section = this.container.querySelector('#host-detail-section');
    const nameEl = this.container.querySelector('#detail-host-name');
    const metricsEl = this.container.querySelector('#detail-metrics-container');
    if (!section || !metricsEl) return;

    nameEl.textContent = `${escapeHtml(host.alias || host.hostname)} - Metrics`;
    metricsEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-dim);">Loading metrics...</div>';
    section.style.display = 'block';
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    if (this.metricsInstance) { this.metricsInstance.destroy(); this.metricsInstance = null; }
    this.metricsInstance = new NetMetricsDashboard();
    this.metricsInstance.initForHost(host.id, host, metricsEl);
  }

  closeDetailSection() {
    this.expandedHostId = null;
    const section = this.container.querySelector('#host-detail-section');
    if (section) section.style.display = 'none';
    if (this.metricsInstance) { this.metricsInstance.destroy(); this.metricsInstance = null; }
  }

  // =====================================================================
  //  Notifications
  // =====================================================================

  showStatusChangeNotification(hostname, oldStatus, newStatus) {
    this.showToast(`${hostname}: ${oldStatus} \u2192 ${newStatus}`, 'info');
  }

  showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  showError(message) {
    console.error('[net-dashboard]', message);
    this.showToast(message, 'error');
  }

  // =====================================================================
  //  Helpers
  // =====================================================================

  _refreshPanel() {
    if (this.discoveredPanel) {
      const el = this.container.querySelector('#discovered-networks-container');
      if (el) this.discoveredPanel.render(el);
    }
  }

  destroy() {
    if (this.unsubscribe) this.unsubscribe();
    if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
    if (this.metricsInstance) this.metricsInstance.destroy();
    if (this.discoveredPanel) this.discoveredPanel.destroy();
  }
}

// --- Tab registration ---

(function registerDashboard() {
  function doRegister() {
    if (!window.tabManager) { setTimeout(doRegister, 0); return; }
    window.tabManager.registerTabType('netops-dashboard', {
      render: (tab, container) => {
        container.innerHTML = '';
        const dashboard = new NetDashboard();
        dashboard.init(container);
        tab.instance = dashboard;
      },
      onClose: (tab) => {
        if (tab.instance) { tab.instance.destroy(); tab.instance = null; }
      },
      maxTabs: 1,
    });
  }
  doRegister();
})();

// --- Module opener ---

(function registerModuleOpener() {
  function doRegister() {
    if (!window._hub) { setTimeout(doRegister, 0); return; }
    window._hub.moduleOpeners = window._hub.moduleOpeners || {};
    window._hub.moduleOpeners['netops'] = function openNetOps(mod) {
      if (window.tabManager && window.tabManager.hasTabType('netops-dashboard')) {
        window.tabManager.createTab('netops-dashboard', 'Monitor', { moduleId: mod.id }, { target: 'module' });
      }
    };
  }
  doRegister();
})();

// --- HTML escape ---

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text || '').replace(/[&<>"']/g, c => map[c]);
}
