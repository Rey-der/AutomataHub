/**
 * Sensors handler — CRUD operations for sensors.
 */

module.exports = {
  register(ipcBridge, deps) {
    const { store, poller, emit } = deps;

    ipcBridge.handle('sensor-monitor:get-sensors', async (_event, opts = {}) => {
      const sensors = store.getAllSensors(opts.enabled_only === true);
      return { sensors };
    });

    ipcBridge.handle('sensor-monitor:add-sensor', async (_event, data) => {
      if (!data || !data.name) return { error: 'Sensor name is required' };
      const sensor = store.addSensor(data);
      if (sensor.enabled) poller.start(sensor.id);
      return { sensor };
    });

    ipcBridge.handle('sensor-monitor:remove-sensor', async (_event, data) => {
      if (!data || !data.id) return { error: 'Sensor ID is required' };
      poller.stop(data.id);
      const removed = store.removeSensor(data.id);
      return { success: removed };
    });

    ipcBridge.handle('sensor-monitor:update-sensor', async (_event, data) => {
      if (!data || !data.id) return { error: 'Sensor ID is required' };
      const { id, ...updates } = data;
      const sensor = store.updateSensor(id, updates);
      if (!sensor) return { error: 'Sensor not found' };

      // Restart polling if interval or enabled state changed
      if ('enabled' in updates || 'interval_s' in updates) {
        poller.stop(id);
        if (sensor.enabled) poller.start(id);
      }
      return { sensor };
    });

    ipcBridge.handle('sensor-monitor:poll-sensor', async (_event, data) => {
      if (!data || !data.id) return { error: 'Sensor ID is required' };
      const sensor = poller.pollNow(data.id);
      if (!sensor) return { error: 'Sensor not found' };
      return { sensor };
    });

    ipcBridge.handle('sensor-monitor:get-readings', async (_event, data) => {
      if (!data || !data.sensor_id) return { error: 'Sensor ID is required' };
      const readings = store.getReadings(data.sensor_id, data.limit || 100);
      return { readings };
    });

    ipcBridge.handle('sensor-monitor:get-sensor-history', async (_event, data) => {
      if (!data || !data.sensor_id) return { error: 'Sensor ID is required' };
      const sensor = store.getSensor(data.sensor_id);
      const readings = store.getReadings(data.sensor_id, data.limit || 200);
      return { sensor, readings };
    });

    ipcBridge.handle('sensor-monitor:get-dashboard-stats', async () => {
      return store.getStats();
    });

    ipcBridge.handle('sensor-monitor:export-data', async () => {
      const sensors = store.getAllSensors();
      const thresholds = store.getThresholds();
      return { sensors, thresholds, exported_at: new Date().toISOString() };
    });
  },
};
