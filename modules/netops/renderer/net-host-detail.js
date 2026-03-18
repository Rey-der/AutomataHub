/**
 * NetHostDetail — full-page detail view for a single host.
 * Shows KPI header, heartbeat bar, metric sub-tabs with Chart.js, and recent checks log.
 * Mounted by NetApp when navigating to 'host-detail' with a host_id.
 */

class NetHostDetail {
  constructor(app, hostId) {
    this.app = app;
    this.hostId = hostId;
    this.host = null;
    this.uptime = null;
    this.aggregate = null;
    this.heartbeats = [];
    this.recentChecks = [];
    this.activeTab = 'response';
    this.chart = null;
    this.unsubscribes = [];
    this.timeRange = '24h';
  }

  async init(container) {
    this.container = container;
    // Grab toolbar time range
    const sel = this.app.container.querySelector('.toolbar-time-range');
    if (sel) this.timeRange = sel.value;

    this._renderSkeleton();
    await this.loadData();
    this.render();
    this.setupLiveUpdates();
  }

  _renderSkeleton() {
    this.container.innerHTML = `
      <div class="hd-wrapper">
        <div class="hd-header"><div class="skeleton skeleton-text" style="width:200px;height:28px"></div></div>
        <div class="hd-kpis">${new Array(4).fill('<div class="kpi-tile skeleton"></div>').join('')}</div>
        <div class="skeleton skeleton-row" style="height:24px;margin:16px 0"></div>
        <div class="skeleton skeleton-block" style="height:200px"></div>
      </div>
    `;
  }

  // ================================================================
  //  Data
  // ================================================================

  async loadData() {
    try {
      const [detail, uptime, agg, hb, history] = await Promise.all([
        API.invoke('netops:get-host-detail', { host_id: this.hostId }),
        API.invoke('netops:get-uptime-stats', { host_id: this.hostId, timeRange: this.timeRange }),
        API.invoke('netops:get-aggregate-metrics', { host_id: this.hostId, timeRange: this.timeRange }),
        API.invoke('netops:get-heartbeat', { host_id: this.hostId, count: 60 }),
        API.invoke('netops:get-status-history', { host_id: this.hostId, limit: 50 }),
      ]);
      this.host = detail.host || this.app.hosts.find(h => h.id === this.hostId);
      this.uptime = uptime;
      this.aggregate = agg;
      this.heartbeats = hb.beats || [];
      this.recentChecks = history.history || [];
    } catch (err) {
      console.error('[netops] loadData failed:', err);
    }
  }

  getStatus() {
    const cached = this.app.statusMap.get(this.hostId);
    return cached?.status || this.host?.last_status || 'unknown';
  }

  getLatency() {
    return this.app.statusMap.get(this.hostId)?.latency_ms ?? null;
  }

  // ================================================================
  //  Render
  // ================================================================

  render() {
    if (!this.host) {
      this.container.innerHTML = `<div class="hd-error">Host not found.</div>`;
      return;
    }
    const status = this.getStatus();
    const latency = this.getLatency();
    const uptimePct = this.uptime?.uptime_percent ?? 0;
    const avgCpu = this.aggregate?.system?.avg_cpu_percent;
    const avgMem = this.aggregate?.system?.avg_memory_percent;

    this.container.innerHTML = `
      <div class="hd-wrapper">
        <!-- Header -->
        <div class="hd-nav">
          <button class="hd-back" id="hd-back">\u2190 Hosts</button>
          <div class="hd-header-actions">
            <button class="hd-btn" data-action="ping" title="Ping Now">\u25B6 Ping</button>
            <button class="hd-btn" data-action="disable">${this.host.enabled ? 'Disable' : 'Enable'}</button>
            <button class="hd-btn hd-btn-danger" data-action="remove">Remove</button>
          </div>
        </div>

        <div class="hd-identity">
          <h2 class="hd-hostname">${_hdEsc(this.host.alias || this.host.hostname)}</h2>
          <span class="hd-ip">${_hdEsc(this.host.ip || this.host.hostname)}</span>
          <span class="hd-proto-badge hd-proto-${_hdEsc(this.host.protocol || 'ping')}">${_hdEsc((this.host.protocol || 'tcp').toUpperCase())}</span>
          <span class="hd-badge hd-badge-${status}">${status}</span>
        </div>

        <!-- Protocol detail -->
        ${this._renderProtoDetail()}

        <!-- KPI cards -->
        <div class="hd-kpi-row">
          ${this._kpi('Latency', latency == null ? '\u2014' : `${latency}ms`, 'latency')}
          ${this._kpi('Uptime', `${uptimePct.toFixed(1)}%`, this._uptimeTone(uptimePct))}
          ${avgCpu == null ? '' : this._kpi('Avg CPU', `${avgCpu.toFixed(1)}%`, this._metricTone(avgCpu))}
          ${avgMem == null ? '' : this._kpi('Avg Memory', `${avgMem.toFixed(1)}%`, this._metricTone(avgMem))}
        </div>

        <!-- Heartbeat bar -->
        <div class="hd-heartbeat-section">
          <div class="hd-section-title">Heartbeat <span class="hd-section-sub">(last ${this.heartbeats.length} checks)</span></div>
          <div class="hd-heartbeat-bar" id="hd-heartbeat-bar">
            ${this._renderHeartbeat()}
          </div>
          <div class="hd-heartbeat-axis">${this._renderTimeAxis()}</div>
        </div>

        <!-- Metric sub-tabs -->
        <div class="hd-metrics-section">
          <div class="hd-tabs">
            ${this._tab('response', 'Response Time')}
            ${this._tab('traffic', 'Traffic')}
            ${this._tab('system', 'System')}
            ${this._tab('buffer', 'Buffer')}
          </div>
          <div class="hd-chart-container" id="hd-chart-container">
            <canvas id="hd-chart-canvas"></canvas>
          </div>
        </div>

        <!-- Recent checks log -->
        <div class="hd-checks-section">
          <div class="hd-section-title">Recent Checks</div>
          <div class="hd-checks-scroll">
            <table class="hd-checks-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Status</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>
                ${this.recentChecks.length === 0
                  ? '<tr><td colspan="3" class="hd-checks-empty">No checks recorded yet.</td></tr>'
                  : this.recentChecks.map(c => this._checkRow(c)).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    this._bindEvents();
    this._loadChart();
  }

  _kpi(label, value, tone) {
    return `
      <div class="hd-kpi hd-kpi-${tone}">
        <div class="hd-kpi-value">${value}</div>
        <div class="hd-kpi-label">${label}</div>
      </div>
    `;
  }

  _uptimeTone(pct) {
    if (pct >= 99) return 'good';
    if (pct >= 90) return 'warn';
    return 'bad';
  }

  _metricTone(val) {
    if (val < 70) return 'good';
    if (val < 90) return 'warn';
    return 'bad';
  }

  _renderProtoDetail() {
    const cached = this.app.statusMap.get(this.hostId);
    const detail = cached?.detail;
    if (!detail || Object.keys(detail).length === 0) return '';

    const proto = this.host.protocol || 'tcp';
    const items = this._protoItems(proto, detail);

    if (detail.error) items.push(`<span class="hd-pd-item hd-pd-err">${_hdEsc(detail.error)}</span>`);

    if (items.length === 0) return '';
    return `<div class="hd-proto-detail">${items.join('')}</div>`;
  }

  _protoItems(proto, detail) {
    if (proto === 'http' || proto === 'https') return this._protoHttp(detail);
    if (proto === 'dns') return this._protoDns(detail);
    if (proto === 'icmp' && detail.icmpFallback) return ['<span class="hd-pd-item hd-pd-warn">ICMP unavailable — TCP fallback</span>'];
    if (detail.port) return [`<span class="hd-pd-item">Port: <strong>${detail.port}</strong></span>`];
    return [];
  }

  _protoHttp(detail) {
    const items = [];
    if (detail.status_code != null) items.push(`<span class="hd-pd-item">Status: <strong>${detail.status_code}</strong></span>`);
    if (detail.response_time_ms != null) items.push(`<span class="hd-pd-item">Response: <strong>${detail.response_time_ms}ms</strong></span>`);
    if (detail.cert_expiry_date) items.push(`<span class="hd-pd-item">Cert Expires: <strong>${detail.cert_expiry_date}</strong></span>`);
    if (detail.keyword_found != null) items.push(`<span class="hd-pd-item">Keyword: <strong>${detail.keyword_found ? '✓ found' : '✗ not found'}</strong></span>`);
    return items;
  }

  _protoDns(detail) {
    const items = [];
    if (detail.record_type) items.push(`<span class="hd-pd-item">Record: <strong>${_hdEsc(detail.record_type)}</strong></span>`);
    if (detail.addresses) items.push(`<span class="hd-pd-item">Resolved: <strong>${_hdEsc(detail.addresses.join(', '))}</strong></span>`);
    if (detail.ip_match != null) items.push(`<span class="hd-pd-item">IP Match: <strong>${detail.ip_match ? '✓' : '✗'}</strong></span>`);
    if (detail.resolution_time_ms != null) items.push(`<span class="hd-pd-item">DNS Time: <strong>${detail.resolution_time_ms}ms</strong></span>`);
    return items;
  }

  _tab(id, label) {
    return `<button class="hd-tab${this.activeTab === id ? ' hd-tab-active' : ''}" data-tab="${id}">${label}</button>`;
  }

  _checkRow(check) {
    const time = new Date(check.timestamp);
    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const status = check.status || 'unknown';
    const lat = check.latency_ms == null ? '\u2014' : `${check.latency_ms}ms`;
    return `
      <tr class="hd-check-row">`
        <td class="hd-check-time">${dateStr} ${timeStr}</td>
        <td class="hd-check-status"><span class="hd-dot hd-dot-${status}"></span>${status}</td>
        <td class="hd-check-lat">${lat}</td>
      </tr>
    `;
  }

  // ================================================================
  //  Heartbeat Bar
  // ================================================================

  _renderHeartbeat() {
    if (this.heartbeats.length === 0) return '<div class="hd-hb-empty">No heartbeat data</div>';
    return this.heartbeats.map((b, i) => {
      const cls = b.status === 'online' ? 'up' : (b.status === 'offline' ? 'down' : 'unk');
      const lat = b.latency_ms == null ? '' : `${b.latency_ms}ms`;
      const time = b.timestamp ? new Date(b.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
      return `<div class="hd-hb-seg hd-hb-${cls}" title="${time} ${b.status} ${lat}" data-idx="${i}"></div>`;
    }).join('');
  }

  _renderTimeAxis() {
    if (this.heartbeats.length < 2) return '';
    const first = this.heartbeats[0];
    const last = this.heartbeats.at(-1);
    const fTime = first.timestamp ? new Date(first.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    const lTime = last.timestamp ? new Date(last.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    return `<span>${fTime}</span><span>${lTime}</span>`;
  }

  // ================================================================
  //  Charts (lazy per sub-tab)
  // ================================================================

  async _loadChart() {
    this._destroyChart();
    const canvas = this.container.querySelector('#hd-chart-canvas');
    if (!canvas || !globalThis.Chart) return;

    try {
      switch (this.activeTab) {
        case 'response': await this._chartResponse(canvas); break;
        case 'traffic':  await this._chartTraffic(canvas);  break;
        case 'system':   await this._chartSystem(canvas);   break;
        case 'buffer':   await this._chartBuffer(canvas);   break;
      }
    } catch (err) {
      console.error('[netops] chart error:', err);
    }
  }

  async _chartResponse(canvas) {
    const { history } = await API.invoke('netops:get-status-history', {
      host_id: this.hostId, limit: 100
    });
    const pts = (history || []).reverse();
    const labels = pts.map(p => _hdTimeLabel(p.timestamp));
    const data = pts.map(p => p.latency_ms ?? null);

    const colors = globalThis.getThemeColors ? getThemeColors() : {};
    this.chart = new globalThis.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Latency (ms)',
          data,
          borderColor: colors.accent || '#2dd4bf',
          backgroundColor: `rgba(45, 212, 191, 0.1)`,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
        }]
      },
      options: this._chartOpts(colors, { yLabel: 'ms' }),
    });
  }

  async _chartTraffic(canvas) {
    const res = await API.invoke('netops:get-network-metrics', {
      host_id: this.hostId, timeRange: this.timeRange
    });
    const metrics = res.metrics || [];
    const labels = metrics.map(m => _hdTimeLabel(m.timestamp));
    const data = {
      labels,
      trafficIn: metrics.map(m => m.traffic_in_mb),
      trafficOut: metrics.map(m => m.traffic_out_mb),
    };
    this.chart = globalThis.createTrafficChart(canvas, data);
  }

  async _chartSystem(canvas) {
    const res = await API.invoke('netops:get-system-metrics', {
      host_id: this.hostId, timeRange: this.timeRange
    });
    const metrics = res.metrics || [];
    const labels = metrics.map(m => _hdTimeLabel(m.timestamp));
    const colors = globalThis.getThemeColors ? getThemeColors() : {};

    this.chart = new globalThis.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'CPU %',
            data: metrics.map(m => m.cpu_percent),
            borderColor: colors.accent || '#2dd4bf',
            backgroundColor: 'rgba(45, 212, 191, 0.1)',
            tension: 0.3, borderWidth: 2, pointRadius: 0, fill: true,
          },
          {
            label: 'Memory %',
            data: metrics.map(m => m.memory_percent),
            borderColor: '#06b6d4',
            backgroundColor: 'rgba(6, 182, 212, 0.1)',
            tension: 0.3, borderWidth: 2, pointRadius: 0, fill: true,
          },
        ]
      },
      options: this._chartOpts(colors, { yMax: 100, yLabel: '%' }),
    });
  }

  async _chartBuffer(canvas) {
    const res = await API.invoke('netops:get-buffer-metrics', {
      host_id: this.hostId, timeRange: this.timeRange
    });
    const metrics = res.metrics || [];
    const labels = metrics.map(m => _hdTimeLabel(m.timestamp));
    const colors = globalThis.getThemeColors ? getThemeColors() : {};

    this.chart = new globalThis.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Hit Rate %',
          data: metrics.map(m => m.hit_rate),
          borderColor: colors.success || '#4ade80',
          backgroundColor: 'rgba(74, 222, 128, 0.1)',
          tension: 0.3, borderWidth: 2, pointRadius: 0, fill: true,
        }]
      },
      options: this._chartOpts(colors, { yMax: 100, yLabel: '%' }),
    });
  }

  _chartOpts(colors, { yMax, yLabel } = {}) {
    const textColor = colors.textDim || '#a0a0a0';
    const borderColor = colors.border || '#3a3a3a';
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: colors.text || '#e0e0e0', usePointStyle: true } },
        tooltip: {
          mode: 'index', intersect: false,
          backgroundColor: colors.surface || '#1a1a1a',
          titleColor: colors.text || '#e0e0e0',
          bodyColor: colors.text || '#e0e0e0',
          borderColor, borderWidth: 1,
        },
      },
      scales: {
        y: {
          min: 0,
          ...(yMax ? { max: yMax } : { grace: '10%' }),
          ticks: { color: textColor },
          grid: { color: `rgba(${globalThis.hexToRgb ? hexToRgb(borderColor) : '58,58,58'}, 0.3)` },
        },
        x: {
          ticks: { color: textColor, maxTicksLimit: 12 },
          grid: { color: `rgba(${globalThis.hexToRgb ? hexToRgb(borderColor) : '58,58,58'}, 0.3)` },
        },
      },
    };
  }

  _destroyChart() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  // ================================================================
  //  Live updates
  // ================================================================

  setupLiveUpdates() {
    const unsub = API.on('netops:status-update', async (data) => {
      if (data.host_id !== this.hostId) return;
      this._updateHeader();
      // Append heartbeat
      this.heartbeats.push({
        status: data.status,
        latency_ms: data.latency_ms,
        timestamp: data.timestamp,
      });
      if (this.heartbeats.length > 60) this.heartbeats.shift();
      const bar = this.container.querySelector('#hd-heartbeat-bar');
      if (bar) bar.innerHTML = this._renderHeartbeat();
      // Refresh uptime KPI
      try {
        const res = await API.invoke('netops:get-uptime-stats', { host_id: this.hostId, timeRange: this.timeRange });
        this.uptime = res;
        // Find the uptime KPI specifically by checking the label
        this.container.querySelectorAll('.hd-kpi').forEach(kpi => {
          const label = kpi.querySelector('.hd-kpi-label');
          if (label?.textContent === 'Uptime') {
            const valEl = kpi.querySelector('.hd-kpi-value');
            if (valEl) valEl.textContent = `${(res.uptime_percent ?? 0).toFixed(1)}%`;
          }
        });
      } catch { /* ignore */ }
    });
    this.unsubscribes.push(unsub);
  }

  _updateHeader() {
    const status = this.getStatus();
    const latency = this.getLatency();
    const badge = this.container.querySelector('.hd-badge');
    if (badge) {
      badge.className = `hd-badge hd-badge-${status}`;
      badge.textContent = status;
    }
    const kpiLat = this.container.querySelector('.hd-kpi-latency .hd-kpi-value');
    if (kpiLat) kpiLat.textContent = latency == null ? '\u2014' : `${latency}ms`;
  }

  // ================================================================
  //  Actions & Events
  // ================================================================

  _bindEvents() {
    // Back button
    const backBtn = this.container.querySelector('#hd-back');
    if (backBtn) backBtn.addEventListener('click', () => this.app.navigateTo('hosts'));

    // Action buttons
    this.container.querySelectorAll('.hd-btn[data-action]').forEach(btn => {
      btn.addEventListener('click', () => this._handleAction(btn.dataset.action));
    });

    // Metric sub-tabs
    this.container.querySelectorAll('.hd-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.dataset.tab === this.activeTab) return;
        this.activeTab = tab.dataset.tab;
        this.container.querySelectorAll('.hd-tab').forEach(t =>
          t.classList.toggle('hd-tab-active', t.dataset.tab === this.activeTab)
        );
        this._loadChart();
      });
    });

    // Time range change
    const sel = this.app.container.querySelector('.toolbar-time-range');
    if (sel) {
      this._timeHandler = () => {
        this.timeRange = sel.value;
        this._loadChart();
      };
      sel.addEventListener('change', this._timeHandler);
    }
  }

  async _handleAction(action) {
    if (!this.host) return;
    switch (action) {
      case 'ping':    return this._actionPing();
      case 'disable': return this._actionToggle();
      case 'remove':  return this._actionRemove();
    }
  }

  async _actionPing() {
    try {
      const result = await API.invoke('netops:ping-host', { hostname: this.host.hostname, host_id: this.hostId });
      const s = result.success ? 'online' : 'offline';
      const lat = result.latency ? ` ${result.latency}ms` : '';
      globalThis.ui.showNotification(`${this.host.hostname}: ${s}${lat}`, result.success ? 'success' : 'warning');
    } catch (err) {
      globalThis.ui.showNotification(`Ping failed: ${err.message}`, 'error');
    }
  }

  async _actionToggle() {
    const newEnabled = this.host.enabled ? 0 : 1;
    await API.invoke('netops:update-host-config', { host_id: this.hostId, enabled: newEnabled });
    this.host.enabled = newEnabled;
    globalThis.ui.showNotification(`${this.host.hostname} ${newEnabled ? 'enabled' : 'disabled'}.`, 'info');
    this.render();
  }

  async _actionRemove() {
    if (!confirm(`Remove "${this.host.alias || this.host.hostname}"? This cannot be undone.`)) return;
    await API.invoke('netops:remove-host', { host_id: this.hostId });
    await this.app.loadHosts();
    globalThis.ui.showNotification(`${this.host.hostname} removed.`, 'success');
    this.app.navigateTo('hosts');
  }

  // ================================================================
  //  Cleanup
  // ================================================================

  destroy() {
    this._destroyChart();
    this.unsubscribes.forEach(fn => { if (typeof fn === 'function') fn(); });

    const sel = this.app.container.querySelector('.toolbar-time-range');
    if (sel && this._timeHandler) sel.removeEventListener('change', this._timeHandler);
  }
}

// --- Helpers ---

function _hdEsc(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text || '').replaceAll(/[&<>"']/g, c => map[c]);
}

function _hdTimeLabel(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
