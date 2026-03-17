/**
 * NetAlerts — Alert rules editor + alert history feed.
 * Provides rule CRUD, alert history with acknowledge/navigate, and
 * real-time alert badge updates.
 */

/* global API */

class NetAlerts {
  constructor(app) {
    this.app = app;
    this.container = null;
    this.rules = [];
    this.alerts = [];
    this.activeTab = 'history'; // 'history' | 'rules'
    this._unsubs = [];
  }

  async init(el) {
    this.container = el;
    await this._loadData();
    this.render();
    this._bindEvents();
    this._setupRealtime();
  }

  destroy() {
    this._unsubs.forEach(fn => { if (typeof fn === 'function') fn(); });
    this._unsubs = [];
  }

  // ================================================================
  //  Data
  // ================================================================

  async _loadData() {
    try {
      const [rulesRes, alertsRes] = await Promise.all([
        API.invoke('netops:get-alert-rules', {}),
        API.invoke('netops:get-alerts', { limit: 200 }),
      ]);
      this.rules = rulesRes.rules || [];
      this.alerts = alertsRes.alerts || [];
    } catch (err) {
      console.error('[net-alerts] Load error:', err);
    }
  }

  async _refreshAlerts() {
    try {
      const res = await API.invoke('netops:get-alerts', { limit: 200 });
      this.alerts = res.alerts || [];
      this._renderHistoryTab();
    } catch (err) {
      console.error('[net-alerts] Refresh error:', err);
    }
  }

  async _refreshRules() {
    try {
      const res = await API.invoke('netops:get-alert-rules', {});
      this.rules = res.rules || [];
      this._renderRulesTab();
    } catch (err) {
      console.error('[net-alerts] Refresh rules error:', err);
    }
  }

  _setupRealtime() {
    const u1 = API.on('netops:alert-triggered', () => this._refreshAlerts());
    const u2 = API.on('netops:alert-resolved', () => this._refreshAlerts());
    this._unsubs.push(u1, u2);
  }

  // ================================================================
  //  Rendering
  // ================================================================

  render() {
    const activeCount = this.alerts.filter(a => !a.resolved_at && !a.acknowledged).length;
    this.container.innerHTML = `
      <div class="na-root">
        <div class="na-header">
          <h2 class="na-title">Alerts${activeCount > 0 ? ` <span class="na-active-count">${activeCount}</span>` : ''}</h2>
          <div class="na-tabs">
            <button class="na-tab${this.activeTab === 'history' ? ' active' : ''}" data-tab="history">History</button>
            <button class="na-tab${this.activeTab === 'rules' ? ' active' : ''}" data-tab="rules">Rules</button>
          </div>
        </div>
        <div class="na-content" id="na-content">
          ${this.activeTab === 'history' ? this._renderHistory() : this._renderRules()}
        </div>
      </div>
    `;
  }

  // ---- History Tab ----

  _renderHistory() {
    if (this.alerts.length === 0) {
      return '<div class="na-empty">No alerts yet. Add alert rules to start monitoring thresholds.</div>';
    }

    return `
      <div class="na-filter-bar">
        <select id="na-severity-filter" class="na-select">
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
        <label class="na-check-label">
          <input type="checkbox" id="na-unack-filter" /> Unacknowledged only
        </label>
      </div>
      <div class="na-alert-list" id="na-alert-list">
        ${this._renderAlertRows(this.alerts)}
      </div>
    `;
  }

  _renderAlertRows(alerts) {
    return alerts.map(a => {
      const host = this.app.hosts.find(h => h.id === a.host_id);
      const hostname = host?.hostname || host?.alias || `#${a.host_id}`;
      const time = this._fmtTime(a.triggered_at);
      const resolved = a.resolved_at ? `Resolved ${this._fmtTime(a.resolved_at)}` : 'Active';
      const ackClass = a.acknowledged ? ' acknowledged' : '';
      const sevClass = `na-sev-${a.severity}`;

      return `
        <div class="na-alert-row${ackClass}" data-alert-id="${a.id}" data-host-id="${a.host_id}">
          <span class="na-sev-badge ${sevClass}">${a.severity}</span>
          <span class="na-alert-host" title="Click to view host">${this._esc(hostname)}</span>
          <span class="na-alert-msg">${this._esc(a.message || '')}</span>
          <span class="na-alert-time">${time}</span>
          <span class="na-alert-status ${a.resolved_at ? 'resolved' : 'active'}">${resolved}</span>
          ${!a.acknowledged ? `<button class="na-ack-btn" data-ack-id="${a.id}" title="Acknowledge">&#10003;</button>` : '<span class="na-acked-icon" title="Acknowledged">&#10003;</span>'}
        </div>
      `;
    }).join('');
  }

  _renderHistoryTab() {
    const list = this.container.querySelector('#na-alert-list');
    if (list) list.innerHTML = this._renderAlertRows(this._getFilteredAlerts());
    // Update active count in title
    const activeCount = this.alerts.filter(a => !a.resolved_at && !a.acknowledged).length;
    const titleEl = this.container.querySelector('.na-active-count');
    if (titleEl) titleEl.textContent = activeCount;
    else if (activeCount > 0) {
      const h2 = this.container.querySelector('.na-title');
      if (h2 && !h2.querySelector('.na-active-count')) {
        h2.insertAdjacentHTML('beforeend', ` <span class="na-active-count">${activeCount}</span>`);
      }
    }
  }

  _getFilteredAlerts() {
    let items = this.alerts;
    const sevFilter = this.container.querySelector('#na-severity-filter')?.value;
    const unackFilter = this.container.querySelector('#na-unack-filter')?.checked;
    if (sevFilter) items = items.filter(a => a.severity === sevFilter);
    if (unackFilter) items = items.filter(a => !a.acknowledged);
    return items;
  }

  // ---- Rules Tab ----

  _renderRules() {
    return `
      <div class="na-rules-toolbar">
        <button class="na-add-rule-btn" id="na-add-rule-btn">+ Add Rule</button>
      </div>
      ${this.rules.length === 0
        ? '<div class="na-empty">No alert rules configured. Click "+ Add Rule" to create one.</div>'
        : `<div class="na-rules-list" id="na-rules-list">${this._renderRuleRows()}</div>`
      }
      <div class="na-rule-modal" id="na-rule-modal" style="display:none">
        ${this._renderRuleForm()}
      </div>
    `;
  }

  _renderRuleRows() {
    return this.rules.map(r => {
      const host = r.host_id ? this.app.hosts.find(h => h.id === r.host_id) : null;
      const hostLabel = host ? (host.alias || host.hostname) : 'All hosts';
      const sevClass = `na-sev-${r.severity}`;
      const toggleLabel = r.enabled ? 'Disable' : 'Enable';

      return `
        <div class="na-rule-row" data-rule-id="${r.id}">
          <span class="na-sev-badge ${sevClass}">${r.severity}</span>
          <span class="na-rule-host">${this._esc(hostLabel)}</span>
          <span class="na-rule-expr">${this._esc(r.metric)} ${this._esc(r.operator)} ${this._esc(String(r.threshold))}</span>
          <span class="na-rule-cooldown">${r.cooldown_min}m cooldown</span>
          <span class="na-rule-status ${r.enabled ? 'enabled' : 'disabled'}">${r.enabled ? 'Active' : 'Disabled'}</span>
          <div class="na-rule-actions">
            <button class="na-rule-toggle" data-rule-id="${r.id}" data-action="toggle">${toggleLabel}</button>
            <button class="na-rule-delete" data-rule-id="${r.id}" data-action="delete">Delete</button>
          </div>
        </div>
      `;
    }).join('');
  }

  _renderRulesTab() {
    const list = this.container.querySelector('#na-rules-list');
    if (list) {
      list.innerHTML = this._renderRuleRows();
    } else {
      // Re-render the full rules content
      const content = this.container.querySelector('#na-content');
      if (content) content.innerHTML = this._renderRules();
      this._bindRulesEvents();
    }
  }

  _renderRuleForm(rule) {
    const hostOptions = this.app.hosts.map(h =>
      `<option value="${h.id}"${rule && rule.host_id === h.id ? ' selected' : ''}>${this._esc(h.alias || h.hostname)}</option>`
    ).join('');

    const isEdit = !!rule;
    const title = isEdit ? 'Edit Rule' : 'Add Alert Rule';
    const m = rule || {};

    return `
      <div class="na-modal-backdrop"></div>
      <div class="na-modal-content">
        <h3>${title}</h3>
        <div class="na-form-row">
          <label>Host</label>
          <select id="na-rule-host">
            <option value="">All hosts (global)</option>
            ${hostOptions}
          </select>
        </div>
        <div class="na-form-row">
          <label>Metric</label>
          <select id="na-rule-metric">
            <option value="status"${m.metric === 'status' ? ' selected' : ''}>Status</option>
            <option value="latency_ms"${m.metric === 'latency_ms' ? ' selected' : ''}>Latency (ms)</option>
            <option value="offline_minutes"${m.metric === 'offline_minutes' ? ' selected' : ''}>Offline duration (min)</option>
            <option value="status_code"${m.metric === 'status_code' ? ' selected' : ''}>HTTP Status Code</option>
            <option value="cert_expiry_days"${m.metric === 'cert_expiry_days' ? ' selected' : ''}>Cert Expiry (days)</option>
          </select>
        </div>
        <div class="na-form-row">
          <label>Operator</label>
          <select id="na-rule-operator">
            <option value="changes_to"${m.operator === 'changes_to' ? ' selected' : ''}>Changes to</option>
            <option value=">"${m.operator === '>' ? ' selected' : ''}>&gt; Greater than</option>
            <option value="<"${m.operator === '<' ? ' selected' : ''}>&lt; Less than</option>
            <option value="=="${m.operator === '==' ? ' selected' : ''}>== Equals</option>
            <option value="!="${m.operator === '!=' ? ' selected' : ''}>!= Not equals</option>
          </select>
        </div>
        <div class="na-form-row">
          <label>Threshold</label>
          <input type="text" id="na-rule-threshold" value="${this._esc(String(m.threshold || ''))}" placeholder="e.g. offline, 200, 30" />
        </div>
        <div class="na-form-row">
          <label>Severity</label>
          <select id="na-rule-severity">
            <option value="info"${m.severity === 'info' ? ' selected' : ''}>Info</option>
            <option value="warning"${!m.severity || m.severity === 'warning' ? ' selected' : ''}>Warning</option>
            <option value="critical"${m.severity === 'critical' ? ' selected' : ''}>Critical</option>
          </select>
        </div>
        <div class="na-form-row">
          <label>Cooldown (min)</label>
          <input type="number" id="na-rule-cooldown" value="${m.cooldown_min || 5}" min="1" />
        </div>
        <div class="na-form-actions">
          <button class="na-modal-cancel" id="na-modal-cancel">Cancel</button>
          <button class="na-modal-save" id="na-modal-save"${isEdit ? ` data-rule-id="${m.id}"` : ''}>Save</button>
        </div>
      </div>
    `;
  }

  // ================================================================
  //  Events
  // ================================================================

  _bindEvents() {
    // Tab switching
    this.container.querySelectorAll('.na-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab;
        this.render();
        this._bindEvents();
      });
    });

    if (this.activeTab === 'history') this._bindHistoryEvents();
    else this._bindRulesEvents();
  }

  _bindHistoryEvents() {
    // Acknowledge buttons
    this.container.querySelectorAll('.na-ack-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const alertId = Number(btn.dataset.ackId);
        await API.invoke('netops:acknowledge-alert', { alert_id: alertId });
        this._refreshAlerts();
        this._updateBadge();
      });
    });

    // Click alert row → navigate to host
    this.container.querySelectorAll('.na-alert-row .na-alert-host').forEach(el => {
      el.addEventListener('click', () => {
        const row = el.closest('.na-alert-row');
        const hostId = Number(row.dataset.hostId);
        if (hostId) this.app.navigateTo('host-detail', { host_id: hostId });
      });
    });

    // Filters
    const sevFilter = this.container.querySelector('#na-severity-filter');
    const unackFilter = this.container.querySelector('#na-unack-filter');
    if (sevFilter) sevFilter.addEventListener('change', () => this._renderHistoryTab());
    if (unackFilter) unackFilter.addEventListener('change', () => this._renderHistoryTab());
  }

  _bindRulesEvents() {
    // Add Rule button
    const addBtn = this.container.querySelector('#na-add-rule-btn');
    if (addBtn) addBtn.addEventListener('click', () => this._showRuleModal());

    // Toggle / Delete buttons
    this.container.querySelectorAll('.na-rule-toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ruleId = Number(btn.dataset.ruleId);
        const rule = this.rules.find(r => r.id === ruleId);
        if (!rule) return;
        await API.invoke('netops:update-alert-rule', { rule_id: ruleId, enabled: rule.enabled ? 0 : 1 });
        this._refreshRules();
      });
    });

    this.container.querySelectorAll('.na-rule-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ruleId = Number(btn.dataset.ruleId);
        await API.invoke('netops:delete-alert-rule', { rule_id: ruleId });
        this._refreshRules();
      });
    });
  }

  // ---- Rule Modal ----

  _showRuleModal(rule) {
    const modal = this.container.querySelector('#na-rule-modal');
    if (!modal) return;
    modal.innerHTML = this._renderRuleForm(rule);
    modal.style.display = 'flex';

    // Bind modal events
    const cancel = modal.querySelector('#na-modal-cancel');
    const save = modal.querySelector('#na-modal-save');
    const backdrop = modal.querySelector('.na-modal-backdrop');

    const close = () => { modal.style.display = 'none'; };
    if (cancel) cancel.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);

    if (save) {
      save.addEventListener('click', async () => {
        const hostVal = modal.querySelector('#na-rule-host').value;
        const payload = {
          host_id: hostVal ? Number(hostVal) : null,
          metric: modal.querySelector('#na-rule-metric').value,
          operator: modal.querySelector('#na-rule-operator').value,
          threshold: modal.querySelector('#na-rule-threshold').value,
          severity: modal.querySelector('#na-rule-severity').value,
          cooldown_min: Number(modal.querySelector('#na-rule-cooldown').value) || 5,
        };

        const editId = save.dataset.ruleId;
        if (editId) {
          await API.invoke('netops:update-alert-rule', { rule_id: Number(editId), ...payload });
        } else {
          await API.invoke('netops:add-alert-rule', payload);
        }

        close();
        this._refreshRules();
      });
    }
  }

  // ================================================================
  //  Badge update (sidebar)
  // ================================================================

  _updateBadge() {
    const count = this.alerts.filter(a => !a.resolved_at && !a.acknowledged).length;
    const badge = document.querySelector('.na-sidebar-badge');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? '' : 'none';
    }
  }

  // ================================================================
  //  Helpers
  // ================================================================

  _fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    if (diffMs < 60_000) return 'Just now';
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
}

// Export for net-app routing
if (typeof window !== 'undefined') window.NetAlerts = NetAlerts;
