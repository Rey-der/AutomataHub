/**
 * Thresholds and alerts handler — threshold CRUD + alert management.
 */

module.exports = {
  register(ipcBridge, deps) {
    const { store } = deps;

    ipcBridge.handle('sensor-monitor:set-threshold', async (_event, data) => {
      if (!data || !data.sensor_id || data.value === undefined) {
        return { error: 'sensor_id and value are required' };
      }
      const threshold = store.setThreshold(data);
      return { threshold };
    });

    ipcBridge.handle('sensor-monitor:get-thresholds', async (_event, data = {}) => {
      const thresholds = store.getThresholds(data.sensor_id);
      return { thresholds };
    });

    ipcBridge.handle('sensor-monitor:remove-threshold', async (_event, data) => {
      if (!data || !data.id) return { error: 'Threshold ID is required' };
      const removed = store.removeThreshold(data.id);
      return { success: removed };
    });

    ipcBridge.handle('sensor-monitor:get-alerts', async (_event, data = {}) => {
      const alerts = store.getAlerts(data);
      return { alerts, active_count: store.getActiveAlertCount() };
    });

    ipcBridge.handle('sensor-monitor:acknowledge-alert', async (_event, data) => {
      if (!data || !data.id) return { error: 'Alert ID is required' };
      const alert = store.acknowledgeAlert(data.id);
      if (!alert) return { error: 'Alert not found' };
      return { alert };
    });
  },
};
