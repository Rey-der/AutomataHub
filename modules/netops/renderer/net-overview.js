/**
 * NetOverview — at-a-glance health dashboard for NetOps Monitor.
 * KPI tiles, heartbeat bars (Uptime Kuma style), and recent event feed.
 * Mounted/destroyed by NetApp's view router.
 */

class NetOverview {
  constructor(app) {
    this.app = app;          // NetApp parent — provides hosts, statusMap, navigateTo
    this.events = [];
    this.heartbeats = {};    // keyed by host_id
    this.unsubscribes = [];
    this.refreshInterval = null;
  }

  async init(container) {
    this.container = container;
    this.renderSkeleton();
    await this.loadData();
    this.render();
    this.setupLiveUpdates();
    this.refreshInterval = setInterval(() => this.refresh(), 30000);
  }

  // ================================================================
  //  Data Loading
  // ================================================================

  async loadData() {
    await Promise.all([
      this.loadEvents(),
      this.loadHeartbeats(),
    ]);
  }

  async loadEvents() {
    try {
      const res = await API.invoke('netops:get-recent-events', { limit: 10 });
      this.events = res.events || [];
    } catch (err) {
      console.error('[net-overview] Failed to load events:', err);
    }
  }

  async loadHeartbeats() {
    const hosts = this.app.hosts;
    const results = await Promise.allSettled(
      hosts.map(h => API.invoke('netops:get-heartbeat', { host_id: h.id, count: 30 }))
    );
    results.forEach((r, i) => {
      this.heartbeats[hosts[i].id] = r.status === 'fulfilled' ? (r.value.beats || []) : [];
    });
  }

  async refresh() {
    await this.app.loadHosts();
    await this.loadData();
    this.render();
  }

  // ================================================================
  //  Live Updates
  // ================================================================

  setupLiveUpdates() {
    // Push new heartbeat segment on status-update
    const unsub1 = API.on('netops:status-update', (data) => {
      const beats = this.heartbeats[data.host_id] || [];
      beats.push({ status: data.status, latency_ms: data.latency_ms, timestamp: data.timestamp });
      while (beats.length > 30) beats.shift();
      this.heartbeats[data.host_id] = beats;
      this.updateKPIs();
      this.updateHeartbeatRow(data.host_id);
    });
    this.unsubscribes.push(unsub1);

    // Prepend new event to feed on status-change
    const unsub2 = API.on('netops:status-change', (data) => {
      this.events.unshift(data);
      if (this.events.length > 10) this.events.length = 10;
      this.renderEventFeed();
      this.updateKPIs();
    });
    this.unsubscribes.push(unsub2);
  }

  // ================================================================
  //  Computed Values
  // ================================================================

  getKPIs() {
    const hosts = this.app.hosts;
    const sm = this.app.statusMap;
    let online = 0, offline = 0, unknown = 0, totalLatency = 0, latencyCount = 0;

    hosts.forEach(h => {
      const cached = sm.get(h.id);
      const status = cached?.status || h.last_status || 'unknown';
      if (status === 'online') online++;
      else if (status === 'offline') offline++;
      else unknown++;

      const lat = cached?.latency_ms;
      if (lat != null) { totalLatency += lat; latencyCount++; }
    });

    const total = hosts.length || 1;
    const uptimePercent = ((online / total) * 100).toFixed(1);
    const avgLatency = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0;

    // Alerts: events within last hour
    const oneHourAgo = Date.now() - 3_600_000;
    const alertCount = this.events.filter(e => new Date(e.timestamp).getTime() > oneHourAgo).length;

    return { uptimePercent, online, offline, unknown, avgLatency, alertCount };
  }

  // ================================================================
  //  Render
  // ================================================================

  renderSkeleton() {
    this.container.innerHTML = `
      <div class="overview">
        <div class="overview-kpis" id="ov-kpis">
          ${Array(5).fill('<div class="kpi-tile skeleton"></div>').join('')}
        </div>
        <section class="overview-section">
          <h3>Hosts at a Glance</h3>
          <div id="ov-heartbeats" class="heartbeat-list"><span class="text-muted">Loading&#8230;</span></div>
        </section>
        <section class="overview-section">
          <h3>Recent Events</h3>
          <div id="ov-events" class="event-feed"><span class="text-muted">Loading&#8230;</span></div>
        </section>
      </div>
    `;
  }

  render() {
    this.renderKPIs();
    this.renderHeartbeats();
    this.renderEventFeed();
  }

  // --- KPI Tiles ---

  renderKPIs() {
    const el = this.container.querySelector('#ov-kpis');
    if (!el) return;
    const k = this.getKPIs();
    el.innerHTML = `
      <div class="kpi-tile">
        <span class="kpi-value">${k.uptimePercent}<small>%</small></span>
        <span class="kpi-label">Uptime</span>
      </div>
      <div class="kpi-tile kpi-online">
        <span class="kpi-value">${k.online}</span>
        <span class="kpi-label">Online</span>
      </div>
      <div class="kpi-tile kpi-offline">
        <span class="kpi-value">${k.offline}</span>
        <span class="kpi-label">Offline</span>
      </div>
      <div class="kpi-tile">
        <span class="kpi-value">${k.avgLatency}<small>ms</small></span>
        <span class="kpi-label">Avg Latency</span>
      </div>
      <div class="kpi-tile kpi-alerts">
        <span class="kpi-value">${k.alertCount}</span>
        <span class="kpi-label">Alerts (1h)</span>
      </div>
    `;
  }

  updateKPIs() {
    this.renderKPIs();
  }

  // --- Heartbeat Bars ---

  renderHeartbeats() {
    const el = this.container.querySelector('#ov-heartbeats');
    if (!el) return;
    const hosts = this.app.hosts;

    if (hosts.length === 0) {
      el.innerHTML = `<div class="ov-empty-cta"><span class="ov-empty-icon">\u229a</span><p>No hosts monitored yet</p><button class="ov-empty-add-btn" id="ov-empty-add">+ Add your first host</button></div>`;
      const addBtn = el.querySelector('#ov-empty-add');
      if (addBtn) addBtn.addEventListener('click', () => this.app.navigateTo('hosts'));
      return;
    }

    el.innerHTML = hosts.map(h => this._heartbeatRow(h)).join('');
    this._bindHeartbeatClicks(el);
  }

  updateHeartbeatRow(hostId) {
    const row = this.container.querySelector(`[data-hb-host="${hostId}"]`);
    if (!row) return;
    const host = this.app.hosts.find(h => h.id === hostId);
    if (!host) return;
    row.outerHTML = this._heartbeatRow(host);
    // Re-bind click for just-replaced row
    const newRow = this.container.querySelector(`[data-hb-host="${hostId}"]`);
    if (newRow) {
      newRow.querySelector('.hb-hostname')?.addEventListener('click', () => {
        this.app.navigateTo('host-detail', hostId);
      });
    }
  }

  _heartbeatRow(host) {
    const beats = this.heartbeats[host.id] || [];
    const segments = [];
    const TOTAL = 30;

    // Pad from the left with empty segments if we have fewer than 30
    const padCount = Math.max(0, TOTAL - beats.length);
    for (let i = 0; i < padCount; i++) {
      segments.push('<span class="hb-seg hb-none" title="No data"></span>');
    }

    for (const b of beats) {
      const cls = b.status === 'online' ? 'hb-up' : b.status === 'offline' ? 'hb-down' : 'hb-none';
      const latStr = b.latency_ms != null ? `${b.latency_ms}ms` : '\u2014';
      const time = new Date(b.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const title = `${time} \u2022 ${b.status} \u2022 ${latStr}`;
      segments.push(`<span class="hb-seg ${cls}" title="${_escAttr(title)}"></span>`);
    }

    const displayName = _escHtml(host.alias || host.hostname);

    return `
      <div class="hb-row" data-hb-host="${host.id}">
        <span class="hb-hostname" role="button" tabindex="0">${displayName}</span>
        <span class="hb-bar">${segments.join('')}</span>
      </div>
    `;
  }

  _bindHeartbeatClicks(el) {
    el.querySelectorAll('.hb-hostname').forEach(span => {
      const hostId = Number(span.closest('.hb-row').dataset.hbHost);
      span.addEventListener('click', () => this.app.navigateTo('host-detail', hostId));
    });
  }

  // --- Recent Events Feed ---

  renderEventFeed() {
    const el = this.container.querySelector('#ov-events');
    if (!el) return;

    if (this.events.length === 0) {
      el.innerHTML = '<div class="text-muted">No status changes recorded yet.</div>';
      return;
    }

    el.innerHTML = this.events.map(ev => {
      const time = new Date(ev.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const name = _escHtml(ev.hostname || `Host #${ev.host_id}`);
      return `
        <div class="event-row" data-ev-host="${ev.host_id}" role="button" tabindex="0">
          <span class="ev-time">${time}</span>
          <span class="ev-host">${name}</span>
          <span class="ev-transition">
            <span class="ev-dot ev-${ev.old_status}"></span>${ev.old_status}
            <span class="ev-arrow">\u2192</span>
            <span class="ev-dot ev-${ev.new_status}"></span>${ev.new_status}
          </span>
        </div>
      `;
    }).join('');

    el.querySelectorAll('.event-row').forEach(row => {
      row.addEventListener('click', () => {
        this.app.navigateTo('host-detail', Number(row.dataset.evHost));
      });
    });
  }

  // ================================================================
  //  Cleanup
  // ================================================================

  destroy() {
    this.unsubscribes.forEach(fn => { if (typeof fn === 'function') fn(); });
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }
}

// --- Helpers (module-scoped) ---

function _escHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text || '').replace(/[&<>"']/g, c => map[c]);
}

function _escAttr(text) {
  return _escHtml(text).replace(/\n/g, ' ');
}
