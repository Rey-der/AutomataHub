/**
 * SensorOverview — dashboard overview with stats cards and recent readings.
 */
(function () {
  class SensorOverview {
    constructor(app) {
      this.app = app;
      this.container = null;
      this.unsubscribes = [];
      this.refreshInterval = null;
    }

    async init(container) {
      this.container = container;
      this.render();
      await this.loadData();
      this.setupLiveUpdates();
      this.refreshInterval = setInterval(() => this.loadData(), 15000);
    }

    setupLiveUpdates() {
      const unsub = globalThis.api.on('sensor-monitor:sensor-updated', () => {
        this.loadData();
      });
      this.unsubscribes.push(unsub);

      const unsub2 = globalThis.api.on('sensor-monitor:sensor-alert', (data) => {
        if (globalThis.ui) {
          globalThis.ui.showNotification(data.alert.message, 'warning', 5000);
        }
      });
      this.unsubscribes.push(unsub2);
    }

    async loadData() {
      try {
        const stats = await globalThis.api.invoke('sensor-monitor:get-dashboard-stats');
        const result = await globalThis.api.invoke('sensor-monitor:get-sensors');
        this.renderStats(stats);
        this.renderSensorGrid(result.sensors || []);
      } catch (err) {
        console.error('[sensor-monitor] Overview load error:', err);
      }
    }

    render() {
      this.container.innerHTML = `
        <div class="sm-overview">
          <div class="sm-stats-row" id="sm-stats-row"></div>
          <div class="sm-section">
            <div class="sm-section-header">
              <h3>Sensor Readings</h3>
              <button class="btn btn-sm sm-btn-discover" id="sm-btn-discover">Discover Sensors</button>
            </div>
            <div class="sm-sensor-grid" id="sm-sensor-grid">
              <div class="sm-empty">Loading sensors...</div>
            </div>
          </div>
        </div>
      `;
      const discoverBtn = this.container.querySelector('#sm-btn-discover');
      if (discoverBtn) {
        discoverBtn.addEventListener('click', () => this.app.navigateTo('discover'));
      }
    }

    renderStats(stats) {
      const row = this.container.querySelector('#sm-stats-row');
      if (!row) return;
      row.innerHTML = `
        <div class="sm-stat-card">
          <span class="sm-stat-value">${stats.total}</span>
          <span class="sm-stat-label">Total Sensors</span>
        </div>
        <div class="sm-stat-card sm-stat-online">
          <span class="sm-stat-value">${stats.online}</span>
          <span class="sm-stat-label">Online</span>
        </div>
        <div class="sm-stat-card sm-stat-offline">
          <span class="sm-stat-value">${stats.offline}</span>
          <span class="sm-stat-label">Offline</span>
        </div>
        <div class="sm-stat-card sm-stat-warning">
          <span class="sm-stat-value">${stats.warning}</span>
          <span class="sm-stat-label">Warning</span>
        </div>
        <div class="sm-stat-card sm-stat-alert">
          <span class="sm-stat-value">${stats.active_alerts}</span>
          <span class="sm-stat-label">Active Alerts</span>
        </div>
      `;
    }

    renderSensorGrid(sensors) {
      const grid = this.container.querySelector('#sm-sensor-grid');
      if (!grid) return;
      if (sensors.length === 0) {
        grid.innerHTML = '<div class="sm-empty">No sensors configured. Use Discover to find sensors on your network.</div>';
        return;
      }

      grid.innerHTML = sensors.map((s) => `
        <div class="sm-sensor-card" data-id="${s.id}">
          <div class="sm-sensor-card-header">
            <span class="sm-status-dot sm-status-${s.status}"></span>
            <span class="sm-sensor-name">${this._esc(s.name)}</span>
            <span class="sm-sensor-type">${this._esc(s.type)}</span>
          </div>
          <div class="sm-sensor-card-body">
            <span class="sm-sensor-value">${s.last_value !== null && s.last_value !== undefined ? s.last_value : '--'}</span>
            <span class="sm-sensor-unit">${this._esc(s.unit)}</span>
          </div>
          <div class="sm-sensor-card-footer">
            <span class="sm-sensor-host">${this._esc(s.host)}</span>
            <span class="sm-sensor-protocol">${this._esc(s.protocol)}</span>
          </div>
        </div>
      `).join('');

      grid.querySelectorAll('.sm-sensor-card').forEach((card) => {
        card.addEventListener('click', () => {
          this.app.navigateTo('detail', { sensorId: card.dataset.id });
        });
      });
    }

    _esc(str) {
      const el = document.createElement('span');
      el.textContent = str || '';
      return el.innerHTML;
    }

    destroy() {
      this.unsubscribes.forEach((fn) => { if (typeof fn === 'function') fn(); });
      if (this.refreshInterval) clearInterval(this.refreshInterval);
    }
  }

  globalThis.SensorOverview = SensorOverview;
})();
