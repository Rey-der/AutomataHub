/**
 * NetHistory — Phase 6: uptime analysis, Datadog-style timeline, event log.
 * Mounted/destroyed by NetApp's view router.
 */

class NetHistory {
  constructor(app) {
    this.app = app;
    this.filterHost = 'all';
    this.filterRange = '24h';
    this.uptimeData = [];
    this.timelineData = [];
    this.events = [];
    this.eventOffset = 0;
    this.eventPageSize = 50;
    this.hasMoreEvents = true;
    this.unsubscribes = [];
  }

  async init(container) {
    this.container = container;
    const sel = this.app.container.querySelector('.toolbar-time-range');
    if (sel) this.filterRange = sel.value;
    this._renderSkeleton();
    await this.loadAll();
    this.render();
    this._setupLiveEvents();
  }

  _renderSkeleton() {
    this.container.innerHTML = `
      <div class="hist-wrapper">
        <div class="hist-filters"><div class="skeleton skeleton-text" style="width:160px;height:32px"></div><div class="skeleton skeleton-text" style="width:160px;height:32px"></div></div>
        <div class="hist-section"><div class="skeleton skeleton-row" style="height:18px;margin:8px 0"></div><div class="skeleton skeleton-row" style="height:18px;margin:8px 0"></div><div class="skeleton skeleton-row" style="height:18px;margin:8px 0"></div></div>
        <div class="hist-section"><div class="skeleton skeleton-block" style="height:120px"></div></div>
      </div>
    `;
  }

  /* ── Data loading ─────────────────────────────────────────────── */

  async loadAll() {
    await this.app.loadHosts();
    await Promise.all([this.loadUptime(), this.loadTimeline(), this.loadEvents(true)]);
  }

  async loadUptime() {
    const hosts = this._filteredHosts();
    const results = await Promise.allSettled(
      hosts.map(h => API.invoke('netops:get-uptime-stats', { host_id: h.id, timeRange: this.filterRange }))
    );
    this.uptimeData = hosts.map((h, i) => {
      const r = results[i];
      const d = r.status === 'fulfilled' ? r.value : {};
      return { host: h, uptime_percent: d.uptime_percent ?? 0, total_checks: d.total_checks ?? 0, online_checks: d.online_checks ?? 0 };
    }).sort((a, b) => a.uptime_percent - b.uptime_percent);
  }

  async loadTimeline() {
    const hosts = this._filteredHosts();
    const limit = this.filterRange === '30d' ? 500 : this.filterRange === '7d' ? 300 : 150;
    const results = await Promise.allSettled(
      hosts.map(h => API.invoke('netops:get-status-history', { host_id: h.id, limit }))
    );
    this.timelineData = hosts.map((h, i) => {
      const r = results[i];
      const history = (r.status === 'fulfilled' ? r.value.history : []) || [];
      return { host: h, segments: this._buildSegments(history) };
    });
  }

  async loadEvents(reset) {
    if (reset) { this.events = []; this.eventOffset = 0; this.hasMoreEvents = true; }
    try {
      const res = await API.invoke('netops:get-recent-events', { limit: 500 });
      let all = res.events || [];
      if (this.filterHost !== 'all') {
        all = all.filter(e => e.host_id === Number(this.filterHost));
      }
      const cutoff = Date.now() - _histRangeMs(this.filterRange);
      all = all.filter(e => new Date(e.timestamp).getTime() > cutoff);
      this.events = all;
      this.hasMoreEvents = false;
    } catch (err) {
      console.error('[netops] loadEvents:', err);
    }
  }

  _filteredHosts() {
    if (this.filterHost === 'all') return this.app.hosts;
    const id = Number(this.filterHost);
    return this.app.hosts.filter(h => h.id === id);
  }

  /* ── Timeline segment builder ─────────────────────────────────── */

  _buildSegments(history) {
    if (!history || history.length === 0) return [];
    const sorted = [...history].reverse();
    const segments = [];
    let cur = { status: sorted[0].status, start: sorted[0].timestamp, end: sorted[0].timestamp };
    for (let i = 1; i < sorted.length; i++) {
      const entry = sorted[i];
      if (entry.status === cur.status) {
        cur.end = entry.timestamp;
      } else {
        segments.push({ ...cur });
        cur = { status: entry.status, start: entry.timestamp, end: entry.timestamp };
      }
    }
    segments.push({ ...cur });
    return segments;
  }

  /* ── Render ────────────────────────────────────────────────────── */

  render() {
    this.container.innerHTML = `
      <div class="hist-wrapper">
        <!-- Filters -->
        <div class="hist-filters">
          <label class="hist-filter">
            <span>Host</span>
            <select class="hist-host-select" id="hist-host-select">
              <option value="all"${this.filterHost === 'all' ? ' selected' : ''}>All Hosts</option>
              ${this.app.hosts.map(h => `<option value="${h.id}"${this.filterHost == h.id ? ' selected' : ''}>${_histEsc(h.alias || h.hostname)}</option>`).join('')}
            </select>
          </label>
          <label class="hist-filter">
            <span>Time Range</span>
            <select class="hist-range-select" id="hist-range-select">
              <option value="24h"${this.filterRange === '24h' ? ' selected' : ''}>Last 24h</option>
              <option value="7d"${this.filterRange === '7d' ? ' selected' : ''}>Last 7 Days</option>
              <option value="30d"${this.filterRange === '30d' ? ' selected' : ''}>Last 30 Days</option>
            </select>
          </label>
        </div>

        <!-- Uptime bars -->
        <div class="hist-section">
          <div class="hist-section-title">Uptime Overview</div>
          ${this.uptimeData.length === 0
            ? '<p class="hist-empty">No uptime data available.</p>'
            : this.uptimeData.map(d => this._renderUptimeBar(d)).join('')}
        </div>

        <!-- Status timeline -->
        <div class="hist-section">
          <div class="hist-section-title">Status Timeline</div>
          ${this.timelineData.length === 0
            ? '<p class="hist-empty">No timeline data available.</p>'
            : `<div class="hist-timeline">${this.timelineData.map(d => this._renderTimelineRow(d)).join('')}</div>`}
        </div>

        <!-- Event log -->
        <div class="hist-section">
          <div class="hist-section-title">Event Log <span class="hist-event-count">${this.events.length} event${this.events.length !== 1 ? 's' : ''}</span></div>
          <div class="hist-events-wrap">
            <table class="hist-event-table">
              <thead>
                <tr>
                  <th>Date / Time</th>
                  <th>Host</th>
                  <th>Transition</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody id="hist-event-body">
                ${this._visibleEvents().length === 0
                  ? '<tr><td colspan="4" class="hist-empty">No events recorded.</td></tr>'
                  : this._visibleEvents().map(e => this._renderEventRow(e)).join('')}
              </tbody>
            </table>
            ${this._renderLoadMore()}
          </div>
          <div class="hist-export-row">
            <button class="hist-export-btn" id="hist-export-btn">\u2B73 Export CSV</button>
          </div>
        </div>
      </div>
    `;
    this._bindEvents();
  }

  /* ── Uptime bar ─────────────────────────────────────────────── */

  _renderUptimeBar(d) {
    const pct = d.uptime_percent;
    const tone = pct >= 99 ? 'good' : pct >= 90 ? 'warn' : 'bad';
    return `
      <div class="hist-uptime-row" data-host-id="${d.host.id}">
        <span class="hist-uptime-name">${_histEsc(d.host.alias || d.host.hostname)}</span>
        <div class="hist-uptime-bar-track">
          <div class="hist-uptime-bar-fill hist-uptime-${tone}" style="width:${pct}%"></div>
        </div>
        <span class="hist-uptime-pct hist-uptime-${tone}">${pct.toFixed(1)}%</span>
      </div>
    `;
  }

  /* ── Timeline ───────────────────────────────────────────────── */

  _renderTimelineRow(d) {
    const rangeMs = _histRangeMs(this.filterRange);
    const rangeStart = Date.now() - rangeMs;
    const rangeEnd = Date.now();

    const blocks = d.segments.map(seg => {
      const segStart = Math.max(new Date(seg.start).getTime(), rangeStart);
      const segEnd = Math.min(new Date(seg.end).getTime(), rangeEnd);
      if (segEnd <= segStart) return '';
      const left = ((segStart - rangeStart) / rangeMs) * 100;
      const width = ((segEnd - segStart) / rangeMs) * 100;
      const durStr = _histDuration(segEnd - segStart);
      const timeStr = new Date(segStart).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<div class="hist-tl-block hist-tl-${seg.status}" style="left:${left}%;width:${Math.max(width, 0.3)}%" title="${seg.status} \u2014 ${timeStr} (${durStr})"></div>`;
    }).join('');

    return `
      <div class="hist-tl-row" data-host-id="${d.host.id}">
        <span class="hist-tl-label">${_histEsc(d.host.alias || d.host.hostname)}</span>
        <div class="hist-tl-track">${blocks}</div>
      </div>
    `;
  }

  /* ── Event log ──────────────────────────────────────────────── */

  _visibleEvents() {
    return this.events.slice(0, this.eventOffset + this.eventPageSize);
  }

  _renderEventRow(evt) {
    const time = new Date(evt.timestamp);
    const dateStr = time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const timeStr = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const host = this.app.hosts.find(h => h.id === evt.host_id);
    const name = host ? (host.alias || host.hostname) : `Host #${evt.host_id}`;
    const lat = evt.latency_ms != null ? `${evt.latency_ms}ms` : '\u2014';

    return `
      <tr class="hist-evt-row" data-host-id="${evt.host_id}">
        <td class="hist-evt-time">${dateStr} ${timeStr}</td>
        <td class="hist-evt-host">${_histEsc(name)}</td>
        <td class="hist-evt-transition">
          <span class="hist-dot hist-dot-${evt.old_status}"></span>${evt.old_status}
          <span class="hist-arrow">\u2192</span>
          <span class="hist-dot hist-dot-${evt.new_status}"></span>${evt.new_status}
        </td>
        <td class="hist-evt-lat">${lat}</td>
      </tr>
    `;
  }

  _renderLoadMore() {
    const shown = this._visibleEvents().length;
    if (shown >= this.events.length) return '';
    return `<button class="hist-load-more" id="hist-load-more">Load More (${this.events.length - shown} remaining)</button>`;
  }

  /* ── Export CSV ──────────────────────────────────────────────── */

  exportCSV() {
    const header = 'Timestamp,Hostname,IP,Old Status,New Status,Latency (ms)';
    const rows = this.events.map(evt => {
      const host = this.app.hosts.find(h => h.id === evt.host_id);
      const name = host ? (host.alias || host.hostname) : '';
      const ip = host ? (host.ip || host.hostname) : '';
      const lat = evt.latency_ms ?? '';
      return `"${evt.timestamp}","${name}","${ip}","${evt.old_status}","${evt.new_status}","${lat}"`;
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `netops-events-${this.filterRange}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    window.ui.showNotification(`Exported ${this.events.length} events to CSV.`, 'success');
  }

  /* ── Live events ────────────────────────────────────────────── */

  _setupLiveEvents() {
    const unsub = API.on('netops:status-change', (evt) => {
      if (this.filterHost !== 'all' && evt.host_id !== Number(this.filterHost)) return;
      const cutoff = Date.now() - _histRangeMs(this.filterRange);
      if (new Date(evt.timestamp).getTime() < cutoff) return;

      this.events.unshift(evt);

      const body = this.container.querySelector('#hist-event-body');
      if (body) {
        const emptyRow = body.querySelector('.hist-empty');
        if (emptyRow) emptyRow.closest('tr').remove();
        const temp = document.createElement('tbody');
        temp.innerHTML = this._renderEventRow(evt);
        const tr = temp.firstElementChild;
        if (tr) {
          tr.classList.add('hist-evt-flash');
          body.prepend(tr);
        }
      }
    });
    this.unsubscribes.push(unsub);
  }

  /* ── Event binding ──────────────────────────────────────────── */

  _bindEvents() {
    const hostSel = this.container.querySelector('#hist-host-select');
    if (hostSel) {
      hostSel.addEventListener('change', () => { this.filterHost = hostSel.value; this._reload(); });
    }

    const rangeSel = this.container.querySelector('#hist-range-select');
    if (rangeSel) {
      rangeSel.addEventListener('change', () => { this.filterRange = rangeSel.value; this._reload(); });
    }

    const loadBtn = this.container.querySelector('#hist-load-more');
    if (loadBtn) {
      loadBtn.addEventListener('click', () => { this.eventOffset += this.eventPageSize; this.render(); });
    }

    const exportBtn = this.container.querySelector('#hist-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportCSV());
    }

    this.container.querySelectorAll('.hist-tl-row[data-host-id]').forEach(row => {
      row.addEventListener('click', () => this.app.navigateTo('host-detail', Number(row.dataset.hostId)));
    });

    this.container.querySelectorAll('.hist-uptime-row[data-host-id]').forEach(row => {
      row.addEventListener('click', () => this.app.navigateTo('host-detail', Number(row.dataset.hostId)));
    });
  }

  async _reload() {
    await this.loadAll();
    this.render();
  }

  /* ── Cleanup ────────────────────────────────────────────────── */

  destroy() {
    this.unsubscribes.forEach(fn => { if (typeof fn === 'function') fn(); });
  }
}

/* ── Helpers ──────────────────────────────────────────────────── */

function _histEsc(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text || '').replace(/[&<>"']/g, c => map[c]);
}

function _histRangeMs(range) {
  const map = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
  return map[range] || map['24h'];
}

function _histDuration(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  if (ms < 86400000) {
    const h = Math.floor(ms / 3600000);
    const m = Math.round((ms % 3600000) / 60000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(ms / 86400000);
  const h = Math.round((ms % 86400000) / 3600000);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}
