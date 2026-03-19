/**
 * Discovery handler — network sensor discovery IPC.
 */

const { discoverSensors, getLocalSubnet } = require('../monitoring/sensor-discovery');

module.exports = {
  register(ipcBridge, deps) {
    const { store, poller, emit } = deps;

    ipcBridge.handle('sensor-monitor:discover-sensors', async (_event, data = {}) => {
      const range = data.range || getLocalSubnet();

      emit('sensor-monitor:discovery-progress', { progress: 0, range });

      const candidates = await discoverSensors(range, (progress) => {
        emit('sensor-monitor:discovery-progress', { progress, range });
      });

      emit('sensor-monitor:discovery-complete', {
        range,
        found: candidates.length,
      });

      return { candidates, range };
    });
  },
};
