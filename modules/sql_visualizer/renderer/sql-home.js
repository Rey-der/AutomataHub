/**
 * SQL Monitor — sql-home tab renderer.
 * Dashboard showing table cards with row counts & latest timestamps,
 * quick stats, script health cards, integrity panel, DB health indicator,
 * bookmarks, and navigation to table browser / query editor / timeline / analytics.
 * Registers the "sql-home" tab type with TabManager.
 */

const SqlHome = (() => {

  // --- Table Card ---

  function createTableCard(stat) {
    const card = document.createElement('div');
    card.className = 'sql-card';
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'article');
    card.setAttribute('aria-label', `Table: ${stat.table}`);

    card.addEventListener('click', () => openTableView(stat.table));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openTableView(stat.table);
      }
    });

    const header = document.createElement('div');
    header.className = 'card-header';

    const name = document.createElement('h3');
    name.className = 'sql-card-name';
    name.textContent = stat.table;
    header.appendChild(name);

    const count = document.createElement('span');
    count.className = 'sql-card-count';
    count.textContent = `${stat.count} rows`;
    header.appendChild(count);

    card.appendChild(header);

    const meta = document.createElement('p');
    meta.className = 'sql-card-meta';
    if (stat.latest) {
      meta.textContent = `Latest: ${stat.latest}`;
    } else {
      meta.textContent = stat.count === 0 ? 'Empty table' : 'No timestamp column';
    }
    card.appendChild(meta);

    const footer = document.createElement('div');
    footer.className = 'card-footer';

    const browseBtn = document.createElement('button');
    browseBtn.className = 'btn btn-sm';
    browseBtn.textContent = 'Browse';
    browseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTableView(stat.table);
    });
    footer.appendChild(browseBtn);

    card.appendChild(footer);
    return card;
  }

  function openTableView(table) {
    globalThis.tabManager.createTab('sql-table-view', table, { tableName: table }, { reuseKey: `table-${table}` });
  }

  // --- Quick Stats ---

  function createQuickStats(stats) {
    const container = document.createElement('div');
    container.className = 'sql-quick-stats';

    const totalRows = stats.reduce((sum, s) => sum + s.count, 0);
    const errorStat = stats.find((s) => s.table === 'errors');
    const execStat = stats.find((s) => s.table === 'execution_tracking');
    const logStat = stats.find((s) => s.table === 'automation_logs');

    const items = [
      { label: 'Total Records', value: totalRows.toLocaleString() },
      { label: 'Errors', value: errorStat ? errorStat.count.toLocaleString() : '0' },
      { label: 'Executions', value: execStat ? execStat.count.toLocaleString() : '0' },
      { label: 'Log Entries', value: logStat ? logStat.count.toLocaleString() : '0' },
    ];

    for (const item of items) {
      const stat = document.createElement('div');
      stat.className = 'sql-stat-item';

      const value = document.createElement('span');
      value.className = 'sql-stat-value';
      value.textContent = item.value;
      stat.appendChild(value);

      const label = document.createElement('span');
      label.className = 'sql-stat-label';
      label.textContent = item.label;
      stat.appendChild(label);

      container.appendChild(stat);
    }

    return container;
  }

  // --- Script Health Cards ---

  function createHealthCards(healthStats) {
    const section = document.createElement('div');
    section.className = 'sql-health-section';

    const heading = document.createElement('h2');
    heading.className = 'sql-section-heading';
    heading.textContent = 'Script Health';
    section.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'sql-health-grid';

    for (const s of healthStats) {
      const card = document.createElement('div');
      card.className = `sql-health-card sql-health-card--${s.health}`;

      const header = document.createElement('div');
      header.className = 'sql-health-card-header';

      const name = document.createElement('span');
      name.className = 'sql-health-name';
      name.textContent = s.script;
      header.appendChild(name);

      const badge = document.createElement('span');
      badge.className = `sql-health-badge sql-health-badge--${s.health}`;
      badge.textContent = s.health;
      header.appendChild(badge);

      card.appendChild(header);

      const stats = document.createElement('div');
      stats.className = 'sql-health-stats';
      stats.innerHTML = `
        <span>Success rate: <strong>${s.successRate}%</strong></span>
        <span>${s.successes}✓ / ${s.failures}✗ (${s.total} total)</span>
        <span>Streak: ${s.currentStreak} ${s.streakType || '—'}</span>
        <span>Last: ${s.lastRun || 'never'}</span>
      `;
      card.appendChild(stats);

      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        globalThis.tabManager.createTab('sql-analytics', 'RPA Analytics', {}, { reuseKey: 'sql-analytics' });
      });

      grid.appendChild(card);
    }

    section.appendChild(grid);
    return section;
  }

  // --- Integrity Panel ---

  function createIntegrityPanel(report) {
    const section = document.createElement('div');
    section.className = 'sql-integrity-section';

    const heading = document.createElement('h2');
    heading.className = 'sql-section-heading';
    heading.textContent = 'Integrity Checks';
    section.appendChild(heading);

    const alerts = document.createElement('div');
    alerts.className = 'sql-integrity-alerts';

    // Zombie runs
    if (report.zombies && report.zombies.length > 0) {
      const alert = document.createElement('div');
      alert.className = 'sql-integrity-alert sql-integrity-alert--warning';
      alert.innerHTML = `<span class="sql-integrity-icon">WARN</span><span><strong>${report.zombies.length} zombie run(s)</strong> — started but never finished (>1 hour ago)</span>`;
      alerts.appendChild(alert);
    }

    // Stale tables
    const staleTables = (report.tableActivity || []).filter((t) => t.stale);
    if (staleTables.length > 0) {
      const alert = document.createElement('div');
      alert.className = 'sql-integrity-alert sql-integrity-alert--info';
      const names = staleTables.map((t) => `${t.table} (${t.daysSince}d)`).join(', ');
      alert.innerHTML = `<span class="sql-integrity-icon">INFO</span><span><strong>Stale tables:</strong> ${names}</span>`;
      alerts.appendChild(alert);
    }

    // Execution gaps
    if (report.gaps && report.gaps.length > 0) {
      const alert = document.createElement('div');
      alert.className = 'sql-integrity-alert sql-integrity-alert--warning';
      const names = report.gaps.map((g) => `${g.script} (${g.daysSinceLast}d)`).join(', ');
      alert.innerHTML = `<span class="sql-integrity-icon">WARN</span><span><strong>Missing runs:</strong> ${names}</span>`;
      alerts.appendChild(alert);
    }

    if (alerts.children.length === 0) {
      const ok = document.createElement('div');
      ok.className = 'sql-integrity-alert sql-integrity-alert--ok';
      ok.innerHTML = '<span class="sql-integrity-icon">OK</span><span>All integrity checks passed</span>';
      alerts.appendChild(ok);
    }

    section.appendChild(alerts);
    return section;
  }

  // --- DB Health Indicator ---

  function createDbHealthIndicator(health) {
    const bar = document.createElement('div');
    bar.className = 'sql-db-health-bar';

    const items = [
      { label: 'Size', value: formatBytes(health.fileSizeBytes) },
      { label: 'WAL', value: formatBytes(health.walSizeBytes) },
      { label: 'Integrity', value: health.integrityOk ? 'OK' : 'FAIL', ok: health.integrityOk },
      { label: 'Tables', value: health.tableCount },
      { label: 'Indexes', value: health.indexCount },
      { label: 'Modified', value: health.lastModified ? new Date(health.lastModified).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—' },
    ];

    for (const item of items) {
      const el = document.createElement('span');
      el.className = 'sql-db-health-item';
      if (item.ok === false) el.classList.add('sql-db-health-item--bad');
      el.innerHTML = `<span class="sql-db-health-label">${item.label}:</span> ${item.value}`;
      bar.appendChild(el);
    }

    return bar;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  }

  // --- Connection Status with Retry UI ---

  function createConnectionStatus(status) {
    const bar = document.createElement('div');
    bar.className = 'sql-connection-bar';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');

    const dot = document.createElement('span');
    dot.className = status.connected ? 'sql-dot sql-dot-connected' : 'sql-dot sql-dot-disconnected';
    bar.appendChild(dot);

    const text = document.createElement('span');
    text.className = 'sql-connection-text';
    
    if (status.connected) {
      text.textContent = `Connected: ${status.path}`;
    } else {
      text.textContent = status.message || 'Not connected — attempting to reconnect...';
    }
    bar.appendChild(text);

    // Add retry button if not connected
    if (!status.connected) {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'btn btn-sm sql-retry-btn';
      retryBtn.textContent = 'Retry Now';
      retryBtn.addEventListener('click', async () => {
        retryBtn.disabled = true;
        retryBtn.textContent = 'Retrying...';
        await DbConnectionManager.retryNow();
        retryBtn.disabled = false;
        retryBtn.textContent = 'Retry Now';
      });
      bar.appendChild(retryBtn);
    }

    return bar;
  }

  // --- Bookmarks Section ---

  function createBookmarksSection(bookmarks) {
    const section = document.createElement('div');
    section.className = 'sql-bookmarks-section';

    const heading = document.createElement('h2');
    heading.className = 'sql-section-heading';
    heading.textContent = 'Bookmarks';
    section.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'sql-bookmarks-list';

    for (let i = 0; i < bookmarks.length; i++) {
      const bm = bookmarks[i];
      const item = document.createElement('div');
      item.className = 'sql-bookmark-item';
      item.addEventListener('click', () => {
        globalThis.tabManager.createTab('sql-table-view', bm.table, {
          tableName: bm.table,
          bookmark: bm,
        }, { reuseKey: `table-${bm.table}` });
      });

      const name = document.createElement('span');
      name.className = 'sql-bookmark-name';
      name.textContent = bm.name;
      item.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'sql-bookmark-meta';
      const filterCount = (bm.filters || []).length;
      const plural = filterCount === 1 ? '' : 's';
      meta.textContent = bm.table + (filterCount > 0 ? ` (${filterCount} filter${plural})` : '');
      item.appendChild(meta);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-sm sql-bookmark-delete';
      delBtn.textContent = 'Remove';
      delBtn.title = 'Remove bookmark';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const prefs = await globalThis.api.getModulePrefs('sql-visualizer') || {};
          const bms = prefs.bookmarks || [];
          bms.splice(i, 1);
          await globalThis.api.setModulePrefs('sql-visualizer', { bookmarks: bms });
          item.remove();
          if (list.children.length === 0) section.remove();
        } catch (err) {
          console.error('[sql-home] delete bookmark:', err);
        }
      });
      item.appendChild(delBtn);

      list.appendChild(item);
    }

    section.appendChild(list);
    return section;
  }

  // --- DB Management Bar ---

  async function _renderDbBar(container) {
    let info = { dbs: [], active: null };
    try {
      info = await globalThis.api.invoke('sql-visualizer:get-db-list');
    } catch { /* not connected yet — show empty bar */ }

    container.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'sql-db-bar';

    // Left: section title + chip row
    const left = document.createElement('div');
    left.className = 'sql-db-bar-left';

    const heading = document.createElement('span');
    heading.className = 'sql-db-bar-heading';
    heading.textContent = 'Connected Databases';
    left.appendChild(heading);

    const chips = document.createElement('div');
    chips.className = 'sql-db-chips';

    if (info.dbs && info.dbs.length > 0) {
      for (const dbPath of info.dbs) {
        const isActive = dbPath === info.active;
        const filename = dbPath.split(/[/\\]/).pop();
        const dirPart = dbPath.substring(0, dbPath.length - filename.length - 1).split(/[/\\]/).pop();

        const chip = document.createElement('div');
        chip.className = 'sql-db-chip' + (isActive ? ' active' : '');
        chip.title = isActive ? dbPath : `Switch to: ${dbPath}`;
        chip.setAttribute('role', 'button');
        chip.setAttribute('tabindex', isActive ? '-1' : '0');

        const chipInner = document.createElement('div');
        chipInner.className = 'sql-db-chip-inner';

        const statusDot = document.createElement('span');
        statusDot.className = 'sql-db-status-dot';
        statusDot.setAttribute('aria-hidden', 'true');
        chipInner.appendChild(statusDot);

        const textGroup = document.createElement('div');
        textGroup.className = 'sql-db-chip-text';

        const nameEl = document.createElement('span');
        nameEl.className = 'sql-db-chip-name';
        nameEl.textContent = filename;
        textGroup.appendChild(nameEl);

        if (dirPart) {
          const dirEl = document.createElement('span');
          dirEl.className = 'sql-db-chip-dir';
          dirEl.textContent = dirPart;
          textGroup.appendChild(dirEl);
        }

        chipInner.appendChild(textGroup);
        chip.appendChild(chipInner);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'sql-db-chip-remove';
        removeBtn.title = 'Remove from list';
        removeBtn.setAttribute('aria-label', `Remove ${filename}`);
        removeBtn.innerHTML = '&times;';
        removeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const result = await globalThis.api.invoke('sql-visualizer:remove-db', { path: dbPath });
          // Immediately clear content — don't wait for checkStatus() event chain
          if (!result.connected) {
            const cd = container.nextElementSibling;
            if (cd) {
              cd.innerHTML = `
                <div class="sql-waiting-state" role="status" aria-live="polite">
                  <div class="sql-waiting-spinner"></div>
                  <p>No database connected.</p>
                  <small>Use \u201cAdd Database\u201d above to connect a SQLite file.</small>
                </div>
              `;
            }
          }
          await _renderDbBar(container);
          await DbConnectionManager.checkStatus();
        });
        chip.appendChild(removeBtn);

        if (!isActive) {
          chip.addEventListener('click', async () => {
            await DbConnectionManager.switchDb(dbPath);
            await _renderDbBar(container);
          });
          chip.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              await DbConnectionManager.switchDb(dbPath);
              await _renderDbBar(container);
            }
          });
        }

        chips.appendChild(chip);
      }
    } else {
      const empty = document.createElement('span');
      empty.className = 'sql-db-chips-empty';
      empty.textContent = 'No databases added — click "Add Database" to get started';
      chips.appendChild(empty);
    }

    left.appendChild(chips);
    bar.appendChild(left);

    // Right: Add DB button
    const addBtn = document.createElement('button');
    addBtn.className = 'sql-db-add-btn';
    addBtn.title = 'Browse for a SQLite database file';
    addBtn.innerHTML = '<span class="sql-db-add-icon" aria-hidden="true">+</span> Add Database';
    addBtn.addEventListener('click', async () => {
      addBtn.disabled = true;
      const result = await globalThis.api.invoke('sql-visualizer:add-db');
      addBtn.disabled = false;
      if (!result.canceled) {
        await _renderDbBar(container);
        await DbConnectionManager.checkStatus();
      }
    });
    bar.appendChild(addBtn);

    container.appendChild(bar);
  }

  // --- Empty State ---

  function renderEmpty(container) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';

    const title = document.createElement('h3');
    title.className = 'empty-state-title';
    title.textContent = 'No tables found';
    empty.appendChild(title);

    const hint = document.createElement('p');
    hint.className = 'empty-state-hint';
    hint.textContent = 'No tables found. Add a database via the connector or check that your DB is initialised.';
    empty.appendChild(hint);

    container.appendChild(empty);
  }

  // --- Render ---

  async function render(tab, container) {
    if (!container) return;
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'home-tab sql-home';

    // Header
    const header = document.createElement('div');
    header.className = 'home-header';

    const headerText = document.createElement('div');
    headerText.className = 'home-header-text';

    const h1 = document.createElement('h1');
    h1.textContent = 'SQL Monitor';
    headerText.appendChild(h1);

    const subtitle = document.createElement('p');
    subtitle.className = 'subtitle';
    subtitle.textContent = 'Monitor, query, and visualize your SQLite databases';
    headerText.appendChild(subtitle);

    header.appendChild(headerText);

    // Action buttons in header
    const headerActions = document.createElement('div');
    headerActions.className = 'home-header-actions';

    const queryBtn = document.createElement('button');
    queryBtn.className = 'btn';
    queryBtn.textContent = 'Query Editor';
    queryBtn.addEventListener('click', () => {
      globalThis.tabManager.createTab('sql-query', 'Query', {}, { reuseKey: 'sql-query-default' });
    });
    headerActions.appendChild(queryBtn);

    const timelineBtn = document.createElement('button');
    timelineBtn.className = 'btn';
    timelineBtn.textContent = 'Timeline';
    timelineBtn.addEventListener('click', () => {
      globalThis.tabManager.createTab('sql-timeline', 'Timeline', {}, { reuseKey: 'sql-timeline' });
    });
    headerActions.appendChild(timelineBtn);

    const analyticsBtn = document.createElement('button');
    analyticsBtn.className = 'btn';
    analyticsBtn.textContent = 'Analytics';
    analyticsBtn.addEventListener('click', () => {
      globalThis.tabManager.createTab('sql-analytics', 'RPA Analytics', {}, { reuseKey: 'sql-analytics' });
    });
    headerActions.appendChild(analyticsBtn);

    header.appendChild(headerActions);
    wrapper.appendChild(header);

    // DB management bar — shows all known databases, allows add/remove/switch
    const dbBarDiv = document.createElement('div');
    dbBarDiv.id = `sql-db-bar-${tab.id}`;
    wrapper.appendChild(dbBarDiv);

    // Content area (will be populated when connected)
    const contentDiv = document.createElement('div');
    contentDiv.id = `sql-content-${tab.id}`;
    wrapper.appendChild(contentDiv);

    container.appendChild(wrapper);

    // Render DB management bar immediately
    _renderDbBar(dbBarDiv);

    // Generation counter: incremented on every load or disconnect.
    // loadContent checks it before appending to discard stale in-flight results.
    let loadGeneration = 0;

    // Start monitoring and set up connection listener
    const unsubscribe = DbConnectionManager.onStatusChange(async (status) => {
      if (status.connected) {
        const myGen = ++loadGeneration;
        await loadContent(contentDiv, tab, myGen, () => loadGeneration);
      } else {
        // Invalidate any in-flight load, then show disconnected state
        loadGeneration++;
        contentDiv.innerHTML = `
          <div class="sql-waiting-state" role="status" aria-live="polite">
            <div class="sql-waiting-spinner"></div>
            <p>No database connected.</p>
            <small>Use “Add Database” above to connect a SQLite file.</small>
          </div>
        `;
      }
    });

    // Start monitoring
    DbConnectionManager.startMonitoring();

    // Clean up listener when tab is closed
    const originalCleanup = tab._cleanup || (() => {});
    tab._cleanup = () => {
      originalCleanup();
      unsubscribe();
      DbConnectionManager.stopMonitoring();
    };
  }

  async function _loadDbHealth(content) {
    try {
      const health = await globalThis.api.invoke('sql-visualizer:get-db-health');
      if (health?.tableCount != null) {
        content.appendChild(createDbHealthIndicator(health));
      }
    } catch (err) {
      console.error('[sql-home] Failed to load DB health:', err);
    }
  }

  async function _loadScriptHealth(content) {
    try {
      const healthStats = await globalThis.api.invoke('sql-visualizer:get-script-health');
      if (healthStats?.length > 0) {
        content.appendChild(createHealthCards(healthStats));
      }
    } catch (err) {
      console.error('[sql-home] Failed to load script health:', err);
    }
  }

  async function _loadIntegrity(content) {
    try {
      const report = await globalThis.api.invoke('sql-visualizer:get-integrity-report');
      if (report) {
        content.appendChild(createIntegrityPanel(report));
      }
    } catch (err) {
      console.error('[sql-home] Failed to load integrity report:', err);
    }
  }

  async function _loadBookmarks(content) {
    try {
      const prefs = await globalThis.api.getModulePrefs('sql-visualizer') || {};
      const bookmarks = prefs.bookmarks || [];
      if (bookmarks.length > 0) {
        content.appendChild(createBookmarksSection(bookmarks));
      }
    } catch { /* ignore */ }
  }

  /**
   * Load dashboard content when database is connected.
   * @param {HTMLElement} contentDiv
   * @param {object} tab
   * @param {number} gen - Load generation; if the current generation counter
   *   (returned by getGen) no longer matches, the result is discarded.
   * @param {() => number} getGen - Returns the current generation value.
   */
  async function loadContent(contentDiv, tab, gen = 0, getGen = () => 0) {
    if (!contentDiv) return;
    contentDiv.innerHTML = '';

    const content = document.createElement('div');

    await _loadDbHealth(content);

    // Load stats
    let stats = [];
    try {
      stats = await globalThis.api.invoke('sql-visualizer:get-table-stats');
    } catch (err) {
      console.error('[sql-home] Failed to load table stats:', err);
    }

    if (stats.length > 0) {
      content.appendChild(createQuickStats(stats));
    }

    await _loadScriptHealth(content);
    await _loadIntegrity(content);
    await _loadBookmarks(content);

    // Table cards
    if (stats.length === 0) {
      renderEmpty(content);
    } else {
      const gridHeading = document.createElement('h2');
      gridHeading.className = 'sql-section-heading';
      gridHeading.textContent = 'Tables';
      content.appendChild(gridHeading);

      const grid = document.createElement('div');
      grid.className = 'sql-cards-grid';
      for (const stat of stats) {
        grid.appendChild(createTableCard(stat));
      }
      content.appendChild(grid);
    }

    // Discard result if a disconnect (or newer load) invalidated this generation
    if (getGen() !== gen) return;
    contentDiv.appendChild(content);
  }

  return { render };
})();

// --- Register with TabManager and Hub ---

(function register() {
  function doRegister() {
    if (!globalThis.tabManager) {
      setTimeout(doRegister, 0);
      return;
    }

    globalThis.tabManager.registerTabType('sql-home', {
      render: SqlHome.render,
      maxTabs: 1,
    });

    globalThis._hub = globalThis._hub || {};
    globalThis._hub.moduleOpeners = globalThis._hub.moduleOpeners || {};
    globalThis._hub.moduleOpeners['sql-visualizer'] = () => {
      const tm = globalThis.tabManager;
      if (!tm) return;

      const existing = tm.getTabsByType('sql-home');
      if (existing.length > 0) {
        tm.switchTab(existing[0].id);
        return;
      }

      if (tm.hasTabType('sql-home')) {
        tm.createTab('sql-home', 'SQL Monitor', {}, { reuseKey: 'autostart-sql-visualizer' });
      }
    };
  }

  doRegister();
})();
