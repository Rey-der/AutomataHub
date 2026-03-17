/**
 * NetOps Handlers — Alert rules CRUD, alert history, acknowledgement.
 */

function register(ipcBridge, { alertEngine, store }) {

  // ---- Rules ----

  ipcBridge.handle('netops:get-alert-rules', async (_e, args) => {
    const { host_id } = args || {};
    const rules = host_id ? alertEngine.getRules(host_id) : store.getAllAlertRules();
    return { rules };
  });

  ipcBridge.handle('netops:add-alert-rule', async (_e, args) => {
    const { host_id, metric, operator, threshold, severity, cooldown_min } = args || {};
    if (!metric || !operator || threshold == null) {
      throw new Error('Missing required rule fields (metric, operator, threshold)');
    }
    const rule = alertEngine.addRule({ host_id, metric, operator, threshold, severity, cooldown_min });
    return { success: true, rule };
  });

  ipcBridge.handle('netops:update-alert-rule', async (_e, args) => {
    const { rule_id, ...updates } = args || {};
    if (!rule_id) throw new Error('Missing rule_id');
    const rule = alertEngine.updateRule(rule_id, updates);
    return rule ? { success: true } : { success: false, error: 'Rule not found' };
  });

  ipcBridge.handle('netops:delete-alert-rule', async (_e, args) => {
    const { rule_id } = args || {};
    if (!rule_id) throw new Error('Missing rule_id');
    alertEngine.deleteRule(rule_id);
    return { success: true };
  });

  // ---- Alert history ----

  ipcBridge.handle('netops:get-alerts', async (_e, args) => {
    const { host_id, severity, limit, unacknowledged } = args || {};
    const alerts = alertEngine.getAlerts({ host_id, severity, limit, unacknowledged });
    return { alerts };
  });

  ipcBridge.handle('netops:acknowledge-alert', async (_e, args) => {
    const { alert_id } = args || {};
    if (!alert_id) throw new Error('Missing alert_id');
    const alert = alertEngine.acknowledgeAlert(alert_id);
    return alert ? { success: true } : { success: false, error: 'Alert not found' };
  });

  ipcBridge.handle('netops:get-active-alert-count', async () => {
    return { count: alertEngine.getActiveCount() };
  });

  // ---- Notification settings ----

  ipcBridge.handle('netops:set-alert-settings', async (_e, args) => {
    const { notify_severities, sound_enabled } = args || {};
    if (Array.isArray(notify_severities)) alertEngine.setNotifySeverities(notify_severities);
    if (sound_enabled != null) alertEngine.setSoundEnabled(sound_enabled);
    return { success: true };
  });
}

module.exports = { register };
