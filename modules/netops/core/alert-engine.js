/**
 * NetOps Alert Engine — threshold-based alerts with cooldown.
 *
 * Rules are evaluated on every status-update / metrics-updated event.
 * Each rule has a cooldown period to prevent alert spam.
 *
 * Operators:
 *   >   — metric greater than threshold
 *   <   — metric less than threshold
 *   ==  — metric equals threshold (or string match)
 *   !=  — metric does not equal threshold
 *   changes_to — value transitions to the specified state
 *
 * Built-in rule templates:
 *   "host goes offline"              → status changes_to offline
 *   "latency > threshold"            → latency_ms > N
 *   "host unreachable for N minutes" → offline_minutes > N
 */

const { Notification } = require('electron');

const OPERATORS = {
  '>'(val, thr) { return Number(val) > Number(thr); },
  '<'(val, thr) { return Number(val) < Number(thr); },
  '=='(val, thr) { return String(val) === String(thr); },
  '!='(val, thr) { return String(val) !== String(thr); },
  'changes_to'(val, thr, _prev, prevVal) {
    return String(val) === String(thr) && String(prevVal) !== String(thr);
  },
};

const DEFAULT_COOLDOWN_MIN = 5;

class AlertEngine {
  constructor(store, persistence, emitFn) {
    this.store = store;
    this.persistence = persistence;
    this.emit = emitFn;

    /** rule_id → last fired ISO timestamp */
    this._cooldowns = new Map();

    /** host_id → { metric → previous value } for changes_to detection */
    this._prevValues = new Map();

    /** Notification settings */
    this.notifySeverities = new Set(['critical']);
    this.soundEnabled = false;
  }

  // ------------------------------------------------------------------
  //  Rule CRUD (delegated to store/persistence)
  // ------------------------------------------------------------------

  getRules(hostId) {
    return this.store.getAlertRules(hostId);
  }

  getRule(ruleId) {
    return this.store.getAlertRule(ruleId);
  }

  addRule(rule) {
    const id = this.store.generateId();
    const full = {
      id,
      host_id: rule.host_id || null,
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      severity: rule.severity || 'warning',
      enabled: (rule.enabled !== undefined && rule.enabled !== null) ? rule.enabled : 1,
      cooldown_min: rule.cooldown_min || DEFAULT_COOLDOWN_MIN,
      created_at: new Date().toISOString(),
    };
    this.store.addAlertRule(full);
    return full;
  }

  updateRule(ruleId, updates) {
    return this.store.updateAlertRule(ruleId, updates);
  }

  deleteRule(ruleId) {
    this.store.removeAlertRule(ruleId);
    this._cooldowns.delete(ruleId);
  }

  // ------------------------------------------------------------------
  //  Alert history
  // ------------------------------------------------------------------

  getAlerts(opts = {}) {
    return this.store.getAlertHistory(opts);
  }

  acknowledgeAlert(alertId) {
    return this.store.acknowledgeAlert(alertId);
  }

  getActiveCount() {
    return this.store.getActiveAlertCount();
  }

  // ------------------------------------------------------------------
  //  Evaluation — called on each status-update / metrics-updated
  // ------------------------------------------------------------------

  evaluate(hostId, data) {
    const rules = this.store.getAlertRules(hostId);
    const now = new Date();

    for (const rule of rules) {
      if (!rule.enabled) continue;

      // Extract current value for the rule's metric
      const currentVal = this._extractMetric(hostId, rule.metric, data);
      if (currentVal === undefined) continue;

      // Retrieve previous value for changes_to operator
      const prevMap = this._prevValues.get(hostId) || {};
      const prevVal = prevMap[rule.metric];

      // Update previous value tracking
      prevMap[rule.metric] = currentVal;
      this._prevValues.set(hostId, prevMap);

      // Evaluate operator
      const opFn = OPERATORS[rule.operator];
      if (!opFn) continue;

      const fired = opFn(currentVal, rule.threshold, null, prevVal);
      if (!fired) {
        // Check if we should auto-resolve an existing open alert
        this._tryAutoResolve(rule, hostId, now);
        continue;
      }

      // Cooldown check
      if (this._isInCooldown(rule.id, now, rule.cooldown_min)) continue;

      // Fire alert
      this._fireAlert(rule, hostId, currentVal, now);
    }
  }

  // ------------------------------------------------------------------
  //  Metric extraction
  // ------------------------------------------------------------------

  _extractMetric(hostId, metric, data) {
    switch (metric) {
      case 'status':
        return data.status;

      case 'latency_ms':
        return data.latency_ms;

      case 'offline_minutes': {
        const status = this.store.getStatus(hostId);
        if (status?.status !== 'offline') return 0;
        const offlineSince = new Date(status.timestamp);
        return (Date.now() - offlineSince.getTime()) / 60_000;
      }

      case 'status_code':
        return data.detail?.status_code;

      case 'cert_expiry_days': {
        const expiry = data.detail?.cert_expiry_date;
        if (!expiry) return undefined;
        return (new Date(expiry).getTime() - Date.now()) / 86_400_000;
      }

      default:
        // Allow dotted paths for detail fields (e.g. detail.response_time_ms)
        if (metric.startsWith('detail.')) {
          return data.detail?.[metric.slice(7)];
        }
        return data[metric];
    }
  }

  // ------------------------------------------------------------------
  //  Cooldown
  // ------------------------------------------------------------------

  _isInCooldown(ruleId, now, cooldownMin) {
    const last = this._cooldowns.get(ruleId);
    if (!last) return false;
    const elapsed = (now.getTime() - new Date(last).getTime()) / 60_000;
    return elapsed < cooldownMin;
  }

  // ------------------------------------------------------------------
  //  Fire alert
  // ------------------------------------------------------------------

  _fireAlert(rule, hostId, currentVal, now) {
    const host = this.store.getHost(hostId);
    const hostname = host?.hostname || `Host #${hostId}`;
    const message = `${hostname}: ${rule.metric} ${rule.operator} ${rule.threshold} (current: ${currentVal})`;

    const alert = {
      id: this.store.generateId(),
      rule_id: rule.id,
      host_id: hostId,
      triggered_at: now.toISOString(),
      resolved_at: null,
      acknowledged: 0,
      severity: rule.severity,
      message,
    };

    this.store.addAlert(alert);
    this._cooldowns.set(rule.id, now.toISOString());

    // Desktop notification
    if (this.notifySeverities.has(rule.severity)) {
      this._sendDesktopNotification(hostname, message, rule.severity, hostId);
    }

    // IPC event
    this.emit('netops:alert-triggered', {
      alert_id: alert.id,
      host_id: hostId,
      hostname,
      severity: rule.severity,
      message,
      timestamp: alert.triggered_at,
    });
  }

  // ------------------------------------------------------------------
  //  Auto-resolve
  // ------------------------------------------------------------------

  _tryAutoResolve(rule, hostId, now) {
    const open = this.store.getOpenAlert(rule.id, hostId);
    if (!open) return;

    this.store.resolveAlert(open.id, now.toISOString());

    const host = this.store.getHost(hostId);
    this.emit('netops:alert-resolved', {
      alert_id: open.id,
      host_id: hostId,
      hostname: host?.hostname || `Host #${hostId}`,
      severity: rule.severity,
      resolved_at: now.toISOString(),
    });
  }

  // ------------------------------------------------------------------
  //  Desktop notifications (Electron)
  // ------------------------------------------------------------------

  _sendDesktopNotification(hostname, message, severity, hostId) {
    if (!Notification.isSupported()) return;

    const n = new Notification({
      title: `NetOps Alert — ${severity.toUpperCase()}`,
      body: message,
      silent: !this.soundEnabled,
    });

    // Click → emit deep-link event so renderer can navigate
    n.on('click', () => {
      this.emit('netops:alert-navigate', { host_id: hostId });
    });

    n.show();
  }

  // ------------------------------------------------------------------
  //  Settings
  // ------------------------------------------------------------------

  setNotifySeverities(arr) {
    this.notifySeverities = new Set(arr);
  }

  setSoundEnabled(enabled) {
    this.soundEnabled = !!enabled;
  }
}

module.exports = { AlertEngine };
