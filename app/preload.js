const { contextBridge, ipcRenderer } = require('electron');

// Channels the hub always allows for push events
const HUB_CHANNELS = [
  'app-error',
  'hub:scan-databases',
  'hub:get-db-credentials',
  'hub:set-db-password',
  'hub:change-db-password',
  'hub:remove-db-password',
  'hub:test-db-connection',
  'hub:db-auth-failed',
];

// Dynamic allowed channels will be fetched after modules load
let allowedChannels = [...HUB_CHANNELS];

contextBridge.exposeInMainWorld('api', {

  // --- Hub APIs (always available) ---

  getResourcesPath: () => ipcRenderer.invoke('get-resources-path'),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),

  getModules: () => ipcRenderer.invoke('hub:get-modules'),

  // --- User Preferences ---

  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  getModulePrefs: (moduleId) => ipcRenderer.invoke('prefs:get-module', moduleId),
  setModulePrefs: (moduleId, updates) => ipcRenderer.invoke('prefs:set-module', { moduleId, updates }),

  /**
   * Fetch the full list of allowed push channels from loaded modules.
   * Called once at renderer boot to populate the allowlist.
   */
  initChannels: async () => {
    const channels = await ipcRenderer.invoke('hub:get-allowed-channels');
    if (Array.isArray(channels)) {
      allowedChannels = [...HUB_CHANNELS, ...channels];
    }
    return allowedChannels;
  },

  // --- Generic invoke for module IPC (validated against declared channels) ---

  invoke: (channel, args) => {
    if (typeof channel !== 'string' || !channel) return Promise.reject(new Error('Invalid channel'));
    return ipcRenderer.invoke(channel, args);
  },

  // --- Event listeners (guarded by allowlist) ---

  on: (event, callback) => {
    if (!allowedChannels.includes(event)) return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(event, handler);
    return () => ipcRenderer.off(event, handler);
  },
  off: (event, callback) => {
    if (!allowedChannels.includes(event)) return;
    ipcRenderer.off(event, callback);
  }
});
