/**
 * Script Runner — ScriptApp
 * Root layout component: NetOps-style sidebar + script browser + in-module execution.
 *
 * Sidebar sections:
 *   Active    — currently running execution sessions
 *   Favorites — starred scripts (persisted in localStorage)
 *   Autostart — scripts that auto-run on module open (persisted in localStorage)
 *   Topics    — the existing topic list (TopicList component)
 */

(function() {
const API = globalThis.api;
globalThis.API = API;

const SCRIPT_RUNNER_LS_KEY = 'script-runner-ui-state';
const SCRIPT_RUNNER_MAX_HISTORY = 50;

function createSessionId() {
  return `sr-exec-${globalThis.crypto.randomUUID()}`;
}

class ScriptApp {
  constructor() {
    this.scripts = [];
    this.allScripts = []; // always unfiltered — used for favorites sidebar
    this.topics = [];
    this.selectedTopicId = null;
    this.sidebarCollapsed = false;
    this.activeView = 'browser'; // 'browser' | 'execution' | 'dashboard'
    this.activeSessionId = null; // currently shown execution session
    // sessions: Map<sessionId, { id, scriptId, scriptName, scriptPath, scriptEnv, status, autoRun }>
    this.sessions = new Map();
    this.unsubscribes = [];
    this.topicListInstance = null;
    this.chainListInstance = null;
    this.scheduleListInstance = null;
    this.scriptBrowserInstance = null;
    this.dashboardInstance = null;
    // Execution history: { sessionId, scriptId, scriptName, exitCode, runtime, timestamp, status }
    this.executionHistory = [];
    // Favorites: Set of scriptIds stored in localStorage
    this.favorites = new Set();
    this._restoreState();
  }

  async init(el) {
    console.log('[script-app] Initializing');
    this.container = el;
    this.render();

    // Load initial data — scripts must load first so store.scripts is populated
    // before get-topics runs (topic script_count depends on store.scripts).
    try {
      await this.loadAllScripts();
      await Promise.all([this.loadTopics(), this.loadScripts()]);
      console.log('[script-app] Data loaded:', this.topics.length, 'topics,', this.scripts.length, 'scripts');
    } catch (err) {
      console.error('[script-app] Failed to load initial data:', err.message);
    }

    // Mount chain list into the sidebar chains section
    const chainsSectionEl = this.container.querySelector('#sr-chains-section');
    if (chainsSectionEl) {
      try {
        this.chainListInstance = new ChainList(this);
        await this.chainListInstance.init(chainsSectionEl);
        console.log('[script-app] ChainList mounted');
      } catch (err) {
        console.error('[script-app] Failed to mount ChainList:', err.message);
      }
    }

    // Mount topic list into the sidebar topics section
    const topicsSectionEl = this.container.querySelector('#sr-topics-section');
    if (topicsSectionEl) {
      try {
        this.topicListInstance = new TopicList(this);
        await this.topicListInstance.init(topicsSectionEl);
        console.log('[script-app] TopicList mounted');
      } catch (err) {
        console.error('[script-app] Failed to mount TopicList:', err.message);
      }
    }

    // Mount schedule list into the sidebar schedules section
    const schedulesSectionEl = this.container.querySelector('#sr-schedules-section');
    if (schedulesSectionEl) {
      try {
        this.scheduleListInstance = new ScheduleList(this);
        await this.scheduleListInstance.init(schedulesSectionEl);
        console.log('[script-app] ScheduleList mounted');
      } catch (err) {
        console.error('[script-app] Failed to mount ScheduleList:', err.message);
      }
    }

    // Mount script browser into the main content area (default view)
    this._mountBrowserView();

    // Re-render sidebar sections now that scripts are loaded and views are mounted
    this._updateSidebarSections();

    // Setup real-time updates
    this.setupRealtimeUpdates();

    console.log('[script-app] Initialization complete');
  }

  _restoreState() {
    try {
      const raw = localStorage.getItem(SCRIPT_RUNNER_LS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if ('selectedTopicId' in s) this.selectedTopicId = s.selectedTopicId;
      if (s.sidebarCollapsed != null) this.sidebarCollapsed = s.sidebarCollapsed;
      if (Array.isArray(s.favorites)) this.favorites = new Set(s.favorites);
    } catch (err) {
      console.error('[script-runner] Failed to restore UI state:', err);
    }
  }

  _saveState() {
    try {
      const obj = {
        selectedTopicId: this.selectedTopicId,
        sidebarCollapsed: this.sidebarCollapsed,
        favorites: [...this.favorites],
      };
      localStorage.setItem(SCRIPT_RUNNER_LS_KEY, JSON.stringify(obj));
    } catch { /* quota exceeded — ignore */ }
  }

  // --- Data Loading ---

  async loadTopics() {
    try {
      const result = await API.invoke('script-runner:get-topics');
      this.topics = result.topics || [];
      return this.topics;
    } catch (err) {
      console.error('[script-runner] Failed to load topics:', err.message);
      return [];
    }
  }

  async loadScripts() {
    try {
      const result = await API.invoke('script-runner:get-scripts', {
        topic_id: this.selectedTopicId,
      });
      this.scripts = result.scripts || [];
      return this.scripts;
    } catch (err) {
      console.error('[script-runner] Failed to load scripts:', err.message);
      return [];
    }
  }

  async loadAllScripts() {
    try {
      const result = await API.invoke('script-runner:get-scripts', { topic_id: null });
      this.allScripts = result.scripts || [];
      return this.allScripts;
    } catch (err) {
      console.error('[script-runner] Failed to load all scripts:', err.message);
      return [];
    }
  }

  async loadScriptsGroupedByTopic() {
    try {
      const groups = await Promise.all(
        this.topics.map(async (topic) => {
          const result = await API.invoke('script-runner:get-scripts', { topic_id: topic.id });
          return { topic, scripts: result.scripts || [] };
        })
      );
      const groupedIds = new Set(groups.flatMap((g) => g.scripts.map((s) => s.id || s.folder)));
      const ungrouped = this.allScripts.filter((s) => !groupedIds.has(s.id || s.folder));
      return { groups: groups.filter((g) => g.scripts.length > 0), ungrouped };
    } catch (err) {
      console.error('[script-runner] Failed to load grouped scripts:', err.message);
      return { groups: [], ungrouped: this.allScripts };
    }
  }

  // --- Favorites ---

  isFavorite(scriptId) { return this.favorites.has(scriptId); }

  toggleFavorite(scriptId) {
    if (this.favorites.has(scriptId)) this.favorites.delete(scriptId);
    else this.favorites.add(scriptId);
    this._saveState();
    this._updateSidebarSections();
    if (this.scriptBrowserInstance) this.scriptBrowserInstance.render();
  }

  // --- Execution Sessions (in-module, no hub tabs) ---

  /**
   * Open an execution session for the given script/variant.
   * Renders it in the module content area.
   */
  openExecution(script, chosen, opts = {}) {
    const sessionId = createSessionId();
    const session = {
      id: sessionId,
      scriptId: script.id || script.folder,
      scriptName: script.name,
      title: script.name,
      scriptPath: chosen.scriptPath || script.scriptPath,
      scriptEnv: chosen.env || script.env || {},
      status: 'idle',
      autoRun: opts.autoRun || false,
    };
    this.sessions.set(sessionId, session);
    this._updateSidebarSections();

    if (!opts.background) {
      this.navigateToExecution(sessionId);
    }

    return session;
  }

  closeSession(sessionId) {
    // Stop if running
    if (typeof ScriptExecution !== 'undefined') {
      const state = ScriptExecution.getState(sessionId);
      if (state?.isRunning) {
        API.invoke('script-runner:stop-script', { tabId: sessionId }).catch(() => {});
      }
      ScriptExecution.removeState(sessionId);
    }
    this.sessions.delete(sessionId);

    // If we just closed the active session, switch back to browser
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
      this.activeView = 'browser';
      this._mountBrowserView();
    }

    this._updateSidebarSections();
  }

  onSessionStatusChange(sessionId) {
    // Called by ScriptExecution when a session status changes
    this._updateSidebarSections();
    // Update execution history
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.status === 'success' || session.status === 'error') {
      const state = typeof ScriptExecution !== 'undefined' ? ScriptExecution.getState(sessionId) : null;
      const entry = {
        sessionId,
        scriptId: session.scriptId,
        scriptName: session.scriptName,
        exitCode: state?.exitCode ?? null,
        runtime: state?.runtime ?? null,
        timestamp: new Date().toISOString(),
        status: session.status,
      };
      this.executionHistory.push(entry);
      if (this.executionHistory.length > SCRIPT_RUNNER_MAX_HISTORY) {
        this.executionHistory.splice(0, this.executionHistory.length - SCRIPT_RUNNER_MAX_HISTORY);
      }
    }
  }

  // --- Navigation ---

  navigateToExecution(sessionId) {
    this.activeView = 'execution';
    this.activeSessionId = sessionId;
    const content = this.container.querySelector('#sr-content');
    if (!content) return;
    content.innerHTML = '';
    if (typeof ScriptExecution !== 'undefined') {
      const session = this.sessions.get(sessionId);
      if (session) ScriptExecution.render(session, content);
    }
    this._highlightActiveSession();
  }

  navigateToBrowser() {
    this.activeView = 'browser';
    this.activeSessionId = null;
    this._mountBrowserView();
    this._highlightActiveSession();
  }

  navigateToDashboard() {
    this.activeView = 'dashboard';
    this.activeSessionId = null;
    this._mountDashboardView();
    this._highlightActiveSession();
  }

  navigateToChainBuilder(chainList, mode, chain) {
    this.activeView = 'chain-builder';
    this.activeSessionId = null;
    const content = this.container.querySelector('#sr-content');
    if (!content) return;
    content.innerHTML = '<div id="chain-builder-container"></div>';
    const el = content.querySelector('#chain-builder-container');
    if (el) chainList.mountBuilder(el, mode, chain);
    this._highlightActiveSession();
  }

  navigateToChainRunner(chainList, chain) {
    this.activeView = 'chain-runner';
    this.activeSessionId = null;
    const content = this.container.querySelector('#sr-content');
    if (!content) return;
    content.innerHTML = '<div id="chain-runner-container" style="display:flex;flex:1;min-height:0;width:100%;"></div>';
    const el = content.querySelector('#chain-runner-container');
    if (el) chainList.mountRunner(el, chain);
    this._highlightActiveSession();
  }

  navigateToScheduleBuilder(scheduleList, mode, schedule) {
    this.activeView = 'schedule-builder';
    this.activeSessionId = null;
    const content = this.container.querySelector('#sr-content');
    if (!content) return;
    content.innerHTML = '<div id="schedule-builder-container"></div>';
    const el = content.querySelector('#schedule-builder-container');
    if (el) scheduleList.mountBuilder(el, mode, schedule);
    this._highlightActiveSession();
  }

  _mountDashboardView() {
    const content = this.container.querySelector('#sr-content');
    if (!content) return;
    content.innerHTML = '<div id="script-dashboard-container"></div>';
    const el = content.querySelector('#script-dashboard-container');
    if (!el) return;
    if (typeof ScriptDashboard !== 'undefined') {
      if (!this.dashboardInstance) {
        this.dashboardInstance = new ScriptDashboard(this);
      }
      this.dashboardInstance.init(el);
    }
  }

  _mountBrowserView() {
    const content = this.container.querySelector('#sr-content');
    if (!content) return;
    content.innerHTML = '<div id="script-browser-container"></div>';
    const browserEl = content.querySelector('#script-browser-container');
    if (browserEl) {
      if (this.scriptBrowserInstance) {
        this.scriptBrowserInstance.init(browserEl);
      } else {
        this.scriptBrowserInstance = new ScriptBrowser(this);
        this.scriptBrowserInstance.init(browserEl);
      }
    }
  }

  _highlightActiveSession() {
    if (!this.container) return;
    this.container.querySelectorAll('.sr-session-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.sessionId === this.activeSessionId);
    });
    // Update nav item active states
    const dashNav = this.container.querySelector('#sr-nav-dashboard');
    const allNav = this.container.querySelector('#sr-nav-all-scripts');
    if (dashNav) dashNav.classList.toggle('active', this.activeView === 'dashboard');
    if (allNav) allNav.classList.toggle('active', this.activeView === 'browser' && !this.selectedTopicId);
  }

  // --- Real-time Updates ---

  setupRealtimeUpdates() {
    const unsub1 = API.on('script-runner:topic-created', (data) => {
      this.topics.push(data.topic);
      if (this.topicListInstance) this.topicListInstance.render();
    });

    const unsub2 = API.on('script-runner:topic-updated', (data) => {
      const idx = this.topics.findIndex((t) => t.id === data.topic.id);
      if (idx >= 0) {
        this.topics[idx] = data.topic;
        if (this.topicListInstance) this.topicListInstance.render();
      }
    });

    const unsub3 = API.on('script-runner:topic-deleted', async (data) => {
      this.topics = this.topics.filter((t) => t.id !== data.topic_id);
      if (this.selectedTopicId === data.topic_id) {
        this.selectedTopicId = null;
      }
      await this.loadScripts();
      await this.loadAllScripts();
      if (this.topicListInstance) this.topicListInstance.render();
      if (this.scriptBrowserInstance) this.scriptBrowserInstance.render();
      this._updateSidebarSections();
    });

    const unsub4 = API.on('script-runner:scripts-updated', async (data) => {
      this.scripts = data.scripts || [];
      await this.loadAllScripts();
      if (this.scriptBrowserInstance) this.scriptBrowserInstance.render();
      if (this.topicListInstance) this.topicListInstance.render();
      this._updateSidebarSections();
    });

    // Reload topic counts + script cards when scripts are added/removed from topics
    const _reloadTopicCounts = async () => {
      await this.loadTopics();
      await this.loadScripts();
      await this.loadAllScripts();
      if (this.topicListInstance) this.topicListInstance.render();
      if (this.scriptBrowserInstance) this.scriptBrowserInstance.render();
      this._updateSidebarSections();
    };
    const unsub5 = API.on('script-runner:script-added-to-topic', _reloadTopicCounts);
    const unsub6 = API.on('script-runner:script-removed-from-topic', _reloadTopicCounts);

    this.unsubscribes = [unsub1, unsub2, unsub3, unsub4, unsub5, unsub6];
  }

  // --- Rendering ---

  render() {
    const collapsed = this.sidebarCollapsed ? ' collapsed' : '';
    this.container.innerHTML = `
      <div class="sr-app">
        <aside class="sr-sidebar${collapsed}" id="sr-sidebar">
          <div class="sr-sidebar-header">
            <span class="sr-sidebar-title">Script Runner</span>
            <button class="sr-sidebar-toggle" id="sr-sidebar-toggle" title="Toggle sidebar">&#9776;</button>
          </div>

          <div class="sr-sidebar-section sr-sidebar-nav-section">
            <div class="sr-nav-item${this.activeView === 'browser' && !this.selectedTopicId ? ' active' : ''}" id="sr-nav-all-scripts" title="All Scripts">
              <span class="sr-nav-icon">&#x229E;</span>
              <span class="sr-nav-label">All Scripts</span>
              <span class="sr-nav-count" id="sr-nav-all-count">${this.allScripts.length}</span>
            </div>
            <div class="sr-nav-item${this.activeView === 'dashboard' ? ' active' : ''}" id="sr-nav-dashboard" title="Execution History">
              <span class="sr-nav-icon">&#x29D6;</span>
              <span class="sr-nav-label">History</span>
            </div>
          </div>

          <div class="sr-sidebar-section" id="sr-active-section">
            <div class="sr-section-header">
              <span class="sr-section-title">Active</span>
              <span class="sr-section-badge" id="sr-active-badge" style="display:none"></span>
            </div>
            <div class="sr-section-body" id="sr-active-list"></div>
          </div>

          <div class="sr-sidebar-section" id="sr-favorites-section">
            <div class="sr-section-header">
              <span class="sr-section-title">Favorites</span>
            </div>
            <div class="sr-section-body" id="sr-favorites-list"></div>
          </div>

          <div class="sr-sidebar-section sr-topics-section" id="sr-topics-section">
          </div>

          <div class="sr-sidebar-section sr-chains-section" id="sr-chains-section">
          </div>

          <div class="sr-sidebar-section sr-schedules-section" id="sr-schedules-section">
          </div>
        </aside>
        <div class="sr-main" id="sr-main">
          <div class="sr-content" id="sr-content"></div>
        </div>
      </div>
    `;
    this._bindEvents();
    this._updateSidebarSections();
  }

  _bindEvents() {
    // Sidebar toggle
    const toggle = this.container.querySelector('#sr-sidebar-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        this.sidebarCollapsed = !this.sidebarCollapsed;
        const sidebar = this.container.querySelector('#sr-sidebar');
        if (sidebar) sidebar.classList.toggle('collapsed', this.sidebarCollapsed);
        this._saveState();
      });
    }

    // Dashboard nav
    const dashNav = this.container.querySelector('#sr-nav-dashboard');
    if (dashNav) {
      dashNav.addEventListener('click', () => this.navigateToDashboard());
    }

    // All Scripts nav
    const allNav = this.container.querySelector('#sr-nav-all-scripts');
    if (allNav) {
      allNav.addEventListener('click', () => this.selectTopic(null));
    }

  }

  _updateSidebarSections() {
    this._renderActiveList();
    this._renderFavoritesList();
    // Update All Scripts count badge
    const countEl = this.container?.querySelector('#sr-nav-all-count');
    if (countEl) countEl.textContent = this.allScripts.length;
    this._highlightActiveSession();
  }

  _renderActiveList() {
    const list = this.container?.querySelector('#sr-active-list');
    const badge = this.container?.querySelector('#sr-active-badge');
    if (!list) return;

    const runningSessions = [...this.sessions.values()].filter(
      (s) => s.status === 'running' || s.status === 'queued' || s.status === 'idle'
    );
    const allSessions = [...this.sessions.values()];

    if (badge) {
      const runningCount = allSessions.filter((s) => s.status === 'running').length;
      badge.textContent = runningCount;
      badge.style.display = runningCount > 0 ? '' : 'none';
    }

    if (allSessions.length === 0) {
      list.innerHTML = '<div class="sr-section-empty">No active sessions</div>';
      return;
    }

    list.innerHTML = allSessions.map((s) => {
      const statusIcon = this._sessionStatusIcon(s.status);
      const isActive = s.id === this.activeSessionId;
      return `
        <div class="sr-session-item${isActive ? ' active' : ''}" data-session-id="${s.id}" title="${this._escapeHtml(s.scriptName)}">
          <span class="sr-session-status sr-status-${s.status}">${statusIcon}</span>
          <span class="sr-session-name">${this._escapeHtml(s.scriptName)}</span>
          <button class="sr-session-close" data-session-id="${s.id}" title="Close session">&#x2715;</button>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.sr-session-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.sr-session-close')) return;
        this.navigateToExecution(el.dataset.sessionId);
      });
    });

    list.querySelectorAll('.sr-session-close').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeSession(btn.dataset.sessionId);
      });
    });
  }

  _renderFavoritesList() {
    const list = this.container?.querySelector('#sr-favorites-list');
    if (!list) return;

    const favScripts = this.allScripts.filter((s) => this.favorites.has(s.id || s.folder));
    if (favScripts.length === 0) {
      list.innerHTML = '<div class="sr-section-empty">No favorites yet<br><small>Click ❤ on a script card</small></div>';
      return;
    }

    list.innerHTML = favScripts.map((s) => `
      <div class="sr-quick-item" data-script-id="${this._escapeHtml(s.id || s.folder)}" title="${this._escapeHtml(s.name)}">
        <span class="sr-quick-icon">&#9829;</span>
        <span class="sr-quick-name">${this._escapeHtml(s.name)}</span>
        <button class="sr-quick-run" data-script-id="${this._escapeHtml(s.id || s.folder)}" title="Run">&#9654;</button>
      </div>
    `).join('');

    list.querySelectorAll('.sr-quick-run').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const script = this.allScripts.find((s) => (s.id || s.folder) === btn.dataset.scriptId);
        if (script) this.openExecution(script, (script.variants?.[0] ?? script), { autoRun: true });
      });
    });

    list.querySelectorAll('.sr-quick-item').forEach((item) => {
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        const script = this.allScripts.find((s) => (s.id || s.folder) === item.dataset.scriptId);
        if (script) this._quickRun(script);
      });
    });
  }

  _sessionStatusIcon(status) {
    const icons = { running: '●', success: '✓', error: '✗', queued: '◷', idle: '○' };
    return icons[status] || '○';
  }

  _quickRun(script) {
    const variants = script.variants || [];
    const chosen = variants.length > 0 ? variants[0] : script;
    this.openExecution(script, chosen, { autoRun: false });
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
  }

  async selectTopic(topicId) {
    this.selectedTopicId = topicId;
    this._saveState();
    await this.loadScripts();
    if (this.topicListInstance) this.topicListInstance.render();
    if (this.scriptBrowserInstance) this.scriptBrowserInstance.render();
    // If on browser view, stay there; otherwise switch
    if (this.activeView !== 'browser') this.navigateToBrowser();
    this._updateSidebarSections();
  }

  /**
   * Returns the last `limit` execution history entries for a given script,
   * most-recent first.
   */
  getRecentRuns(scriptId, limit = 5) {
    return this.executionHistory
      .filter((r) => r.scriptId === scriptId)
      .slice(-limit)
      .reverse();
  }

  destroy() {
    for (const unsub of this.unsubscribes) {
      if (unsub) unsub();
    }
    if (this.chainListInstance) this.chainListInstance.destroy?.();
    if (this.scheduleListInstance) this.scheduleListInstance.destroy?.();
    if (this.topicListInstance) this.topicListInstance.destroy?.();
    if (this.scriptBrowserInstance) this.scriptBrowserInstance.destroy?.();
    if (this.dashboardInstance) this.dashboardInstance.destroy?.();
    // Stop running sessions
    for (const [sessionId] of this.sessions) {
      if (typeof ScriptExecution !== 'undefined') ScriptExecution.removeState(sessionId);
    }
    this.sessions.clear();
  }
}

// Register with TabManager
(function registerTabType() {
  function doRegister() {
    if (!globalThis.tabManager) {
      setTimeout(doRegister, 0);
      return;
    }
    
    globalThis.tabManager.registerTabType('script-home', {
      render(tab, container) {
        container.innerHTML = '';

        if (tab._appInstance) {
          // Subsequent visits: re-render layout, restore state, reattach components
          const app = tab._appInstance;
          app.container = container;
          app.render();
          const chainsSectionEl = container.querySelector('#sr-chains-section');
          if (chainsSectionEl && app.chainListInstance) app.chainListInstance.init(chainsSectionEl);
          const schedulesSectionEl = container.querySelector('#sr-schedules-section');
          if (schedulesSectionEl && app.scheduleListInstance) app.scheduleListInstance.init(schedulesSectionEl);
          const topicsSectionEl = container.querySelector('#sr-topics-section');
          if (topicsSectionEl && app.topicListInstance) app.topicListInstance.init(topicsSectionEl);
          // Restore view (browser, dashboard, or active execution)
          if (app.activeView === 'execution' && app.activeSessionId && app.sessions.has(app.activeSessionId)) {
            app.navigateToExecution(app.activeSessionId);
          } else if (app.activeView === 'dashboard') {
            app._mountDashboardView();
          } else {
            app._mountBrowserView();
          }
          app._updateSidebarSections();
        } else {
          // First visit: full init (loads data, mounts children, sets up IPC listeners)
          tab._appInstance = new ScriptApp();
          tab._appInstance.init(container);
        }
      },
      onClose(tab) {
        if (tab._appInstance) {
          tab._appInstance.destroy();
          tab._appInstance = null;
        }
      },
      maxTabs: 1,
    });
    
    console.log('[script-app] TabManager registration complete');
  }
  
  doRegister();
})();

// Register module opener for hub's module list
(function registerModuleOpener() {
  function doRegister() {
    if (!globalThis._hub) {
      setTimeout(doRegister, 0);
      return;
    }
    
    globalThis._hub.moduleOpeners = globalThis._hub.moduleOpeners || {};
    globalThis._hub.moduleOpeners['script-runner'] = function openScriptRunner(mod) {
      const tm = globalThis.tabManager;
      if (!tm) return;

      // Reuse existing tab
      const existing = tm.getTabsByType('script-home');
      if (existing.length > 0) {
        tm.switchTab(existing[0].id);
        return;
      }

      if (tm.hasTabType('script-home')) {
        tm.createTab('script-home', 'Scripts', { moduleId: mod.id }, { target: 'module' });
      }
    };
    
    console.log('[script-app] Module opener registration complete');
  }
  
  doRegister();
})();

})();
