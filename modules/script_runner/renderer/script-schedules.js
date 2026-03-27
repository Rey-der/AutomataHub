/**
 * Script Runner — ScheduleList
 * Sidebar component + full-page builder for user-defined schedules.
 *
 * Sidebar: lists all saved schedules with enable/disable toggle, context menu.
 * Builder: full main-content view with script/chain picker on the left,
 *          calendar + time + recurring options on the right.
 */

(function() {
const API = globalThis.api;

const CRON_PRESETS = [
  { label: 'Every minute',       cron: '* * * * *' },
  { label: 'Every 5 minutes',    cron: '*/5 * * * *' },
  { label: 'Every 15 minutes',   cron: '*/15 * * * *' },
  { label: 'Every 30 minutes',   cron: '*/30 * * * *' },
  { label: 'Every hour',         cron: '0 * * * *' },
  { label: 'Every 6 hours',      cron: '0 */6 * * *' },
  { label: 'Every 12 hours',     cron: '0 */12 * * *' },
  { label: 'Daily at midnight',  cron: '0 0 * * *' },
  { label: 'Daily at 8 AM',      cron: '0 8 * * *' },
  { label: 'Weekly (Mon 9 AM)',   cron: '0 9 * * 1' },
  { label: 'Monthly (1st, midnight)', cron: '0 0 1 * *' },
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Helper: build a cron string from structured schedule state ────────────
function buildCron(state) {
  if (state.mode === 'once') {
    // One-time: encode as a cron that fires at the given minute/hour/day/month
    // node-cron doesn't do one-shot, but we store it and the scheduler handles it
    const d = new Date(state.date + 'T' + (state.time || '00:00'));
    if (isNaN(d)) return null;
    return `${d.getMinutes()} ${d.getHours()} ${d.getDate()} ${d.getMonth() + 1} *`;
  }
  // Recurring
  const min = state.minute ?? '*';
  const hour = state.hour ?? '*';
  const dom = state.dayOfMonth ?? '*';
  const month = state.month ?? '*';
  let dow = '*';
  if (state.weekdays && state.weekdays.length > 0 && state.weekdays.length < 7) {
    dow = state.weekdays.join(',');
  }
  return `${min} ${hour} ${dom} ${month} ${dow}`;
}

class ScheduleList {
  constructor(app) {
    this.app = app;
    this.container = null;
    this.schedules = [];
    this._contextMenuScheduleId = null;
    this._builderMode = 'create'; // 'create' | 'edit'
    this._editingScheduleId = null;
    this._builderContainer = null;
    this._selectedTargetType = 'script'; // 'script' | 'chain'
    this._selectedTargetId = null;
    this._scheduleState = this._defaultState();
    this._pickerGroups = null;
    this.unsubscribes = [];
  }

  _defaultState() {
    return {
      mode: 'recurring',      // 'once' | 'recurring'
      date: '',               // YYYY-MM-DD for one-time
      time: '08:00',
      preset: '',             // cron preset key
      minute: '0',
      hour: '8',
      dayOfMonth: '*',
      month: '*',
      weekdays: [],           // 1-7 for mon-sun
    };
  }

  async init(container) {
    this.container = container;
    await this._loadSchedules();
    this.render();
    this._subscribeToEvents();
  }

  async _loadSchedules() {
    try {
      const result = await API.invoke('script-runner:get-schedules');
      this.schedules = result.schedules || [];
    } catch (err) {
      console.error('[script-schedules] Failed to load schedules:', err.message);
      this.schedules = [];
    }
  }

  _subscribeToEvents() {
    this.unsubscribes.forEach((u) => u?.());
    this.unsubscribes = [];

    const u1 = API.on('script-runner:schedule-created', (data) => {
      this.schedules.push(data.schedule);
      this._refreshList();
      this.app.scriptBrowserInstance?.render();
    });
    const u2 = API.on('script-runner:schedule-updated', (data) => {
      const idx = this.schedules.findIndex((s) => s.id === data.schedule.id);
      if (idx >= 0) this.schedules[idx] = data.schedule;
      else this.schedules.push(data.schedule);
      this._refreshList();
      this.app.scriptBrowserInstance?.render();
    });
    const u3 = API.on('script-runner:schedule-deleted', (data) => {
      this.schedules = this.schedules.filter((s) => s.id !== data.schedule_id);
      this._refreshList();
      this.app.scriptBrowserInstance?.render();
    });
    this.unsubscribes = [u1, u2, u3];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SIDEBAR RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  render() {
    if (!this.container) return;
    const enabledCount = this.schedules.filter((s) => s.enabled).length;

    this.container.innerHTML = `
      <div class="schedule-list-wrapper">
        <div class="topic-list-header">
          <h3>Schedules${enabledCount > 0 ? ` <span class="sr-section-badge schedule-badge">${enabledCount}</span>` : ''}</h3>
          <div class="topic-header-actions">
            <button class="topic-header-btn" id="btn-new-schedule" title="Create new schedule">+</button>
          </div>
        </div>
        <div class="schedule-list-items" id="schedule-items">
          ${this._renderScheduleItems()}
        </div>
      </div>

      <!-- Context Menu -->
      <div class="schedule-context-menu" id="schedule-context-menu" style="display:none">
        <button class="context-menu-item" id="schedule-ctx-edit">&#9998;&nbsp; Edit</button>
        <div class="context-menu-separator"></div>
        <button class="context-menu-item context-menu-item-danger" id="schedule-ctx-delete">&#x2715;&nbsp; Delete</button>
      </div>
    `;

    this._attachSidebarListeners();
  }

  _renderScheduleItems() {
    if (this.schedules.length === 0) {
      return '<div class="schedule-list-empty">No schedules yet. Click + to create one.</div>';
    }

    return this.schedules.map((sched) => {
      const targetLabel = this._getTargetLabel(sched);
      const typeIcon = sched.target_type === 'chain' ? '&#9741;' : '&#9654;';
      return `
        <div class="schedule-item-wrapper${sched.enabled ? '' : ' disabled'}" data-schedule-id="${sched.id}">
          <div class="schedule-item" data-schedule-id="${sched.id}" title="${this._esc(sched.name)}\n${sched.cron}\nTarget: ${this._esc(targetLabel)}">
            <span class="schedule-icon">${typeIcon}</span>
            <span class="schedule-name">${this._esc(sched.name)}</span>
          </div>
          <label class="schedule-toggle" title="${sched.enabled ? 'Disable' : 'Enable'}">
            <input type="checkbox" class="schedule-toggle-input" data-schedule-id="${sched.id}" ${sched.enabled ? 'checked' : ''}>
            <span class="schedule-toggle-slider"></span>
          </label>
          <button class="schedule-menu-btn" data-schedule-id="${sched.id}" title="Options">&#x22EE;</button>
        </div>
      `;
    }).join('');
  }

  _refreshList() {
    const items = this.container?.querySelector('#schedule-items');
    if (items) {
      items.innerHTML = this._renderScheduleItems();
      this._attachScheduleItemListeners();
    } else {
      this.render();
    }
  }

  // ─── Sidebar Events ─────────────────────────────────────────────────────────

  _attachSidebarListeners() {
    // + button → open builder
    const addBtn = this.container.querySelector('#btn-new-schedule');
    if (addBtn) addBtn.addEventListener('click', () => this._openBuilder('create'));

    // Context menu actions
    const ctxEdit = this.container.querySelector('#schedule-ctx-edit');
    if (ctxEdit) ctxEdit.addEventListener('click', () => {
      const sched = this.schedules.find((s) => s.id === this._contextMenuScheduleId);
      if (sched) this._openBuilder('edit', sched);
      this._hideContextMenu();
    });

    const ctxDelete = this.container.querySelector('#schedule-ctx-delete');
    if (ctxDelete) ctxDelete.addEventListener('click', () => {
      const sched = this.schedules.find((s) => s.id === this._contextMenuScheduleId);
      if (sched && confirm(`Delete schedule "${sched.name}"?`)) {
        API.invoke('script-runner:delete-schedule', { schedule_id: sched.id });
      }
      this._hideContextMenu();
    });

    // Close context menu on outside click
    const _onDocClick = (e) => {
      if (!e.target.closest('.schedule-context-menu')) this._hideContextMenu();
    };
    document.addEventListener('click', _onDocClick);
    this._onDocClick = _onDocClick;

    this._attachScheduleItemListeners();
  }

  _attachScheduleItemListeners() {
    // Toggle switches
    this.container?.querySelectorAll('.schedule-toggle-input').forEach((input) => {
      input.addEventListener('change', (e) => {
        e.stopPropagation();
        API.invoke('script-runner:toggle-schedule', { schedule_id: input.dataset.scheduleId, enabled: input.checked });
      });
    });

    // Context menu buttons (⋮)
    this.container?.querySelectorAll('.schedule-menu-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showContextMenu(btn.dataset.scheduleId, e);
      });
    });

    // Double-click → edit
    this.container?.querySelectorAll('.schedule-item[data-schedule-id]').forEach((el) => {
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const sched = this.schedules.find((s) => s.id === el.dataset.scheduleId);
        if (sched) this._openBuilder('edit', sched);
      });
    });
  }

  _showContextMenu(scheduleId, event) {
    this._contextMenuScheduleId = scheduleId;
    const menu = this.container?.querySelector('#schedule-context-menu');
    if (!menu) return;
    menu.style.display = 'block';
    menu.style.left = '0px';
    menu.style.top = '0px';
    const rect = menu.getBoundingClientRect();
    const x = Math.min(event.clientX, window.innerWidth - rect.width - 8);
    const y = Math.min(event.clientY, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(0, x) + 'px';
    menu.style.top = Math.max(0, y) + 'px';
  }

  _hideContextMenu() {
    const menu = this.container?.querySelector('#schedule-context-menu');
    if (menu) menu.style.display = 'none';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  FULL-PAGE BUILDER (rendered in main content area via ScriptApp)
  // ═══════════════════════════════════════════════════════════════════════════

  _openBuilder(mode, schedule) {
    this.app.navigateToScheduleBuilder(this, mode, schedule);
  }

  /**
   * Called by ScriptApp.navigateToScheduleBuilder — mounts the schedule
   * builder full-page view into the provided content element.
   */
  mountBuilder(el, mode, schedule) {
    this._builderMode = mode;
    this._editingScheduleId = schedule?.id || null;
    this._builderContainer = el;
    this._selectedTargetType = schedule?.target_type || 'script';
    this._selectedTargetId = schedule?.target_id || null;
    this._scheduleState = schedule ? this._stateFromSchedule(schedule) : this._defaultState();
    this._pickerGroups = null;

    this._renderBuilder();

    // Load topic grouping async
    this.app.loadScriptsGroupedByTopic().then((grouped) => {
      this._pickerGroups = grouped;
      this._renderPickerList();
    });
  }

  _stateFromSchedule(sched) {
    const parts = sched.cron.split(/\s+/);
    const preset = CRON_PRESETS.find((p) => p.cron === sched.cron);
    return {
      mode: 'recurring',
      date: '',
      time: `${String(parts[1] || '8').padStart(2,'0')}:${String(parts[0] || '0').padStart(2,'0')}`,
      preset: preset ? preset.cron : '',
      minute: parts[0] || '*',
      hour: parts[1] || '*',
      dayOfMonth: parts[2] || '*',
      month: parts[3] || '*',
      weekdays: (parts[4] && parts[4] !== '*') ? parts[4].split(',') : [],
    };
  }

  _renderBuilder() {
    const bc = this._builderContainer;
    if (!bc) return;
    const mode = this._builderMode;
    const editing = mode === 'edit' ? this.schedules.find((s) => s.id === this._editingScheduleId) : null;

    bc.innerHTML = `
      <div class="sr-schedule-builder-view">
        <div class="sr-schedule-builder-topbar">
          <div class="sr-schedule-builder-topbar-left">
            <button class="sr-chain-back-btn" id="sched-back-btn" title="Cancel">&#8592; Back</button>
            <h2>${mode === 'edit' ? 'Edit Schedule' : 'New Schedule'}</h2>
          </div>
          <div class="sr-schedule-builder-topbar-right">
            <button class="btn btn-secondary" id="sched-builder-cancel">Cancel</button>
            <button class="btn btn-primary" id="sched-builder-save">${mode === 'edit' ? 'Update' : 'Create'} Schedule</button>
          </div>
        </div>
        <div class="sr-schedule-builder-name-row">
          <label for="sched-name-input">Schedule Name</label>
          <input type="text" id="sched-name-input" placeholder="e.g. Nightly Backup"
                 value="${this._esc(editing?.name || '')}" autocomplete="off">
          <span class="form-error" id="sched-name-error"></span>
        </div>
        <div class="sr-schedule-builder-body">
          <!-- LEFT: target picker -->
          <div class="sr-schedule-picker-panel">
            <div class="sr-schedule-panel-header">
              <div class="sr-schedule-target-tabs">
                <button class="sr-schedule-target-tab${this._selectedTargetType === 'script' ? ' active' : ''}" data-type="script">Scripts</button>
                <button class="sr-schedule-target-tab${this._selectedTargetType === 'chain' ? ' active' : ''}" data-type="chain">Chains</button>
              </div>
              <input type="search" class="sr-chain-search" id="sched-target-search" placeholder="Search…">
            </div>
            <div class="sr-schedule-target-list" id="sched-target-list"></div>
          </div>
          <!-- RIGHT: timing configuration -->
          <div class="sr-schedule-timing-panel">
            <div class="sr-schedule-panel-header">
              <span>Schedule</span>
            </div>
            <div class="sr-schedule-timing-content" id="sched-timing-content">
              ${this._renderTimingPanel()}
            </div>
          </div>
        </div>
      </div>
    `;

    this._attachBuilderListeners();
    this._renderPickerList();
    setTimeout(() => bc.querySelector('#sched-name-input')?.focus(), 50);
  }

  _renderTimingPanel() {
    const st = this._scheduleState;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const todayFormatted = now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

    const presetOptions = CRON_PRESETS.map((p) =>
      `<option value="${p.cron}"${st.preset === p.cron ? ' selected' : ''}>${p.label}</option>`
    ).join('');

    const weekdayButtons = WEEKDAYS.map((name, i) => {
      const val = String(i + 1);
      const active = st.weekdays.includes(val);
      return `<button class="sr-sched-weekday${active ? ' active' : ''}" data-day="${val}">${name}</button>`;
    }).join('');

    // Format time for display: always HH:MM
    const displayTime = st.time || `${String(st.hour !== '*' ? st.hour : '8').padStart(2,'0')}:${String(st.minute !== '*' ? st.minute : '0').padStart(2,'0')}`;

    return `
      <!-- Mode tabs -->
      <div class="sr-sched-mode-tabs">
        <button class="sr-sched-mode-tab${st.mode === 'recurring' ? ' active' : ''}" data-mode="recurring">Recurring</button>
        <button class="sr-sched-mode-tab${st.mode === 'once' ? ' active' : ''}" data-mode="once">One-time</button>
      </div>

      ${st.mode === 'once' ? `
        <!-- One-time date/time picker -->
        <div class="sr-sched-section">
          <label class="sr-sched-label">Date</label>
          <input type="date" class="sr-sched-input" id="sched-date" value="${st.date || today}" min="${today}">
          <small class="sr-sched-hint">e.g. ${todayFormatted}</small>
        </div>
        <div class="sr-sched-section">
          <label class="sr-sched-label">Time</label>
          <input type="time" class="sr-sched-input" id="sched-time" value="${st.time || '08:00'}">
          <small class="sr-sched-hint">e.g. 08:00</small>
        </div>
      ` : `
        <!-- Recurring schedule -->
        <div class="sr-sched-section">
          <label class="sr-sched-label">Preset</label>
          <select class="sr-sched-input" id="sched-preset">
            <option value="">Custom…</option>
            ${presetOptions}
          </select>
        </div>

        ${!st.preset ? `
          <div class="sr-sched-section">
            <label class="sr-sched-label">Time</label>
            <input type="time" class="sr-sched-input" id="sched-time-recurring" value="${displayTime}">
            <small class="sr-sched-hint">e.g. 08:00</small>
          </div>

          <div class="sr-sched-section">
            <label class="sr-sched-label">Days of week</label>
            <div class="sr-sched-weekdays" id="sched-weekdays">
              ${weekdayButtons}
            </div>
          </div>

          <div class="sr-sched-section">
            <label class="sr-sched-label">Day of month <small class="sr-sched-hint">(optional)</small></label>
            <input type="text" class="sr-sched-input" id="sched-dom" value="${st.dayOfMonth !== '*' ? st.dayOfMonth : ''}" placeholder="* (any)">
          </div>
        ` : ''}
      `}
    `;
  }


  _buildCurrentCron() {
    const st = this._scheduleState;
    if (st.mode === 'once') {
      return buildCron(st);
    }
    if (st.preset) return st.preset;
    return buildCron(st);
  }

  // ─── Target Picker (left panel) ──────────────────────────────────────────

  _renderPickerList() {
    const bc = this._builderContainer;
    const list = bc?.querySelector('#sched-target-list');
    const search = bc?.querySelector('#sched-target-search');
    if (!list) return;

    const query = (search?.value || '').toLowerCase();

    if (this._selectedTargetType === 'chain') {
      this._renderChainPicker(list, query);
    } else {
      this._renderScriptPicker(list, query);
    }
  }

  _renderScriptPicker(list, query) {
    const makeItem = (s) => {
      const sid = s.id || s.folder;
      const selected = this._selectedTargetId === sid;
      return `<div class="sr-sched-pick-item${selected ? ' selected' : ''}" data-target-id="${this._esc(sid)}">
        <span class="sr-sched-pick-radio">${selected ? '&#9679;' : '&#9675;'}</span>
        <span class="sr-sched-pick-name">${this._esc(s.name)}</span>
      </div>`;
    };

    const matchesQuery = (s) => {
      if (!query) return true;
      return (s.name + ' ' + (s.description || '')).toLowerCase().includes(query);
    };

    if (!query && this._pickerGroups) {
      const { groups, ungrouped } = this._pickerGroups;
      list.innerHTML = [
        ...groups.map((g) => `
          <div class="sr-sched-pick-group">
            <div class="sr-sched-pick-group-header" data-group="${this._esc(g.topic.id)}">
              <span class="sr-sched-pick-arrow">&#9660;</span>
              <span>${this._esc(g.topic.name)}</span>
              <span class="sr-sched-pick-count">${g.scripts.length}</span>
            </div>
            <div class="sr-sched-pick-group-body">${g.scripts.map(makeItem).join('')}</div>
          </div>`),
        ungrouped.length > 0 ? `
          <div class="sr-sched-pick-group">
            <div class="sr-sched-pick-group-header" data-group="__ungrouped">
              <span class="sr-sched-pick-arrow">&#9660;</span>
              <span>Ungrouped</span>
              <span class="sr-sched-pick-count">${ungrouped.length}</span>
            </div>
            <div class="sr-sched-pick-group-body">${ungrouped.map(makeItem).join('')}</div>
          </div>` : '',
      ].join('') || '<div class="sr-sched-pick-empty">No scripts found.</div>';

      // Collapse toggle
      list.querySelectorAll('.sr-sched-pick-group-header').forEach((hdr) => {
        hdr.addEventListener('click', () => {
          const body = hdr.nextElementSibling;
          const arrow = hdr.querySelector('.sr-sched-pick-arrow');
          const collapsed = body.style.display === 'none';
          body.style.display = collapsed ? '' : 'none';
          arrow.style.transform = collapsed ? '' : 'rotate(-90deg)';
        });
      });
    } else {
      const scripts = (this.app.allScripts || []).filter(matchesQuery);
      list.innerHTML = scripts.length > 0
        ? scripts.map(makeItem).join('')
        : '<div class="sr-sched-pick-empty">No scripts found.</div>';
    }

    // Click to select
    list.querySelectorAll('.sr-sched-pick-item').forEach((el) => {
      el.addEventListener('click', () => {
        this._selectedTargetId = el.dataset.targetId;
        this._renderPickerList();
      });
    });
  }

  _renderChainPicker(list, query) {
    const chains = (this.app.chainListInstance?.chains || []).filter((c) => {
      if (!query) return true;
      return c.name.toLowerCase().includes(query);
    });

    if (chains.length === 0) {
      list.innerHTML = '<div class="sr-sched-pick-empty">No chains available.</div>';
      return;
    }

    list.innerHTML = chains.map((c) => {
      const selected = this._selectedTargetId === c.id;
      const count = (c.script_ids || []).length;
      return `<div class="sr-sched-pick-item${selected ? ' selected' : ''}" data-target-id="${this._esc(c.id)}">
        <span class="sr-sched-pick-radio">${selected ? '&#9679;' : '&#9675;'}</span>
        <span class="sr-sched-pick-name">${this._esc(c.name)}</span>
        <span class="sr-sched-pick-count">${count}</span>
      </div>`;
    }).join('');

    list.querySelectorAll('.sr-sched-pick-item').forEach((el) => {
      el.addEventListener('click', () => {
        this._selectedTargetId = el.dataset.targetId;
        this._renderPickerList();
      });
    });
  }

  // ─── Builder Events ─────────────────────────────────────────────────────────

  _attachBuilderListeners() {
    const bc = this._builderContainer;
    if (!bc) return;

    bc.querySelector('#sched-back-btn')?.addEventListener('click', () => this._closeBuilder());
    bc.querySelector('#sched-builder-cancel')?.addEventListener('click', () => this._closeBuilder());
    bc.querySelector('#sched-builder-save')?.addEventListener('click', () => this._saveSchedule());

    const nameInput = bc.querySelector('#sched-name-input');
    if (nameInput) {
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this._closeBuilder();
      });
    }

    // Search
    const searchInput = bc.querySelector('#sched-target-search');
    if (searchInput) searchInput.addEventListener('input', () => this._renderPickerList());

    // Target type tabs
    bc.querySelectorAll('.sr-schedule-target-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this._selectedTargetType = tab.dataset.type;
        this._selectedTargetId = null;
        bc.querySelectorAll('.sr-schedule-target-tab').forEach((t) => t.classList.toggle('active', t === tab));
        this._renderPickerList();
      });
    });

    // Timing panel events
    this._attachTimingListeners();
  }

  _attachTimingListeners() {
    const bc = this._builderContainer;
    if (!bc) return;

    // Mode tabs (recurring / one-time)
    bc.querySelectorAll('.sr-sched-mode-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this._scheduleState.mode = tab.dataset.mode;
        if (tab.dataset.mode === 'once' && !this._scheduleState.date) {
          this._scheduleState.date = new Date().toISOString().slice(0, 10);
        }
        this._refreshTimingPanel();
      });
    });

    // One-time date/time — sync displayed default into state on render
    const dateInput = bc.querySelector('#sched-date');
    if (dateInput) {
      if (!this._scheduleState.date && dateInput.value) this._scheduleState.date = dateInput.value;
      dateInput.addEventListener('change', () => {
        this._scheduleState.date = dateInput.value;
      });
    }
    const timeInput = bc.querySelector('#sched-time');
    if (timeInput) timeInput.addEventListener('change', () => {
      this._scheduleState.time = timeInput.value;
    });

    // Preset dropdown
    const presetSel = bc.querySelector('#sched-preset');
    if (presetSel) presetSel.addEventListener('change', () => {
      this._scheduleState.preset = presetSel.value;
      this._refreshTimingPanel();
    });

    // Recurring time input (HH:MM)
    const timeRecurring = bc.querySelector('#sched-time-recurring');
    if (timeRecurring) timeRecurring.addEventListener('change', () => {
      const parts = (timeRecurring.value || '08:00').split(':');
      this._scheduleState.hour = String(parseInt(parts[0], 10) || 0);
      this._scheduleState.minute = String(parseInt(parts[1], 10) || 0);
      this._scheduleState.time = timeRecurring.value;
    });

    // Weekday buttons
    bc.querySelectorAll('.sr-sched-weekday').forEach((btn) => {
      btn.addEventListener('click', () => {
        const day = btn.dataset.day;
        const wds = this._scheduleState.weekdays;
        const idx = wds.indexOf(day);
        if (idx >= 0) wds.splice(idx, 1);
        else wds.push(day);
        btn.classList.toggle('active');
      });
    });

    // Day of month
    const domInput = bc.querySelector('#sched-dom');
    if (domInput) domInput.addEventListener('input', () => {
      this._scheduleState.dayOfMonth = domInput.value.trim() || '*';
    });


  }

  _refreshTimingPanel() {
    const content = this._builderContainer?.querySelector('#sched-timing-content');
    if (!content) return;
    content.innerHTML = this._renderTimingPanel();
    this._attachTimingListeners();
  }

  _closeBuilder() {
    this._builderContainer = null;
    this._selectedTargetId = null;
    this._editingScheduleId = null;
    this._scheduleState = this._defaultState();
    this.app.navigateToBrowser();
  }

  // ─── Save ────────────────────────────────────────────────────────────────────

  async _saveSchedule() {
    const bc = this._builderContainer;
    const nameInput = bc?.querySelector('#sched-name-input');
    const errorEl = bc?.querySelector('#sched-name-error');
    const name = nameInput?.value?.trim();

    if (!name) {
      if (errorEl) errorEl.textContent = 'Schedule name is required';
      nameInput?.focus();
      return;
    }
    if (!this._selectedTargetId) {
      if (errorEl) errorEl.textContent = 'Please select a script or chain';
      return;
    }

    const cron = this._buildCurrentCron();
    if (!cron) {
      if (errorEl) errorEl.textContent = 'Invalid schedule configuration';
      return;
    }
    if (errorEl) errorEl.textContent = '';

    const payload = {
      name,
      target_type: this._selectedTargetType,
      target_id: this._selectedTargetId,
      cron,
    };

    try {
      let result;
      if (this._builderMode === 'edit' && this._editingScheduleId) {
        result = await API.invoke('script-runner:update-schedule', { schedule_id: this._editingScheduleId, ...payload });
      } else {
        result = await API.invoke('script-runner:create-schedule', payload);
      }

      if (result.success) {
        const verb = this._builderMode === 'edit' ? 'updated' : 'created';
        globalThis.ui?.showNotification?.(`Schedule "${name}" ${verb}`, 'success');
        this._closeBuilder();
      } else {
        if (errorEl) errorEl.textContent = result.error || 'Failed to save schedule';
      }
    } catch (err) {
      console.error('[script-schedules] Save error:', err.message);
      const errEl = this._builderContainer?.querySelector('#sched-name-error');
      if (errEl) errEl.textContent = 'Error saving schedule';
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  _getTargetLabel(sched) {
    if (sched.target_type === 'chain') {
      const chain = (this.app.chainListInstance?.chains || []).find((c) => c.id === sched.target_id);
      return chain ? chain.name : sched.target_id;
    }
    const script = (this.app.allScripts || []).find((s) => (s.id || s.folder) === sched.target_id);
    return script ? script.name : sched.target_id;
  }

  _esc(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
  }

  destroy() {
    this.unsubscribes.forEach((u) => u?.());
    this.unsubscribes = [];
    if (this._onDocClick) {
      document.removeEventListener('click', this._onDocClick);
    }
  }
}

globalThis.ScheduleList = ScheduleList;
})();
