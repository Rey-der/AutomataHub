class TabManager {
  constructor() {
    this.tabs = new Map();
    this.activeTabId = 'home';
    this._tabTypeRenderers = new Map();
    this._maxTabsPerType = new Map();

    this.tabs.set('home', { id: 'home', type: 'home', title: 'Home', status: 'idle', target: 'main' });

    this.mainTabBar = document.getElementById('main-tab-bar');
    this.autoStartTabs = document.getElementById('auto-start-tabs');
    this.moduleTabBar = document.getElementById('module-tab-bar');
    this.tabContent = document.getElementById('tab-content');

    // Bind Home tab click
    const homeBtn = this.mainTabBar.querySelector('[data-tab-id="home"]');
    if (homeBtn) {
      homeBtn.addEventListener('click', () => this.switchTab('home'));
    }
  }

  /**
   * Register a tab type with its renderer callbacks.
   * @param {string} typeId — unique tab type identifier
   * @param {object} opts — { render(tab, container), onClose?(tab), maxTabs? }
   */
  registerTabType(typeId, opts) {
    if (!typeId || !opts || typeof opts.render !== 'function') {
      throw new Error(`registerTabType: "${typeId}" must provide a render function`);
    }
    this._tabTypeRenderers.set(typeId, opts);
    if (opts.maxTabs) {
      this._maxTabsPerType.set(typeId, opts.maxTabs);
    }
  }

  /**
   * Check if a tab type is registered.
   */
  hasTabType(typeId) {
    return typeId === 'home' || this._tabTypeRenderers.has(typeId);
  }

  getActiveTabId() {
    return this.activeTabId;
  }

  getTab(tabId) {
    return this.tabs.get(tabId) || null;
  }

  getExecutionTabs() {
    return [...this.tabs.values()].filter((t) => t.type !== 'home');
  }

  getTabsByType(type) {
    return [...this.tabs.values()].filter((t) => t.type === type);
  }

  /**
   * Create a new tab of a registered type.
   * @param {string} type — registered tab type
   * @param {string} title — tab display title
   * @param {object} data — extra properties to attach to the tab object
   * @param {object} opts — { reuseKey?: string } — if set, reuse existing tab with matching reuseKey
   * @returns {object|null} the tab object, or null if limit reached
   */
  /**
   * Create a new tab of a registered type.
   * @param {string} type — registered tab type
   * @param {string} title — tab display title
   * @param {object} data — extra properties to attach to the tab object
   * @param {object} opts — { reuseKey?: string, target?: 'main'|'module' }
   * @returns {object|null} the tab object, or null if limit reached
   */
  createTab(type, title, data = {}, opts = {}) {
    // Check if this type is registered
    if (!this._tabTypeRenderers.has(type)) {
      console.warn(`[tab-manager] Unknown tab type: ${type}`);
      return null;
    }

    // Reuse existing tab if reuseKey matches
    if (opts.reuseKey) {
      const existing = [...this.tabs.values()].find(
        (tab) => tab.type === type && tab.reuseKey === opts.reuseKey
      );
      if (existing) {
        this.switchTab(existing.id);
        return existing;
      }
    }

    // Enforce max tabs per type
    const maxForType = this._maxTabsPerType.get(type) || 4;
    const typeTabs = this.getTabsByType(type);
    if (typeTabs.length >= maxForType) {
      window.ui.showNotification(`Maximum of ${maxForType} ${type} tabs reached. Close a tab first.`, 'warning');
      return null;
    }

    const target = opts.target || 'module';
    const id = `${type}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const tab = {
      id,
      type,
      title,
      status: 'idle',
      target,
      reuseKey: opts.reuseKey || null,
      ...data,
    };

    this.tabs.set(id, tab);
    this._renderTabButton(tab);
    this._updateModuleBarVisibility();
    if (!opts.background) {
      this.switchTab(id);
    }
    return tab;
  }

  switchTab(tabId) {
    if (!this.tabs.has(tabId)) return false;

    this.activeTabId = tabId;

    // Update active state across both tab bars
    this._getAllTabButtons().forEach((btn) => {
      const isActive = btn.dataset.tabId === tabId;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });

    // Render the tab content
    this._renderContent(tabId);
    return true;
  }

  closeTab(tabId) {
    if (tabId === 'home' || !this.tabs.has(tabId)) return false;

    const tab = this.tabs.get(tabId);

    // Call the registered onClose callback if available
    const typeOpts = this._tabTypeRenderers.get(tab.type);
    if (typeOpts && typeof typeOpts.onClose === 'function') {
      typeOpts.onClose(tab);
    }

    this.tabs.delete(tabId);

    // Remove tab button from whichever bar it's in
    const btn = this._findTabButton(tabId);
    if (btn) btn.remove();

    this._updateModuleBarVisibility();

    // Switch to home if this was active
    if (this.activeTabId === tabId) {
      this.switchTab('home');
    }
    return true;
  }

  updateTabStatus(tabId, status) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    tab.status = status;

    const btn = this._findTabButton(tabId);
    if (!btn) return;

    const indicator = btn.querySelector('.tab-status');
    if (!indicator) return;

    const icons = { running: '●', success: '✓', error: '✗', queued: '◷', idle: '' };
    indicator.textContent = icons[status] || '';
    indicator.className = 'tab-status';
    if (status !== 'idle') {
      indicator.classList.add(`status-${status}`);
    }
  }

  _renderTabButton(tab) {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.tabId = tab.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.setAttribute('aria-controls', 'tab-content');
    btn.setAttribute('aria-label', `${tab.title} tab`);

    const statusSpan = document.createElement('span');
    statusSpan.className = 'tab-status';
    statusSpan.setAttribute('aria-hidden', 'true');
    btn.appendChild(statusSpan);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = tab.title;
    btn.appendChild(titleSpan);

    const closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('tabindex', '0');
    closeBtn.setAttribute('role', 'button');
    closeBtn.setAttribute('aria-label', `Close ${tab.title} tab`);
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tab.id);
    });
    closeBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        this.closeTab(tab.id);
      }
    });
    btn.appendChild(closeBtn);

    btn.addEventListener('click', () => this.switchTab(tab.id));

    // Route to the correct tab bar
    if (tab.target === 'main') {
      this.autoStartTabs.appendChild(btn);
    } else {
      this.moduleTabBar.appendChild(btn);
    }
  }

  /**
   * Find a tab button across both bars.
   */
  _findTabButton(tabId) {
    return this.mainTabBar.querySelector(`[data-tab-id="${tabId}"]`)
      || this.moduleTabBar.querySelector(`[data-tab-id="${tabId}"]`);
  }

  /**
   * Get all tab buttons from both bars.
   */
  _getAllTabButtons() {
    return [
      ...this.mainTabBar.querySelectorAll('.tab'),
      ...this.moduleTabBar.querySelectorAll('.tab'),
    ];
  }

  /**
   * Show/hide the module tab bar based on whether it has tabs.
   */
  _updateModuleBarVisibility() {
    const hasTabs = this.moduleTabBar.querySelectorAll('.tab').length > 0;
    this.moduleTabBar.classList.toggle('hidden', !hasTabs);
  }

  _renderContent(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    if (tab.type === 'home') {
      // Home tab is always rendered by the hub dashboard
      if (window.homeTab) {
        window.homeTab.render();
      }
      return;
    }

    // Dispatch to registered tab type renderer
    const typeOpts = this._tabTypeRenderers.get(tab.type);
    if (typeOpts && typeof typeOpts.render === 'function') {
      typeOpts.render(tab, this.tabContent);
    }
  }
}

// TabManager is instantiated by module-bootstrap.js after all modules are loaded
