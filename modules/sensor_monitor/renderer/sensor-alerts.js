/**
 * SensorAlerts — alert log and management view.
 */
(function () {
  class SensorAlerts {
    constructor(app) {
      this.app = app;
      this.container = null;
      this.alerts = [];
      this.showAcknowledged = false;
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
      const unsub = globalThis.api.on('sensor-monitor:sensor-alert', () => this.loadData());
      this.unsubscribes.push(unsub);
    }

    async loadData() {
      try {
        const result = await globalThis.api.invoke('sensor-monitor:get-alerts', {
          unacknowledged: !this.showAcknowledged,
          limit: 200,
        });
        this.alerts = result.alerts || [];
        this.renderAlerts();
        this.renderCount(result.active_count || 0);
      } catch (err) {
        console.error('[sensor-monitor] Alerts load error:', err);
      }
    }

    render() {
      this.container.innerHTML = `
        <div class="sm-alerts-view">
          <div class="sm-alerts-toolbar">
            <h3>Alerts <span class="sm-alert-count" id="sm-alert-count"></span></h3>
            <label class="sm-toggle-label">
              <input type="checkbox" id="sm-show-acked" />
              Show acknowledged
            </label>
          </div>
          <div class="sm-alerts-list" id="sm-alerts-list">
            <div class="sm-empty">Loading alerts...</div>
          </div>
        </div>
      `;

      this.container.querySelector('#sm-show-acked').addEventListener('change', (e) => {
        this.showAcknowledged = e.target.checked;
        this.loadData();
      });
    }

    renderCount(count) {
      const el = this.container.querySelector('#sm-alert-count');
      if (el) el.textContent = count > 0 ? `(${count} active)` : '';
    }

    renderAlerts() {
      const list = this.container.querySelector('#sm-alerts-list');
      if (!list) return;

      if (this.alerts.length === 0) {
        list.innerHTML = '<div class="sm-empty">No alerts to display.</div>';
        return;
      }

      list.innerHTML = this.alerts.map((a) => `
        <div class="sm-alert-card sm-severity-bg-${a.severity} ${a.acknowledged ? 'sm-alert-acked' : ''}">
          <div class="sm-alert-header">
            <span class="sm-threshold-badge sm-severity-${a.severity}">${this._esc(a.severity)}</span>
            <span class="sm-alert-time">${new Date(a.created_at).toLocaleString()}</span>
          </div>
          <div class="sm-alert-message">${this._esc(a.message)}</div>
          <div class="sm-alert-actions">
            ${!a.acknowledged ? `<button class="btn btn-sm sm-btn-ack" data-id="${a.id}">Acknowledge</button>` : '<span class="sm-muted">Acknowledged</span>'}
            <button class="btn btn-sm sm-btn-detail" data-sensor="${a.sensor_id}">View Sensor</button>
          </div>
        </div>
      `).join('');

      list.querySelectorAll('.sm-btn-ack').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await globalThis.api.invoke('sensor-monitor:acknowledge-alert', { id: btn.dataset.id });
          this.loadData();
        });
      });

      list.querySelectorAll('.sm-btn-detail').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.app.navigateTo('detail', { sensorId: btn.dataset.sensor });
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

  globalThis.SensorAlerts = SensorAlerts;
})();
