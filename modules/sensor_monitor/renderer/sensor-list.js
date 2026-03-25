/**
 * SensorList — tabular view of all sensors with sorting/filtering.
 */
(function () {
  class SensorList {
    constructor(app) {
      this.app = app;
      this.container = null;
      this.sensors = [];
      this.filter = '';
      this.typeFilter = '';
      this.sortKey = 'name';
      this.sortAsc = true;
      this.unsubscribes = [];
      this.refreshInterval = null;
    }

    async init(container, opts = {}) {
      this.container = container;
      if (opts.filterType) this.typeFilter = opts.filterType;
      this.render();
      await this.loadData();
      this.setupLiveUpdates();
      this.refreshInterval = setInterval(() => this.loadData(), 20000);
    }

    setupLiveUpdates() {
      const unsub = globalThis.api.on('sensor-monitor:sensor-updated', () => this.loadData());
      this.unsubscribes.push(unsub);
    }

    async loadData() {
      try {
        const result = await globalThis.api.invoke('sensor-monitor:get-sensors');
        this.sensors = result.sensors || [];
        this.renderTable();
      } catch (err) {
        console.error('[sensor-monitor] List load error:', err);
      }
    }

    render() {
      this.container.innerHTML = `
        <div class="sm-list-view">
          <div class="sm-list-toolbar">
            <input type="text" class="sm-search-input" id="sm-list-search"
                   placeholder="Filter sensors..." />
            <select class="sm-type-filter" id="sm-type-filter">
              <option value="">All Types</option>
            </select>
            <button class="btn btn-sm" id="sm-btn-add">Add Sensor</button>
          </div>
          <div class="sm-table-wrap" id="sm-table-wrap">
            <div class="sm-empty">Loading...</div>
          </div>
        </div>
      `;

      this.container.querySelector('#sm-list-search').addEventListener('input', (e) => {
        this.filter = e.target.value.toLowerCase();
        this.renderTable();
      });

      this.container.querySelector('#sm-type-filter').addEventListener('change', (e) => {
        this.typeFilter = e.target.value;
        this.renderTable();
      });

      this.container.querySelector('#sm-btn-add').addEventListener('click', () => {
        this._showAddDialog();
      });
    }

    renderTable() {
      const wrap = this.container.querySelector('#sm-table-wrap');
      if (!wrap) return;

      // Populate type filter dropdown
      const typeSelect = this.container.querySelector('#sm-type-filter');
      if (typeSelect && typeSelect.options.length <= 1) {
        const types = [...new Set(this.sensors.map((s) => s.type))].sort();
        for (const t of types) {
          const opt = document.createElement('option');
          opt.value = t;
          opt.textContent = t;
          typeSelect.appendChild(opt);
        }
        if (this.typeFilter) typeSelect.value = this.typeFilter;
      }

      let filtered = this.sensors;
      if (this.typeFilter) {
        filtered = filtered.filter((s) => s.type === this.typeFilter);
      }
      if (this.filter) {
        filtered = filtered.filter((s) =>
          s.name.toLowerCase().includes(this.filter) ||
          s.host.toLowerCase().includes(this.filter) ||
          s.type.toLowerCase().includes(this.filter)
        );
      }

      filtered.sort((a, b) => {
        const va = a[this.sortKey] ?? '';
        const vb = b[this.sortKey] ?? '';
        const cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
        return this.sortAsc ? cmp : -cmp;
      });

      if (filtered.length === 0) {
        wrap.innerHTML = '<div class="sm-empty">No sensors match your filter.</div>';
        return;
      }

      wrap.innerHTML = `
        <table class="sm-table">
          <thead>
            <tr>
              <th class="sm-th-fav"></th>
              <th class="sm-th-sortable" data-key="status">Status</th>
              <th class="sm-th-sortable" data-key="name">Name</th>
              <th class="sm-th-sortable" data-key="type">Type</th>
              <th class="sm-th-sortable" data-key="host">Host</th>
              <th class="sm-th-sortable" data-key="last_value">Value</th>
              <th>Unit</th>
              <th class="sm-th-sortable" data-key="protocol">Protocol</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map((s) => {
              const isFav = this.app.isFavorite(s.id);
              return `
              <tr data-id="${s.id}">
                <td><button class="sm-fav-btn${isFav ? ' sm-fav-active' : ''}" data-id="${s.id}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">${isFav ? '★' : '☆'}</button></td>
                <td><span class="sm-status-dot sm-status-${s.status}"></span> ${this._esc(s.status)}</td>
                <td class="sm-cell-name">${this._esc(s.name)}</td>
                <td>${this._esc(s.type)}</td>
                <td class="sm-cell-mono">${this._esc(s.host)}</td>
                <td class="sm-cell-value">${s.last_value !== null && s.last_value !== undefined ? s.last_value : '--'}</td>
                <td>${this._esc(s.unit)}</td>
                <td>${this._esc(s.protocol)}</td>
                <td>
                  <button class="btn btn-sm sm-btn-detail" data-id="${s.id}" title="Details">View</button>
                  <button class="btn btn-sm btn-danger sm-btn-remove" data-id="${s.id}" title="Remove">X</button>
                </td>
              </tr>
            `; }).join('')}
          </tbody>
        </table>
      `;

      wrap.querySelectorAll('.sm-th-sortable').forEach((th) => {
        th.addEventListener('click', () => {
          const key = th.dataset.key;
          if (this.sortKey === key) this.sortAsc = !this.sortAsc;
          else { this.sortKey = key; this.sortAsc = true; }
          this.renderTable();
        });
      });

      wrap.querySelectorAll('.sm-fav-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.app.toggleFavorite(btn.dataset.id);
          this.renderTable();
        });
      });

      wrap.querySelectorAll('.sm-btn-detail').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.app.navigateTo('detail', { sensorId: btn.dataset.id });
        });
      });

      wrap.querySelectorAll('.sm-btn-remove').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await globalThis.api.invoke('sensor-monitor:remove-sensor', { id: btn.dataset.id });
          this.loadData();
        });
      });
    }

    _showAddDialog() {
      const overlay = document.createElement('div');
      overlay.className = 'sm-dialog-overlay';
      overlay.innerHTML = `
        <div class="sm-dialog">
          <h3>Add Sensor</h3>
          <label>Name<input type="text" id="sm-add-name" placeholder="e.g. Server Room Temp" /></label>
          <label>Type
            <select id="sm-add-type">
              <option value="temperature">Temperature</option>
              <option value="humidity">Humidity</option>
              <option value="pressure">Pressure</option>
              <option value="co2">CO2</option>
              <option value="light">Light</option>
              <option value="power">Power</option>
              <option value="current">Current</option>
              <option value="network">Network</option>
              <option value="generic">Generic</option>
            </select>
          </label>
          <label>Host<input type="text" id="sm-add-host" placeholder="192.168.1.10" /></label>
          <label>Protocol
            <select id="sm-add-protocol">
              <option value="snmp">SNMP</option>
              <option value="mqtt">MQTT</option>
              <option value="http">HTTP</option>
              <option value="modbus">Modbus</option>
            </select>
          </label>
          <label>Unit<input type="text" id="sm-add-unit" placeholder="C, %, ppm..." /></label>
          <label>Poll Interval (s)<input type="number" id="sm-add-interval" value="60" min="5" max="3600" /></label>
          <div class="sm-dialog-actions">
            <button class="btn btn-sm" id="sm-add-cancel">Cancel</button>
            <button class="btn btn-sm sm-btn-primary" id="sm-add-save">Add</button>
          </div>
        </div>
      `;

      this.container.appendChild(overlay);

      overlay.querySelector('#sm-add-cancel').addEventListener('click', () => overlay.remove());
      overlay.querySelector('#sm-add-save').addEventListener('click', async () => {
        const name = overlay.querySelector('#sm-add-name').value.trim();
        const host = overlay.querySelector('#sm-add-host').value.trim();
        if (!name || !host) {
          if (globalThis.ui) globalThis.ui.showNotification('Name and host are required', 'error');
          return;
        }
        await globalThis.api.invoke('sensor-monitor:add-sensor', {
          name,
          type: overlay.querySelector('#sm-add-type').value,
          host,
          protocol: overlay.querySelector('#sm-add-protocol').value,
          unit: overlay.querySelector('#sm-add-unit').value.trim(),
          interval_s: parseInt(overlay.querySelector('#sm-add-interval').value, 10) || 60,
        });
        overlay.remove();
        this.loadData();
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

  globalThis.SensorList = SensorList;
})();
