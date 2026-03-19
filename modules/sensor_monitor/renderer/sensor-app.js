/**
 * SensorApp — root renderer component for the Sensor Monitor module.
 *
 * Manages navigation between sub-views: overview, list, detail, alerts, discover.
 * Registered as the 'sensor-dashboard' tab type.
 */
(function () {
  const API = globalThis.api;

  class SensorApp {
    constructor() {
      this.container = null;
      this.activeView = 'overview';
      this.viewOpts = {};
      this.currentSubView = null;
      this.unsubscribes = [];
      this.discoveryUnsubs = [];
    }

    async init(el) {
      this.container = el;
      this._restoreState();
      this.render();
      this._bindNav();
      await this.navigateTo(this.activeView, this.viewOpts);
    }

    render() {
      this.container.innerHTML = `
        <div class="sm-app">
          <div class="sm-nav">
            <button class="sm-nav-item active" data-view="overview">Overview</button>
            <button class="sm-nav-item" data-view="list">Sensors</button>
            <button class="sm-nav-item" data-view="alerts">Alerts</button>
            <button class="sm-nav-item" data-view="discover">Discover</button>
          </div>
          <div class="sm-content" id="sm-content"></div>
        </div>
      `;
    }

    _bindNav() {
      this.container.querySelectorAll('.sm-nav-item').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.navigateTo(btn.dataset.view);
        });
      });
    }

    async navigateTo(view, opts = {}) {
      // Clean up previous sub-view
      if (this.currentSubView && typeof this.currentSubView.destroy === 'function') {
        this.currentSubView.destroy();
        this.currentSubView = null;
      }
      // Clean up discovery unsubs
      this.discoveryUnsubs.forEach((fn) => { if (typeof fn === 'function') fn(); });
      this.discoveryUnsubs = [];

      this.activeView = view;
      this.viewOpts = opts;
      this._saveState();

      // Update nav active state
      this.container.querySelectorAll('.sm-nav-item').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.view === view);
      });

      const content = this.container.querySelector('#sm-content');
      if (!content) return;
      content.innerHTML = '';

      switch (view) {
        case 'overview':
          this.currentSubView = new globalThis.SensorOverview(this);
          await this.currentSubView.init(content);
          break;

        case 'list':
          this.currentSubView = new globalThis.SensorList(this);
          await this.currentSubView.init(content);
          break;

        case 'detail':
          this.currentSubView = new globalThis.SensorDetail(this);
          await this.currentSubView.init(content, opts);
          break;

        case 'alerts':
          this.currentSubView = new globalThis.SensorAlerts(this);
          await this.currentSubView.init(content);
          break;

        case 'discover':
          await this._renderDiscover(content);
          break;

        default:
          content.innerHTML = '<div class="sm-empty">Unknown view.</div>';
      }
    }

    async _renderDiscover(el) {
      el.innerHTML = `
        <div class="sm-discover-view">
          <div class="sm-discover-header">
            <h3>Network Sensor Discovery</h3>
            <div class="sm-discover-controls">
              <input type="text" id="sm-discover-range" class="sm-search-input"
                     placeholder="e.g. 192.168.1.0/24 or 10.0.0.1-10.0.0.50" />
              <button class="btn btn-sm sm-btn-primary" id="sm-discover-start">Scan</button>
            </div>
          </div>
          <div class="sm-discover-progress" id="sm-discover-progress" style="display:none">
            <div class="sm-progress-bar"><div class="sm-progress-fill" id="sm-progress-fill"></div></div>
            <span class="sm-progress-text" id="sm-progress-text">Scanning...</span>
          </div>
          <div class="sm-discover-results" id="sm-discover-results">
            <div class="sm-empty">Enter a network range and click Scan to discover sensors.</div>
          </div>
        </div>
      `;

      const startBtn = el.querySelector('#sm-discover-start');
      const rangeInput = el.querySelector('#sm-discover-range');

      // Listen for progress
      const unsubProgress = API.on('sensor-monitor:discovery-progress', (data) => {
        const progressDiv = el.querySelector('#sm-discover-progress');
        const fill = el.querySelector('#sm-progress-fill');
        const text = el.querySelector('#sm-progress-text');
        if (progressDiv) progressDiv.style.display = '';
        if (fill) fill.style.width = `${Math.round(data.progress * 100)}%`;
        if (text) text.textContent = `Scanning ${data.range}... ${Math.round(data.progress * 100)}%`;
      });
      this.discoveryUnsubs.push(unsubProgress);

      startBtn.addEventListener('click', async () => {
        startBtn.disabled = true;
        startBtn.textContent = 'Scanning...';
        const range = rangeInput.value.trim() || undefined;

        try {
          const result = await API.invoke('sensor-monitor:discover-sensors', { range });
          this._renderDiscoverResults(el, result.candidates || []);
        } catch (err) {
          console.error('[sensor-monitor] Discovery error:', err);
          const results = el.querySelector('#sm-discover-results');
          if (results) results.innerHTML = '<div class="sm-empty">Discovery failed. Check the network range.</div>';
        } finally {
          startBtn.disabled = false;
          startBtn.textContent = 'Scan';
          const progressDiv = el.querySelector('#sm-discover-progress');
          if (progressDiv) progressDiv.style.display = 'none';
        }
      });
    }

    _renderDiscoverResults(el, candidates) {
      const results = el.querySelector('#sm-discover-results');
      if (!results) return;

      if (candidates.length === 0) {
        results.innerHTML = '<div class="sm-empty">No sensors detected on the scanned range.</div>';
        return;
      }

      results.innerHTML = `
        <div class="sm-discover-count">${candidates.length} sensor(s) found</div>
        <div class="sm-discover-list">
          ${candidates.map((c, i) => `
            <div class="sm-discover-card">
              <div class="sm-discover-card-info">
                <strong>${this._esc(c.name)}</strong>
                <span class="sm-cell-mono">${this._esc(c.host)}:${c.port}</span>
                <span class="sm-sensor-type">${this._esc(c.type)}</span>
              </div>
              <button class="btn btn-sm sm-btn-primary sm-discover-add" data-idx="${i}">Add</button>
            </div>
          `).join('')}
        </div>
      `;

      results.querySelectorAll('.sm-discover-add').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const idx = parseInt(btn.dataset.idx, 10);
          const c = candidates[idx];
          if (!c) return;
          await API.invoke('sensor-monitor:add-sensor', {
            name: c.name,
            type: c.type,
            host: c.host,
            port: c.port,
            protocol: c.protocol,
          });
          btn.textContent = 'Added';
          btn.disabled = true;
          if (globalThis.ui) globalThis.ui.showNotification(`Added ${c.name}`, 'success');
        });
      });
    }

    _esc(str) {
      const el = document.createElement('span');
      el.textContent = str || '';
      return el.innerHTML;
    }

    _saveState() {
      try {
        localStorage.setItem('sensor-monitor-state', JSON.stringify({
          activeView: this.activeView,
          viewOpts: this.viewOpts,
        }));
      } catch { /* ignore */ }
    }

    _restoreState() {
      try {
        const raw = localStorage.getItem('sensor-monitor-state');
        if (raw) {
          const obj = JSON.parse(raw);
          this.activeView = obj.activeView || 'overview';
          this.viewOpts = obj.viewOpts || {};
        }
      } catch { /* ignore */ }
    }

    destroy() {
      if (this.currentSubView && typeof this.currentSubView.destroy === 'function') {
        this.currentSubView.destroy();
      }
      this.unsubscribes.forEach((fn) => { if (typeof fn === 'function') fn(); });
      this.discoveryUnsubs.forEach((fn) => { if (typeof fn === 'function') fn(); });
      this._saveState();
    }
  }

  // --- Tab registration ---
  (function registerSensorApp() {
    function doRegister() {
      if (!globalThis.tabManager) { setTimeout(doRegister, 0); return; }

      globalThis.tabManager.registerTabType('sensor-dashboard', {
        render: (tab, container) => {
          container.innerHTML = '';
          const app = new SensorApp();
          app.init(container);
          tab.instance = app;
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
      if (!globalThis._hub) { setTimeout(doRegister, 0); return; }

      globalThis._hub.moduleOpeners = globalThis._hub.moduleOpeners || {};
      globalThis._hub.moduleOpeners['sensor-monitor'] = function openSensorMonitor(mod) {
        const tm = globalThis.tabManager;
        if (!tm || !tm.hasTabType('sensor-dashboard')) return;

        const existing = tm.getTabsByType('sensor-dashboard');
        if (existing.length > 0) {
          tm.switchTab(existing[0].id);
          return;
        }
        tm.createTab('sensor-dashboard', 'Sensor Monitor', { moduleId: mod.id }, { target: 'module' });
      };
    }
    doRegister();
  })();
})();
