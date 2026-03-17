/**
 * Script Runner — ScriptApp
 * Root layout component: topic sidebar + script browser + state management.
 * Similar to NetApp for NetOps module.
 */

if (typeof API === 'undefined') {
  var API = window.api;
}

const SCRIPT_RUNNER_LS_KEY = 'script-runner-ui-state';
const SCRIPT_RUNNER_MAX_HISTORY = 50;

class ScriptApp {
  constructor() {
    this.scripts = [];
    this.topics = [];
    this.selectedTopicId = null;
    this.unsubscribes = [];
    this.topicListInstance = null;
    this.scriptBrowserInstance = null;
    // Execution history: { tabId, scriptId, scriptName, exitCode, runtime, timestamp, status }
    this.executionHistory = [];
    this._restoreState();
  }

  async init(el) {
    console.log('[script-app] Initializing');
    this.container = el;
    this.render();

    // Load initial data
    try {
      await Promise.all([this.loadTopics(), this.loadScripts()]);
      console.log('[script-app] Data loaded:', this.topics.length, 'topics,', this.scripts.length, 'scripts');
    } catch (err) {
      console.error('[script-app] Failed to load initial data:', err.message);
    }

    // Mount topic list sidebar
    const sidebarEl = this.container.querySelector('#script-sidebar');
    if (sidebarEl) {
      try {
        this.topicListInstance = new TopicList(this);
        await this.topicListInstance.init(sidebarEl);
        console.log('[script-app] TopicList mounted');
      } catch (err) {
        console.error('[script-app] Failed to mount TopicList:', err.message);
      }
    }

    // Mount script browser
    const browserEl = this.container.querySelector('#script-browser-container');
    if (browserEl) {
      try {
        this.scriptBrowserInstance = new ScriptBrowser(this);
        await this.scriptBrowserInstance.init(browserEl);
        console.log('[script-app] ScriptBrowser mounted');
      } catch (err) {
        console.error('[script-app] Failed to mount ScriptBrowser:', err.message);
      }
    }

    // Setup real-time updates
    this.setupRealtimeUpdates();
    console.log('[script-app] Initialization complete');
  }

  _restoreState() {
    try {
      const raw = localStorage.getItem(SCRIPT_RUNNER_LS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.selectedTopicId) this.selectedTopicId = s.selectedTopicId;
    } catch (err) {
      console.error('[script-runner] Failed to restore UI state:', err);
    }
  }

  _saveState() {
    try {
      const obj = { selectedTopicId: this.selectedTopicId };
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

    const unsub3 = API.on('script-runner:topic-deleted', (data) => {
      this.topics = this.topics.filter((t) => t.id !== data.topic_id);
      if (this.selectedTopicId === data.topic_id) {
        this.selectedTopicId = null;
      }
      if (this.topicListInstance) this.topicListInstance.render();
      if (this.scriptBrowserInstance) this.scriptBrowserInstance.render();
    });

    const unsub4 = API.on('script-runner:scripts-updated', (data) => {
      this.scripts = data.scripts || [];
      if (this.scriptBrowserInstance) this.scriptBrowserInstance.render();
    });

    // Track execution history for "Recent Runs" in detail panel
    const unsub5 = API.on('script-runner:complete', (data) => {
      const tab = window.tabManager?.getTab?.(data.tabId);
      const entry = {
        tabId: data.tabId,
        scriptId: tab?.scriptId || data.tabId,
        scriptName: tab?.scriptName || tab?.title || '—',
        exitCode: data.exitCode,
        runtime: data.runtime,
        timestamp: new Date().toISOString(),
        status: data.exitCode === 0 ? 'success' : 'error',
      };
      this.executionHistory.push(entry);
      if (this.executionHistory.length > SCRIPT_RUNNER_MAX_HISTORY) {
        this.executionHistory.splice(0, this.executionHistory.length - SCRIPT_RUNNER_MAX_HISTORY);
      }
    });

    this.unsubscribes = [unsub1, unsub2, unsub3, unsub4, unsub5];
  }

  // --- Rendering ---

  render() {
    this.container.innerHTML = `
      <div class="script-app">
        <div class="script-app-sidebar" id="script-sidebar"></div>
        <div class="script-app-main">
          <div id="script-browser-container"></div>
        </div>
      </div>
    `;
  }

  async selectTopic(topicId) {
    this.selectedTopicId = topicId;
    this._saveState();
    await this.loadScripts();
    if (this.topicListInstance) this.topicListInstance.render();
    if (this.scriptBrowserInstance) this.scriptBrowserInstance.render();
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
    if (this.topicListInstance) this.topicListInstance.destroy?.();
    if (this.scriptBrowserInstance) this.scriptBrowserInstance.destroy?.();
  }
}

// Register with TabManager
(function registerTabType() {
  function doRegister() {
    if (!window.tabManager) {
      setTimeout(doRegister, 0);
      return;
    }
    
    window.tabManager.registerTabType('script-home', {
      render(tab, container) {
        container.innerHTML = '';

        if (!tab._appInstance) {
          // First visit: full init (loads data, mounts children, sets up IPC listeners)
          tab._appInstance = new ScriptApp();
          tab._appInstance.init(container);
        } else {
          // Subsequent visits: re-render layout into the fresh container, reattach children
          const app = tab._appInstance;
          app.container = container;
          app.render();
          const sidebarEl = container.querySelector('#script-sidebar');
          const browserEl = container.querySelector('#script-browser-container');
          if (sidebarEl && app.topicListInstance) app.topicListInstance.init(sidebarEl);
          if (browserEl && app.scriptBrowserInstance) app.scriptBrowserInstance.init(browserEl);
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
    if (!window._hub) {
      setTimeout(doRegister, 0);
      return;
    }
    
    window._hub.moduleOpeners = window._hub.moduleOpeners || {};
    window._hub.moduleOpeners['script-runner'] = function openScriptRunner(mod) {
      if (window.tabManager && window.tabManager.hasTabType('script-home')) {
        console.log('[script-app] Opening Scripts tab for module:', mod.id);
        window.tabManager.createTab('script-home', 'Scripts', { moduleId: mod.id }, { target: 'module' });
      } else {
        console.warn('[script-app] Script-home tab type not registered or tabManager not available');
      }
    };
    
    console.log('[script-app] Module opener registration complete');
  }
  
  doRegister();
})();
