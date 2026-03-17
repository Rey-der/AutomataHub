/**
 * NetHostList — sortable, filterable host table with sparklines.
 * Mounted/destroyed by NetApp's view router.
 */

class NetHostList {
  constructor(app) {
    this.app = app;
    this.sortCol = app.hostListSort?.col || 'name';
    this.sortAsc = app.hostListSort?.asc !== false;
    this.filter = '';
    this.historyCache = {};   // host_id → last 20 history entries
    this.uptimeCache = {};    // host_id → { uptime_percent }
    this.unsubscribes = [];
    this.actionMenuHostId = null;
  }

  async init(container) {
    this.container = container;
    this._renderSkeleton();
    await this.app.loadHosts();
    await this.loadExtraData();
    this.render();
    this.setupLiveUpdates();
  }

  _renderSkeleton() {
    this.container.innerHTML = `
      <div class="hl-wrapper">
        <div class="hl-header"><div class="skeleton skeleton-text" style="width:120px;height:24px"></div></div>
        <table class="hl-table"><tbody>
          ${Array(5).fill('<tr class="hl-row"><td colspan="8"><div class="skeleton skeleton-row"></div></td></tr>').join('')}
        </tbody></table>
      </div>
    `;
  }

  // ================================================================
  //  Data
  // ================================================================

  async loadExtraData() {
    const hosts = this.app.hosts;
    const [histResults, uptimeResults] = await Promise.all([
      Promise.allSettled(hosts.map(h =>
        API.invoke('netops:get-status-history', { host_id: h.id, limit: 20 })
      )),
      Promise.allSettled(hosts.map(h =>
        API.invoke('netops:get-uptime-stats', { host_id: h.id, timeRange: '24h' })
      )),
    ]);
    histResults.forEach((r, i) => {
      this.historyCache[hosts[i].id] = r.status === 'fulfilled' ? (r.value.history || []) : [];
    });
    uptimeResults.forEach((r, i) => {
      this.uptimeCache[hosts[i].id] = r.status === 'fulfilled' ? r.value : { uptime_percent: 0 };
    });
  }

  // ================================================================
  //  Sorting / Filtering
  // ================================================================

  getSortedHosts() {
    const sm = this.app.statusMap;
    let hosts = [...this.app.hosts];

    // Filter
    if (this.filter) {
      const q = this.filter.toLowerCase();
      hosts = hosts.filter(h => {
        const name = (h.alias || h.hostname || '').toLowerCase();
        const ip = (h.ip || h.hostname || '').toLowerCase();
        return name.includes(q) || ip.includes(q);
      });
    }

    // Sort
    hosts.sort((a, b) => {
      let va, vb;
      switch (this.sortCol) {
        case 'name':
          va = (a.alias || a.hostname).toLowerCase();
          vb = (b.alias || b.hostname).toLowerCase();
          return this.sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        case 'ip':
          va = a.ip || a.hostname || '';
          vb = b.ip || b.hostname || '';
          return this.sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        case 'status': {
          const order = { online: 0, offline: 1, unknown: 2 };
          va = order[sm.get(a.id)?.status || a.last_status || 'unknown'] ?? 2;
          vb = order[sm.get(b.id)?.status || b.last_status || 'unknown'] ?? 2;
          return this.sortAsc ? va - vb : vb - va;
        }
        case 'latency':
          va = sm.get(a.id)?.latency_ms ?? 9999;
          vb = sm.get(b.id)?.latency_ms ?? 9999;
          return this.sortAsc ? va - vb : vb - va;
        case 'uptime':
          va = this.uptimeCache[a.id]?.uptime_percent ?? 0;
          vb = this.uptimeCache[b.id]?.uptime_percent ?? 0;
          return this.sortAsc ? vb - va : va - vb; // desc = worst first
        case 'lastcheck':
          va = a.last_check || '';
          vb = b.last_check || '';
          return this.sortAsc ? vb.localeCompare(va) : va.localeCompare(vb);
        case 'protocol':
          va = (a.protocol || 'ping').toLowerCase();
          vb = (b.protocol || 'ping').toLowerCase();
          return this.sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        default:
          return 0;
      }
    });
    return hosts;
  }

  toggleSort(col) {
    if (this.sortCol === col) { this.sortAsc = !this.sortAsc; }
    else { this.sortCol = col; this.sortAsc = true; }
    this.app.hostListSort = { col: this.sortCol, asc: this.sortAsc };
    this.app._saveState();
    this.render();
  }

  // ================================================================
  //  Render
  // ================================================================

  render() {
    this.actionMenuHostId = null;
    const hosts = this.getSortedHosts();
    this.container.innerHTML = `
      <div class="hl-wrapper">
        <div class="hl-header">
          <h2>Hosts</h2>
          <span class="hl-count">Showing ${hosts.length} of ${this.app.hosts.length} hosts</span>
        </div>
        <table class="hl-table">
          <thead>
            <tr>
              ${this._thCell('Name', 'name')}
              ${this._thCell('IP', 'ip')}
              ${this._thCell('Proto', 'protocol')}
              ${this._thCell('Status', 'status')}
              ${this._thCell('Latency', 'latency')}
              ${this._thCell('Uptime', 'uptime')}
              ${this._thCell('Last Check', 'lastcheck')}
              <th class="hl-th hl-th-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${hosts.length === 0 ? this._emptyRow() : hosts.map(h => this._hostRow(h)).join('')}
          </tbody>
        </table>
      </div>
      ${this._addHostModalHTML()}
      ${this._editHostModalHTML()}
    `;
    this._bindEvents();
  }

  _thCell(label, col) {
    const active = this.sortCol === col;
    const arrow = active ? (this.sortAsc ? ' \u25B2' : ' \u25BC') : '';
    return `<th class="hl-th${active ? ' hl-th-active' : ''}" data-sort="${col}">${label}${arrow}</th>`;
  }

  _hostRow(host) {
    const sm = this.app.statusMap;
    const cached = sm.get(host.id);
    const status = cached?.status || host.last_status || 'unknown';
    const latency = cached?.latency_ms;
    const uptime = this.uptimeCache[host.id]?.uptime_percent;
    const history = this.historyCache[host.id] || [];
    const lastCheck = cached?.timestamp || host.last_check;

    const latStr = latency != null ? `${latency}ms` : '\u2014';
    const uptimeStr = uptime != null ? `${uptime.toFixed(1)}%` : '\u2014';
    const timeStr = lastCheck ? _hlFormatTime(lastCheck) : '\u2014';

    const disabled = !host.enabled;

    return `
      <tr class="hl-row hl-row-${status}${disabled ? ' hl-row-disabled' : ''}" data-host-id="${host.id}" tabindex="0">
        <td class="hl-td hl-td-name">${_hlEsc(host.alias || host.hostname)}${disabled ? ' <span class="hl-disabled-badge">disabled</span>' : ''}</td>
        <td class="hl-td hl-td-ip">${_hlEsc(host.ip || host.hostname)}</td>
        <td class="hl-td hl-td-proto"><span class="hl-proto-badge hl-proto-${_hlEsc(host.protocol || 'ping')}">${_hlEsc((host.protocol || 'tcp').toUpperCase())}</span></td>
        <td class="hl-td hl-td-status">
          <span class="hl-status-dot hl-dot-${status}"></span>${status}
        </td>
        <td class="hl-td hl-td-latency">
          ${this._sparklineSVG(history)}
          <span class="hl-lat-val">${latStr}</span>
        </td>
        <td class="hl-td hl-td-uptime">${uptimeStr}</td>
        <td class="hl-td hl-td-time">${timeStr}</td>
        <td class="hl-td hl-td-actions">
          <button class="hl-action-btn" data-host-id="${host.id}" title="Actions">\u22EF</button>
          <div class="hl-action-menu" data-menu-host="${host.id}" style="display:none;">
            <button class="hl-menu-item" data-action="ping" data-host-id="${host.id}">Ping Now</button>
            <button class="hl-menu-item" data-action="edit" data-host-id="${host.id}">Edit</button>
            <button class="hl-menu-item" data-action="detail" data-host-id="${host.id}">View Details</button>
            <button class="hl-menu-item" data-action="disable" data-host-id="${host.id}">${host.enabled ? 'Disable' : 'Enable'}</button>
            <button class="hl-menu-item hl-menu-danger" data-action="remove" data-host-id="${host.id}">Remove</button>
          </div>
        </td>
      </tr>
    `;
  }

  _emptyRow() {
    return `
      <tr>
        <td colspan="8" class="hl-empty">
          <div class="hl-empty-cta">
            <span class="hl-empty-icon">⊚</span>
            <p>No hosts monitored yet</p>
            <button class="hl-empty-add-btn" id="hl-empty-add">+ Add your first host</button>
          </div>
        </td>
      </tr>
    `;
  }

  // ================================================================
  //  Sparkline SVG
  // ================================================================

  _sparklineSVG(history) {
    if (!history || history.length < 2) return '';
    // history is newest-first from store; reverse for left-to-right chronological
    const pts = [...history].reverse().slice(-20);
    const latencies = pts.map(p => p.latency_ms ?? null);
    const valid = latencies.filter(v => v != null);
    if (valid.length < 2) return '';

    const max = Math.max(...valid, 1);
    const w = 60, h = 18, pad = 1;
    const step = (w - pad * 2) / (latencies.length - 1);

    let path = '';
    let lastY = null;
    latencies.forEach((val, i) => {
      if (val == null) return;
      const x = pad + i * step;
      const y = h - pad - ((val / max) * (h - pad * 2));
      if (lastY === null) path += `M${x.toFixed(1)},${y.toFixed(1)}`;
      else path += ` L${x.toFixed(1)},${y.toFixed(1)}`;
      lastY = y;
    });

    // Color: green if stable (low variance), yellow if volatile, red if many offline
    const offlineCount = pts.filter(p => p.status === 'offline').length;
    let color = 'var(--success)';
    if (offlineCount > pts.length * 0.3) color = 'var(--error)';
    else if (valid.length > 1) {
      const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
      const variance = valid.reduce((a, b) => a + (b - mean) ** 2, 0) / valid.length;
      if (Math.sqrt(variance) > mean * 0.4) color = 'var(--warning)';
    }

    return `<svg class="hl-sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${path}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  // ================================================================
  //  Add Host Modal
  // ================================================================

  _addHostModalHTML() {
    return `
      <div class="hl-modal-overlay" id="hl-add-modal" style="display:none;">
        <div class="hl-modal">
          <div class="hl-modal-header">
            <h3>Add Host</h3>
            <button class="hl-modal-close" id="hl-modal-close">&times;</button>
          </div>
          <form class="hl-modal-body" id="hl-add-form" autocomplete="off">
            <label class="hl-field">
              <span>Hostname <em>(required)</em></span>
              <input type="text" name="hostname" required placeholder="e.g. 192.168.1.1 or myserver.local" />
            </label>
            <label class="hl-field">
              <span>IP Address</span>
              <input type="text" name="ip" placeholder="Optional" />
            </label>
            <div class="hl-field-row">
              <label class="hl-field">
                <span>Port</span>
                <input type="number" name="port" min="1" max="65535" placeholder="80" />
              </label>
              <label class="hl-field">
                <span>Protocol</span>
                <select name="protocol" id="hl-proto-select">
                  <option value="ping">Ping (TCP)</option>
                  <option value="icmp">ICMP</option>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="dns">DNS</option>
                </select>
              </label>
            </div>
            <div class="hl-proto-fields" id="hl-proto-fields">
              <div class="hl-proto-http" style="display:none;">
                <label class="hl-field">
                  <span>URL <em>(optional, overrides hostname)</em></span>
                  <input type="text" name="url" placeholder="https://example.com/health" />
                </label>
                <div class="hl-field-row">
                  <label class="hl-field">
                    <span>Expected Status</span>
                    <input type="number" name="expected_status" min="100" max="599" placeholder="200" />
                  </label>
                  <label class="hl-field">
                    <span>Keyword</span>
                    <input type="text" name="keyword" placeholder="Optional body match" />
                  </label>
                </div>
              </div>
              <div class="hl-proto-dns" style="display:none;">
                <div class="hl-field-row">
                  <label class="hl-field">
                    <span>Record Type</span>
                    <select name="record_type">
                      <option value="A">A</option>
                      <option value="AAAA">AAAA</option>
                      <option value="MX">MX</option>
                      <option value="CNAME">CNAME</option>
                    </select>
                  </label>
                  <label class="hl-field">
                    <span>Expected IP</span>
                    <input type="text" name="expected_ip" placeholder="Optional" />
                  </label>
                </div>
              </div>
            </div>
            <label class="hl-field">
              <span>Alias</span>
              <input type="text" name="alias" placeholder="Friendly name (optional)" />
            </label>
            <div class="hl-modal-actions">
              <button type="button" class="hl-btn-cancel" id="hl-add-cancel">Cancel</button>
              <button type="submit" class="hl-btn-submit">Add Host</button>
            </div>
            <div class="hl-form-error" id="hl-form-error" style="display:none;"></div>
          </form>
        </div>
      </div>
    `;
  }

  showAddModal() {
    const modal = this.container.querySelector('#hl-add-modal');
    if (modal) modal.style.display = '';
  }

  hideAddModal() {
    const modal = this.container.querySelector('#hl-add-modal');
    if (modal) modal.style.display = 'none';
    const form = this.container.querySelector('#hl-add-form');
    if (form) form.reset();
    const err = this.container.querySelector('#hl-form-error');
    if (err) err.style.display = 'none';
  }

  // ================================================================
  //  Edit Host Modal
  // ================================================================

  _editHostModalHTML() {
    return `
      <div class="hl-modal-overlay" id="hl-edit-modal" style="display:none;">
        <div class="hl-modal">
          <div class="hl-modal-header">
            <h3>Edit Host</h3>
            <button class="hl-modal-close" id="hl-edit-modal-close">&times;</button>
          </div>
          <form class="hl-modal-body" id="hl-edit-form" autocomplete="off">
            <input type="hidden" name="host_id" />
            <label class="hl-field">
              <span>Hostname <em>(required)</em></span>
              <input type="text" name="hostname" required placeholder="e.g. 192.168.1.1 or myserver.local" />
            </label>
            <label class="hl-field">
              <span>IP Address</span>
              <input type="text" name="ip" placeholder="Optional" />
            </label>
            <div class="hl-field-row">
              <label class="hl-field">
                <span>Port</span>
                <input type="number" name="port" min="1" max="65535" placeholder="80" />
              </label>
              <label class="hl-field">
                <span>Protocol</span>
                <select name="protocol" id="hl-edit-proto-select">
                  <option value="ping">Ping (TCP)</option>
                  <option value="icmp">ICMP</option>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="dns">DNS</option>
                </select>
              </label>
            </div>
            <div class="hl-proto-fields" id="hl-edit-proto-fields">
              <div class="hl-proto-http" style="display:none;">
                <label class="hl-field">
                  <span>URL <em>(optional, overrides hostname)</em></span>
                  <input type="text" name="url" placeholder="https://example.com/health" />
                </label>
                <div class="hl-field-row">
                  <label class="hl-field">
                    <span>Expected Status</span>
                    <input type="number" name="expected_status" min="100" max="599" placeholder="200" />
                  </label>
                  <label class="hl-field">
                    <span>Keyword</span>
                    <input type="text" name="keyword" placeholder="Optional body match" />
                  </label>
                </div>
              </div>
              <div class="hl-proto-dns" style="display:none;">
                <div class="hl-field-row">
                  <label class="hl-field">
                    <span>Record Type</span>
                    <select name="record_type">
                      <option value="A">A</option>
                      <option value="AAAA">AAAA</option>
                      <option value="MX">MX</option>
                      <option value="CNAME">CNAME</option>
                    </select>
                  </label>
                  <label class="hl-field">
                    <span>Expected IP</span>
                    <input type="text" name="expected_ip" placeholder="Optional" />
                  </label>
                </div>
              </div>
            </div>
            <label class="hl-field">
              <span>Alias</span>
              <input type="text" name="alias" placeholder="Friendly name (optional)" />
            </label>
            <div class="hl-modal-actions">
              <button type="button" class="hl-btn-cancel" id="hl-edit-cancel">Cancel</button>
              <button type="submit" class="hl-btn-submit">Save Changes</button>
            </div>
            <div class="hl-form-error" id="hl-edit-form-error" style="display:none;"></div>
          </form>
        </div>
      </div>
    `;
  }

  showEditModal(hostId) {
    const host = this.app.hosts.find(h => h.id === hostId);
    if (!host) return;

    const modal = this.container.querySelector('#hl-edit-modal');
    if (!modal) return;

    const form = this.container.querySelector('#hl-edit-form');
    if (!form) return;

    // Populate fields
    form.elements.host_id.value = host.id;
    form.elements.hostname.value = host.hostname || '';
    form.elements.ip.value = host.ip || '';
    form.elements.port.value = host.port || '';
    form.elements.protocol.value = host.protocol || 'ping';
    form.elements.url.value = host.url || '';
    form.elements.expected_status.value = host.expected_status || '';
    form.elements.keyword.value = host.keyword || '';
    form.elements.record_type.value = host.record_type || 'A';
    form.elements.expected_ip.value = host.expected_ip || '';
    form.elements.alias.value = host.alias || '';

    // Toggle protocol-specific fields
    const proto = host.protocol || 'ping';
    const httpFields = modal.querySelector('.hl-proto-http');
    const dnsFields = modal.querySelector('.hl-proto-dns');
    if (httpFields) httpFields.style.display = (proto === 'http' || proto === 'https') ? '' : 'none';
    if (dnsFields) dnsFields.style.display = (proto === 'dns') ? '' : 'none';

    const err = this.container.querySelector('#hl-edit-form-error');
    if (err) err.style.display = 'none';

    modal.style.display = '';
  }

  hideEditModal() {
    const modal = this.container.querySelector('#hl-edit-modal');
    if (modal) modal.style.display = 'none';
    const form = this.container.querySelector('#hl-edit-form');
    if (form) form.reset();
    const err = this.container.querySelector('#hl-edit-form-error');
    if (err) err.style.display = 'none';
  }

  async handleEditHost(formData) {
    const hostId = Number(formData.get('host_id'));
    const hostname = (formData.get('hostname') || '').trim();
    if (!hostname) {
      this._showEditFormError('Hostname is required.');
      return;
    }

    try {
      const updates = {
        host_id: hostId,
        hostname,
        ip: (formData.get('ip') || '').trim() || null,
        port: parseInt(formData.get('port')) || 0,
        protocol: formData.get('protocol') || 'ping',
        alias: (formData.get('alias') || '').trim() || null,
        url: (formData.get('url') || '').trim() || null,
        expected_status: parseInt(formData.get('expected_status')) || null,
        keyword: (formData.get('keyword') || '').trim() || null,
        expected_ip: (formData.get('expected_ip') || '').trim() || null,
        record_type: formData.get('record_type') || 'A',
      };
      const result = await API.invoke('netops:update-host-config', updates);
      if (result.success) {
        this.hideEditModal();
        await this.app.loadHosts();
        await this.loadExtraData();
        this.render();
        window.ui.showNotification(`${hostname} updated successfully.`, 'success');
      } else {
        this._showEditFormError(result.error || 'Failed to update host.');
      }
    } catch (err) {
      this._showEditFormError(err.message);
    }
  }

  _showEditFormError(msg) {
    const el = this.container.querySelector('#hl-edit-form-error');
    if (el) { el.textContent = msg; el.style.display = ''; }
  }

  async handleAddHost(formData) {
    const hostname = (formData.get('hostname') || '').trim();
    if (!hostname) {
      this._showFormError('Hostname is required.');
      return;
    }
    // Duplicate check
    const existing = this.app.hosts.find(h =>
      h.hostname === hostname || h.ip === hostname ||
      (formData.get('ip') && h.ip === formData.get('ip').trim())
    );
    if (existing) {
      this._showFormError(`Host "${existing.hostname}" already exists.`);
      return;
    }

    try {
      const args = {
        hostname,
        ip: (formData.get('ip') || '').trim() || null,
        port: parseInt(formData.get('port')) || 0,
        protocol: formData.get('protocol') || 'ping',
        alias: (formData.get('alias') || '').trim() || null,
        url: (formData.get('url') || '').trim() || null,
        expected_status: parseInt(formData.get('expected_status')) || null,
        keyword: (formData.get('keyword') || '').trim() || null,
        expected_ip: (formData.get('expected_ip') || '').trim() || null,
        record_type: formData.get('record_type') || 'A',
      };
      const result = await API.invoke('netops:add-host', args);
      if (result.success) {
        this.hideAddModal();
        await this.app.loadHosts();
        await this.loadExtraData();
        this.render();
        window.ui.showNotification(`${hostname} added successfully.`, 'success');
      } else {
        this._showFormError(result.error || 'Failed to add host.');
      }
    } catch (err) {
      this._showFormError(err.message);
    }
  }

  _showFormError(msg) {
    const el = this.container.querySelector('#hl-form-error');
    if (el) { el.textContent = msg; el.style.display = ''; }
  }

  // ================================================================
  //  In-place Updates
  // ================================================================

  setupLiveUpdates() {
    const unsub1 = API.on('netops:status-update', (data) => {
      this._updateRowInPlace(data.host_id);
      if (data.statusChanged) this._flashRow(data.host_id);
    });
    this.unsubscribes.push(unsub1);

    const unsub2 = API.on('netops:status-change', (data) => {
      // Append to history cache for sparkline
      const hc = this.historyCache[data.host_id];
      if (hc) {
        hc.unshift({ host_id: data.host_id, status: data.new_status, latency_ms: data.latency_ms, timestamp: data.timestamp });
        if (hc.length > 20) hc.length = 20;
      }
    });
    this.unsubscribes.push(unsub2);
  }

  async _updateRowInPlace(hostId) {
    const row = this.container.querySelector(`tr[data-host-id="${hostId}"]`);
    if (!row) return;

    const host = this.app.hosts.find(h => h.id === hostId);
    if (!host) return;

    const cached = this.app.statusMap.get(hostId);
    const status = cached?.status || host.last_status || 'unknown';
    const latency = cached?.latency_ms;
    const timeStr = cached?.timestamp ? _hlFormatTime(cached.timestamp) : '\u2014';

    row.className = `hl-row hl-row-${status}`;

    const statusCell = row.querySelector('.hl-td-status');
    if (statusCell) statusCell.innerHTML = `<span class="hl-status-dot hl-dot-${status}"></span>${status}`;

    const latCell = row.querySelector('.hl-lat-val');
    if (latCell) latCell.textContent = latency != null ? `${latency}ms` : '\u2014';

    const timeCell = row.querySelector('.hl-td-time');
    if (timeCell) timeCell.textContent = timeStr;

    // Refresh uptime
    try {
      const res = await API.invoke('netops:get-uptime-stats', { host_id: hostId, timeRange: '24h' });
      this.uptimeCache[hostId] = res;
      const uptimeCell = row.querySelector('.hl-td-uptime');
      if (uptimeCell) {
        const pct = res.uptime_percent;
        uptimeCell.textContent = pct != null ? `${pct.toFixed(1)}%` : '\u2014';
      }
    } catch { /* ignore */ }

    // Update sparkline
    const history = this.historyCache[hostId] || [];
    const sparkContainer = row.querySelector('.hl-td-latency');
    if (sparkContainer) {
      const oldSvg = sparkContainer.querySelector('.hl-sparkline');
      const newSvg = this._sparklineSVG(history);
      if (oldSvg && newSvg) {
        const temp = document.createElement('div');
        temp.innerHTML = newSvg;
        const svg = temp.firstElementChild;
        if (svg) oldSvg.replaceWith(svg);
      }
    }
  }

  _flashRow(hostId) {
    const row = this.container.querySelector(`tr[data-host-id="${hostId}"]`);
    if (!row) return;
    row.classList.add('hl-row-flash');
    setTimeout(() => row.classList.remove('hl-row-flash'), 1200);
  }

  // ================================================================
  //  Actions
  // ================================================================

  async pingHost(hostId) {
    const host = this.app.hosts.find(h => h.id === hostId);
    if (!host) return;
    try {
      const result = await API.invoke('netops:ping-host', { hostname: host.hostname, host_id: hostId });
      const status = result.success ? 'online' : 'offline';
      const latStr = result.latency ? `${result.latency}ms` : '';
      window.ui.showNotification(`${host.hostname}: ${status} ${latStr}`, status === 'online' ? 'success' : 'warning');
    } catch (err) {
      window.ui.showNotification(`Ping failed: ${err.message}`, 'error');
    }
  }

  async removeHost(hostId) {
    const host = this.app.hosts.find(h => h.id === hostId);
    if (!host) return;
    if (!confirm(`Remove "${host.alias || host.hostname}"? This cannot be undone.`)) return;
    try {
      await API.invoke('netops:remove-host', { host_id: hostId });
      await this.app.loadHosts();
      this.render();
      window.ui.showNotification(`${host.hostname} removed.`, 'success');
    } catch (err) {
      window.ui.showNotification(`Failed to remove: ${err.message}`, 'error');
    }
  }

  async toggleHost(hostId) {
    const host = this.app.hosts.find(h => h.id === hostId);
    if (!host) return;
    const newEnabled = host.enabled ? 0 : 1;
    try {
      await API.invoke('netops:update-host-config', { host_id: hostId, enabled: newEnabled });
      host.enabled = newEnabled;
      this.render();
      window.ui.showNotification(`${host.hostname} ${newEnabled ? 'enabled' : 'disabled'}.`, 'info');
    } catch (err) {
      window.ui.showNotification(`Failed: ${err.message}`, 'error');
    }
  }

  // ================================================================
  //  Event Binding
  // ================================================================

  _bindEvents() {
    // Sort headers
    this.container.querySelectorAll('.hl-th[data-sort]').forEach(th => {
      th.addEventListener('click', () => this.toggleSort(th.dataset.sort));
    });

    // Row click → detail (but not on action column)
    this.container.querySelectorAll('.hl-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.hl-td-actions')) return;
        this.app.navigateTo('host-detail', Number(row.dataset.hostId));
      });
    });

    // Keyboard navigation for host rows
    this.container.addEventListener('keydown', (e) => {
      const row = e.target.closest('.hl-row');
      if (!row) return;
      const rows = [...this.container.querySelectorAll('.hl-row')];
      const idx = rows.indexOf(row);
      if (e.key === 'ArrowDown' && idx < rows.length - 1) {
        rows[idx + 1].focus();
        e.preventDefault();
      } else if (e.key === 'ArrowUp' && idx > 0) {
        rows[idx - 1].focus();
        e.preventDefault();
      } else if (e.key === 'Enter') {
        this.app.navigateTo('host-detail', Number(row.dataset.hostId));
        e.preventDefault();
      }
    });

    // Action menu toggle
    this.container.querySelectorAll('.hl-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const hostId = Number(btn.dataset.hostId);
        this._toggleActionMenu(hostId);
      });
    });

    // Action menu items
    this.container.querySelectorAll('.hl-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const hostId = Number(item.dataset.hostId);
        const action = item.dataset.action;
        this._closeAllMenus();
        if (action === 'ping') this.pingHost(hostId);
        else if (action === 'edit') this.showEditModal(hostId);
        else if (action === 'detail') this.app.navigateTo('host-detail', hostId);
        else if (action === 'disable') this.toggleHost(hostId);
        else if (action === 'remove') this.removeHost(hostId);
      });
    });

    // Close menus on outside click (remove stale handler first)
    if (this._outsideClickHandler) document.removeEventListener('click', this._outsideClickHandler);
    this._outsideClickHandler = (e) => {
      if (!e.target.closest('.hl-action-btn') && !e.target.closest('.hl-action-menu')) {
        this._closeAllMenus();
      }
    };
    document.addEventListener('click', this._outsideClickHandler);

    // Add Host button in toolbar
    const addBtn = this.app.container.querySelector('.toolbar-add-host');
    if (addBtn) {
      this._addHostHandler = () => this.showAddModal();
      addBtn.removeEventListener('click', addBtn._prevHandler);
      addBtn.addEventListener('click', this._addHostHandler);
      addBtn._prevHandler = this._addHostHandler;
    }

    // Modal close / cancel
    const closeBtn = this.container.querySelector('#hl-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hideAddModal());
    const cancelBtn = this.container.querySelector('#hl-add-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.hideAddModal());

    // Modal overlay click to close
    const overlay = this.container.querySelector('#hl-add-modal');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.hideAddModal();
      });
    }

    // Form submit
    const form = this.container.querySelector('#hl-add-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleAddHost(new FormData(form));
      });
    }

    // Toolbar search — wire to filter
    const search = this.app.container.querySelector('.toolbar-search');
    if (search) {
      this._searchHandler = () => {
        this.filter = search.value.trim();
        this.render();
      };
      search.removeEventListener('input', search._prevHandler);
      search.addEventListener('input', this._searchHandler);
      search._prevHandler = this._searchHandler;
    }

    // Empty state CTA
    const emptyAdd = this.container.querySelector('#hl-empty-add');
    if (emptyAdd) {
      emptyAdd.addEventListener('click', () => this.showAddModal());
    }

    // Protocol select → toggle protocol-specific fields (Add modal)
    const protoSelect = this.container.querySelector('#hl-proto-select');
    if (protoSelect) {
      const updateFields = () => {
        const v = protoSelect.value;
        const addModal = this.container.querySelector('#hl-add-modal');
        if (!addModal) return;
        const httpFields = addModal.querySelector('.hl-proto-http');
        const dnsFields = addModal.querySelector('.hl-proto-dns');
        if (httpFields) httpFields.style.display = (v === 'http' || v === 'https') ? '' : 'none';
        if (dnsFields) dnsFields.style.display = (v === 'dns') ? '' : 'none';
      };
      protoSelect.addEventListener('change', updateFields);
      updateFields();
    }

    // ---- Edit modal bindings ----
    const editCloseBtn = this.container.querySelector('#hl-edit-modal-close');
    if (editCloseBtn) editCloseBtn.addEventListener('click', () => this.hideEditModal());
    const editCancelBtn = this.container.querySelector('#hl-edit-cancel');
    if (editCancelBtn) editCancelBtn.addEventListener('click', () => this.hideEditModal());

    const editOverlay = this.container.querySelector('#hl-edit-modal');
    if (editOverlay) {
      editOverlay.addEventListener('click', (e) => {
        if (e.target === editOverlay) this.hideEditModal();
      });
    }

    const editForm = this.container.querySelector('#hl-edit-form');
    if (editForm) {
      editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleEditHost(new FormData(editForm));
      });
    }

    const editProtoSelect = this.container.querySelector('#hl-edit-proto-select');
    if (editProtoSelect) {
      const updateEditFields = () => {
        const v = editProtoSelect.value;
        const editModal = this.container.querySelector('#hl-edit-modal');
        if (!editModal) return;
        const httpFields = editModal.querySelector('.hl-proto-http');
        const dnsFields = editModal.querySelector('.hl-proto-dns');
        if (httpFields) httpFields.style.display = (v === 'http' || v === 'https') ? '' : 'none';
        if (dnsFields) dnsFields.style.display = (v === 'dns') ? '' : 'none';
      };
      editProtoSelect.addEventListener('change', updateEditFields);
    }
  }

  _toggleActionMenu(hostId) {
    const isOpen = this.actionMenuHostId === hostId;
    this._closeAllMenus();
    if (!isOpen) {
      const btn = this.container.querySelector(`.hl-action-btn[data-host-id="${hostId}"]`);
      const menu = this.container.querySelector(`[data-menu-host="${hostId}"]`);
      if (menu && btn) {
        const rect = btn.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.right = `${window.innerWidth - rect.right}px`;
        menu.style.display = 'block';
        this.actionMenuHostId = hostId;
      }
    }
  }

  _closeAllMenus() {
    this.container.querySelectorAll('.hl-action-menu').forEach(m => m.style.display = 'none');
    this.actionMenuHostId = null;
  }

  // ================================================================
  //  Cleanup
  // ================================================================

  destroy() {
    this.unsubscribes.forEach(fn => { if (typeof fn === 'function') fn(); });
    if (this._outsideClickHandler) document.removeEventListener('click', this._outsideClickHandler);
    // Clean up toolbar listeners
    const search = this.app.container.querySelector('.toolbar-search');
    if (search && this._searchHandler) {
      search.removeEventListener('input', this._searchHandler);
    }
  }
}

// --- Helpers (module-scoped) ---

function _hlEsc(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text || '').replace(/[&<>"']/g, c => map[c]);
}

function _hlFormatTime(timestamp) {
  if (!timestamp) return '\u2014';
  const d = new Date(timestamp);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
