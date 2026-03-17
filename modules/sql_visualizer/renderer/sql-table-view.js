/**
 * SQL Visualizer — sql-table-view tab renderer.
 * Paginated, sortable, filterable table browser with CSV export,
 * row detail panel, cross-table drill-down, auto-refresh, and bookmarks.
 * Registers the "sql-table-view" tab type with TabManager.
 */

const SqlTableView = (() => {
  // Per-tab state keyed by tabId
  const tabStates = new Map();

  function getState(tabId) {
    if (!tabStates.has(tabId)) {
      tabStates.set(tabId, {
        tableName: null,
        columns: [],
        rows: [],
        total: 0,
        page: 0,
        pageSize: 25,
        sortCol: null,
        sortDir: 'ASC',
        filters: [],
        loading: false,
        selectedRow: null,      // row object for detail panel
        autoRefresh: false,     // live monitoring toggle
        refreshInterval: 15000, // ms
        _refreshTimer: null,
      });
    }
    return tabStates.get(tabId);
  }

  function removeState(tabId) {
    const state = tabStates.get(tabId);
    if (state && state._refreshTimer) clearInterval(state._refreshTimer);
    tabStates.delete(tabId);
  }

  // --- Data fetching ---

  async function loadPage(tabId) {
    const state = getState(tabId);
    if (state.loading) return;
    state.loading = true;

    try {
      // Fetch column info on first load
      if (state.columns.length === 0 && state.tableName) {
        state.columns = await globalThis.api.invoke('sql-visualizer:get-table-info', { table: state.tableName });
      }

      const result = await globalThis.api.invoke('sql-visualizer:query-rows', {
        table: state.tableName,
        offset: state.page * state.pageSize,
        limit: state.pageSize,
        sortCol: state.sortCol,
        sortDir: state.sortDir,
        filters: state.filters.filter((f) => f.value !== ''),
      });

      state.rows = result.rows;
      state.total = result.total;
    } catch (err) {
      console.error('[sql-table-view] Load error:', err);
      state.rows = [];
      state.total = 0;
    } finally {
      state.loading = false;
    }
  }

  // --- Rendering ---

  function _restoreBookmark(state, tab) {
    if (state.tableName || !tab.tableName) return;
    state.tableName = tab.tableName;
    if (!tab.bookmark) return;
    const bm = tab.bookmark;
    if (bm.sortCol) state.sortCol = bm.sortCol;
    if (bm.sortDir) state.sortDir = bm.sortDir;
    if (bm.pageSize) state.pageSize = bm.pageSize;
    if (Array.isArray(bm.filters)) state.filters = bm.filters.map((f) => ({ ...f }));
    tab.bookmark = null;
  }

  function _createHeaderActions(tab, state) {
    const headerActions = document.createElement('div');
    headerActions.className = 'sql-tv-actions';

    // Page size selector
    const pageSizeLabel = document.createElement('label');
    pageSizeLabel.className = 'sql-page-size-label';
    pageSizeLabel.textContent = 'Rows: ';
    const pageSizeSelect = document.createElement('select');
    pageSizeSelect.className = 'sql-page-size';
    for (const size of [25, 50, 100]) {
      const opt = document.createElement('option');
      opt.value = size;
      opt.textContent = size;
      if (size === state.pageSize) opt.selected = true;
      pageSizeSelect.appendChild(opt);
    }
    pageSizeSelect.addEventListener('change', () => {
      state.pageSize = Number.parseInt(pageSizeSelect.value, 10);
      state.page = 0;
      refreshView(tab);
    });
    pageSizeLabel.appendChild(pageSizeSelect);
    headerActions.appendChild(pageSizeLabel);

    // Export CSV
    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn btn-sm btn-secondary';
    exportBtn.textContent = 'Export CSV';
    exportBtn.addEventListener('click', () => handleExportCsv(state));
    headerActions.appendChild(exportBtn);

    // Bookmark current view
    const bookmarkBtn = document.createElement('button');
    bookmarkBtn.className = 'btn btn-sm btn-secondary';
    bookmarkBtn.textContent = 'Bookmark';
    bookmarkBtn.title = 'Save current filters & sort as a bookmark';
    bookmarkBtn.addEventListener('click', () => handleBookmark(state));
    headerActions.appendChild(bookmarkBtn);

    // Auto-refresh toggle
    const refreshToggle = document.createElement('button');
    refreshToggle.className = `btn btn-sm${state.autoRefresh ? ' btn-active' : ' btn-secondary'}`;
    refreshToggle.textContent = state.autoRefresh ? '⟳ Live' : '⟳ Auto';
    refreshToggle.title = 'Toggle auto-refresh';
    refreshToggle.addEventListener('click', () => {
      state.autoRefresh = !state.autoRefresh;
      setupAutoRefresh(tab, state);
      refreshToggle.className = `btn btn-sm${state.autoRefresh ? ' btn-active' : ' btn-secondary'}`;
      refreshToggle.textContent = state.autoRefresh ? 'Live' : 'Auto';
      if (globalThis.tabManager?.updateTabStatus) {
        globalThis.tabManager.updateTabStatus(tab.id, state.autoRefresh ? 'running' : 'idle');
      }
    });
    headerActions.appendChild(refreshToggle);

    // Refresh interval selector
    const intervalSelect = document.createElement('select');
    intervalSelect.className = 'sql-page-size';
    intervalSelect.title = 'Refresh interval';
    for (const [ms, label] of [[5000, '5s'], [15000, '15s'], [30000, '30s'], [60000, '60s']]) {
      const opt = document.createElement('option');
      opt.value = ms;
      opt.textContent = label;
      if (ms === state.refreshInterval) opt.selected = true;
      intervalSelect.appendChild(opt);
    }
    intervalSelect.addEventListener('change', () => {
      state.refreshInterval = Number.parseInt(intervalSelect.value, 10);
      if (state.autoRefresh) setupAutoRefresh(tab, state);
    });
    headerActions.appendChild(intervalSelect);

    return headerActions;
  }

  function render(tab, container) {
    if (!container) return;
    container.innerHTML = '';

    const state = getState(tab.id);
    _restoreBookmark(state, tab);

    const wrapper = document.createElement('div');
    wrapper.className = 'sql-table-view';
    wrapper.dataset.tabId = tab.id;

    // Header
    const header = document.createElement('div');
    header.className = 'sql-tv-header';

    const title = document.createElement('h2');
    title.textContent = state.tableName || 'Table';
    header.appendChild(title);

    header.appendChild(_createHeaderActions(tab, state));
    wrapper.appendChild(header);

    // Filter bar
    wrapper.appendChild(createFilterBar(tab, state));

    // Table container (filled after data loads)
    const tableContainer = document.createElement('div');
    tableContainer.className = 'sql-table-container';
    tableContainer.id = `sql-table-${tab.id}`;
    wrapper.appendChild(tableContainer);

    // Footer with pagination
    const footer = document.createElement('div');
    footer.className = 'sql-tv-footer';
    footer.id = `sql-footer-${tab.id}`;
    wrapper.appendChild(footer);

    // Row detail panel (hidden until a row is clicked)
    const detailPanel = document.createElement('div');
    detailPanel.className = 'sql-detail-panel hidden';
    detailPanel.id = `sql-detail-${tab.id}`;
    wrapper.appendChild(detailPanel);

    container.appendChild(wrapper);

    // Load data and render table
    refreshView(tab);
  }

  async function refreshView(tab) {
    const state = getState(tab.id);
    await loadPage(tab.id);

    const tableContainer = document.getElementById(`sql-table-${tab.id}`);
    if (tableContainer) {
      renderTable(tableContainer, tab, state);
    }

    const footer = document.getElementById(`sql-footer-${tab.id}`);
    if (footer) {
      renderPagination(footer, tab, state);
    }
  }

  function renderTable(container, tab, state) {
    container.innerHTML = '';

    if (state.rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sql-table-empty';
      empty.textContent = state.total === 0 ? 'No rows in this table' : 'No rows match the current filters';
      container.appendChild(empty);
      return;
    }

    const table = document.createElement('table');
    table.className = 'sql-data-table';

    // Header row
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const col of state.columns) {
      const th = document.createElement('th');
      th.textContent = col.name;
      th.className = 'sql-th';
      if (state.sortCol === col.name) {
        th.classList.add(state.sortDir === 'ASC' ? 'sort-asc' : 'sort-desc');
      }
      th.addEventListener('click', () => {
        if (state.sortCol === col.name) {
          state.sortDir = state.sortDir === 'ASC' ? 'DESC' : 'ASC';
        } else {
          state.sortCol = col.name;
          state.sortDir = 'ASC';
        }
        state.page = 0;
        refreshView(tab);
      });
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Data rows
    const tbody = document.createElement('tbody');
    for (const row of state.rows) {
      const tr = document.createElement('tr');
      tr.classList.add('sql-data-row');
      if (state.selectedRow === row) tr.classList.add('sql-row-selected');

      // Row click → open detail panel
      tr.addEventListener('click', () => {
        state.selectedRow = row;
        // Highlight
        tbody.querySelectorAll('.sql-row-selected').forEach((el) => el.classList.remove('sql-row-selected'));
        tr.classList.add('sql-row-selected');
        renderDetailPanel(tab, state);
      });

      for (const col of state.columns) {
        const td = document.createElement('td');
        const value = row[col.name];

        if (value === null || value === undefined) {
          td.className = 'sql-null';
          td.textContent = 'NULL';
        } else if (typeof value === 'string' && isJsonString(value)) {
          td.appendChild(createJsonCell(value));
        } else {
          td.textContent = String(value);

          // Cross-table navigation links
          if (state.tableName === 'execution_tracking' && col.name === 'id') {
            td.classList.add('sql-link');
            td.title = 'View correlated logs & errors';
            td.addEventListener('click', (e) => {
              e.stopPropagation();
              globalThis.tabManager.createTab('sql-timeline', 'Timeline', {}, { reuseKey: 'sql-timeline' });
            });
          }
          if (col.name === 'script' && typeof value === 'string') {
            td.classList.add('sql-link');
            td.title = 'View all entries for this script';
            td.addEventListener('click', (e) => {
              e.stopPropagation();
              navigateToScript(tab, state, value);
            });
          }
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.appendChild(table);
  }

  // --- Cross-Table Navigation ---

  function navigateToScript(tab, state, scriptName) {
    // If we're in execution_tracking or errors, filter to this script
    if (state.tableName === 'execution_tracking' || state.tableName === 'errors' || state.tableName === 'automation_logs') {
      // Add script filter if not already present
      const existing = state.filters.find((f) => f.column === 'script');
      if (existing) {
        existing.value = scriptName;
      } else {
        state.filters.push({ column: 'script', operator: '=', value: scriptName });
      }
      state.page = 0;
      refreshView(tab);
      render(tab, document.getElementById('tab-content'));
    } else {
      // Open automation_logs filtered by script
      globalThis.tabManager.createTab('sql-table-view', `logs: ${scriptName}`, { tableName: 'automation_logs' }, { reuseKey: `table-automation_logs` });
    }
  }

  // --- Row Detail Panel ---

  function _renderDetailFields(columns, selectedRow) {
    const fields = document.createElement('div');
    fields.className = 'sql-detail-fields';

    for (const col of columns) {
      const field = document.createElement('div');
      field.className = 'sql-detail-field';

      const label = document.createElement('label');
      label.className = 'sql-detail-label';
      label.textContent = col.name;
      if (col.pk) label.classList.add('sql-detail-pk');
      field.appendChild(label);

      const value = selectedRow[col.name];
      const valEl = document.createElement('div');
      valEl.className = 'sql-detail-value';

      if (value == null) {
        valEl.className += ' sql-null';
        valEl.textContent = 'NULL';
      } else if (typeof value === 'string' && isJsonString(value)) {
        const pre = document.createElement('pre');
        pre.className = 'sql-detail-json';
        pre.textContent = JSON.stringify(JSON.parse(value), null, 2);
        valEl.appendChild(pre);
      } else {
        valEl.textContent = String(value);
      }

      field.appendChild(valEl);
      fields.appendChild(field);
    }

    return fields;
  }

  function _renderDrilldowns(panel, state) {
    const drilldowns = document.createElement('div');
    drilldowns.className = 'sql-detail-drilldown';
    const row = state.selectedRow;

    if (state.tableName === 'execution_tracking' && row.id) {
      const corrBtn = document.createElement('button');
      corrBtn.className = 'btn btn-sm';
      corrBtn.textContent = 'View Correlated Logs & Errors';
      corrBtn.addEventListener('click', async () => {
        try {
          const corr = await globalThis.api.invoke('sql-visualizer:get-correlated-records', { executionId: row.id });
          renderCorrelatedInPanel(panel, corr);
        } catch (err) {
          console.error('[detail] correlated:', err);
        }
      });
      drilldowns.appendChild(corrBtn);
    }

    if (state.tableName === 'errors' && row.script && row.timestamp) {
      const execBtn = document.createElement('button');
      execBtn.className = 'btn btn-sm';
      execBtn.textContent = 'Find Execution';
      execBtn.addEventListener('click', () => {
        globalThis.tabManager.createTab('sql-table-view', 'execution_tracking', { tableName: 'execution_tracking' }, { reuseKey: 'table-execution_tracking' });
      });
      drilldowns.appendChild(execBtn);
    }

    if (row.script) {
      const scriptBtn = document.createElement('button');
      scriptBtn.className = 'btn btn-sm';
      scriptBtn.textContent = 'All Activity for "' + escHtml(row.script) + '"';
      scriptBtn.addEventListener('click', () => {
        globalThis.tabManager.createTab('sql-query', 'Query', {}, { reuseKey: 'sql-query-default' });
      });
      drilldowns.appendChild(scriptBtn);
    }

    if (drilldowns.children.length > 0) {
      panel.appendChild(drilldowns);
    }
  }

  function renderDetailPanel(tab, state) {
    const panel = document.getElementById(`sql-detail-${tab.id}`);
    if (!panel || !state.selectedRow) return;
    panel.classList.remove('hidden');
    panel.innerHTML = '';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-sm sql-detail-close';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => {
      state.selectedRow = null;
      panel.classList.add('hidden');
    });
    panel.appendChild(closeBtn);

    // Copy as JSON
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-sm sql-detail-copy';
    copyBtn.textContent = 'Copy JSON';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(JSON.stringify(state.selectedRow, null, 2));
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy JSON'; }, 1500);
    });
    panel.appendChild(copyBtn);

    const heading = document.createElement('h3');
    heading.className = 'sql-detail-heading';
    heading.textContent = `${state.tableName} — Row Detail`;
    panel.appendChild(heading);

    // Breadcrumb
    const breadcrumb = document.createElement('div');
    breadcrumb.className = 'sql-breadcrumb';
    const crumbHome = document.createElement('span');
    crumbHome.className = 'sql-breadcrumb-link';
    crumbHome.textContent = 'Dashboard';
    crumbHome.addEventListener('click', () => globalThis.tabManager.createTab('sql-home', 'SQL Dashboard', {}, { reuseKey: 'sql-home' }));
    breadcrumb.appendChild(crumbHome);
    breadcrumb.appendChild(document.createTextNode(' › '));
    const crumbTable = document.createElement('span');
    crumbTable.className = 'sql-breadcrumb-link';
    crumbTable.textContent = state.tableName;
    breadcrumb.appendChild(crumbTable);
    breadcrumb.appendChild(document.createTextNode(' › Row #' + (state.selectedRow.id || '—')));
    panel.appendChild(breadcrumb);

    panel.appendChild(_renderDetailFields(state.columns, state.selectedRow));
    _renderDrilldowns(panel, state);
  }

  function renderCorrelatedInPanel(panel, corr) {
    // Remove any previously appended correlated section
    const existing = panel.querySelector('.sql-detail-correlated');
    if (existing) existing.remove();

    const section = document.createElement('div');
    section.className = 'sql-detail-correlated';

    const h4 = document.createElement('h4');
    h4.textContent = `Correlated: ${corr.logs.length} logs, ${corr.errors.length} errors`;
    section.appendChild(h4);

    if (corr.logs.length > 0) {
      const logList = document.createElement('div');
      logList.className = 'sql-tl-log-list';
      for (const log of corr.logs.slice(0, 20)) {
        const item = document.createElement('div');
        item.className = 'sql-tl-log-item';
        item.innerHTML = '<span class="sql-tl-log-time">' + escHtml(log.timestamp) + '</span>' +
          '<span class="sql-badge sql-badge--' + log.status.toLowerCase() + '">' + log.status + '</span>' +
          '<span class="sql-tl-log-msg">' + escHtml(log.message) + '</span>';
        logList.appendChild(item);
      }
      section.appendChild(logList);
    }

    if (corr.errors.length > 0) {
      for (const err of corr.errors.slice(0, 5)) {
        const errEl = document.createElement('div');
        errEl.className = 'sql-tl-error-item';
        errEl.innerHTML = '<div class="sql-tl-error-header"><span class="sql-tl-log-time">' +
          escHtml(err.timestamp) + '</span><span>' + escHtml(err.message) + '</span></div>';
        if (err.stack_trace) {
          const stack = document.createElement('pre');
          stack.className = 'sql-tl-stack';
          stack.textContent = err.stack_trace;
          errEl.appendChild(stack);
        }
        section.appendChild(errEl);
      }
    }

    panel.appendChild(section);
  }

  function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // --- Auto-Refresh ---

  function setupAutoRefresh(tab, state) {
    if (state._refreshTimer) {
      clearInterval(state._refreshTimer);
      state._refreshTimer = null;
    }
    if (state.autoRefresh) {
      state._refreshTimer = setInterval(() => refreshView(tab), state.refreshInterval);
    }
  }

  // --- Bookmarks ---

  async function handleBookmark(state) {
    const overlay = document.createElement('div');
    overlay.className = 'sql-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'sql-modal';

    const heading = document.createElement('h3');
    heading.className = 'sql-modal-title';
    heading.textContent = 'Save Bookmark';
    modal.appendChild(heading);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sql-modal-input';
    input.placeholder = 'Bookmark name...';
    input.value = state.tableName + ' — custom view';
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
        const prefs = await globalThis.api.getModulePrefs('sql-visualizer') || {};
        const bookmarks = prefs.bookmarks || [];
        bookmarks.push({
          name,
          table: state.tableName,
          sortCol: state.sortCol,
          sortDir: state.sortDir,
          filters: state.filters.map((f) => ({ column: f.column, operator: f.operator, value: f.value })),
          pageSize: state.pageSize,
          createdAt: Date.now(),
        });
        await globalThis.api.setModulePrefs('sql-visualizer', { bookmarks });
        if (globalThis.ui && globalThis.ui.showNotification) {
          globalThis.ui.showNotification('Bookmark saved: ' + name, 'success');
        }
      } catch (err) {
        console.error('[sql-table-view] bookmark save error:', err);
      }
    });
    actions.appendChild(confirmBtn);
    modal.appendChild(actions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmBtn.click();
      if (e.key === 'Escape') overlay.remove();
    });
  }

  function isJsonString(str) {
    if ((!str.startsWith('{') && !str.startsWith('[')) || str.length < 2) return false;
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  }

  function createJsonCell(jsonStr) {
    const wrapper = document.createElement('div');
    wrapper.className = 'sql-json-cell';

    const preview = document.createElement('span');
    preview.className = 'sql-json-preview';
    const parsed = JSON.parse(jsonStr);
    preview.textContent = Array.isArray(parsed) ? `[${parsed.length} items]` : '{…}';
    wrapper.appendChild(preview);

    const toggle = document.createElement('button');
    toggle.className = 'btn-inline sql-json-toggle';
    toggle.textContent = '▶';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = wrapper.querySelector('.sql-json-expanded');
      if (expanded) {
        expanded.remove();
        toggle.textContent = '▶';
      } else {
        const pre = document.createElement('pre');
        pre.className = 'sql-json-expanded';
        pre.textContent = JSON.stringify(parsed, null, 2);
        wrapper.appendChild(pre);
        toggle.textContent = '▼';
      }
    });
    wrapper.insertBefore(toggle, preview);

    return wrapper;
  }

  // --- Filter Bar ---

  function createFilterBar(tab, state) {
    const bar = document.createElement('div');
    bar.className = 'sql-filter-bar';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-sm btn-secondary';
    addBtn.textContent = '+ Filter';
    addBtn.addEventListener('click', () => {
      if (state.columns.length === 0) return;
      state.filters.push({ column: state.columns[0].name, operator: 'LIKE', value: '' });
      render(tab, document.getElementById('tab-content'));
    });
    bar.appendChild(addBtn);

    for (let i = 0; i < state.filters.length; i++) {
      const f = state.filters[i];
      const row = document.createElement('div');
      row.className = 'sql-filter-row';

      // Column select
      const colSelect = document.createElement('select');
      colSelect.className = 'sql-filter-col';
      for (const col of state.columns) {
        const opt = document.createElement('option');
        opt.value = col.name;
        opt.textContent = col.name;
        if (col.name === f.column) opt.selected = true;
        colSelect.appendChild(opt);
      }
      colSelect.addEventListener('change', () => {
        f.column = colSelect.value;
      });
      row.appendChild(colSelect);

      // Operator select
      const opSelect = document.createElement('select');
      opSelect.className = 'sql-filter-op';
      for (const op of ['LIKE', '=', '!=', '>', '<', '>=', '<=']) {
        const opt = document.createElement('option');
        opt.value = op;
        opt.textContent = op;
        if (op === f.operator) opt.selected = true;
        opSelect.appendChild(opt);
      }
      opSelect.addEventListener('change', () => {
        f.operator = opSelect.value;
      });
      row.appendChild(opSelect);

      // Value input
      const valInput = document.createElement('input');
      valInput.type = 'text';
      valInput.className = 'sql-filter-value';
      valInput.placeholder = 'Value…';
      valInput.value = f.value || '';
      valInput.addEventListener('input', () => {
        f.value = valInput.value;
      });
      valInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          state.page = 0;
          refreshView(tab);
        }
      });
      row.appendChild(valInput);

      // Apply
      const applyBtn = document.createElement('button');
      applyBtn.className = 'btn btn-sm';
      applyBtn.textContent = '↵';
      applyBtn.title = 'Apply filter';
      applyBtn.addEventListener('click', () => {
        state.page = 0;
        refreshView(tab);
      });
      row.appendChild(applyBtn);

      // Remove
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-sm btn-danger';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        state.filters.splice(i, 1);
        state.page = 0;
        refreshView(tab);
        render(tab, document.getElementById('tab-content'));
      });
      row.appendChild(removeBtn);

      bar.appendChild(row);
    }

    return bar;
  }

  // --- Pagination ---

  function renderPagination(footer, tab, state) {
    footer.innerHTML = '';

    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));

    const info = document.createElement('span');
    info.className = 'sql-pagination-info';
    const start = state.total === 0 ? 0 : state.page * state.pageSize + 1;
    const end = Math.min((state.page + 1) * state.pageSize, state.total);
    info.textContent = `${start}–${end} of ${state.total} rows`;
    footer.appendChild(info);

    const controls = document.createElement('div');
    controls.className = 'sql-pagination-controls';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'btn btn-sm';
    prevBtn.textContent = '← Prev';
    prevBtn.disabled = state.page === 0;
    prevBtn.addEventListener('click', () => {
      state.page = Math.max(0, state.page - 1);
      refreshView(tab);
    });
    controls.appendChild(prevBtn);

    const pageInfo = document.createElement('span');
    pageInfo.className = 'sql-page-info';
    pageInfo.textContent = `Page ${state.page + 1} / ${totalPages}`;
    controls.appendChild(pageInfo);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-sm';
    nextBtn.textContent = 'Next →';
    nextBtn.disabled = state.page >= totalPages - 1;
    nextBtn.addEventListener('click', () => {
      state.page = Math.min(totalPages - 1, state.page + 1);
      refreshView(tab);
    });
    controls.appendChild(nextBtn);

    footer.appendChild(controls);
  }

  // --- CSV Export ---

  async function handleExportCsv(state) {
    if (!state.tableName) return;

    try {
      // Build a query that matches current filters/sort
      let sql = `SELECT * FROM "${state.tableName}"`;
      if (state.sortCol) {
        sql += ` ORDER BY "${state.sortCol}" ${state.sortDir}`;
      }

      const csv = await globalThis.api.invoke('sql-visualizer:export-csv', { sql });
      downloadCsv(csv, `${state.tableName}.csv`);
      globalThis.ui.showNotification(`Exported ${state.tableName}.csv`, 'success');
    } catch (err) {
      globalThis.ui.showNotification('Export failed: ' + (err.message || 'Unknown error'), 'error');
    }
  }

  function downloadCsv(csvText, filename) {
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { render, removeState };
})();

// --- Register with TabManager ---

(function register() {
  function doRegister() {
    if (!globalThis.tabManager) {
      setTimeout(doRegister, 0);
      return;
    }

    globalThis.tabManager.registerTabType('sql-table-view', {
      render: SqlTableView.render,
      onClose: (tab) => SqlTableView.removeState(tab.id),
      maxTabs: 6,
    });
  }

  doRegister();
})();
