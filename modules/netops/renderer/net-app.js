/**
 * NetApp — root layout component for NetOps Monitor.
 * Provides sidebar navigation, toolbar, status bar, and content routing.
 * Content views (Overview, Hosts, Discovery, History) are placeholders
 * until implemented in Phases 2–6.
 */

const API = globalThis.api;

const NETOPS_LS_KEY = 'netops-ui-state';

class NetApp {
  activeView = 'overview';
  hosts = [];
  statusMap = new Map();
  unsubscribes = [];
  autoRefreshInterval = null;
  sidebarCollapsed = false;
  lastCollectionTime = null;
  _viewInstance = null;   // current view component (has init/destroy)
  hostListSort = { col: 'name', asc: true };

  constructor() {
    this._restoreState();
  }

  async init(el) {
    this.container = el;
    this.render();
    await this.loadHosts();
    this.setupRealtimeUpdates();
    this.startAutoRefresh();

    // Mount the default view
    const content = this.container.querySelector('#netapp-content');
    if (content) this._mountView(content);
  }

  // ================================================================
  //  State Persistence
  // ================================================================

  _restoreState() {
    try {
      const raw = localStorage.getItem(NETOPS_LS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.activeView) this.activeView = s.activeView;
      if (s.sidebarCollapsed != null) this.sidebarCollapsed = s.sidebarCollapsed;
      if (s.timeRange) this._savedTimeRange = s.timeRange;
      if (s.hostListSort) this.hostListSort = s.hostListSort;
      if (s.statusMap) {
        for (const [k, v] of Object.entries(s.statusMap)) {
          this.statusMap.set(Number(k), v);
        }
      }
    } catch (err) {
      console.error('[netops] Failed to restore UI state:', err);
    }
  }

  _saveState() {
    try {
      const obj = {
        activeView: this.activeView === 'host-detail' ? 'hosts' : this.activeView,
        sidebarCollapsed: this.sidebarCollapsed,
        timeRange: this.container?.querySelector('.toolbar-time-range')?.value || '24h',
        hostListSort: this.hostListSort,
        statusMap: Object.fromEntries(this.statusMap),
      };
      localStorage.setItem(NETOPS_LS_KEY, JSON.stringify(obj));
    } catch { /* quota exceeded or no access — ignore */ }
  }

  // ================================================================
  //  Data
  // ================================================================

  async loadHosts() {
    try {
      const result = await API.invoke('netops:get-monitored-hosts', { enabled_only: false });
      this.hosts = result.hosts || [];
      this.updateStatusBar();
    } catch (err) {
      console.error('[netops] Failed to load hosts:', err);
    }
  }

  setupRealtimeUpdates() {
    const unsub1 = API.on('netops:status-update', (data) => {
      this.statusMap.set(data.host_id, {
        status: data.status,
        latency_ms: data.latency_ms,
        timestamp: data.timestamp,
      });
      this.lastCollectionTime = new Date();
      this.updateStatusBar();
      this._saveState();
    });
    this.unsubscribes.push(unsub1);

    // Alert badge updates
    const unsub2 = API.on('netops:alert-triggered', () => this._updateAlertBadge());
    const unsub3 = API.on('netops:alert-resolved', () => this._updateAlertBadge());
    this.unsubscribes.push(unsub2, unsub3);

    // Alert deep-link navigation (from desktop notification click)
    const unsub4 = API.on('netops:alert-navigate', (data) => {
      if (data.host_id) this.navigateTo('host-detail', { host_id: data.host_id });
    });
    this.unsubscribes.push(unsub4);

    // Initial badge load
    this._updateAlertBadge();
  }

  async _updateAlertBadge() {
    try {
      const res = await API.invoke('netops:get-active-alert-count');
      const count = res.count || 0;
      const badge = this.container.querySelector('.na-sidebar-badge');
      if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? '' : 'none';
      }
    } catch { /* alert handler may not be ready yet */ }
  }

  startAutoRefresh() {
    this.autoRefreshInterval = setInterval(() => this.loadHosts(), 30000);
  }

  getStatusCounts() {
    const c = { online: 0, offline: 0, unknown: 0, disabled: 0 };
    this.hosts.forEach(h => {
      if (!h.enabled) { c.disabled++; return; }
      const s = this.statusMap.get(h.id)?.status || h.last_status || 'unknown';
      if (s in c) c[s]++;
    });
    return c;
  }

  // ================================================================
  //  Rendering
  // ================================================================

  render() {
    const collapsed = this.sidebarCollapsed ? ' collapsed' : '';
    const savedRange = this._savedTimeRange || '24h';
    this.container.innerHTML = `
      <div class="netapp">
        <aside class="netapp-sidebar${collapsed}">
          <div class="sidebar-header">
            <span class="sidebar-title">NetOps</span>
            <button class="sidebar-toggle" title="Toggle sidebar">&#9776;</button>
          </div>
          <nav class="sidebar-nav">
            ${this._renderNavItems()}
          </nav>
        </aside>
        <div class="netapp-main">
          <div class="netapp-toolbar">
            <div class="toolbar-left">
              <input type="text" class="toolbar-search" placeholder="Search hosts&#8230;" />
            </div>
            <div class="toolbar-right">
              <select class="toolbar-time-range">
                <option value="1h"${savedRange === '1h' ? ' selected' : ''}>Last 1h</option>
                <option value="6h"${savedRange === '6h' ? ' selected' : ''}>Last 6h</option>
                <option value="24h"${savedRange === '24h' ? ' selected' : ''}>Last 24h</option>
                <option value="7d"${savedRange === '7d' ? ' selected' : ''}>Last 7d</option>
                <option value="30d"${savedRange === '30d' ? ' selected' : ''}>Last 30d</option>
              </select>
              <button class="toolbar-add-host">+ Add Host</button>
            </div>
          </div>
          <div class="netapp-content" id="netapp-content">
            ${this._renderViewContent()}
          </div>
          <footer class="netapp-statusbar" id="netapp-statusbar">
            ${this._renderStatusBar()}
          </footer>
        </div>
      </div>
    `;
    this._bindEvents();
  }

  _renderNavItems() {
    const items = [
      { id: 'overview',  label: 'Overview',   icon: '\u25C9' },
      { id: 'hosts',     label: 'Hosts',      icon: '\u2630' },
      { id: 'discovery', label: 'Discovery',  icon: '\u2295' },
      { id: 'history',   label: 'History',    icon: '\u25F7' },
      { id: 'alerts',    label: 'Alerts',     icon: '\u26A0' },
    ];
    return items.map(item => {
      let extra = '';
      if (item.id === 'alerts') {
        extra = '<span class="na-sidebar-badge" style="display:none"></span>';
      }
      return `
      <button class="sidebar-nav-item${this.activeView === item.id ? ' active' : ''}"
              data-view="${item.id}" title="${item.label}">
        <span class="nav-icon">${item.icon}</span>
        <span class="nav-label">${item.label}</span>
        ${extra}
      </button>
    `;
    }).join('');
  }

  _renderViewContent() {
    // Views with real components return empty string — mounted async
    if (this.activeView === 'overview') return '';
    if (this.activeView === 'hosts') return '';
    if (this.activeView === 'host-detail') return '';
    if (this.activeView === 'discovery') return '';
    if (this.activeView === 'history') return '';
    if (this.activeView === 'alerts') return '';

    return `
      <div class="view-placeholder">
        <h2>${this.activeView}</h2>
      </div>
    `;
  }

  _renderStatusBar() {
    const c = this.getStatusCounts();
    const timeStr = this.lastCollectionTime
      ? this.lastCollectionTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '\u2014';
    return `
      <span class="sb-item"><span class="sb-dot online"></span>${c.online} Online</span>
      <span class="sb-item"><span class="sb-dot offline"></span>${c.offline} Offline</span>
      <span class="sb-item"><span class="sb-dot unknown"></span>${c.unknown} Unknown</span>
      ${c.disabled > 0 ? `<span class="sb-item"><span class="sb-dot disabled"></span>${c.disabled} Disabled</span>` : ''}
      <span class="sb-divider"></span>
      <span class="sb-item sb-time">Last: ${timeStr}</span>
    `;
  }

  updateStatusBar() {
    const bar = this.container.querySelector('#netapp-statusbar');
    if (bar) bar.innerHTML = this._renderStatusBar();
  }

  // ================================================================
  //  Navigation
  // ================================================================

  navigateTo(view, data) {
    if (this.activeView === view && !data) return;
    this._destroyView();
    this.activeView = view;
    this._viewData = data || null;
    this._saveState();

    this.container.querySelectorAll('.sidebar-nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    const content = this.container.querySelector('#netapp-content');
    if (!content) return;
    content.innerHTML = this._renderViewContent();
    this._mountView(content);
  }

  _mountView(content) {
    if (this.activeView === 'overview' && typeof NetOverview !== 'undefined') {
      this._viewInstance = new NetOverview(this);
      this._viewInstance.init(content);
    } else if (this.activeView === 'hosts' && typeof NetHostList !== 'undefined') {
      this._viewInstance = new NetHostList(this);
      this._viewInstance.init(content);
    } else if (this.activeView === 'host-detail' && typeof NetHostDetail !== 'undefined') {
      this._viewInstance = new NetHostDetail(this, this._viewData);
      this._viewInstance.init(content);
    } else if (this.activeView === 'discovery' && typeof NetDiscovery !== 'undefined') {
      this._viewInstance = new NetDiscovery(this);
      this._viewInstance.init(content);
    } else if (this.activeView === 'history' && typeof NetHistory !== 'undefined') {
      this._viewInstance = new NetHistory(this);
      this._viewInstance.init(content);
    } else if (this.activeView === 'alerts' && typeof NetAlerts !== 'undefined') {
      this._viewInstance = new NetAlerts(this);
      this._viewInstance.init(content);
    }
  }

  _destroyView() {
    if (this._viewInstance && typeof this._viewInstance.destroy === 'function') {
      this._viewInstance.destroy();
    }
    this._viewInstance = null;
  }

  // ================================================================
  //  Event Listeners
  // ================================================================

  _bindEvents() {
    // Sidebar nav
    this.container.querySelectorAll('.sidebar-nav-item').forEach(btn => {
      btn.addEventListener('click', () => this.navigateTo(btn.dataset.view));
    });

    // Sidebar toggle
    const toggle = this.container.querySelector('.sidebar-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        this.sidebarCollapsed = !this.sidebarCollapsed;
        const sidebar = this.container.querySelector('.netapp-sidebar');
        if (sidebar) sidebar.classList.toggle('collapsed', this.sidebarCollapsed);
        this._saveState();
      });
    }

    // Add Host — if the host list view is active, delegate to its modal
    const addBtn = this.container.querySelector('.toolbar-add-host');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        if (this._viewInstance && typeof this._viewInstance.showAddModal === 'function') {
          this._viewInstance.showAddModal();
        } else {
          this.navigateTo('hosts');
        }
      });
    }

    // Time range — persist selection
    const timeRange = this.container.querySelector('.toolbar-time-range');
    if (timeRange) {
      timeRange.addEventListener('change', () => this._saveState());
    }

    // Keyboard navigation
    this._keyHandler = (e) => this._handleKeyboard(e);
    document.addEventListener('keydown', this._keyHandler);
  }

  _handleKeyboard(e) {
    if (e.key === 'Escape') {
      this._handleEscape(e);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
      this._handleSidebarNav(e);
    }
  }

  _handleEscape(e) {
    if (this._viewInstance?.hideAddModal) {
      const modal = this.container.querySelector('#hl-add-modal');
      if (modal?.style.display !== 'none') {
        this._viewInstance.hideAddModal();
        e.preventDefault();
        return;
      }
    }
    if (this.activeView === 'host-detail') {
      this.navigateTo('hosts');
      e.preventDefault();
      return;
    }
    if (document.activeElement?.tagName === 'INPUT') {
      document.activeElement.blur();
      e.preventDefault();
    }
  }

  _handleSidebarNav(e) {
    const sidebar = this.container.querySelector('.sidebar-nav');
    if (!sidebar?.contains(document.activeElement)) return;
    const items = [...sidebar.querySelectorAll('.sidebar-nav-item')];
    const idx = items.indexOf(document.activeElement);
    if (idx === -1) return;
    if (e.key === 'ArrowDown' && idx < items.length - 1) {
      items[idx + 1].focus();
      e.preventDefault();
    } else if (e.key === 'ArrowUp' && idx > 0) {
      items[idx - 1].focus();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      document.activeElement.click();
      e.preventDefault();
    }
  }

  // ================================================================
  //  Cleanup
  // ================================================================

  destroy() {
    this._destroyView();
    this.unsubscribes.forEach(fn => { if (typeof fn === 'function') fn(); });
    if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
    this._saveState();
  }
}

// --- Tab registration ---

(function registerNetApp() {
  function doRegister() {
    if (!globalThis.tabManager) { setTimeout(doRegister, 0); return; }
    globalThis.tabManager.registerTabType('netops-dashboard', {
      render: (tab, container) => {
        container.innerHTML = '';
        const app = new NetApp();
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
    globalThis._hub.moduleOpeners['netops'] = function openNetOps(mod) {
      const tm = globalThis.tabManager;
      if (!tm) return;

      // Reuse existing tab
      const existing = tm.getTabsByType('netops-dashboard');
      if (existing.length > 0) {
        tm.switchTab(existing[0].id);
        return;
      }

      if (tm.hasTabType('netops-dashboard')) {
        tm.createTab('netops-dashboard', 'NetOps Monitor', { moduleId: mod.id }, { target: 'module' });
      }
    };
  }
  doRegister();
})();
