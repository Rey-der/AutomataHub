/**
 * SensorApp — root renderer component for the Sensor Monitor module.
 *
 * Sidebar layout with nav, active alerts, favorites, and type groups.
 * Registered as the 'sensor-dashboard' tab type.
 */
(function () {
  const API = globalThis.api;

  const NAV_ITEMS = [
    { view: 'overview', icon: '◉', label: 'Overview' },
    { view: 'list',     icon: '☰', label: 'Sensors' },
    { view: 'alerts',   icon: '⚠', label: 'Alerts' },
    { view: 'discover', icon: '⌕', label: 'Discover' },
  ];

  const DEFAULT_TYPE_COLORS = {
    temperature: '#e74c3c',
    humidity:    '#3498db',
    pressure:    '#9b59b6',
    co2:         '#2ecc71',
    light:       '#f39c12',
    power:       '#e67e22',
    current:     '#1abc9c',
    network:     '#34495e',
    generic:     '#7f8c8d',
  };

  // Deterministic fallback color for unknown types
  function _typeColorFallback(type) {
    let hash = 0;
    for (let i = 0; i < type.length; i++) hash = (hash * 31 + type.charCodeAt(i)) >>> 0;
    const hue = hash % 360;
    return `hsl(${hue}, 55%, 55%)`;
  }

  class SensorApp {
    constructor() {
      this.container = null;
      this.activeView = 'overview';
      this.viewOpts = {};
      this.currentSubView = null;
      this.unsubscribes = [];
      this.discoveryUnsubs = [];

      // Sidebar state
      this.sidebarCollapsed = false;
      this.favorites = new Set();
      this.typeColors = new Map();
      this.allSensors = [];
      this.alertCount = 0;
    }

    async init(el) {
      this.container = el;
      this._restoreState();
      this.render();
      this._bindEvents();
      await this._loadSidebarData();
      this._setupSidebarUpdates();
      await this.navigateTo(this.activeView, this.viewOpts);
    }

    render() {
      const collapsed = this.sidebarCollapsed ? ' collapsed' : '';
      this.container.innerHTML = `
        <div class="sm-app">
          <aside class="sm-sidebar${collapsed}" id="sm-sidebar">
            <div class="sm-sidebar-header">
              <span class="sm-sidebar-title">Sensor Monitor</span>
              <button class="sm-sidebar-toggle" id="sm-sidebar-toggle" title="Toggle sidebar">&#9776;</button>
            </div>
            <nav class="sm-sidebar-nav" id="sm-sidebar-nav">
              ${NAV_ITEMS.map((n) => `
                <button class="sm-nav-item${n.view === this.activeView ? ' active' : ''}" data-view="${n.view}">
                  <span class="sm-nav-icon">${n.icon}</span>
                  <span class="sm-nav-label">${n.label}</span>
                </button>
              `).join('')}
            </nav>
            <div class="sm-sidebar-section" id="sm-alerts-section">
              <div class="sm-section-header">
                <span class="sm-section-title">Active Alerts</span>
                <span class="sm-section-badge" id="sm-alert-badge" style="display:none"></span>
              </div>
              <div class="sm-section-body" id="sm-alerts-list"></div>
            </div>
            <div class="sm-sidebar-section" id="sm-favorites-section">
              <div class="sm-section-header">
                <span class="sm-section-title">Favorites</span>
              </div>
              <div class="sm-section-body" id="sm-favorites-list"></div>
            </div>
            <div class="sm-sidebar-section sm-groups-section" id="sm-groups-section">
              <div class="sm-section-header">
                <span class="sm-section-title">Groups</span>
              </div>
              <div class="sm-section-body" id="sm-groups-list"></div>
            </div>
          </aside>
          <div class="sm-main" id="sm-main">
            <div class="sm-content" id="sm-content"></div>
            <footer class="sm-statusbar" id="sm-statusbar"></footer>
          </div>
        </div>
      `;
    }

    _bindEvents() {
      // Sidebar toggle
      const toggle = this.container.querySelector('#sm-sidebar-toggle');
      if (toggle) {
        toggle.addEventListener('click', () => {
          this.sidebarCollapsed = !this.sidebarCollapsed;
          const sidebar = this.container.querySelector('#sm-sidebar');
          if (sidebar) sidebar.classList.toggle('collapsed', this.sidebarCollapsed);
          this._saveState();
        });
      }

      // Nav items
      this.container.querySelectorAll('#sm-sidebar-nav .sm-nav-item').forEach((btn) => {
        btn.addEventListener('click', () => this.navigateTo(btn.dataset.view));
      });
    }

    _setupSidebarUpdates() {
      const unsub1 = API.on('sensor-monitor:sensor-updated', () => this._loadSidebarData());
      const unsub2 = API.on('sensor-monitor:sensor-alert', () => this._loadSidebarData());
      this.unsubscribes.push(unsub1, unsub2);
    }

    async _loadSidebarData() {
      try {
        const [sensorResult, statsResult] = await Promise.all([
          API.invoke('sensor-monitor:get-sensors'),
          API.invoke('sensor-monitor:get-dashboard-stats'),
        ]);
        this.allSensors = sensorResult.sensors || [];
        this.alertCount = statsResult.active_alerts || 0;
      } catch (err) {
        console.error('[sensor-monitor] Sidebar data load error:', err);
      }
      this._updateSidebarSections();
    }

    _updateSidebarSections() {
      this._renderAlertsList();
      this._renderFavoritesList();
      this._renderGroupsList();
      this._renderStatusBar();
    }

    _renderAlertsList() {
      const list = this.container?.querySelector('#sm-alerts-list');
      const badge = this.container?.querySelector('#sm-alert-badge');
      if (!list) return;

      if (badge) {
        badge.textContent = this.alertCount;
        badge.style.display = this.alertCount > 0 ? '' : 'none';
      }

      const warningSensors = this.allSensors.filter((s) => s.status === 'warning' || s.status === 'critical');
      if (warningSensors.length === 0) {
        list.innerHTML = '<div class="sm-section-empty">No active alerts</div>';
        return;
      }

      list.innerHTML = warningSensors.map((s) => `
        <div class="sm-alert-item" data-id="${s.id}" title="${this._esc(s.name)}">
          <span class="sm-alert-status sm-astatus-${s.status}">●</span>
          <span class="sm-alert-name">${this._esc(s.name)}</span>
          <span class="sm-alert-val">${s.last_value ?? '--'}</span>
        </div>
      `).join('');

      list.querySelectorAll('.sm-alert-item').forEach((el) => {
        el.addEventListener('click', () => this.navigateTo('detail', { sensorId: el.dataset.id }));
      });
    }

    _renderFavoritesList() {
      const list = this.container?.querySelector('#sm-favorites-list');
      if (!list) return;

      const favSensors = this.allSensors.filter((s) => this.favorites.has(s.id));
      if (favSensors.length === 0) {
        list.innerHTML = '<div class="sm-section-empty">No favorites yet<br><small>Click ★ on a sensor</small></div>';
        return;
      }

      list.innerHTML = favSensors.map((s) => `
        <div class="sm-fav-item" data-id="${s.id}" title="${this._esc(s.name)}">
          <span class="sm-fav-icon">★</span>
          <span class="sm-fav-name">${this._esc(s.name)}</span>
          <span class="sm-fav-val">${s.last_value ?? '--'} ${this._esc(s.unit)}</span>
        </div>
      `).join('');

      list.querySelectorAll('.sm-fav-item').forEach((el) => {
        el.addEventListener('click', () => this.navigateTo('detail', { sensorId: el.dataset.id }));
      });
    }

    _renderGroupsList() {
      const list = this.container?.querySelector('#sm-groups-list');
      if (!list) return;

      // Group sensors by type
      const groups = {};
      for (const s of this.allSensors) {
        const type = s.type || 'generic';
        if (!groups[type]) groups[type] = [];
        groups[type].push(s);
      }

      const typeNames = Object.keys(groups).sort();
      if (typeNames.length === 0) {
        list.innerHTML = '<div class="sm-section-empty">No sensors</div>';
        return;
      }

      list.innerHTML = typeNames.map((type) => {
        const color = this.typeColors.get(type) || DEFAULT_TYPE_COLORS[type] || _typeColorFallback(type);
        const count = groups[type].length;
        const online = groups[type].filter((s) => s.status === 'online').length;
        return `
          <div class="sm-group-item" data-type="${this._esc(type)}" title="${type}: ${count} sensor(s)">
            <span class="sm-group-dot" data-type="${this._esc(type)}" style="background:${color}" title="Click to change color"></span>
            <input type="color" class="sm-group-color-input" value="${color}" data-type="${this._esc(type)}" />
            <span class="sm-group-name">${this._esc(type)}</span>
            <span class="sm-group-count">${online}/${count}</span>
          </div>
        `;
      }).join('');

      list.querySelectorAll('.sm-group-dot').forEach((dot) => {
        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          dot.closest('.sm-group-item').querySelector('.sm-group-color-input').click();
        });
      });

      list.querySelectorAll('.sm-group-color-input').forEach((input) => {
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('change', (e) => {
          e.stopPropagation();
          this.typeColors.set(input.dataset.type, input.value);
          this._saveState();
          this._renderGroupsList();
        });
      });

      list.querySelectorAll('.sm-group-item').forEach((el) => {
        el.addEventListener('click', () => {
          this.navigateTo('list', { filterType: el.dataset.type });
        });
      });
    }

    _renderStatusBar() {
      const bar = this.container?.querySelector('#sm-statusbar');
      if (!bar) return;
      const total = this.allSensors.length;
      const online = this.allSensors.filter((s) => s.status === 'online').length;
      const offline = this.allSensors.filter((s) => s.status === 'offline').length;
      const warning = this.allSensors.filter((s) => s.status === 'warning' || s.status === 'critical').length;
      bar.innerHTML = `
        <span class="sm-sb-item"><span class="sm-status-dot sm-status-online"></span> ${online} online</span>
        <span class="sm-sb-item"><span class="sm-status-dot sm-status-offline"></span> ${offline} offline</span>
        <span class="sm-sb-item"><span class="sm-status-dot sm-status-warning"></span> ${warning} warning</span>
        <span class="sm-sb-item sm-sb-total">${total} sensors</span>
      `;
    }

    // --- Favorites ---

    isFavorite(sensorId) {
      return this.favorites.has(sensorId);
    }

    toggleFavorite(sensorId) {
      if (this.favorites.has(sensorId)) this.favorites.delete(sensorId);
      else this.favorites.add(sensorId);
      this._saveState();
      this._renderFavoritesList();
    }

    // --- Navigation ---

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

      // Update sidebar nav active state
      this.container.querySelectorAll('#sm-sidebar-nav .sm-nav-item').forEach((btn) => {
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
          await this.currentSubView.init(content, opts);
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
          this._loadSidebarData();
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
          sidebarCollapsed: this.sidebarCollapsed,
          favorites: [...this.favorites],
          typeColors: [...this.typeColors.entries()],
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
          this.sidebarCollapsed = !!obj.sidebarCollapsed;
          if (Array.isArray(obj.favorites)) this.favorites = new Set(obj.favorites);
          if (Array.isArray(obj.typeColors)) this.typeColors = new Map(obj.typeColors);
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
          if (tab._appInstance) {
            const app = tab._appInstance;
            app.container = container;
            app.render();
            app._bindEvents();
            app._updateSidebarSections();
            if (app.activeView === 'detail' && app.viewOpts.sensorId) {
              app.navigateTo('detail', app.viewOpts);
            } else {
              app.navigateTo(app.activeView, app.viewOpts);
            }
          } else {
            const app = new SensorApp();
            tab._appInstance = app;
            app.init(container);
          }
        },
        onClose: (tab) => {
          if (tab._appInstance) { tab._appInstance.destroy(); tab._appInstance = null; }
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
