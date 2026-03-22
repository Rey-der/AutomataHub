/**
 * Script Runner — ScriptBrowser
 * Main panel for browsing, filtering, and managing scripts by topic.
 */

class ScriptBrowser {
  constructor(app) {
    this.app = app;
    this.container = null;
    this.filterText = '';
    this.filterLanguage = '';
    this._pendingTopicScript = null;
  }

  async init(container) {
    this.container = container;
    this.render();
  }

  render() {
    if (!this.container) return;

    const topicName = this.app.selectedTopicId
      ? this.app.topics.find((t) => t.id === this.app.selectedTopicId)?.name
      : 'All Scripts';

    this.container.innerHTML = `
      <div class="script-browser">
        <div class="script-browser-header">
          <h2>${this._escapeHtml(topicName || 'Scripts')}</h2>
          <div class="script-browser-filters">
            <input
              type="text"
              class="script-filter"
              id="script-filter"
              placeholder="Search scripts..."
              value="${this._escapeHtml(this.filterText)}"
            />
            <button class="btn btn-sm btn-secondary" id="btn-clear-filter" title="Clear filter" style="display: ${this.filterText ? 'inline-flex' : 'none'}">
              ✕
            </button>
          </div>
          ${this.app.selectedTopicId ? '' : `<button class="btn-add-script" id="btn-browse">+ Add Script</button>`}
        </div>
        
        ${this._renderLanguageFilter()}

        <div class="script-browser-content" id="scripts-container">
          ${this._renderScripts()}
        </div>

        <div class="browser-loading" id="browser-loading" style="display:none">
          <div class="browser-loading-spinner"></div>
        </div>

        ${this.app.selectedTopicId ? `
          <div class="remove-zone" id="remove-zone">
            <p class="remove-label">Drag script here to remove from topic</p>
          </div>
        ` : ''}

        <div class="topic-picker-overlay" id="topic-picker-overlay" style="display:none">
          <div class="topic-picker-backdrop" id="topic-picker-backdrop"></div>
          <div class="topic-picker-modal" id="topic-picker-modal">
            <div class="topic-picker-header">
              <span>Add to Topic</span>
              <button class="topic-picker-close" id="btn-close-picker">&#x2715;</button>
            </div>
            <div class="topic-picker-list" id="topic-picker-list"></div>
          </div>
        </div>

        <div class="script-detail-overlay" id="script-detail-overlay" style="display:none">
          <div class="script-detail-backdrop" id="script-detail-backdrop"></div>
          <div class="script-detail-panel" id="script-detail-panel">
            <div class="script-detail-header">
              <h3 class="script-detail-title" id="detail-title"></h3>
              <button class="script-detail-close" id="btn-close-detail">&#x2715;</button>
            </div>
            <div class="script-detail-body" id="detail-body"></div>
          </div>
        </div>

        <div class="sr-variant-menu" id="variant-menu" style="display:none;"></div>
      </div>
    `;

    this._attachEventListeners();
  }

  _renderScripts() {
    const filtered = this._getFilteredScripts();

    if (filtered.length === 0) {
      if (this.filterText) {
        return '<div class="empty-state"><p>No scripts match your filter</p></div>';
      }
      return `
        <div class="empty-state">
          <p>No scripts yet</p>
          <small>Click "+ Add Script" to get started.</small>
        </div>
      `;
    }

    return filtered
      .map((script) => this._renderScriptCard(script))
      .join('');
  }

  _renderScriptCard(script) {
    const topics = script.topics || [];
    const topicTags = topics
      .map((t) => `<span class="script-topic-tag" style="--topic-color: ${t.color || '#4A90E2'}">${this._escapeHtml(t.name)}</span>`)
      .join('');

    // Render variant language badges
    const variants = script.variants || [];
    const languageTags = variants
      .map((v) => `<span class="script-language">${this._escapeHtml(v.language || 'Unknown')}</span>`)
      .join('');

    // Retry badge
    const retryBadge = script.retries > 0
      ? `<span class="script-retry-badge" title="Auto-retry: ${script.retries} retries, ${((script.retryDelayMs || 3000) / 1000).toFixed(0)}s delay">Retry x${script.retries}</span>`
      : '';

    // Schedule badge
    const scheduleBadge = script.schedule
      ? `<span class="script-schedule-badge" title="Cron: ${this._escapeHtml(script.schedule)}">Scheduled</span>`
      : '';

    // Dependency badge
    const deps = script.dependsOn || [];
    const depsBadge = deps.length > 0
      ? `<span class="script-deps-badge" title="Depends on: ${deps.map((d) => this._escapeHtml(d)).join(', ')}">Depends</span>`
      : '';

    // Chain membership badge
    const scriptId = script.id || script.folder;
    const chains = this.app.chainListInstance?.chains || [];
    const chainNames = chains
      .filter((c) => (c.script_ids || []).includes(scriptId))
      .map((c) => c.name);
    const chainBadge = chainNames.length > 0
      ? `<span class="script-chain-badge" title="In chain: ${chainNames.map((n) => this._escapeHtml(n)).join(', ')}">&#9741; Chain</span>`
      : '';

    // Modified badge (script changed since last execution)
    const modifiedBadge = script.modified
      ? `<span class="script-modified-badge" title="Script modified since last run">Modified</span>`
      : '';

    // Dependency line below description
    const depsLine = deps.length > 0
      ? `<p class="script-deps-line">Depends on: ${deps.map((d) => `<span class="script-dep-name">${this._escapeHtml(d)}</span>`).join(', ')}</p>`
      : '';

    const isFav = this.app.isFavorite(scriptId);

    return `
      <div class="script-card" data-script-id="${this._escapeHtml(scriptId)}" draggable="true" title="Drag to topic to assign">
        <div class="card-header">
          <h3 class="script-name">${this._escapeHtml(script.name)}</h3>
          <div class="card-header-actions">
            <button class="card-toggle toggle-favorite sc-fav-btn${isFav ? ' active' : ''}" data-script-id="${this._escapeHtml(scriptId)}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">${isFav ? '&#9829;' : '&#9825;'}</button>
          </div>
        </div>

        ${languageTags || retryBadge || scheduleBadge || depsBadge || chainBadge || modifiedBadge
          ? `<div class="variant-badges">${languageTags}${retryBadge}${scheduleBadge}${depsBadge}${chainBadge}${modifiedBadge}</div>`
          : ''}
        
        ${script.description ? `<p class="script-description">${this._escapeHtml(script.description)}</p>` : ''}
        ${depsLine}
        
        ${topicTags ? `<div class="script-topics">${topicTags}</div>` : ''}
        
        <div class="card-footer">
          <button class="btn btn-primary" data-script-id="${this._escapeHtml(scriptId)}">
            Run
          </button>
          <button class="btn btn-secondary" data-script-id="${this._escapeHtml(scriptId)}" title="Add to topic">
            + Topic
          </button>
          <button class="btn btn-danger" data-script-id="${this._escapeHtml(scriptId)}">
            Remove
          </button>
        </div>
      </div>
    `;
  }

  _getFilteredScripts() {
    let scripts = this.app.scripts;
    if (this.filterText) {
      const q = this.filterText.toLowerCase();
      scripts = scripts.filter((s) => {
        const name = (s.name || '').toLowerCase();
        const desc = (s.description || '').toLowerCase();
        return name.includes(q) || desc.includes(q);
      });
    }
    if (this.filterLanguage) {
      scripts = scripts.filter((s) =>
        (s.variants || []).some((v) => v.language === this.filterLanguage)
      );
    }
    return scripts;
  }

  _attachEventListeners() {
    // Keyboard shortcut: Ctrl+F
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        const filterEl = this.container.querySelector('#script-filter');
        if (filterEl) {
          filterEl.focus();
          filterEl.select();
        }
      }
    });

    // Filter input
    const filterEl = this.container.querySelector('#script-filter');
    if (filterEl) {
      filterEl.addEventListener('input', (e) => {
        this.filterText = e.target.value;
        this._updateScriptsList();
      });
    }

    // Drag script cards (for dragging to topics)
    this.container.querySelectorAll('.script-card').forEach((card) => {
      card.addEventListener('dragstart', (e) => {
        const scriptId = card.dataset.scriptId;
        const script = this.app.scripts.find((s) => s.id === scriptId || s.folder === scriptId);
        if (script) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('script-id', scriptId);
          e.dataTransfer.setData('script-name', script.name);
          card.classList.add('dragging');
        }
      });
      
      card.addEventListener('dragend', (e) => {
        card.classList.remove('dragging');
      });
    });

    // Favorite buttons
    this.container.querySelectorAll('.sc-fav-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.app.toggleFavorite(btn.dataset.scriptId);
      });
    });

    // Run buttons
    this.container.querySelectorAll('.card-footer .btn-primary').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const scriptId = btn.dataset.scriptId;
        const script = this.app.scripts.find((s) => s.id === scriptId || s.folder === scriptId);
        if (script) this._handleRunScript(script, btn);
      });
    });

    // Topic buttons
    this.container.querySelectorAll('.card-footer .btn-secondary').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const scriptId = btn.dataset.scriptId;
        const script = this.app.scripts.find((s) => s.id === scriptId || s.folder === scriptId);
        if (script) this._handleAddToTopic(script);
      });
    });

    // Remove buttons
    this.container.querySelectorAll('.card-footer .btn-danger').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const scriptId = btn.dataset.scriptId;
        const script = this.app.scripts.find((s) => s.id === scriptId || s.folder === scriptId);
        if (script) this._handleRemoveScript(script);
      });
    });

    // Browse button
    const btnBrowse = this.container.querySelector('#btn-browse');
    if (btnBrowse) {
      btnBrowse.addEventListener('click', () => this._handleBrowse());
    }

    // Language filter chips
    this.container.querySelectorAll('.lang-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        this.filterLanguage = chip.dataset.lang;
        this.render();
      });
    });

    // Script card click → detail panel
    this.container.querySelectorAll('.script-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-footer') || e.target.closest('.variant-badges')) return;
        const scriptId = card.dataset.scriptId;
        const script = this.app.scripts.find((s) => s.id === scriptId || s.folder === scriptId);
        if (script) this._openScriptDetail(script);
      });
    });

    // Topic picker close
    const pickerBackdrop = this.container.querySelector('#topic-picker-backdrop');
    const btnClosePicker = this.container.querySelector('#btn-close-picker');
    if (pickerBackdrop) pickerBackdrop.addEventListener('click', () => this._closeTopicPicker());
    if (btnClosePicker) btnClosePicker.addEventListener('click', () => this._closeTopicPicker());

    // Script detail close
    const detailBackdrop = this.container.querySelector('#script-detail-backdrop');
    const btnCloseDetail = this.container.querySelector('#btn-close-detail');
    if (detailBackdrop) detailBackdrop.addEventListener('click', () => this._closeScriptDetail());
    if (btnCloseDetail) btnCloseDetail.addEventListener('click', () => this._closeScriptDetail());

    // Escape closes overlays
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this._closeTopicPicker();
        this._closeScriptDetail();
        this._closeVariantMenu();
      }
    });

    // Click outside closes variant menu
    document.addEventListener('click', () => {
      this._closeVariantMenu();
    });

    // Remove zone (drag script here to remove from topic)
    const removeZone = this.container.querySelector('#remove-zone');
    if (removeZone) {
      removeZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        removeZone.classList.add('remove-zone-active');
      });
      removeZone.addEventListener('dragleave', () => {
        removeZone.classList.remove('remove-zone-active');
      });
      removeZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        removeZone.classList.remove('remove-zone-active');
        const scriptId = e.dataTransfer?.getData('script-id');
        const topicId = this.app.selectedTopicId;
        if (scriptId && topicId) {
          await this._handleRemoveFromTopic(scriptId, topicId);
        }
      });
    }
  }

  setLoading(active) {
    const el = this.container?.querySelector('#browser-loading');
    if (el) el.style.display = active ? 'flex' : 'none';
  }

  _updateScriptsList() {
    const container = this.container.querySelector('#scripts-container');
    if (container) {
      container.innerHTML = this._renderScripts();
      this._attachEventListeners();
    }
  }

  async _handleRemoveFromTopic(scriptId, topicId) {
    this.setLoading(true);
    try {
      const result = await API.invoke('script-runner:remove-script-from-topic', {
        script_id: scriptId,
        topic_id: topicId,
      });

      if (result.success) {
        globalThis.ui?.showNotification?.('Removed from topic', 'success');
        await this.app.loadScripts();
        await this.app.loadTopics();
        this.render();
      } else {
        globalThis.ui?.showNotification?.(result.error || 'Failed to remove from topic', 'error');
      }
    } catch (err) {
      console.error('[script-runner] Remove from topic error:', err.message);
      globalThis.ui?.showNotification?.('Error removing from topic', 'error');
    } finally {
      this.setLoading(false);
    }
  }

  async _handleRunScript(script, btn) {
    const variants = script.variants || [];

    if (variants.length > 1) {
      this._showVariantMenu(script, btn);
      return;
    }

    const chosen = variants.length === 1 ? variants[0] : script;
    this._openExecution(script, chosen);
  }

  _openExecution(script, chosen) {
    this.app.openExecution(script, chosen);
  }

  _showVariantMenu(script, btn) {
    this._closeVariantMenu();
    const menu = this.container.querySelector('#variant-menu');
    if (!menu || !btn) return;

    menu.innerHTML = (script.variants || []).map((v) => `
      <button class="sr-variant-item" data-variant-label="${this._escapeHtml(v.label)}">
        <span class="script-language">${this._escapeHtml(v.language || v.label)}</span>
        <span class="sr-variant-name">${this._escapeHtml(v.label)}</span>
      </button>
    `).join('');

    menu.querySelectorAll('.sr-variant-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const chosen = script.variants.find((x) => x.label === item.dataset.variantLabel);
        this._closeVariantMenu();
        if (chosen) this._openExecution(script, chosen);
      });
    });

    const rect = btn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.right = `${globalThis.innerWidth - rect.right}px`;
    menu.style.left = '';
    menu.style.display = 'block';

    this._variantMenuOpen = true;
  }

  _closeVariantMenu() {
    const menu = this.container?.querySelector('#variant-menu');
    if (menu) menu.style.display = 'none';
    this._variantMenuOpen = false;
  }

  _handleAddToTopic(script) {
    if (this.app.topics.length === 0) {
      globalThis.ui?.showNotification?.('Create a topic first', 'info');
      return;
    }

    this._pendingTopicScript = script;
    const list = this.container.querySelector('#topic-picker-list');
    const overlay = this.container.querySelector('#topic-picker-overlay');
    if (!list || !overlay) return;

    list.innerHTML = this.app.topics
      .map(
        (t) => `
        <button class="topic-picker-item" data-topic-id="${t.id}">
          <span class="topic-dot" style="background: ${t.color || '#4A90E2'}"></span>
          <span class="topic-picker-name">${this._escapeHtml(t.name)}</span>
          <span class="topic-picker-count">${t.script_count || 0}</span>
        </button>
      `
      )
      .join('');

    list.querySelectorAll('.topic-picker-item').forEach((btn) => {
      btn.addEventListener('click', () => this._confirmAddToTopic(btn.dataset.topicId));
    });

    overlay.style.display = 'flex';
  }

  _closeTopicPicker() {
    const overlay = this.container?.querySelector('#topic-picker-overlay');
    if (overlay) overlay.style.display = 'none';
    this._pendingTopicScript = null;
  }

  async _confirmAddToTopic(topicId) {
    const script = this._pendingTopicScript;
    this._closeTopicPicker();
    if (!script || !topicId) return;

    const topic = this.app.topics.find((t) => t.id === topicId);
    this.setLoading(true);
    try {
      const result = await API.invoke('script-runner:add-script-to-topic', {
        script_id: script.id || script.folder,
        topic_id: topicId,
      });

      if (result.success) {
        globalThis.ui?.showNotification?.(`Added to "${topic?.name}"`, 'success');
        await this.app.loadScripts();
        await this.app.loadTopics();
        this.render();
      } else {
        globalThis.ui?.showNotification?.(result.error || 'Failed to add to topic', 'error');
      }
    } catch (err) {
      console.error('[script-runner] Add to topic error:', err.message);
      globalThis.ui?.showNotification?.('Failed to add to topic', 'error');
    } finally {
      this.setLoading(false);
    }
  }

  async _handleRemoveScript(script) {
    if (!confirm(`Remove "${script.name}"? This cannot be undone.`)) return;

    this.setLoading(true);
    try {
      const result = await API.invoke('script-runner:remove-script', {
        script_id: script.id || script.folder,
      });

      if (result.success) {
        globalThis.ui?.showNotification?.('Script removed', 'success');
        await this.app.loadScripts();
        this.render();
      } else {
        globalThis.ui?.showNotification?.(result.error || 'Failed to remove script', 'error');
      }
    } catch (err) {
      console.error('[script-runner] Remove script error:', err.message);
      globalThis.ui?.showNotification?.('Failed to remove script', 'error');
    } finally {
      this.setLoading(false);
    }
  }

  async _handleBrowse() {
    this.setLoading(true);
    try {
      const result = await API.invoke('script-runner:open-folder-picker');
      if (result.canceled) return;
      if (!result.valid) {
        globalThis.ui?.showNotification?.(result.error || 'Invalid folder', 'error');
        return;
      }

      const importResult = await API.invoke('script-runner:import-script', {
        folderPath: result.folderPath,
      });

      if (importResult.success) {
        globalThis.ui?.showNotification?.(importResult.message, 'success');
        await this.app.loadScripts();
        this.render();
      } else {
        globalThis.ui?.showNotification?.(importResult.message || 'Import failed', 'error');
      }
    } catch (err) {
      console.error('[script-runner] Import error:', err.message);
      globalThis.ui?.showNotification?.('Failed to import scripts', 'error');
    } finally {
      this.setLoading(false);
    }
  }

  _renderLanguageFilter() {
    const languages = [
      ...new Set(
        this.app.scripts.flatMap((s) => (s.variants || []).map((v) => v.language).filter(Boolean))
      ),
    ].sort((a, b) => a.localeCompare(b));

    if (languages.length === 0) return '';

    return `
      <div class="language-filter-bar">
        <button class="lang-chip ${this.filterLanguage ? '' : 'active'}" data-lang="">All</button>
        ${languages
          .map(
            (lang) =>
              `<button class="lang-chip ${this.filterLanguage === lang ? 'active' : ''}" data-lang="${this._escapeHtml(lang)}">${this._escapeHtml(lang)}</button>`
          )
          .join('')}
      </div>
    `;
  }

  _openScriptDetail(script) {
    const overlay = this.container.querySelector('#script-detail-overlay');
    const titleEl = this.container.querySelector('#detail-title');
    const bodyEl = this.container.querySelector('#detail-body');
    if (!overlay || !titleEl || !bodyEl) return;

    titleEl.textContent = script.name;

    const variants =
      (script.variants || [])
        .map(
          (v) => `<span class="script-language">${this._escapeHtml(v.language || 'Unknown')}</span>`
        )
        .join('') || '<span class="detail-none">No variants</span>';

    const description = script.description
      ? this._escapeHtml(script.description)
      : '<span class="detail-none">No description</span>';

    bodyEl.innerHTML = `
      <div class="detail-row">
        <span class="detail-label">About</span>
        <div class="detail-value">${description}</div>
      </div>
      <div class="detail-row">
        <span class="detail-label">Languages</span>
        <div class="detail-value detail-lang-chips">${variants}</div>
      </div>
      <div class="detail-row">
        <span class="detail-label">Recent Runs</span>
        <div class="detail-value">${this._renderRecentRuns(script)}</div>
      </div>
    `;

    overlay.style.display = 'flex';
  }

  _renderRecentRuns(script) {
    const scriptId = script.id || script.folder;
    const runs = this.app.getRecentRuns ? this.app.getRecentRuns(scriptId) : [];
    if (runs.length === 0) {
      return '<span class="detail-none">No runs yet</span>';
    }
    return `<div class="run-history-list">${runs.map((r) => this._renderRunEntry(r)).join('')}</div>`;
  }

  _renderRunEntry(run) {
    const isSuccess = run.status === 'success';
    const statusClass = isSuccess ? 'run-status-success' : 'run-status-error';
    const statusIcon = isSuccess ? 'OK' : 'ERR';
    const duration = run.runtime == null ? '—' : this._formatRuntime(run.runtime);
    const date = run.timestamp ? new Date(run.timestamp).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    }) : '—';
    const exitLabel = run.exitCode == null ? '' : `exit ${run.exitCode}`;
    return `
      <div class="run-entry">
        <span class="run-entry-status ${statusClass}" title="${exitLabel}">${statusIcon}</span>
        <span class="run-entry-time">${this._escapeHtml(date)}</span>
        <span class="run-entry-duration">${this._escapeHtml(duration)}</span>
      </div>
    `;
  }

  _formatRuntime(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}m ${s}s`;
  }

  _closeScriptDetail() {
    const overlay = this.container?.querySelector('#script-detail-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  destroy() {
    this._closeVariantMenu();
  }
}
