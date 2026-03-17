/**
 * NetOps Handlers — Backup, restore, retention settings, and DB management.
 */

const fs = require('node:fs');
const { dialog } = require('electron');

function register(ipcBridge, { persistence, store, mainWindow }) {

  // --- Export hosts + networks as JSON ---
  ipcBridge.handle('netops:export-data', async () => {
    const data = persistence.exportJson();
    const win = typeof mainWindow === 'function' ? mainWindow() : mainWindow;
    const result = await dialog.showSaveDialog(win, {
      title: 'Export NetOps Data',
      defaultPath: `netops-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true, path: result.filePath };
  });

  // --- Import from JSON (merge or replace) ---
  ipcBridge.handle('netops:import-data', async (_e, args) => {
    const { mode = 'merge' } = args || {};
    const win = typeof mainWindow === 'function' ? mainWindow() : mainWindow;
    const result = await dialog.showOpenDialog(win, {
      title: 'Import NetOps Data',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };

    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error('Invalid JSON file'); }

    const counts = persistence.importJson(data, mode);

    // Reload store from DB to pick up imported data
    store.hosts.clear();
    store.discoveredNetworks.length = 0;
    store.discoveredHosts.length = 0;
    persistence.loadIntoStore(store);

    return { success: true, ...counts };
  });

  // --- Manual DB backup to user-chosen path ---
  ipcBridge.handle('netops:backup-db', async () => {
    const win = typeof mainWindow === 'function' ? mainWindow() : mainWindow;
    const result = await dialog.showSaveDialog(win, {
      title: 'Backup NetOps Database',
      defaultPath: `netops-backup-${new Date().toISOString().slice(0, 10)}.sqlite`,
      filters: [{ name: 'SQLite Database', extensions: ['sqlite', 'db'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    persistence.backupTo(result.filePath);
    return { success: true, path: result.filePath };
  });

  // --- Retention settings ---
  ipcBridge.handle('netops:get-retention', async () => {
    return {
      success: true,
      rawDays: persistence.retentionRawDays,
      avgDays: persistence.retentionAvgDays,
    };
  });

  ipcBridge.handle('netops:set-retention', async (_e, args) => {
    const { rawDays, avgDays } = args || {};
    if (typeof rawDays === 'number' && rawDays >= 1) persistence.retentionRawDays = rawDays;
    if (typeof avgDays === 'number' && avgDays >= 1) persistence.retentionAvgDays = avgDays;
    return {
      success: true,
      rawDays: persistence.retentionRawDays,
      avgDays: persistence.retentionAvgDays,
    };
  });

  // --- Force prune now ---
  ipcBridge.handle('netops:prune-data', async () => {
    persistence.prune();
    return { success: true };
  });
}

module.exports = { register };
