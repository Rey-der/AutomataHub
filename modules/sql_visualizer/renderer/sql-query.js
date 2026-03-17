/**
 * SQL Visualizer — sql-query tab renderer.
 * Ad-hoc SQL editor with result grid, query history, preset queries, saved queries, and CSV export.
 * Registers the "sql-query" tab type with TabManager.
 */

const SqlQuery = (() => {
  // Per-tab state keyed by tabId
  const tabStates = new Map();

  const PRESETS = [
    { label: 'Recent Errors', sql: "SELECT * FROM errors ORDER BY timestamp DESC LIMIT 50" },
    { label: "Today's Activity", sql: "SELECT * FROM automation_logs WHERE DATE(timestamp) = DATE('now', 'localtime') ORDER BY timestamp DESC" },
    { label: 'Execution Stats', sql: "SELECT script, COUNT(*) AS runs, ROUND(AVG((julianday(end_time) - julianday(start_time)) * 86400), 1) AS avg_seconds, SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) AS successes, SUM(CASE WHEN status = 'FAIL' THEN 1 ELSE 0 END) AS failures FROM execution_tracking WHERE end_time IS NOT NULL GROUP BY script ORDER BY runs DESC" },
    { label: 'Zombie Runs', sql: "SELECT * FROM execution_tracking WHERE end_time IS NULL AND start_time < datetime('now', 'localtime', '-1 hour')" },
    { label: 'Failed Today', sql: "SELECT * FROM execution_tracking WHERE status = 'FAIL' AND DATE(start_time) = DATE('now', 'localtime') ORDER BY start_time DESC" },
    { label: 'File Ops Today', sql: "SELECT operation, COUNT(*) AS count FROM file_processing_records WHERE DATE(timestamp) = DATE('now', 'localtime') GROUP BY operation" },
    { label: 'Backup Health', sql: "SELECT * FROM backup_history ORDER BY backup_date DESC LIMIT 10" },
  ];

  function getState(tabId) {
    if (!tabStates.has(tabId)) {
      tabStates.set(tabId, {
        sql: '',
        result: null,
        error: null,
        history: [],
        loading: false,
        savedQueries: [],   // loaded from hub prefs
        showSaved: false,
      });
    }
    return tabStates.get(tabId);
  }

  function removeState(tabId) {
    tabStates.delete(tabId);
  }

  // --- Saved Queries (hub prefs) ---

  async function loadSavedQueries(state) {
    try {
      const prefs = await window.api.getModulePrefs('sql-visualizer') || {};
      state.savedQueries = prefs.savedQueries || [];
    } catch (err) {
      console.error('[sql-query] load saved queries:', err);
      state.savedQueries = [];
    }
  }

  async function saveQuery(tab, state) {
    const sql = state.sql.trim();
    if (!sql) return;

    // Build inline modal instead of prompt() which is blocked in Electron
    const overlay = document.createElement('div');
    overlay.className = 'sql-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'sql-modal';

    const heading = document.createElement('h3');
    heading.className = 'sql-modal-title';
    heading.textContent = 'Save Query';
    modal.appendChild(heading);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sql-modal-input';
    input.placeholder = 'Query name...';
    modal.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'sql-modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-sm btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => overlay.remove());
    actions.appendChild(cancelBtn);

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn btn-sm';
    confirmBtn.textContent = 'Save';
    confirmBtn.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name) return;
      overlay.remove();
      try {
        const prefs = await window.api.getModulePrefs('sql-visualizer') || {};
        const savedQueries = prefs.savedQueries || [];
        savedQueries.push({ name, sql, createdAt: Date.now() });
        await window.api.setModulePrefs('sql-visualizer', { savedQueries });
        state.savedQueries = savedQueries;
        state.showSaved = true;
        render(tab, document.getElementById('tab-content'));
        if (window.ui && window.ui.showNotification) {
          window.ui.showNotification('Query saved: ' + name, 'success');
        }
      } catch (err) {
        console.error('[sql-query] save query error:', err);
      }
    });
    actions.appendChild(confirmBtn);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmBtn.click();
      if (e.key === 'Escape') overlay.remove();
    });
  }

  async function deleteSavedQuery(tab, state, index) {
    try {
      const prefs = await window.api.getModulePrefs('sql-visualizer') || {};
      const savedQueries = prefs.savedQueries || [];
      savedQueries.splice(index, 1);
      await window.api.setModulePrefs('sql-visualizer', { savedQueries });
      state.savedQueries = savedQueries;
      render(tab, document.getElementById('tab-content'));
    } catch (err) {
      console.error('[sql-query] delete saved query:', err);
    }
  }

  // --- Rendering ---

  async function render(tab, container) {
    if (!container) return;
    container.innerHTML = '';

    const state = getState(tab.id);

    // Load saved queries on first render
    if (state.savedQueries.length === 0 && !state._prefsLoaded) {
      state._prefsLoaded = true;
      await loadSavedQueries(state);
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'sql-query-tab';
    wrapper.dataset.tabId = tab.id;

    // Header
    const header = document.createElement('div');
    header.className = 'sql-query-header';

    const title = document.createElement('h2');
    title.textContent = 'Query Editor';
    header.appendChild(title);

    wrapper.appendChild(header);

    // Preset buttons
    const presets = document.createElement('div');
    presets.className = 'sql-presets';
    for (const preset of PRESETS) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-secondary sql-preset-btn';
      btn.textContent = preset.label;
      btn.title = preset.sql;
      btn.addEventListener('click', () => {
        state.sql = preset.sql;
        const textarea = wrapper.querySelector('.sql-editor');
        if (textarea) textarea.value = preset.sql;
      });
      presets.appendChild(btn);
    }
    wrapper.appendChild(presets);

    // SQL editor
    const editorContainer = document.createElement('div');
    editorContainer.className = 'sql-editor-container';

    const textarea = document.createElement('textarea');
    textarea.className = 'sql-editor';
    textarea.placeholder = 'SELECT * FROM automation_logs LIMIT 25';
    textarea.value = state.sql;
    textarea.spellcheck = false;
    textarea.addEventListener('input', () => {
      state.sql = textarea.value;
    });
    textarea.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + Enter to run
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleRun(tab);
      }
      // Tab inserts spaces
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        state.sql = textarea.value;
      }
    });
    editorContainer.appendChild(textarea);
    wrapper.appendChild(editorContainer);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'sql-query-toolbar';

    const runBtn = document.createElement('button');
    runBtn.className = 'btn';
    runBtn.textContent = 'Run';
    runBtn.disabled = state.loading;
    runBtn.addEventListener('click', () => handleRun(tab));
    toolbar.appendChild(runBtn);

    const hint = document.createElement('span');
    hint.className = 'sql-shortcut-hint';
    hint.textContent = '⌘+Enter to run';
    toolbar.appendChild(hint);

    if (state.result) {
      const exportBtn = document.createElement('button');
      exportBtn.className = 'btn btn-sm btn-secondary';
      exportBtn.textContent = 'Export CSV';
      exportBtn.addEventListener('click', () => handleExportCsv(state));
      toolbar.appendChild(exportBtn);

      const info = document.createElement('span');
      info.className = 'sql-result-info';
      info.textContent = `${state.result.rowCount} row${state.result.rowCount !== 1 ? 's' : ''} returned`;
      toolbar.appendChild(info);
    }

    // Save & load buttons
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-sm btn-secondary';
    saveBtn.textContent = 'Save Query';
    saveBtn.addEventListener('click', () => saveQuery(tab, state));
    toolbar.appendChild(saveBtn);

    if (state.savedQueries.length > 0) {
      const toggleSaved = document.createElement('button');
      toggleSaved.className = 'btn btn-sm btn-secondary' + (state.showSaved ? ' btn-active' : '');
      toggleSaved.textContent = 'Saved (' + state.savedQueries.length + ')';
      toggleSaved.addEventListener('click', () => {
        state.showSaved = !state.showSaved;
        render(tab, document.getElementById('tab-content'));
      });
      toolbar.appendChild(toggleSaved);
    }

    wrapper.appendChild(toolbar);

    // Saved queries section
    if (state.showSaved && state.savedQueries.length > 0) {
      wrapper.appendChild(createSavedQueriesSection(tab, state));
    }

    // Error display
    if (state.error) {
      const errorBox = document.createElement('div');
      errorBox.className = 'sql-error-box';
      errorBox.textContent = state.error;
      wrapper.appendChild(errorBox);
    }

    // Result table
    if (state.result && state.result.rows.length > 0) {
      wrapper.appendChild(createResultTable(state.result));
    } else if (state.result && state.result.rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sql-table-empty';
      empty.textContent = 'Query returned 0 rows';
      wrapper.appendChild(empty);
    }

    // Query history
    if (state.history.length > 0) {
      wrapper.appendChild(createHistory(tab, state));
    }

    container.appendChild(wrapper);
  }

  function createResultTable(result) {
    const container = document.createElement('div');
    container.className = 'sql-table-container sql-result-container';

    const table = document.createElement('table');
    table.className = 'sql-data-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const col of result.columns) {
      const th = document.createElement('th');
      th.className = 'sql-th';
      th.textContent = col;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of result.rows) {
      const tr = document.createElement('tr');
      for (const col of result.columns) {
        const td = document.createElement('td');
        const value = row[col];
        if (value === null || value === undefined) {
          td.className = 'sql-null';
          td.textContent = 'NULL';
        } else {
          td.textContent = String(value);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
    return container;
  }

  function createSavedQueriesSection(tab, state) {
    const section = document.createElement('div');
    section.className = 'sql-saved-queries';

    const header = document.createElement('h3');
    header.textContent = 'Saved Queries';
    section.appendChild(header);

    const list = document.createElement('div');
    list.className = 'sql-saved-list';

    for (let i = 0; i < state.savedQueries.length; i++) {
      const q = state.savedQueries[i];
      const item = document.createElement('div');
      item.className = 'sql-saved-item';

      const nameEl = document.createElement('span');
      nameEl.className = 'sql-saved-name';
      nameEl.textContent = q.name;
      item.appendChild(nameEl);

      const sqlPreview = document.createElement('code');
      sqlPreview.className = 'sql-saved-preview';
      sqlPreview.textContent = q.sql.length > 80 ? q.sql.substring(0, 80) + '…' : q.sql;
      sqlPreview.title = q.sql;
      item.appendChild(sqlPreview);

      const actions = document.createElement('div');
      actions.className = 'sql-saved-actions';

      const loadBtn = document.createElement('button');
      loadBtn.className = 'btn btn-sm';
      loadBtn.textContent = 'Load';
      loadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.sql = q.sql;
        render(tab, document.getElementById('tab-content'));
      });
      actions.appendChild(loadBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-sm btn-danger';
      delBtn.textContent = 'Del';
      delBtn.title = 'Delete saved query';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSavedQuery(tab, state, i);
      });
      actions.appendChild(delBtn);

      actions.appendChild(document.createTextNode(' '));

      const ts = document.createElement('span');
      ts.className = 'sql-saved-date';
      ts.textContent = new Date(q.createdAt).toLocaleDateString('en-GB');
      actions.appendChild(ts);

      item.appendChild(actions);
      list.appendChild(item);
    }

    section.appendChild(list);
    return section;
  }

  function createHistory(tab, state) {
    const section = document.createElement('div');
    section.className = 'sql-history';

    const header = document.createElement('h3');
    header.textContent = 'History';
    section.appendChild(header);

    const list = document.createElement('div');
    list.className = 'sql-history-list';

    // Show most recent first
    for (let i = state.history.length - 1; i >= 0; i--) {
      const entry = state.history[i];
      const item = document.createElement('div');
      item.className = 'sql-history-item';

      const sqlText = document.createElement('code');
      sqlText.className = 'sql-history-sql';
      sqlText.textContent = entry.sql.length > 120 ? entry.sql.substring(0, 120) + '…' : entry.sql;
      sqlText.title = entry.sql;
      item.appendChild(sqlText);

      const ts = document.createElement('span');
      ts.className = 'sql-history-time';
      ts.textContent = new Date(entry.timestamp).toLocaleTimeString('en-GB', { hour12: false });
      item.appendChild(ts);

      item.addEventListener('click', () => {
        state.sql = entry.sql;
        render(tab, document.getElementById('tab-content'));
      });

      list.appendChild(item);
    }

    section.appendChild(list);
    return section;
  }

  // --- Actions ---

  async function handleRun(tab) {
    const state = getState(tab.id);
    const sql = state.sql.trim();
    if (!sql) return;

    state.loading = true;
    state.error = null;
    state.result = null;

    // Re-render to show loading state
    render(tab, document.getElementById('tab-content'));

    try {
      const result = await window.api.invoke('sql-visualizer:run-query', { sql });
      state.result = result;
      state.error = null;

      // Add to history (avoid consecutive duplicates)
      const lastEntry = state.history[state.history.length - 1];
      if (!lastEntry || lastEntry.sql !== sql) {
        state.history.push({ sql, timestamp: Date.now() });
        // Keep last 50 entries
        if (state.history.length > 50) {
          state.history = state.history.slice(-50);
        }
      }
    } catch (err) {
      state.error = err.message || 'Query execution failed';
      state.result = null;
    } finally {
      state.loading = false;
      render(tab, document.getElementById('tab-content'));
    }
  }

  async function handleExportCsv(state) {
    const sql = state.sql.trim();
    if (!sql) return;

    try {
      const csv = await window.api.invoke('sql-visualizer:export-csv', { sql });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'query-result.csv';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      window.ui.showNotification('Exported query-result.csv', 'success');
    } catch (err) {
      window.ui.showNotification('Export failed: ' + (err.message || 'Unknown error'), 'error');
    }
  }

  return { render, removeState };
})();

// --- Register with TabManager ---

(function register() {
  function doRegister() {
    if (!window.tabManager) {
      setTimeout(doRegister, 0);
      return;
    }

    window.tabManager.registerTabType('sql-query', {
      render: SqlQuery.render,
      onClose: (tab) => SqlQuery.removeState(tab.id),
      maxTabs: 3,
    });
  }

  doRegister();
})();
