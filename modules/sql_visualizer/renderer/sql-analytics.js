/**
 * SQL Visualizer — RPA Analytics tab renderer.
 * Tabbed view with Performance Stats, Activity Heatmap,
 * Error Patterns, and File Processing sections.
 * Registers the "sql-analytics" tab type with TabManager.
 */

const SqlAnalytics = (() => {

  const SECTIONS = [
    { id: 'performance', label: 'Performance' },
    { id: 'heatmap',     label: 'Activity Heatmap' },
    { id: 'errors',      label: 'Error Patterns' },
    { id: 'files',       label: 'File Processing' },
  ];

  const DAY_NAMES  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

  // --- Render ---

  async function render(tab, container) {
    if (!container) return;
    container.innerHTML = '';

    const state = { section: 'performance', scriptFilter: null };

    const wrapper = document.createElement('div');
    wrapper.className = 'sql-analytics-tab';

    // Header
    const header = document.createElement('div');
    header.className = 'sql-an-header';

    const h2 = document.createElement('h2');
    h2.textContent = 'RPA Analytics';
    header.appendChild(h2);
    wrapper.appendChild(header);

    // Section tabs
    const nav = document.createElement('div');
    nav.className = 'sql-an-nav';
    for (const s of SECTIONS) {
      const btn = document.createElement('button');
      btn.className = `btn btn-sm sql-an-tab-btn${s.id === state.section ? ' active' : ''}`;
      btn.textContent = s.label;
      btn.dataset.section = s.id;
      btn.addEventListener('click', () => {
        state.section = s.id;
        nav.querySelectorAll('.sql-an-tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.section === s.id));
        renderSection(wrapper, state);
      });
      nav.appendChild(btn);
    }
    wrapper.appendChild(nav);

    // Content area
    const content = document.createElement('div');
    content.className = 'sql-an-content';
    wrapper.appendChild(content);

    container.appendChild(wrapper);
    await renderSection(wrapper, state);
  }

  // --- Section router ---

  async function renderSection(wrapper, state) {
    const content = wrapper.querySelector('.sql-an-content');
    content.innerHTML = '<div class="sql-an-loading">Loading…</div>';

    try {
      switch (state.section) {
        case 'performance': await renderPerformance(content, state); break;
        case 'heatmap':     await renderHeatmap(content, state);     break;
        case 'errors':      await renderErrors(content);             break;
        case 'files':       await renderFiles(content);              break;
      }
    } catch (err) {
      content.innerHTML = `<div class="sql-an-error">Error loading analytics: ${escHtml(err.message)}</div>`;
    }
  }

  // --- Performance Section ---

  async function renderPerformance(container, state) {
    const data = await globalThis.api.invoke('sql-visualizer:get-performance-stats', { script: state.scriptFilter });
    container.innerHTML = '';

    // Script filter
    const filterBar = document.createElement('div');
    filterBar.className = 'sql-an-filter-bar';

    const label = document.createElement('span');
    label.textContent = 'Script:';
    filterBar.appendChild(label);

    const sel = document.createElement('select');
    sel.className = 'sql-filter-col';
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = '— All scripts —';
    sel.appendChild(allOpt);

    // Get unique scripts from runs
    const scripts = [...new Set(data.runs.map((r) => r.script))].sort((a, b) => a.localeCompare(b));
    for (const s of scripts) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      if (s === state.scriptFilter) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      state.scriptFilter = sel.value || null;
      renderPerformance(container, state);
    });
    filterBar.appendChild(sel);
    container.appendChild(filterBar);

    if (data.count === 0) {
      container.appendChild(emptyMessage('No completed executions found.'));
      return;
    }

    // Summary cards
    const cards = document.createElement('div');
    cards.className = 'sql-an-stat-cards';
    const metrics = [
      { label: 'Executions', value: data.count },
      { label: 'Avg Runtime', value: formatDuration(data.avgMs) },
      { label: 'Median', value: formatDuration(data.medianMs) },
      { label: 'Min', value: formatDuration(data.minMs) },
      { label: 'Max', value: formatDuration(data.maxMs) },
      { label: 'P95', value: formatDuration(data.p95Ms) },
    ];
    for (const m of metrics) {
      const card = document.createElement('div');
      card.className = 'sql-an-metric';
      card.innerHTML = `<span class="sql-an-metric-val">${escHtml(String(m.value))}</span><span class="sql-an-metric-label">${m.label}</span>`;
      cards.appendChild(card);
    }
    container.appendChild(cards);

    // Runs table
    const tableWrap = document.createElement('div');
    tableWrap.className = 'sql-table-container';
    const table = document.createElement('table');
    table.className = 'sql-data-table';

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th class="sql-th">ID</th><th class="sql-th">Script</th><th class="sql-th">Start</th><th class="sql-th">Duration</th><th class="sql-th">Status</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const r of data.runs.slice(0, 100)) {
      const tr = document.createElement('tr');
      const statusClass = (r.status || 'running').toLowerCase();
      tr.innerHTML = `
        <td>${r.id}</td>
        <td>${escHtml(r.script)}</td>
        <td>${escHtml(r.start_time)}</td>
        <td>${r.durationMs != null ? formatDuration(r.durationMs) : '—'}</td>
        <td><span class="sql-badge sql-badge--${statusClass}">${r.status || 'RUNNING'}</span></td>
      `;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    container.appendChild(tableWrap);
  }

  // --- Heatmap Section ---

  async function renderHeatmap(container, state) {
    const data = await globalThis.api.invoke('sql-visualizer:get-activity-heatmap', { timeRange: 'month', script: state.scriptFilter });
    container.innerHTML = '';

    if (data.maxCount === 0) {
      container.appendChild(emptyMessage('No activity data for heatmap.'));
      return;
    }

    const heatmap = document.createElement('div');
    heatmap.className = 'sql-heatmap';

    // Header row: hours
    const headerRow = document.createElement('div');
    headerRow.className = 'sql-heatmap-row sql-heatmap-header';
    headerRow.appendChild(createCell('', 'sql-heatmap-label'));
    for (let h = 0; h < 24; h++) {
      headerRow.appendChild(createCell(h % 3 === 0 ? `${String(h).padStart(2, '0')}` : '', 'sql-heatmap-hour'));
    }
    heatmap.appendChild(headerRow);

    // Day rows
    for (let day = 0; day < 7; day++) {
      const row = document.createElement('div');
      row.className = 'sql-heatmap-row';

      row.appendChild(createCell(DAY_NAMES[day], 'sql-heatmap-label'));

      for (let hour = 0; hour < 24; hour++) {
        const cell = data.cells.find((c) => c.day === day && c.hour === hour);
        const count = cell ? cell.count : 0;
        const intensity = data.maxCount > 0 ? count / data.maxCount : 0;

        const el = document.createElement('div');
        el.className = 'sql-heatmap-cell';
        el.style.opacity = count === 0 ? '0.05' : String(0.2 + intensity * 0.8);
        el.style.backgroundColor = count === 0 ? 'var(--surface-3)' : 'var(--accent)';
        el.title = `${DAY_NAMES[day]} ${HOUR_LABELS[hour]}: ${count} events`;
        row.appendChild(el);
      }

      heatmap.appendChild(row);
    }

    container.appendChild(heatmap);
  }

  // --- Error Patterns Section ---

  async function renderErrors(container) {
    const patterns = await globalThis.api.invoke('sql-visualizer:get-error-patterns');
    container.innerHTML = '';

    if (patterns.length === 0) {
      container.appendChild(emptyMessage('No error patterns found.'));
      return;
    }

    const list = document.createElement('div');
    list.className = 'sql-an-error-list';

    for (const p of patterns) {
      const card = document.createElement('div');
      card.className = 'sql-an-error-card';

      const header = document.createElement('div');
      header.className = 'sql-an-error-card-header';
      header.innerHTML = `
        <span class="sql-an-error-count">${p.count}×</span>
        <span class="sql-an-error-pattern">${escHtml(p.pattern)}</span>
      `;
      card.appendChild(header);

      const meta = document.createElement('div');
      meta.className = 'sql-an-error-card-meta';
      meta.innerHTML = `
        <span>Scripts: ${p.scripts.map(escHtml).join(', ')}</span>
        <span>Latest: ${escHtml(p.latestTimestamp)}</span>
      `;
      card.appendChild(meta);

      // Expand examples on click
      if (p.examples.length > 0) {
        const toggle = document.createElement('button');
        toggle.className = 'btn btn-sm sql-an-example-toggle';
        toggle.textContent = 'Show examples';
        const exampleContainer = document.createElement('div');
        exampleContainer.className = 'sql-an-examples hidden';

        for (const ex of p.examples) {
          const item = document.createElement('div');
          item.className = 'sql-an-example-item';
          item.innerHTML = `
            <span class="sql-tl-log-time">${escHtml(ex.timestamp)}</span>
            <span>${escHtml(ex.script)}</span>
            <span>${escHtml(ex.message)}</span>
          `;
          exampleContainer.appendChild(item);
        }

        toggle.addEventListener('click', () => {
          exampleContainer.classList.toggle('hidden');
          toggle.textContent = exampleContainer.classList.contains('hidden') ? 'Show examples' : 'Hide examples';
        });

        card.appendChild(toggle);
        card.appendChild(exampleContainer);
      }

      list.appendChild(card);
    }

    container.appendChild(list);
  }

  // --- File Processing Section ---

  async function renderFiles(container) {
    container.innerHTML = '';

    // Operation breakdown
    let opData;
    try {
      opData = await globalThis.api.invoke('sql-visualizer:run-query', {
        sql: `SELECT operation, COUNT(*) AS count, script FROM file_processing_records GROUP BY operation, script ORDER BY count DESC`
      });
    } catch {
      container.appendChild(emptyMessage('No file processing data.'));
      return;
    }

    if (opData.rowCount === 0) {
      container.appendChild(emptyMessage('No file processing records found.'));
      return;
    }

    // Summary by operation
    const opSummary = {};
    for (const r of opData.rows) {
      if (!opSummary[r.operation]) opSummary[r.operation] = 0;
      opSummary[r.operation] += r.count;
    }

    const cards = document.createElement('div');
    cards.className = 'sql-an-stat-cards';
    for (const [op, count] of Object.entries(opSummary)) {
      const card = document.createElement('div');
      card.className = 'sql-an-metric';
      card.innerHTML = `<span class="sql-an-metric-val">${count}</span><span class="sql-an-metric-label">${escHtml(op)}</span>`;
      cards.appendChild(card);
    }
    container.appendChild(cards);

    // Detailed table
    const tableWrap = document.createElement('div');
    tableWrap.className = 'sql-table-container';
    const table = document.createElement('table');
    table.className = 'sql-data-table';

    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th class="sql-th">Operation</th><th class="sql-th">Script</th><th class="sql-th">Count</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const r of opData.rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escHtml(r.operation)}</td><td>${escHtml(r.script)}</td><td>${r.count}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    container.appendChild(tableWrap);

    // Recent files
    let recentData;
    try {
      recentData = await globalThis.api.invoke('sql-visualizer:run-query', {
        sql: `SELECT source_path, dest_path, file_type, script, operation, timestamp FROM file_processing_records ORDER BY timestamp DESC LIMIT 20`
      });
    } catch { return; }

    if (recentData.rowCount > 0) {
      const h3 = document.createElement('h3');
      h3.className = 'sql-an-section-title';
      h3.textContent = 'Recent File Operations';
      container.appendChild(h3);

      const rTable = document.createElement('div');
      rTable.className = 'sql-table-container';
      const rt = document.createElement('table');
      rt.className = 'sql-data-table';

      const rth = document.createElement('thead');
      rth.innerHTML = '<tr><th class="sql-th">Time</th><th class="sql-th">Script</th><th class="sql-th">Op</th><th class="sql-th">Type</th><th class="sql-th">Source</th></tr>';
      rt.appendChild(rth);

      const rtb = document.createElement('tbody');
      for (const r of recentData.rows) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escHtml(r.timestamp)}</td>
          <td>${escHtml(r.script)}</td>
          <td>${escHtml(r.operation)}</td>
          <td>${escHtml(r.file_type)}</td>
          <td title="${escHtml(r.source_path)}">${escHtml(truncatePath(r.source_path))}</td>
        `;
        rtb.appendChild(tr);
      }
      rt.appendChild(rtb);
      rTable.appendChild(rt);
      container.appendChild(rTable);
    }
  }

  // --- Util ---

  function createCell(text, className) {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    return el;
  }

  function emptyMessage(text) {
    const p = document.createElement('p');
    p.className = 'sql-an-empty';
    p.textContent = text;
    return p;
  }

  function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }

  function truncatePath(p) {
    if (!p) return '';
    const parts = p.split('/');
    return parts.length > 3 ? '…/' + parts.slice(-2).join('/') : p;
  }

  function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function onClose() {

  return { render, onClose };
})();

// --- Register with TabManager ---

(function register() {
  function doRegister() {
    if (!globalThis.tabManager) {
      setTimeout(doRegister, 0);
      return;
    }

    globalThis.tabManager.registerTabType('sql-analytics', {
      render: SqlAnalytics.render,
      onClose: SqlAnalytics.onClose,
      maxTabs: 1,
    });
  }

  doRegister();
})();
