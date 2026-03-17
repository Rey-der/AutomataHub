/**
 * Script Runner — execution tab renderer.
 * Provides a live terminal view for running scripts.
 * Registers the "script-execution" tab type with TabManager.
 */

const ScriptExecution = (() => {
  // Per-tab state keyed by tabId
  const tabStates = new Map();
  const timerIntervals = new Map();
  const MAX_LINES = 1000;

  // --- Error tip detection ---

  const ERROR_TIPS = [
    { pattern: /ENOENT|no such file or directory/i, tip: 'File or directory not found. Check the script path and ensure all required files exist.' },
    { pattern: /EACCES|permission denied/i, tip: 'Permission denied. Try running with elevated privileges or check file permissions.' },
    { pattern: /EADDRINUSE|address already in use/i, tip: 'Port already in use. Another process may be running on this port.' },
    { pattern: /command not found|is not recognized/i, tip: 'Command not found. Ensure the required interpreter or tool is installed and on your PATH.' },
    { pattern: /SyntaxError/i, tip: 'Syntax error in script. Check for missing brackets, commas, or typos near the indicated line.' },
    { pattern: /ReferenceError/i, tip: 'Reference error — a variable or function is used before being defined or imported.' },
    { pattern: /TypeError/i, tip: 'Type error — check that you are calling methods on the correct object types.' },
    { pattern: /MODULE_NOT_FOUND|Cannot find module/i, tip: 'Module not found. Run `npm install` in the script directory or verify the module name.' },
    { pattern: /ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i, tip: 'Network error. Check your internet connection or the target host/port.' },
    { pattern: /SIGKILL|killed/i, tip: 'Process was forcefully terminated. It may have exceeded memory limits.' },
  ];

  function getErrorTip(text) {
    for (const { pattern, tip } of ERROR_TIPS) {
      if (pattern.test(text)) return tip;
    }
    return null;
  }

  function getState(tabId) {
    if (!tabStates.has(tabId)) {
      tabStates.set(tabId, {
        lines: [],
        lineCount: 0,
        isRunning: false,
        exitCode: null,
        runtime: null,
        startTime: null,
        truncated: false,
        autoStarted: false,
        scriptOverride: null,  // edited content for next run
        editMode: false,
      });
    }
    return tabStates.get(tabId);
  }

  function removeState(tabId) {
    stopTimer(tabId);
    tabStates.delete(tabId);
  }

  function formatElapsed(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const tenths = Math.floor((ms % 1000) / 100);
    if (min > 0) return `${min}m ${sec.toString().padStart(2, '0')}.${tenths}s`;
    return `${sec}.${tenths}s`;
  }

  function startTimer(tabId) {
    stopTimer(tabId);
    timerIntervals.set(tabId, setInterval(() => {
      const state = getState(tabId);
      if (!state.isRunning || !state.startTime) { stopTimer(tabId); return; }
      const elapsed = Date.now() - state.startTime;
      const el = document.getElementById(`elapsed-${tabId}`);
      if (el) el.textContent = formatElapsed(elapsed);
      const info = document.getElementById(`toolbar-info-${tabId}`);
      if (info) info.textContent = buildInfoText(state);
    }, 100));
  }

  function stopTimer(tabId) {
    const id = timerIntervals.get(tabId);
    if (id) { clearInterval(id); timerIntervals.delete(tabId); }
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

    const state = getState(tab.id);

    // Progress bar + elapsed time
    const progressRow = document.createElement('div');
    progressRow.className = 'execution-progress-row';
    progressRow.id = `progress-row-${tab.id}`;

    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    progressBar.id = `progress-bar-${tab.id}`;
    const progressFill = document.createElement('div');
    progressFill.className = 'progress-fill';
    if (state.isRunning) progressFill.classList.add('progress-indeterminate');
    else if (state.runtime !== null) { progressFill.classList.add('progress-done'); progressFill.style.width = '100%'; }
    progressBar.appendChild(progressFill);
    progressRow.appendChild(progressBar);

    const elapsed = document.createElement('span');
    elapsed.className = 'elapsed-time';
    elapsed.id = `elapsed-${tab.id}`;
    if (state.isRunning && state.startTime) {
      elapsed.textContent = formatElapsed(Date.now() - state.startTime);
    } else if (state.runtime !== null) {
      elapsed.textContent = formatElapsed(state.runtime);
    }
    progressRow.appendChild(elapsed);
    wrapper.appendChild(progressRow);

    // Terminal
    const terminal = document.createElement('div');
    terminal.className = 'terminal';
    terminal.id = `terminal-${tab.id}`;

    if (state.lines.length === 0) {
      const placeholder = document.createElement('div');
      placeholder.className = 'terminal-placeholder';

      const phHeader = document.createElement('div');
      phHeader.className = 'terminal-placeholder-header';

      const phLeft = document.createElement('div');
      phLeft.className = 'ph-left';

      const phText = document.createElement('span');
      phText.className = 'terminal-placeholder-text';
      phText.textContent = 'Ready to run';
      phLeft.appendChild(phText);

      const phHint = document.createElement('span');
      phHint.className = 'terminal-placeholder-hint';
      phHint.textContent = '\u2014 click \u201CRun\u201D to start';
      phLeft.appendChild(phHint);

      phHeader.appendChild(phLeft);

      const penBtn = document.createElement('button');
      penBtn.className = 'script-edit-btn' + (state.editMode ? ' active' : '');
      penBtn.title = state.editMode ? 'Done editing' : 'Edit script for this run';
      penBtn.textContent = state.editMode ? '\u2713 Done' : '\u270F Edit';
      phHeader.appendChild(penBtn);

      placeholder.appendChild(phHeader);

      if (state.editMode) {
        const ta = document.createElement('textarea');
        ta.className = 'script-edit-area';
        ta.id = `script-edit-${tab.id}`;
        ta.spellcheck = false;
        ta.value = state.scriptOverride ?? 'Loading\u2026';
        placeholder.appendChild(ta);
        if (state.scriptOverride === null && tab.scriptPath) {
          globalThis.api.invoke('script-runner:read-script', { scriptPath: tab.scriptPath })
            .then((res) => {
              const el = document.getElementById(`script-edit-${tab.id}`);
              if (!el) return;
              el.value = res.success ? res.content : `(Could not load: ${res.error})`;
              if (res.success) state.scriptOverride = res.content;
            }).catch(() => {});
        }
        setTimeout(() => { const el = document.getElementById(`script-edit-${tab.id}`); if (el) el.focus(); }, 0);
      } else {
        const codeBlock = document.createElement('pre');
        codeBlock.className = 'script-preview' + (state.scriptOverride === null ? '' : ' script-preview-edited');
        codeBlock.id = `script-preview-${tab.id}`;
        codeBlock.textContent = state.scriptOverride ?? 'Loading\u2026';
        placeholder.appendChild(codeBlock);
        if (state.scriptOverride === null && tab.scriptPath) {
          globalThis.api.invoke('script-runner:read-script', { scriptPath: tab.scriptPath })
            .then((res) => {
              const el = document.getElementById(`script-preview-${tab.id}`);
              if (!el) return;
              if (res.success) el.textContent = res.content;
              else { el.textContent = `(Could not load script: ${res.error})`; el.classList.add('script-preview-error'); }
            }).catch(() => {
              const el = document.getElementById(`script-preview-${tab.id}`);
              if (el) { el.textContent = '(Failed to read script)'; el.classList.add('script-preview-error'); }
            });
        }
      }

      terminal.appendChild(placeholder);

      penBtn.addEventListener('click', () => {
        const s = getState(tab.id);
        if (s.editMode) {
          const taEl = document.getElementById(`script-edit-${tab.id}`);
          if (taEl) s.scriptOverride = taEl.value;
          s.editMode = false;
        } else {
          if (s.scriptOverride === null) {
            const preEl = document.getElementById(`script-preview-${tab.id}`);
            const raw = preEl ? preEl.textContent : '';
            if (raw && raw !== 'Loading\u2026') s.scriptOverride = raw;
          }
          s.editMode = true;
        }
        if (globalThis.tabManager.getActiveTabId() === tab.id) {
          render(globalThis.tabManager.getTab(tab.id), document.getElementById('tab-content'));
        }
      });
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

    // Retry button — only shown after a failed run
    if (!state.isRunning && state.exitCode !== null && state.exitCode !== 0) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'btn btn-retry btn-sm';
      retryBtn.textContent = 'Retry';
      retryBtn.title = 'Run the script again';
      retryBtn.addEventListener('click', () => handleRun(tab));
      toolbar.appendChild(retryBtn);
    }

    wrapper.appendChild(toolbar);
    container.appendChild(wrapper);

    // Auto-run on first render if requested (deferred to avoid reentrant render)
    if (tab.autoRun && !state.autoStarted && !state.isRunning && state.exitCode === null) {
      state.autoStarted = true;
      setTimeout(() => handleRun(tab), 0);
    }
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
      running: 'Running...',
      success: 'Completed',
      error: 'Failed',
      queued: 'Queued',
    };
    return labels[status] || 'Idle';
  }

  function buildInfoText(state) {
    let text = `Lines: ${state.lineCount}`;
    if (state.lineCount > MAX_LINES) {
      text += ` (showing ${MAX_LINES})`;
    }
    if (state.isRunning && state.startTime) {
      text += ` | Elapsed: ${formatElapsed(Date.now() - state.startTime)}`;
    } else if (state.runtime !== null) {
      text += ` | Runtime: ${formatElapsed(state.runtime)}`;
    }
    return text;
  }

  // --- Actions ---

  function handleRun(tab) {
    const state = getState(tab.id);

    // If user is in edit mode, capture textarea content before running
    if (state.editMode) {
      const taEl = document.getElementById(`script-edit-${tab.id}`);
      if (taEl) state.scriptOverride = taEl.value;
      state.editMode = false;
    }

    state.isRunning = true;
    state.exitCode = null;
    state.runtime = null;
    state.startTime = Date.now();

    startTimer(tab.id);
    globalThis.tabManager.updateTabStatus(tab.id, 'running');

    globalThis.api.invoke('script-runner:run-script', {
      scriptPath: tab.scriptPath,
      scriptName: tab.scriptName || tab.title,
      tabId: tab.id,
      scriptEnv: tab.scriptEnv || {},
      scriptContent: state.scriptOverride || undefined,
    }).catch(() => {
      state.isRunning = false;
      stopTimer(tab.id);
      globalThis.tabManager.updateTabStatus(tab.id, 'error');
      globalThis.ui.showNotification('Failed to start script', 'error');
    });

    // Re-render if this tab is active to update button states
    if (globalThis.tabManager.getActiveTabId() === tab.id) {
      render(globalThis.tabManager.getTab(tab.id), document.getElementById('tab-content'));
    }
  }

  function handleStop(tabId) {
    globalThis.api.invoke('script-runner:stop-script', { tabId });
  }

  async function handleSaveLogs(tab) {
    const state = getState(tab.id);
    if (state.lines.length === 0) return;

    const content = state.lines.map((l) => {
      const prefix = l.type === 'stderr' ? '[ERR] ' : '';
      return `[${formatTime(l.timestamp)}] ${prefix}${l.text}`;
    }).join('\n');

    try {
      const result = await globalThis.api.invoke('script-runner:save-logs', {
        content,
        scriptName: tab.scriptName || tab.title,
        timestamp: new Date().toISOString(),
        tabId: tab.id,
      });
      if (result.success) {
        globalThis.ui.showNotification(result.message, 'success');
      } else {
        globalThis.ui.showNotification(result.message || 'Failed to save logs', 'error');
      }
    } catch {
      globalThis.ui.showNotification('Failed to save logs', 'error');
    }
  }

  function handleClear(tabId) {
    const state = getState(tabId);
    state.lines = [];
    state.lineCount = 0;
    state.truncated = false;
    state.runtime = null;
    state.startTime = null;
    state.scriptOverride = null;
    state.editMode = false;

    globalThis.api.invoke('script-runner:clear-terminal', { tabId });

    if (globalThis.tabManager.getActiveTabId() === tabId) {
      const tab = globalThis.tabManager.getTab(tabId);
      if (tab) render(tab, document.getElementById('tab-content'));
    }
  }

  // --- Live append (called from IPC listeners) ---

  function appendOutput(tabId, text, timestamp, type = 'stdout') {
    const state = getState(tabId);
    const entry = { text, timestamp, type };

    state.lines.push(entry);
    state.lineCount++;

    // Detect actionable error tip for stderr lines
    let tipEntry = null;
    if (type === 'stderr') {
      const tip = getErrorTip(text);
      if (tip) {
        tipEntry = { text: `Tip: ${tip}`, timestamp, type: 'system' };
        state.lines.push(tipEntry);
        // tipEntry not counted in lineCount — it's metadata, not script output
      }
    }

    const isActive = globalThis.tabManager.getActiveTabId() === tabId;
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
    // Append tip inline after the error line if it's still in state (not truncated away)
    if (tipEntry && state.lines.includes(tipEntry)) {
      terminal.appendChild(createLineEl(tipEntry));
    }
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
    stopTimer(tabId);

    // Update progress bar to completed state
    const fill = document.querySelector(`#progress-bar-${tabId} .progress-fill`);
    if (fill) {
      fill.classList.remove('progress-indeterminate');
      fill.classList.add('progress-done');
      fill.style.width = '100%';
      if (exitCode !== 0) fill.classList.add('progress-error');
    }
    const elapsedEl = document.getElementById(`elapsed-${tabId}`);
    if (elapsedEl) elapsedEl.textContent = formatElapsed(runtime);

    const status = exitCode === 0 ? 'success' : 'error';
    globalThis.tabManager.updateTabStatus(tabId, status);

    const msg = signal
      ? `Process terminated (signal: ${signal})`
      : `Process exited with code ${exitCode} (${formatElapsed(runtime)})`;
    appendOutput(tabId, msg, new Date().toISOString(), 'system');

    if (globalThis.tabManager.getActiveTabId() === tabId) {
      const tab = globalThis.tabManager.getTab(tabId);
      if (tab) render(tab, document.getElementById('tab-content'));
    }
  }

  function onQueueStatus(tabId, position) {
    globalThis.tabManager.updateTabStatus(tabId, 'queued');
    appendOutput(tabId, `Queued at position ${position}`, new Date().toISOString(), 'system');
  }

  // --- IPC Wiring ---

  function setupListeners() {
    globalThis.api.on('script-runner:output', (data) => {
      appendOutput(data.tabId, data.text, data.timestamp, 'stdout');
    });

    globalThis.api.on('script-runner:error', (data) => {
      appendOutput(data.tabId, data.text, data.timestamp, 'stderr');
    });

    globalThis.api.on('script-runner:complete', (data) => {
      onComplete(data.tabId, data.exitCode, data.runtime, data.signal);
    });

    globalThis.api.on('script-runner:queue-status', (data) => {
      onQueueStatus(data.tabId, data.position);
    });

    globalThis.api.on('script-runner:log-saved', () => {
      // Reserved for future external log triggers
    });
  }

  return { render, getState, removeState, appendOutput, onComplete, setupListeners };
})();

// --- Register with TabManager ---

(function register() {
  function doRegister() {
    if (!globalThis.tabManager) {
      setTimeout(doRegister, 0);
      return;
    }

    globalThis.tabManager.registerTabType('script-execution', {
      render: ScriptExecution.render,
      onClose: (tab) => ScriptExecution.removeState(tab.id),
      maxTabs: 4,
    });

    // Setup IPC event listeners for live output
    ScriptExecution.setupListeners();
  }

  doRegister();
})();
