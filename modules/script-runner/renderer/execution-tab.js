/**
 * Script Runner — execution tab renderer.
 * Provides a live terminal view for running scripts.
 * Registers the "script-execution" tab type with TabManager.
 */

const ScriptExecution = (() => {
  // Per-tab state keyed by tabId
  const tabStates = new Map();
  const MAX_LINES = 1000;

  function getState(tabId) {
    if (!tabStates.has(tabId)) {
      tabStates.set(tabId, {
        lines: [],
        lineCount: 0,
        isRunning: false,
        exitCode: null,
        runtime: null,
        truncated: false,
      });
    }
    return tabStates.get(tabId);
  }

  function removeState(tabId) {
    tabStates.delete(tabId);
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-GB', { hour12: false });
  }

  // --- Rendering ---

  function render(tab, container) {
    if (!container) return;
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'execution-tab';
    wrapper.dataset.tabId = tab.id;

    // Header
    const header = document.createElement('div');
    header.className = 'execution-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'header-left';

    const title = document.createElement('h2');
    title.textContent = tab.title;
    headerLeft.appendChild(title);
    header.appendChild(headerLeft);

    const badge = document.createElement('span');
    badge.className = 'status-badge status-' + (tab.status || 'idle');
    badge.id = `status-badge-${tab.id}`;
    badge.textContent = statusLabel(tab.status);
    header.appendChild(badge);

    wrapper.appendChild(header);

    // Terminal
    const terminal = document.createElement('div');
    terminal.className = 'terminal';
    terminal.id = `terminal-${tab.id}`;

    const state = getState(tab.id);
    if (state.lines.length === 0) {
      const placeholder = document.createElement('div');
      placeholder.className = 'terminal-placeholder';

      const phIcon = document.createElement('div');
      phIcon.className = 'terminal-placeholder-icon';
      phIcon.textContent = '\u25B6';
      placeholder.appendChild(phIcon);

      const phText = document.createElement('div');
      phText.className = 'terminal-placeholder-text';
      phText.textContent = 'Ready to run';
      placeholder.appendChild(phText);

      const phHint = document.createElement('div');
      phHint.className = 'terminal-placeholder-hint';
      phHint.textContent = 'Click \u201CRun\u201D below to start the script';
      placeholder.appendChild(phHint);

      terminal.appendChild(placeholder);
    } else {
      renderLines(terminal, state);
    }

    wrapper.appendChild(terminal);

    // Toolbar
    const toolbar = document.createElement('footer');
    toolbar.className = 'execution-toolbar';

    const info = document.createElement('span');
    info.className = 'toolbar-info';
    info.id = `toolbar-info-${tab.id}`;
    info.textContent = buildInfoText(state);
    toolbar.appendChild(info);

    const runBtn = document.createElement('button');
    runBtn.className = 'btn';
    runBtn.textContent = '\u25B6 Run';
    runBtn.disabled = state.isRunning;
    runBtn.addEventListener('click', () => handleRun(tab));
    toolbar.appendChild(runBtn);

    const stopBtn = document.createElement('button');
    stopBtn.className = 'btn btn-danger btn-sm';
    stopBtn.textContent = '\u25A0 Stop';
    stopBtn.disabled = !state.isRunning;
    stopBtn.addEventListener('click', () => handleStop(tab.id));
    toolbar.appendChild(stopBtn);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-success btn-sm';
    saveBtn.textContent = 'Save Logs';
    saveBtn.disabled = state.lines.length === 0;
    saveBtn.addEventListener('click', () => handleSaveLogs(tab));
    toolbar.appendChild(saveBtn);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-secondary btn-sm';
    clearBtn.textContent = 'Clear';
    clearBtn.disabled = state.lines.length === 0;
    clearBtn.addEventListener('click', () => handleClear(tab.id));
    toolbar.appendChild(clearBtn);

    wrapper.appendChild(toolbar);
    container.appendChild(wrapper);
  }

  function renderLines(terminal, state) {
    for (const entry of state.lines) {
      terminal.appendChild(createLineEl(entry));
    }
  }

  function createLineEl(entry) {
    const line = document.createElement('div');
    line.className = 'terminal-line';
    if (entry.type === 'stderr') line.classList.add('terminal-error');
    if (entry.type === 'system') line.classList.add('terminal-system');

    const ts = document.createElement('span');
    ts.className = 'timestamp';
    ts.textContent = `[${formatTime(entry.timestamp)}]`;
    line.appendChild(ts);

    const content = document.createElement('span');
    content.className = 'content';
    content.textContent = entry.text;
    line.appendChild(content);

    return line;
  }

  function statusLabel(status) {
    const labels = {
      idle: 'Idle',
      running: '\u23F1 Running\u2026',
      success: '\u2713 Completed',
      error: '\u2717 Failed',
      queued: '\u25F7 Queued',
    };
    return labels[status] || 'Idle';
  }

  function buildInfoText(state) {
    let text = `Lines: ${state.lineCount}`;
    if (state.lineCount > MAX_LINES) {
      text += ` (showing ${MAX_LINES})`;
    }
    if (state.runtime !== null) {
      text += ` | Runtime: ${(state.runtime / 1000).toFixed(1)}s`;
    }
    return text;
  }

  // --- Actions ---

  function handleRun(tab) {
    const state = getState(tab.id);
    state.isRunning = true;
    state.exitCode = null;
    state.runtime = null;

    window.tabManager.updateTabStatus(tab.id, 'running');

    window.api.invoke('script-runner:run-script', {
      scriptPath: tab.scriptPath,
      scriptName: tab.scriptName || tab.title,
      tabId: tab.id,
    }).catch(() => {
      state.isRunning = false;
      window.tabManager.updateTabStatus(tab.id, 'error');
      window.ui.showNotification('Failed to start script', 'error');
    });

    // Re-render if this tab is active to update button states
    if (window.tabManager.getActiveTabId() === tab.id) {
      render(window.tabManager.getTab(tab.id), document.getElementById('tab-content'));
    }
  }

  function handleStop(tabId) {
    window.api.invoke('script-runner:stop-script', { tabId });
  }

  async function handleSaveLogs(tab) {
    const state = getState(tab.id);
    if (state.lines.length === 0) return;

    const content = state.lines.map((l) => {
      const prefix = l.type === 'stderr' ? '[ERR] ' : '';
      return `[${formatTime(l.timestamp)}] ${prefix}${l.text}`;
    }).join('\n');

    try {
      const result = await window.api.invoke('script-runner:save-logs', {
        content,
        scriptName: tab.scriptName || tab.title,
        timestamp: new Date().toISOString(),
        tabId: tab.id,
      });
      if (result.success) {
        window.ui.showNotification(result.message, 'success');
      } else {
        window.ui.showNotification(result.message || 'Failed to save logs', 'error');
      }
    } catch {
      window.ui.showNotification('Failed to save logs', 'error');
    }
  }

  function handleClear(tabId) {
    const state = getState(tabId);
    state.lines = [];
    state.lineCount = 0;
    state.truncated = false;

    window.api.invoke('script-runner:clear-terminal', { tabId });

    if (window.tabManager.getActiveTabId() === tabId) {
      const tab = window.tabManager.getTab(tabId);
      if (tab) render(tab, document.getElementById('tab-content'));
    }
  }

  // --- Live append (called from IPC listeners) ---

  function appendOutput(tabId, text, timestamp, type = 'stdout') {
    const state = getState(tabId);
    const entry = { text, timestamp, type };

    state.lines.push(entry);
    state.lineCount++;

    const isActive = window.tabManager.getActiveTabId() === tabId;
    const terminal = isActive ? document.getElementById(`terminal-${tabId}`) : null;

    // Truncate head if exceeding limit
    if (state.lines.length > MAX_LINES) {
      const overflow = state.lines.length - MAX_LINES;
      state.lines.splice(0, overflow);

      if (terminal) {
        const children = terminal.querySelectorAll('.terminal-line');
        for (let i = 0; i < overflow && i < children.length; i++) {
          children[i].remove();
        }

        if (!state.truncated) {
          state.truncated = true;
          const notice = document.createElement('div');
          notice.className = 'terminal-line terminal-system';
          const ts = document.createElement('span');
          ts.className = 'timestamp';
          ts.textContent = '';
          notice.appendChild(ts);
          const c = document.createElement('span');
          c.className = 'content';
          c.textContent = `--- Earlier output truncated (showing last ${MAX_LINES} lines) ---`;
          notice.appendChild(c);
          terminal.insertBefore(notice, terminal.firstChild);
        }
      }
    }

    if (!terminal) return;

    // Remove placeholder
    const placeholder = terminal.querySelector('.terminal-placeholder');
    if (placeholder) placeholder.remove();

    terminal.appendChild(createLineEl(entry));
    terminal.scrollTop = terminal.scrollHeight;

    // Update toolbar info
    const info = document.getElementById(`toolbar-info-${tabId}`);
    if (info) info.textContent = buildInfoText(state);
  }

  function onComplete(tabId, exitCode, runtime, signal) {
    const state = getState(tabId);
    state.isRunning = false;
    state.exitCode = exitCode;
    state.runtime = runtime;

    const status = exitCode === 0 ? 'success' : 'error';
    window.tabManager.updateTabStatus(tabId, status);

    const msg = signal
      ? `Process terminated (signal: ${signal})`
      : `Process exited with code ${exitCode} (${(runtime / 1000).toFixed(1)}s)`;
    appendOutput(tabId, msg, new Date().toISOString(), 'system');

    if (window.tabManager.getActiveTabId() === tabId) {
      const tab = window.tabManager.getTab(tabId);
      if (tab) render(tab, document.getElementById('tab-content'));
    }
  }

  function onQueueStatus(tabId, position) {
    window.tabManager.updateTabStatus(tabId, 'queued');
    appendOutput(tabId, `Queued at position ${position}`, new Date().toISOString(), 'system');
  }

  // --- IPC Wiring ---

  function setupListeners() {
    window.api.on('script-runner:output', (data) => {
      appendOutput(data.tabId, data.text, data.timestamp, 'stdout');
    });

    window.api.on('script-runner:error', (data) => {
      appendOutput(data.tabId, data.text, data.timestamp, 'stderr');
    });

    window.api.on('script-runner:complete', (data) => {
      onComplete(data.tabId, data.exitCode, data.runtime, data.signal);
    });

    window.api.on('script-runner:queue-status', (data) => {
      onQueueStatus(data.tabId, data.position);
    });

    window.api.on('script-runner:log-saved', () => {
      // Reserved for future external log triggers
    });
  }

  return { render, getState, removeState, appendOutput, onComplete, setupListeners };
})();

// --- Register with TabManager ---

(function register() {
  function doRegister() {
    if (!window.tabManager) {
      setTimeout(doRegister, 0);
      return;
    }

    window.tabManager.registerTabType('script-execution', {
      render: ScriptExecution.render,
      onClose: (tab) => ScriptExecution.removeState(tab.id),
      maxTabs: 4,
    });

    // Setup IPC event listeners for live output
    ScriptExecution.setupListeners();
  }

  doRegister();
})();
