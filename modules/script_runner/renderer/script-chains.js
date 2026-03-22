/**
 * Script Runner — ChainList
 * Sidebar component for user-defined chains (ordered sequences of scripts).
 *
 * Mirrors the structure and behaviour of TopicList (script-topics.js).
 * - Lists all saved chains, each showing name + script count
 * - ⋮ context menu: Rename / Edit, Delete
 * - Double-click / click Edit → opens chain builder in the main content area
 * - + button → opens chain builder in the main content area
 * - Clicking a chain item runs its scripts sequentially
 */

const API = globalThis.api;

class ChainList {
  constructor(app) {
    this.app = app;
    this.container = null;
    this.chains = [];
    this._contextMenuChainId = null;
    this._builderMode = 'create'; // 'create' | 'edit'
    this._editingChainId = null;
    this._selectedScriptIds = []; // ordered list in the builder
    this._builderContainer = null; // the #sr-content child when builder is open
    this._pickerGroups = null; // { groups: [{topic, scripts}], ungrouped: [] }
    this.unsubscribes = [];
  }

  async init(container) {
    this.container = container;
    await this._loadChains();
    this.render();
    this._subscribeToEvents();
  }

  async _loadChains() {
    try {
      const result = await API.invoke('script-runner:get-chains');
      this.chains = result.chains || [];
    } catch (err) {
      console.error('[script-chains] Failed to load chains:', err.message);
      this.chains = [];
    }
  }

  _subscribeToEvents() {
    // Clean up any previous listeners before re-subscribing (called on every tab visit)
    this.unsubscribes.forEach((u) => u?.());
    this.unsubscribes = [];

    const u1 = API.on('script-runner:chain-created', (data) => {
      this.chains.push(data.chain);
      this._refreshList();
      this.app.scriptBrowserInstance?.render();
    });
    const u2 = API.on('script-runner:chain-updated', (data) => {
      const idx = this.chains.findIndex((c) => c.id === data.chain.id);
      if (idx >= 0) this.chains[idx] = data.chain;
      else this.chains.push(data.chain);
      this._refreshList();
      this.app.scriptBrowserInstance?.render();
    });
    const u3 = API.on('script-runner:chain-deleted', (data) => {
      this.chains = this.chains.filter((c) => c.id !== data.chain_id);
      this._refreshList();
      this.app.scriptBrowserInstance?.render();
    });
    this.unsubscribes = [u1, u2, u3];
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="chain-list-wrapper">
        <div class="topic-list-header">
          <h3>Chains</h3>
          <div class="topic-header-actions">
            <button class="topic-header-btn" id="btn-new-chain" title="Create new chain">+</button>
          </div>
        </div>
        <div class="chain-list-items" id="chain-items">
          ${this._renderChainItems()}
        </div>
      </div>

      <!-- Context Menu -->
      <div class="chain-context-menu" id="chain-context-menu" style="display:none">
        <button class="context-menu-item" id="chain-ctx-run">&#9654;&nbsp; Run Chain</button>
        <button class="context-menu-item" id="chain-ctx-edit">&#9998;&nbsp; Edit</button>
        <div class="context-menu-separator"></div>
        <button class="context-menu-item context-menu-item-danger" id="chain-ctx-delete">&#x2715;&nbsp; Delete</button>
      </div>
    `;

    this._attachEventListeners();
  }

  _renderChainItems() {
    if (this.chains.length === 0) {
      return '<div class="chain-list-empty">No chains yet. Click + to create one.</div>';
    }

    return this.chains
      .map((chain) => {
        const count = (chain.script_ids || []).length;
        return `
          <div class="chain-item-wrapper" data-chain-id="${chain.id}">
            <button class="chain-item" data-chain-id="${chain.id}"
                    title="Run: ${this._escapeHtml(chain.name)}">
              <span class="chain-icon">&#9741;</span>
              <span class="chain-name">${this._escapeHtml(chain.name)}</span>
              <span class="chain-count">${count}</span>
            </button>
            <button class="chain-menu-btn" data-chain-id="${chain.id}" title="Options">&#x22EE;</button>
          </div>
        `;
      })
      .join('');
  }

  _refreshList() {
    const items = this.container?.querySelector('#chain-items');
    if (!items) return;
    items.innerHTML = this._renderChainItems();
    this._attachChainItemListeners();
  }

  // ─── Event Listeners ─────────────────────────────────────────────────────────

  _attachEventListeners() {
    // + button
    const btnNew = this.container.querySelector('#btn-new-chain');
    if (btnNew) btnNew.addEventListener('click', () => this._openBuilder('create'));

    // Context menu actions
    const ctxRun = this.container.querySelector('#chain-ctx-run');
    if (ctxRun) {
      ctxRun.addEventListener('click', () => {
        const chain = this._findChain(this._contextMenuChainId);
        if (chain) this._runChain(chain);
        this._hideContextMenu();
      });
    }

    const ctxEdit = this.container.querySelector('#chain-ctx-edit');
    if (ctxEdit) {
      ctxEdit.addEventListener('click', () => {
        const chain = this._findChain(this._contextMenuChainId);
        if (chain) this._openBuilder('edit', chain);
        this._hideContextMenu();
      });
    }

    const ctxDelete = this.container.querySelector('#chain-ctx-delete');
    if (ctxDelete) {
      ctxDelete.addEventListener('click', () => {
        const chain = this._findChain(this._contextMenuChainId);
        if (chain && confirm(`Delete chain "${chain.name}"?\nThis cannot be undone.`)) {
          this._deleteChain(chain.id);
        }
        this._hideContextMenu();
      });
    }

    // Close context menu on outside click
    const _onDocClick = (e) => {
      if (!e.target.closest('.chain-context-menu')) this._hideContextMenu();
    };
    document.addEventListener('click', _onDocClick);
    this._onDocClick = _onDocClick;

    // Chain items
    this._attachChainItemListeners();
  }

  _attachChainItemListeners() {
    this.container?.querySelectorAll('.chain-item[data-chain-id]').forEach((el) => {
      // Click → run
      el.addEventListener('click', (e) => {
        if (e.target.closest('.chain-menu-btn')) return;
        const chain = this._findChain(el.dataset.chainId);
        if (chain) this._runChain(chain);
      });

      // Double-click → edit
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const chain = this._findChain(el.dataset.chainId);
        if (chain) this._openBuilder('edit', chain);
      });

      // Right-click → context menu
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._showContextMenu(el.dataset.chainId, e);
      });
    });

    this.container?.querySelectorAll('.chain-menu-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showContextMenu(btn.dataset.chainId, e);
      });
    });
  }

  // ─── Builder (rendered in main content area via ScriptApp) ───────────────────

  _openBuilder(mode, chain) {
    this.app.navigateToChainBuilder(this, mode, chain);
  }

  /**
   * Called by ScriptApp.navigateToChainBuilder — mounts the chain builder
   * full-page view into the provided content element.
   */
  mountBuilder(el, mode, chain) {
    this._builderMode = mode;
    this._editingChainId = chain?.id || null;
    this._selectedScriptIds = chain ? [...(chain.script_ids || [])] : [];
    this._builderContainer = el;

    el.innerHTML = `
      <div class="sr-chain-builder-view">
        <div class="sr-chain-builder-topbar">
          <div class="sr-chain-builder-topbar-left">
            <button class="sr-chain-back-btn" id="chain-back-btn" title="Cancel">&#8592; Back</button>
            <h2 id="chain-builder-title">${mode === 'edit' ? 'Edit Chain' : 'New Chain'}</h2>
          </div>
          <div class="sr-chain-builder-topbar-right">
            <button class="btn btn-secondary" id="chain-builder-cancel">Cancel</button>
            <button class="btn btn-primary" id="chain-builder-save">Save Chain</button>
          </div>
        </div>
        <div class="sr-chain-builder-name-row">
          <label for="chain-name-input">Chain Name</label>
          <input type="text" id="chain-name-input" placeholder="e.g. Backups Chain"
                 value="${this._escapeHtml(chain?.name || '')}" autocomplete="off">
          <span class="form-error" id="chain-name-error"></span>
        </div>
        <div class="sr-chain-builder-body">
          <div class="sr-chain-picker-panel">
            <div class="sr-chain-panel-header">
              <span>All Scripts</span>
              <input type="search" class="sr-chain-search" id="chain-script-search" placeholder="Search…">
            </div>
            <div class="sr-chain-script-list" id="chain-script-list"></div>
          </div>
          <div class="sr-chain-selected-panel">
            <div class="sr-chain-panel-header">
              <span>Chain Order</span>
              <span class="sr-chain-count" id="chain-selected-count">0 scripts</span>
            </div>
            <div class="sr-chain-selected-list" id="chain-selected-list"></div>
            <div class="sr-chain-empty-hint" id="chain-empty-hint">
              Check scripts on the left to add them here.<br>Drag items to reorder.
            </div>
          </div>
        </div>
      </div>
    `;

    this._pickerGroups = null;
    this._attachBuilderListeners();
    this._renderPickerScripts();
    this._renderSelectedScripts();
    setTimeout(() => el.querySelector('#chain-name-input')?.focus(), 50);

    // Load topic grouping async — re-renders picker once ready
    this.app.loadScriptsGroupedByTopic().then((grouped) => {
      this._pickerGroups = grouped;
      this._renderPickerScripts();
    });
  }

  _attachBuilderListeners() {
    const bc = this._builderContainer;
    if (!bc) return;

    bc.querySelector('#chain-back-btn')?.addEventListener('click', () => this._closeBuilder());
    bc.querySelector('#chain-builder-cancel')?.addEventListener('click', () => this._closeBuilder());
    bc.querySelector('#chain-builder-save')?.addEventListener('click', () => this._saveChain());

    const nameInput = bc.querySelector('#chain-name-input');
    if (nameInput) {
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._saveChain();
        if (e.key === 'Escape') this._closeBuilder();
      });
    }

    const searchInput = bc.querySelector('#chain-script-search');
    if (searchInput) searchInput.addEventListener('input', () => this._renderPickerScripts());
  }

  _closeBuilder() {
    this._builderContainer = null;
    this._selectedScriptIds = [];
    this._editingChainId = null;
    this.app.navigateToBrowser();
  }

  _renderPickerScripts() {
    const bc = this._builderContainer;
    const list = bc?.querySelector('#chain-script-list');
    const search = bc?.querySelector('#chain-script-search');
    if (!list) return;

    const query = (search?.value || '').toLowerCase();

    const makeItem = (s) => {
      const sid = s.id || s.folder;
      const checked = this._selectedScriptIds.includes(sid);
      return `<label class="sr-chain-script-pick${checked ? ' checked' : ''}" data-script-id="${this._escapeHtml(sid)}">
        <input type="checkbox" class="sr-chain-checkbox" data-script-id="${this._escapeHtml(sid)}" ${checked ? 'checked' : ''}>
        <span class="sr-chain-script-pick-name">${this._escapeHtml(s.name)}</span>
      </label>`;
    };

    const matchesQuery = (s) => {
      if (!query) return true;
      return (s.name + ' ' + (s.description || '')).toLowerCase().includes(query);
    };

    // Grouped view (no search active and groups loaded)
    if (!query && this._pickerGroups) {
      const { groups, ungrouped } = this._pickerGroups;
      const allEmpty = groups.every((g) => g.scripts.length === 0) && ungrouped.length === 0;
      if (allEmpty) {
        list.innerHTML = '<div class="sr-chain-empty">No scripts found.</div>';
      } else {
        list.innerHTML = [
          ...groups.map((g) => `
            <div class="sr-chain-group">
              <div class="sr-chain-group-header" data-group="${this._escapeHtml(g.topic.id)}">
                <span class="sr-chain-group-arrow">&#9660;</span>
                <span class="sr-chain-group-name">${this._escapeHtml(g.topic.name)}</span>
                <span class="sr-chain-group-count">${g.scripts.length}</span>
              </div>
              <div class="sr-chain-group-body">${g.scripts.map(makeItem).join('')}</div>
            </div>`),
          ungrouped.length > 0 ? `
            <div class="sr-chain-group">
              <div class="sr-chain-group-header" data-group="__ungrouped">
                <span class="sr-chain-group-arrow">&#9660;</span>
                <span class="sr-chain-group-name">Ungrouped</span>
                <span class="sr-chain-group-count">${ungrouped.length}</span>
              </div>
              <div class="sr-chain-group-body">${ungrouped.map(makeItem).join('')}</div>
            </div>` : '',
        ].join('');

        // Collapse/expand toggle
        list.querySelectorAll('.sr-chain-group-header').forEach((hdr) => {
          hdr.addEventListener('click', () => {
            const body = hdr.nextElementSibling;
            const arrow = hdr.querySelector('.sr-chain-group-arrow');
            const collapsed = body.style.display === 'none';
            body.style.display = collapsed ? '' : 'none';
            arrow.style.transform = collapsed ? '' : 'rotate(-90deg)';
          });
        });
      }
    } else {
      // Flat search view
      const scripts = this.app.allScripts.filter(matchesQuery);
      if (scripts.length === 0) {
        list.innerHTML = '<div class="sr-chain-empty">No scripts found.</div>';
      } else {
        list.innerHTML = scripts.map(makeItem).join('');
      }
    }

    list.querySelectorAll('.sr-chain-checkbox').forEach((cb) => {
      cb.addEventListener('change', () => {
        const sid = cb.dataset.scriptId;
        if (cb.checked) {
          if (!this._selectedScriptIds.includes(sid)) this._selectedScriptIds.push(sid);
        } else {
          this._selectedScriptIds = this._selectedScriptIds.filter((id) => id !== sid);
        }
        this._renderPickerScripts();
        this._renderSelectedScripts();
      });
    });
  }

  _renderSelectedScripts() {
    const bc = this._builderContainer;
    const list = bc?.querySelector('#chain-selected-list');
    const hint = bc?.querySelector('#chain-empty-hint');
    const countEl = bc?.querySelector('#chain-selected-count');
    if (!list) return;

    const n = this._selectedScriptIds.length;
    if (countEl) countEl.textContent = `${n} script${n === 1 ? '' : 's'}`;
    if (hint) hint.style.display = n === 0 ? '' : 'none';

    if (n === 0) {
      list.innerHTML = '';
      return;
    }

    list.innerHTML = this._selectedScriptIds
      .map((sid, idx) => {
        const script = this.app.allScripts.find((s) => (s.id || s.folder) === sid);
        const name = script ? script.name : sid;
        return `
          <div class="sr-chain-selected-item" data-script-id="${this._escapeHtml(sid)}" draggable="true" data-index="${idx}">
            <span class="sr-chain-drag-handle">&#x2807;</span>
            <span class="sr-chain-step-num">${idx + 1}</span>
            <span class="sr-chain-selected-name">${this._escapeHtml(name)}</span>
            <button class="sr-chain-remove" data-script-id="${this._escapeHtml(sid)}" title="Remove">&#x2715;</button>
          </div>
        `;
      })
      .join('');

    // Remove buttons
    list.querySelectorAll('.sr-chain-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._selectedScriptIds = this._selectedScriptIds.filter((id) => id !== btn.dataset.scriptId);
        this._renderPickerScripts();
        this._renderSelectedScripts();
      });
    });

    // Drag-to-reorder
    this._attachDragReorder(list);
  }

  _attachDragReorder(list) {
    let dragSrcIdx = null;

    list.querySelectorAll('.sr-chain-selected-item').forEach((item) => {
      item.addEventListener('dragstart', (e) => {
        dragSrcIdx = Number.parseInt(item.dataset.index, 10);
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        list.querySelectorAll('.sr-chain-selected-item').forEach((i) => i.classList.remove('drag-over'));
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        list.querySelectorAll('.sr-chain-selected-item').forEach((i) => i.classList.remove('drag-over'));
        item.classList.add('drag-over');
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const dstIdx = Number.parseInt(item.dataset.index, 10);
        if (dragSrcIdx === null || dragSrcIdx === dstIdx) return;
        const [moved] = this._selectedScriptIds.splice(dragSrcIdx, 1);
        this._selectedScriptIds.splice(dstIdx, 0, moved);
        dragSrcIdx = null;
        this._renderSelectedScripts();
      });
    });
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────────

  async _saveChain() {
    const bc = this._builderContainer;
    const nameInput = bc?.querySelector('#chain-name-input');
    const errorEl = bc?.querySelector('#chain-name-error');
    const name = nameInput?.value?.trim();

    if (!name) {
      if (errorEl) errorEl.textContent = 'Chain name is required';
      nameInput?.focus();
      return;
    }
    if (errorEl) errorEl.textContent = '';

    try {
      let result;
      if (this._builderMode === 'edit' && this._editingChainId) {
        result = await API.invoke('script-runner:update-chain', {
          chain_id: this._editingChainId,
          name,
          script_ids: this._selectedScriptIds,
        });
      } else {
        result = await API.invoke('script-runner:create-chain', {
          name,
          script_ids: this._selectedScriptIds,
        });
      }

      if (result.success) {
        const verb = this._builderMode === 'edit' ? 'updated' : 'created';
        globalThis.ui?.showNotification?.(`Chain "${name}" ${verb}`, 'success');
        this._closeBuilder();
      } else if (errorEl) {
        errorEl.textContent = result.error || 'Failed to save chain';
      }
    } catch (err) {
      console.error('[script-chains] Save error:', err.message);
      const errEl2 = this._builderContainer?.querySelector('#chain-name-error');
      if (errEl2) errEl2.textContent = 'Error saving chain';
    }
  }

  async _deleteChain(chainId) {
    try {
      const result = await API.invoke('script-runner:delete-chain', { chain_id: chainId });
      if (result.success) {
        globalThis.ui?.showNotification?.('Chain deleted', 'success');
      } else {
        globalThis.ui?.showNotification?.(result.error || 'Failed to delete chain', 'error');
      }
    } catch (err) {
      console.error('[script-chains] Delete error:', err.message);
      globalThis.ui?.showNotification?.('Error deleting chain', 'error');
    }
  }

  // ─── Run Chain (full execution view) ─────────────────────────────────────────

  _runChain(chain) {
    this.app.navigateToChainRunner(this, chain);
  }

  /**
   * Called by ScriptApp.navigateToChainRunner — mounts the chain runner view
   * into the main content area. Looks like an execution-tab with a tab bar.
   */
  mountRunner(el, chain) {
    const scripts = (chain.script_ids || [])
      .map((id) => this.app.allScripts.find((s) => (s.id || s.folder) === id))
      .filter(Boolean);

    if (scripts.length === 0) {
      globalThis.ui?.showNotification?.(`No scripts found for chain "${chain.name}"`, 'error');
      this.app.navigateToBrowser();
      return;
    }

    // Create a session immediately for every script (idle state, not auto-run)
    const slots = scripts.map((s, i) => {
      const variants = s.variants || [];
      const chosen = variants.length > 0 ? variants[0] : s;
      const session = this.app.openExecution(s, chosen, { autoRun: false, background: true });
      return {
        index: i,
        script: s,
        status: 'idle',   // idle | running | success | error | skipped
        session,
      };
    });

    let activeSlot = 0;
    let chainRunning = false;
    let chainCancelled = false;

    const render = () => {
      el.innerHTML = `
        <div class="sr-chain-runner">
          <div class="sr-chain-tabs" id="sr-chain-tabs">
            <div class="sr-chain-tab sr-chain-tab-chain" data-slot="chain" title="${this._escapeHtml(chain.name)}">
              &#9741; ${this._escapeHtml(chain.name)}
            </div>
            ${slots.map((slot, i) => `
              <div class="sr-chain-tab${i === activeSlot ? ' active' : ''}" data-slot="${i}"
                   title="${this._escapeHtml(slot.script.name)}">
                <span class="sr-chain-tab-status status-${slot.status}"></span>
                ${this._escapeHtml(slot.script.name)}
              </div>
            `).join('')}
          </div>
          <div class="sr-chain-runner-content" id="sr-chain-runner-content"></div>
          <div class="sr-chain-runner-toolbar">
            <span class="toolbar-info" id="sr-chain-runner-info">
              ${scripts.length} script${scripts.length === 1 ? '' : 's'} in chain
            </span>
            <button class="btn btn-secondary btn-sm" id="sr-chain-runner-back">&#8592; Back</button>
            <button class="btn btn-danger btn-sm" id="sr-chain-runner-stop" style="display:none">&#9632; Stop Chain</button>
            <button class="btn" id="sr-chain-runner-run">&#9654; Run Chain</button>
          </div>
        </div>
      `;

      // Render the active slot's execution view into the content area
      renderSlotContent();
      attachListeners();
    };

    const renderSlotContent = () => {
      const contentEl = el.querySelector('#sr-chain-runner-content');
      if (!contentEl) return;
      const slot = slots[activeSlot];
      if (!slot) return;

      // Always render via ScriptExecution — it handles idle state with proper header/terminal/toolbar
      if (typeof ScriptExecution !== 'undefined') {
        ScriptExecution.render(slot.session, contentEl);
      }
    };

    const updateTabs = () => {
      const tabsEl = el.querySelector('#sr-chain-tabs');
      if (!tabsEl) return;
      slots.forEach((slot, i) => {
        const tab = tabsEl.querySelector(`[data-slot="${i}"]`);
        if (!tab) return;
        tab.classList.toggle('active', i === activeSlot);
        const dot = tab.querySelector('.sr-chain-tab-status');
        if (dot) dot.className = `sr-chain-tab-status status-${slot.status}`;
      });
    };

    const updateInfo = () => {
      const info = el.querySelector('#sr-chain-runner-info');
      if (!info) return;
      const done = slots.filter((s) => s.status === 'success').length;
      const failed = slots.filter((s) => s.status === 'error').length;
      const running = slots.filter((s) => s.status === 'running').length;
      if (running > 0) {
        info.textContent = `Running script ${slots.findIndex((s) => s.status === 'running') + 1} of ${scripts.length}…`;
      } else if (done + failed === scripts.length) {
        info.textContent = failed > 0
          ? `Chain finished — ${done} succeeded, ${failed} failed`
          : `Chain complete — all ${done} scripts succeeded`;
      } else {
        info.textContent = `${scripts.length} script${scripts.length === 1 ? '' : 's'} in chain`;
      }
      const runBtn = el.querySelector('#sr-chain-runner-run');
      if (runBtn) {
        runBtn.disabled = chainRunning;
        runBtn.textContent = chainRunning ? '⏳ Running…' : '▶ Run Chain';
      }
      const stopBtn = el.querySelector('#sr-chain-runner-stop');
      if (stopBtn) {
        stopBtn.style.display = chainRunning ? '' : 'none';
      }
    };

    const attachListeners = () => {
      // Tab clicks
      el.querySelectorAll('.sr-chain-tab[data-slot]').forEach((tab) => {
        tab.addEventListener('click', () => {
          const slot = tab.dataset.slot;
          if (slot === 'chain') return; // chain name tab is non-navigable
          activeSlot = Number.parseInt(slot, 10);
          updateTabs();
          renderSlotContent();
        });
      });

      // Back
      el.querySelector('#sr-chain-runner-back')?.addEventListener('click', () => {
        this.app.navigateToBrowser();
      });

      // Run Chain
      el.querySelector('#sr-chain-runner-run')?.addEventListener('click', () => {
        if (chainRunning) return;
        runChainSequential();
      });

      // Stop Chain
      el.querySelector('#sr-chain-runner-stop')?.addEventListener('click', () => {
        if (!chainRunning) return;
        chainCancelled = true;
        // Kill the currently running script
        const runningSlot = slots.find((s) => s.status === 'running');
        if (runningSlot && typeof ScriptExecution !== 'undefined') {
          ScriptExecution.handleStop(runningSlot.session.id);
        }
      });
    };

    const runChainSequential = async () => {
      chainRunning = true;
      chainCancelled = false;
      updateInfo();

      for (let i = 0; i < slots.length; i++) {
        if (chainCancelled) {
          slots.slice(i).forEach((s) => { s.status = 'skipped'; });
          updateTabs();
          break;
        }

        const slot = slots[i];

        // Session already exists (created upfront) — just run it
        slot.status = 'running';
        activeSlot = i;

        updateTabs();
        renderSlotContent();
        updateInfo();

        // Start the script
        if (typeof ScriptExecution !== 'undefined') {
          ScriptExecution.handleRun(slot.session);
        }

        // Wait for completion
        await new Promise((resolve) => {
          const unsub = globalThis.api.on('script-runner:complete', (data) => {
            if (data.tabId === slot.session.id) {
              unsub();
              const success = data.exitCode === 0 && !chainCancelled;
              let status;
              if (success) status = 'success';
              else if (chainCancelled) status = 'skipped';
              else status = 'error';
              slot.status = status;
              updateTabs();
              updateInfo();
              resolve();
            }
          });
        });

        // On error or cancellation, stop the chain
        if (slot.status === 'error' || slot.status === 'skipped' || chainCancelled) {
          slots.slice(i + 1).forEach((s) => { s.status = 'skipped'; });
          updateTabs();
          break;
        }
      }

      chainRunning = false;
      updateInfo();
    };

    render();
  }

  // ─── Context Menu ─────────────────────────────────────────────────────────────

  _showContextMenu(chainId, e) {
    this._contextMenuChainId = chainId;
    const menu = this.container?.querySelector('#chain-context-menu');
    if (!menu) return;
    menu.style.display = 'block';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
  }

  _hideContextMenu() {
    const menu = this.container?.querySelector('#chain-context-menu');
    if (menu) menu.style.display = 'none';
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  _findChain(id) {
    return this.chains.find((c) => c.id === id) || null;
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
  }

  destroy() {
    for (const unsub of this.unsubscribes) {
      if (unsub) unsub();
    }
    if (this._onDocClick) {
      document.removeEventListener('click', this._onDocClick);
    }
  }
}

globalThis.ChainList = ChainList;
