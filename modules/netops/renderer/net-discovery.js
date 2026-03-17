/**
 * NetDiscovery — network scanner UI and discovered-network browser.
 * Mounted/destroyed by NetApp's view router.
 */

class NetDiscovery {
  constructor(app) {
    this.app = app;
    this.scanning = false;
    this.scanProgress = null;     // { progress, scanned, total }
    this.scanStartTime = null;
    this.networks = [];
    this.expandedNets = new Set(); // persist collapse state across re-renders
    this.hostsByNet = {};          // network_id → discovered hosts[]
    this.unsubscribes = [];
  }

  async init(container) {
    this.container = container;
    await this.loadNetworks();
    this.render();
    this._setupPushEvents();
  }

  // ================================================================
  //  Data
  // ================================================================

  async loadNetworks() {
    try {
      const res = await API.invoke('netops:get-discovered-networks');
      this.networks = res.networks || [];
    } catch (err) {
      console.error('[netops] loadNetworks:', err);
    }
  }

  async loadHosts(networkId) {
    try {
      const res = await API.invoke('netops:get-discovered-hosts', { network_id: networkId });
      this.hostsByNet[networkId] = res.hosts || [];
    } catch (err) {
      console.error('[netops] loadHosts:', err);
    }
  }

  isMonitored(ip, hostname) {
    return this.app.hosts.some(h =>
      h.ip === ip || h.hostname === ip || h.hostname === hostname
    );
  }

  // ================================================================
  //  Render
  // ================================================================

  render() {
    this.container.innerHTML = `
      <div class="disc-wrapper">
        <!-- Scanner -->
        <div class="disc-scanner-section">
          <div class="disc-section-title">Network Scanner</div>
          <form class="disc-scan-form" id="disc-scan-form" autocomplete="off">
            <div class="disc-scan-fields">
              <label class="disc-field">
                <span>CIDR Range</span>
                <input type="text" name="cidr" required placeholder="192.168.1.0/24" />
              </label>
              <label class="disc-field disc-field-sm">
                <span>Port (optional)</span>
                <input type="number" name="port" min="1" max="65535" placeholder="80" />
              </label>
              <label class="disc-field">
                <span>Name (optional)</span>
                <input type="text" name="name" placeholder="Office LAN" />
              </label>
            </div>
            <button type="submit" class="disc-scan-btn" id="disc-scan-btn" ${this.scanning ? 'disabled' : ''}>
              ${this.scanning ? 'Scanning\u2026' : '\u{1F50D} Scan'}
            </button>
          </form>
          ${this._renderProgress()}
        </div>

        <!-- Saved Networks -->
        <div class="disc-networks-section">
          <div class="disc-section-title">Discovered Networks <span class="disc-count">${this.networks.length} network${this.networks.length !== 1 ? 's' : ''}</span></div>
          ${this.networks.length === 0
            ? '<p class="disc-empty">No networks discovered yet. Run a scan to get started.</p>'
            : this.networks.map(n => this._renderNetwork(n)).join('')}
        </div>
      </div>
    `;
    this._bindEvents();
  }

  _renderProgress() {
    if (!this.scanning && !this.scanProgress) return '';
    const p = this.scanProgress || { progress: 0, scanned: 0, total: 0 };
    const elapsed = this.scanStartTime ? Math.round((Date.now() - this.scanStartTime) / 1000) : 0;
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    return `
      <div class="disc-progress" id="disc-progress">
        <div class="disc-progress-bar">
          <div class="disc-progress-fill" style="width:${p.progress}%"></div>
        </div>
        <div class="disc-progress-info">
          <span>${p.scanned} / ${p.total} hosts scanned (${p.progress}%)</span>
          <span>Elapsed: ${timeStr}</span>
        </div>
      </div>
    `;
  }

  _renderNetwork(net) {
    const expanded = this.expandedNets.has(net.id);
    const chevron = expanded ? '\u25BC' : '\u25B6';
    const hosts = this.hostsByNet[net.id] || [];
    return `
      <div class="disc-network" data-net-id="${net.id}">
        <div class="disc-net-header" data-net-id="${net.id}">
          <span class="disc-net-chevron">${chevron}</span>
          <span class="disc-net-name">${_discEsc(net.name || net.cidr)}</span>
          <span class="disc-net-cidr">${_discEsc(net.cidr)}</span>
          <span class="disc-net-stats">${net.online_count}/${net.host_count} online</span>
          <div class="disc-net-actions">
            <button class="disc-net-btn" data-action="rescan" data-cidr="${_discEsc(net.cidr)}" data-name="${_discEsc(net.name || '')}" title="Rescan">&#8635; Rescan</button>
            <button class="disc-net-btn disc-net-btn-danger" data-action="remove" data-net-id="${net.id}" title="Remove">&times; Remove</button>
          </div>
        </div>
        ${expanded ? this._renderHostTable(net.id, hosts) : ''}
      </div>
    `;
  }

  _renderHostTable(networkId, hosts) {
    if (hosts.length === 0) {
      return '<div class="disc-hosts-loading">Loading hosts\u2026</div>';
    }
    return `
      <table class="disc-host-table">
        <thead>
          <tr>
            <th>IP</th>
            <th>Hostname</th>
            <th>Status</th>
            <th>Latency</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${hosts.map(h => this._renderHostRow(h)).join('')}
        </tbody>
      </table>
    `;
  }

  _renderHostRow(host) {
    const status = host.status || 'unknown';
    const lat = host.latency_ms != null ? `${host.latency_ms}ms` : '\u2014';
    const monitored = this.isMonitored(host.ip, host.hostname);
    return `
      <tr class="disc-host-row disc-host-${status}">
        <td class="disc-host-ip">${_discEsc(host.ip)}</td>
        <td>${_discEsc(host.hostname || host.ip)}</td>
        <td><span class="disc-dot disc-dot-${status}"></span>${status}</td>
        <td class="disc-host-lat">${lat}</td>
        <td class="disc-host-actions">
          ${monitored
            ? '<span class="disc-monitored" title="Already monitored">\u2713 Monitored</span>'
            : `<button class="disc-add-btn" data-host-id="${host.id}" data-ip="${_discEsc(host.ip)}" data-hostname="${_discEsc(host.hostname || host.ip)}" title="Add to monitored">+ Add</button>`}
          <button class="disc-ping-btn" data-hostname="${_discEsc(host.ip)}" title="Ping">Ping</button>
        </td>
      </tr>
    `;
  }

  // ================================================================
  //  Scanning
  // ================================================================

  async startScan(cidr, port, name) {
    this.scanning = true;
    this.scanProgress = { progress: 0, scanned: 0, total: 0 };
    this.scanStartTime = Date.now();
    this.render();

    try {
      const result = await API.invoke('netops:scan-network', { cidr, port: port || null, name: name || null });
      this.scanning = false;
      this.scanProgress = null;
      this.scanStartTime = null;

      await this.app.loadHosts(); // refresh monitored hosts for dupe check
      await this.loadNetworks();

      // Auto-expand the scanned network
      if (result.network_id) {
        this.expandedNets.add(result.network_id);
        await this.loadHosts(result.network_id);
      }

      this.render();
      const found = result.discovered_count || 0;
      globalThis.ui.showNotification(`Scan complete: ${found} host${found !== 1 ? 's' : ''} online out of ${result.scanned} scanned.`, 'success');
    } catch (err) {
      this.scanning = false;
      this.scanProgress = null;
      this.scanStartTime = null;
      this.render();
      globalThis.ui.showNotification(`Scan failed: ${err.message}`, 'error');
    }
  }

  // ================================================================
  //  Actions
  // ================================================================

  async addDiscoveredHost(hostId, ip, hostname) {
    try {
      const result = await API.invoke('netops:add-discovered-host', { host_id: hostId, hostname, ip });
      if (result.success) {
        await this.app.loadHosts();
        this.render();
        globalThis.ui.showNotification(`${ip} added to monitored hosts.`, 'success');
      } else {
        globalThis.ui.showNotification(result.error || 'Failed to add host.', 'error');
      }
    } catch (err) {
      globalThis.ui.showNotification(`Failed: ${err.message}`, 'error');
    }
  }

  async pingDiscoveredHost(hostname, btn) {
    btn.disabled = true;
    btn.textContent = '\u2026';
    try {
      const result = await API.invoke('netops:ping-host', { hostname });
      const s = result.success ? 'online' : 'offline';
      const lat = result.latency ? ` ${result.latency}ms` : '';
      btn.textContent = `${s}${lat}`;
      btn.classList.add(result.success ? 'disc-ping-ok' : 'disc-ping-fail');
      setTimeout(() => {
        btn.textContent = 'Ping';
        btn.disabled = false;
        btn.classList.remove('disc-ping-ok', 'disc-ping-fail');
      }, 3000);
    } catch {
      btn.textContent = 'error';
      btn.disabled = false;
    }
  }

  async rescanNetwork(cidr, name) {
    await this.startScan(cidr, 0, name);
  }

  async removeNetwork(networkId) {
    const net = this.networks.find(n => n.id === networkId);
    if (!net) return;
    if (!confirm(`Remove network "${net.name || net.cidr}" and all its discovered hosts?`)) return;
    try {
      await API.invoke('netops:remove-discovered-network', { network_id: networkId });
      this.expandedNets.delete(networkId);
      delete this.hostsByNet[networkId];
      await this.loadNetworks();
      this.render();
      globalThis.ui.showNotification(`Network ${net.cidr} removed.`, 'success');
    } catch (err) {
      globalThis.ui.showNotification(`Failed: ${err.message}`, 'error');
    }
  }

  async toggleExpand(networkId) {
    if (this.expandedNets.has(networkId)) {
      this.expandedNets.delete(networkId);
    } else {
      this.expandedNets.add(networkId);
      if (!this.hostsByNet[networkId] || this.hostsByNet[networkId].length === 0) {
        await this.loadHosts(networkId);
      }
    }
    this.render();
  }

  // ================================================================
  //  Push Events
  // ================================================================

  _setupPushEvents() {
    const unsub = API.on('netops:scan-progress', (data) => {
      if (!this.scanning) return;
      this.scanProgress = data;
      this._updateProgress();
    });
    this.unsubscribes.push(unsub);
  }

  _updateProgress() {
    const el = this.container.querySelector('#disc-progress');
    if (!el) return;
    const p = this.scanProgress || { progress: 0, scanned: 0, total: 0 };
    const elapsed = this.scanStartTime ? Math.round((Date.now() - this.scanStartTime) / 1000) : 0;
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    const fill = el.querySelector('.disc-progress-fill');
    if (fill) fill.style.width = `${p.progress}%`;

    const info = el.querySelector('.disc-progress-info');
    if (info) {
      info.innerHTML = `
        <span>${p.scanned} / ${p.total} hosts scanned (${p.progress}%)</span>
        <span>Elapsed: ${timeStr}</span>
      `;
    }
  }

  // ================================================================
  //  Event Binding
  // ================================================================

  _bindEvents() {
    // Scan form submit
    const form = this.container.querySelector('#disc-scan-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const cidr = (fd.get('cidr') || '').trim();
        if (!cidr) return;
        this.startScan(cidr, Number.parseInt(fd.get('port')) || 0, (fd.get('name') || '').trim());
      });
    }

    // Network header click → expand/collapse
    this.container.querySelectorAll('.disc-net-header').forEach(hdr => {
      hdr.addEventListener('click', (e) => {
        if (e.target.closest('.disc-net-btn')) return; // don't toggle on action buttons
        const netId = Number(hdr.dataset.netId);
        this.toggleExpand(netId);
      });
    });

    // Network action buttons (rescan / remove)
    this.container.querySelectorAll('.disc-net-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'rescan') {
          this.rescanNetwork(btn.dataset.cidr, btn.dataset.name);
        } else if (action === 'remove') {
          this.removeNetwork(Number(btn.dataset.netId));
        }
      });
    });

    // Add discovered host
    this.container.querySelectorAll('.disc-add-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.addDiscoveredHost(Number(btn.dataset.hostId), btn.dataset.ip, btn.dataset.hostname);
      });
    });

    // Ping discovered host
    this.container.querySelectorAll('.disc-ping-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pingDiscoveredHost(btn.dataset.hostname, btn);
      });
    });
  }

  // ================================================================
  //  Cleanup
  // ================================================================

  destroy() {
    this.unsubscribes.forEach(fn => { if (typeof fn === 'function') fn(); });
  }
}

// --- Helpers ---

function _discEsc(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text || '').replace(/[&<>"']/g, c => map[c]);
}
