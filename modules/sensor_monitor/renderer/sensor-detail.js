/**
 * SensorDetail — single-sensor view with live chart and threshold management.
 */
(function () {
  class SensorDetail {
    constructor(app) {
      this.app = app;
      this.container = null;
      this.sensorId = null;
      this.sensor = null;
      this.readings = [];
      this.chart = null;
      this.unsubscribes = [];
      this.refreshInterval = null;
    }

    async init(container, opts = {}) {
      this.container = container;
      this.sensorId = opts.sensorId;
      if (!this.sensorId) {
        container.innerHTML = '<div class="sm-empty">No sensor selected.</div>';
        return;
      }
      this.render();
      await this.loadData();
      this.setupLiveUpdates();
      this.refreshInterval = setInterval(() => this.loadData(), 10000);
    }

    setupLiveUpdates() {
      const unsub = globalThis.api.on('sensor-monitor:sensor-updated', (data) => {
        if (data.sensor_id === this.sensorId) this.loadData();
      });
      this.unsubscribes.push(unsub);
    }

    async loadData() {
      try {
        const result = await globalThis.api.invoke('sensor-monitor:get-sensor-history', {
          sensor_id: this.sensorId,
          limit: 100,
        });
        this.sensor = result.sensor;
        this.readings = result.readings || [];
        this.renderInfo();
        this.renderChart();
        this.renderReadingsTable();
        await this.renderThresholds();
      } catch (err) {
        console.error('[sensor-monitor] Detail load error:', err);
      }
    }

    render() {
      this.container.innerHTML = `
        <div class="sm-detail-view">
          <div class="sm-detail-header" id="sm-detail-header">
            <button class="btn btn-sm sm-btn-back" id="sm-detail-back">Back</button>
            <span class="sm-detail-title">Loading...</span>
            <button class="sm-fav-btn" id="sm-detail-fav" title="Toggle favorite">☆</button>
          </div>
          <div class="sm-detail-info" id="sm-detail-info"></div>
          <div class="sm-detail-chart-wrap">
            <canvas id="sm-detail-chart" height="220"></canvas>
          </div>
          <div class="sm-detail-sections">
            <div class="sm-detail-section">
              <h4>Thresholds</h4>
              <div id="sm-detail-thresholds"></div>
              <div class="sm-threshold-add" id="sm-threshold-add">
                <select id="sm-thresh-op">
                  <option value=">">></option>
                  <option value=">=">>=</option>
                  <option value="<">&lt;</option>
                  <option value="<=">&lt;=</option>
                </select>
                <input type="number" id="sm-thresh-val" placeholder="Value" />
                <select id="sm-thresh-sev">
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
                <button class="btn btn-sm sm-btn-primary" id="sm-thresh-save">Add</button>
              </div>
            </div>
            <div class="sm-detail-section">
              <h4>Recent Readings</h4>
              <div class="sm-readings-table-wrap" id="sm-readings-table"></div>
            </div>
          </div>
        </div>
      `;

      this.container.querySelector('#sm-detail-back').addEventListener('click', () => {
        this.app.navigateTo('overview');
      });

      this.container.querySelector('#sm-detail-fav').addEventListener('click', () => {
        this.app.toggleFavorite(this.sensorId);
        this._updateFavBtn();
      });

      this.container.querySelector('#sm-thresh-save').addEventListener('click', async () => {
        const op = this.container.querySelector('#sm-thresh-op').value;
        const val = parseFloat(this.container.querySelector('#sm-thresh-val').value);
        const sev = this.container.querySelector('#sm-thresh-sev').value;
        if (isNaN(val)) return;
        await globalThis.api.invoke('sensor-monitor:set-threshold', {
          sensor_id: this.sensorId,
          operator: op,
          value: val,
          severity: sev,
        });
        this.container.querySelector('#sm-thresh-val').value = '';
        this.renderThresholds();
      });
    }

    renderInfo() {
      const info = this.container.querySelector('#sm-detail-info');
      const title = this.container.querySelector('.sm-detail-title');
      if (!this.sensor) return;

      title.textContent = this.sensor.name;
      this._updateFavBtn();
      info.innerHTML = `
        <div class="sm-info-grid">
          <div class="sm-info-item">
            <span class="sm-info-label">Status</span>
            <span class="sm-status-dot sm-status-${this.sensor.status}"></span>
            <span>${this._esc(this.sensor.status)}</span>
          </div>
          <div class="sm-info-item">
            <span class="sm-info-label">Current Value</span>
            <span class="sm-info-value">${this.sensor.last_value ?? '--'} ${this._esc(this.sensor.unit)}</span>
          </div>
          <div class="sm-info-item">
            <span class="sm-info-label">Type</span>
            <span>${this._esc(this.sensor.type)}</span>
          </div>
          <div class="sm-info-item">
            <span class="sm-info-label">Host</span>
            <span class="sm-cell-mono">${this._esc(this.sensor.host)}</span>
          </div>
          <div class="sm-info-item">
            <span class="sm-info-label">Protocol</span>
            <span>${this._esc(this.sensor.protocol)}</span>
          </div>
          <div class="sm-info-item">
            <span class="sm-info-label">Poll Interval</span>
            <span>${this.sensor.interval_s}s</span>
          </div>
          <div class="sm-info-item">
            <span class="sm-info-label">Last Seen</span>
            <span>${this.sensor.last_seen ? new Date(this.sensor.last_seen).toLocaleTimeString() : '--'}</span>
          </div>
        </div>
      `;
    }

    renderChart() {
      const canvas = this.container.querySelector('#sm-detail-chart');
      if (!canvas || this.readings.length === 0) return;

      const labels = this.readings.map((r) =>
        new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
      const values = this.readings.map((r) => r.value);

      if (this.chart) this.chart.destroy();

      if (typeof Chart === 'undefined') return;

      this.chart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: `${this.sensor ? this.sensor.name : 'Sensor'} (${this.sensor ? this.sensor.unit : ''})`,
            data: values,
            borderColor: '#007acc',
            backgroundColor: 'rgba(0, 122, 204, 0.1)',
            borderWidth: 2,
            pointRadius: 1,
            fill: true,
            tension: 0.3,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#d4d4d4' } } },
          scales: {
            x: { ticks: { color: '#858585', maxTicksLimit: 10 }, grid: { color: '#3e3e42' } },
            y: { ticks: { color: '#858585' }, grid: { color: '#3e3e42' } },
          },
        },
      });
    }

    async renderThresholds() {
      const wrap = this.container.querySelector('#sm-detail-thresholds');
      if (!wrap) return;
      try {
        const result = await globalThis.api.invoke('sensor-monitor:get-thresholds', { sensor_id: this.sensorId });
        const thresholds = result.thresholds || [];
        if (thresholds.length === 0) {
          wrap.innerHTML = '<span class="sm-muted">No thresholds configured.</span>';
          return;
        }
        wrap.innerHTML = thresholds.map((t) => `
          <div class="sm-threshold-row">
            <span class="sm-threshold-badge sm-severity-${t.severity}">${t.severity}</span>
            <span>Value ${this._esc(t.operator)} ${t.value}</span>
            <button class="btn btn-sm btn-danger sm-thresh-remove" data-id="${t.id}">Remove</button>
          </div>
        `).join('');

        wrap.querySelectorAll('.sm-thresh-remove').forEach((btn) => {
          btn.addEventListener('click', async () => {
            await globalThis.api.invoke('sensor-monitor:remove-threshold', { id: btn.dataset.id });
            this.renderThresholds();
          });
        });
      } catch (err) {
        console.error('[sensor-monitor] Thresholds load error:', err);
      }
    }

    renderReadingsTable() {
      const wrap = this.container.querySelector('#sm-readings-table');
      if (!wrap) return;
      const recent = this.readings.slice(-20).reverse();
      if (recent.length === 0) {
        wrap.innerHTML = '<span class="sm-muted">No readings yet.</span>';
        return;
      }
      wrap.innerHTML = `
        <table class="sm-table sm-table-compact">
          <thead><tr><th>Time</th><th>Value</th><th>Unit</th></tr></thead>
          <tbody>
            ${recent.map((r) => `
              <tr>
                <td>${new Date(r.timestamp).toLocaleTimeString()}</td>
                <td class="sm-cell-value">${r.value}</td>
                <td>${this._esc(r.unit)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    _updateFavBtn() {
      const btn = this.container?.querySelector('#sm-detail-fav');
      if (!btn) return;
      const isFav = this.app.isFavorite(this.sensorId);
      btn.textContent = isFav ? '★' : '☆';
      btn.classList.toggle('sm-fav-active', isFav);
      btn.title = isFav ? 'Remove from favorites' : 'Add to favorites';
    }

    _esc(str) {
      const el = document.createElement('span');
      el.textContent = str || '';
      return el.innerHTML;
    }

    destroy() {
      this.unsubscribes.forEach((fn) => { if (typeof fn === 'function') fn(); });
      if (this.refreshInterval) clearInterval(this.refreshInterval);
      if (this.chart) { this.chart.destroy(); this.chart = null; }
    }
  }

  globalThis.SensorDetail = SensorDetail;
})();
