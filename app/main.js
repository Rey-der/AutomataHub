const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, session, ipcMain, dialog, nativeImage, shell } = require('electron');
const { ModuleRegistry } = require('./core/module-registry');
const { discoverModules, discoverInstalledModules } = require('./core/module-loader');
const { IpcBridge } = require('./core/ipc-bridge');
const { getPrefs, getModulePrefs, setModulePrefs } = require('./core/user-prefs');

// Must be set before app is ready so macOS Dock shows the correct name
app.name = 'AutomataHub';

const MODULES_DIR = path.join(__dirname, '..', 'modules');
const NODE_MODULES_DIR = path.join(__dirname, '..', 'node_modules');
const ICON_PATH = path.join(__dirname, '..', 'resources', 'icon.png');

let mainWindow = null;
const registry = new ModuleRegistry();
const ipcBridge = new IpcBridge();

// --- Window Creation ---

function createWindow() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"]
      }
    });
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#1e1e1e',
    title: 'AutomataHub',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- Hub IPC Handlers (shared across all modules) ---

function setupHubIPC() {
  // Get resources directory path
  ipcMain.handle('get-resources-path', () => {
    return path.join(__dirname, '..', 'resources');
  });

  // Open external URL safely
  ipcMain.handle('open-external-url', (_event, url) => {
    const allowed = ['https://github.com/Rey-der'];
    if (typeof url === 'string' && allowed.some(a => url.startsWith(a))) {
      shell.openExternal(url);
    }
  });

  // Return module metadata for the renderer (dashboard, dynamic loading)
  ipcMain.handle('hub:get-modules', () => {
    return registry.getAll().map((m) => ({
      id: m.id,
      name: m.name,
      version: m.version,
      description: m.description,
      tabTypes: m.tabTypes,
      rendererScripts: m.rendererScripts,
      rendererStyles: m.rendererStyles || [],
    }));
  });

  // Return allowed push channels for the renderer's dynamic listener setup
  ipcMain.handle('hub:get-allowed-channels', () => {
    return registry.getAllowedChannels();
  });

  // --- User Preferences ---

  ipcMain.handle('prefs:get', () => {
    return getPrefs();
  });

  ipcMain.handle('prefs:get-module', (_event, moduleId) => {
    if (typeof moduleId !== 'string') return null;
    return getModulePrefs(moduleId);
  });

  ipcMain.handle('prefs:set-module', (_event, { moduleId, updates }) => {
    if (typeof moduleId !== 'string' || !updates || typeof updates !== 'object') return null;
    return setModulePrefs(moduleId, updates);
  });
}

// --- Module Initialization ---

function loadModules() {
  // Local modules/ takes priority over node_modules/automatahub-*
  const localModules = discoverModules(MODULES_DIR);
  const installedModules = discoverInstalledModules(NODE_MODULES_DIR);

  const localIds = new Set(localModules.map((m) => m.id));
  const merged = [
    ...localModules,
    ...installedModules.filter((m) => !localIds.has(m.id)),
  ];

  for (const mod of merged) {
    registry.register(mod);

    if (mod.setup) {
      try {
        mod.setup({
          ipcBridge,
          mainWindow: () => mainWindow,
          paths: {
            root: path.join(__dirname, '..'),
            modules: MODULES_DIR,
            resources: path.join(__dirname, '..', 'resources'),
          },
          send: (channel, data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(channel, data);
            }
          },
        });
      } catch (err) {
        console.error(`[hub] Failed to setup module "${mod.id}":`, err.message);
      }
    }
  }

  console.log(`[hub] Loaded ${registry.getAll().length} module(s): ${registry.getAll().map((m) => m.id).join(', ') || '(none)'}`);
}

// --- App Lifecycle ---

app.whenReady().then(() => {
  // Set dock icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(ICON_PATH));
  }

  setupHubIPC();
  loadModules();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Teardown all modules
  for (const mod of registry.getAll()) {
    if (mod.teardown) {
      try {
        mod.teardown();
      } catch (err) {
        console.error(`[hub] Teardown error in "${mod.id}":`, err.message);
      }
    }
  }

  // Remove module IPC handlers
  ipcBridge.removeAll();

  // Remove hub IPC handlers
  ipcMain.removeHandler('get-resources-path');
  ipcMain.removeHandler('open-external-url');
  ipcMain.removeHandler('hub:get-modules');
  ipcMain.removeHandler('hub:get-allowed-channels');
});
