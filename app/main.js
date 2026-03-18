const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, session, ipcMain, dialog, nativeImage, shell } = require('electron');
const { ModuleRegistry } = require('./core/module-registry');
const { discoverModules, discoverInstalledModules } = require('./core/module-loader');
const { IpcBridge } = require('./core/ipc-bridge');
const { getPrefs, getModulePrefs, setModulePrefs } = require('./core/user-prefs');
const dbCredentials = require('./core/db-credentials');
const dbScanner = require('./core/db-scanner');

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

  // --- Database Manager ---

  ipcMain.handle('hub:scan-databases', () => {
    const rootDir = path.join(__dirname, '..');
    const userDataDir = app.getPath('userData');
    return dbScanner.scanForDatabases(rootDir, MODULES_DIR, userDataDir);
  });

  ipcMain.handle('hub:get-db-credentials', () => {
    return dbCredentials.listCredentials();
  });

  ipcMain.handle('hub:set-db-password', (_event, { dbPath, password }) => {
    if (typeof dbPath !== 'string' || typeof password !== 'string') {
      return { success: false, error: 'Invalid arguments' };
    }
    if (password.length < 4 || password.length > 256) {
      return { success: false, error: 'Password must be 4–256 characters' };
    }
    const ok = dbCredentials.setCredential(dbPath, password);
    return { success: ok };
  });

  ipcMain.handle('hub:change-db-password', (_event, { dbPath, oldPassword, newPassword }) => {
    if (typeof dbPath !== 'string' || typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
      return { success: false, error: 'Invalid arguments' };
    }
    if (newPassword.length < 4 || newPassword.length > 256) {
      return { success: false, error: 'New password must be 4–256 characters' };
    }
    if (!dbCredentials.verifyCredential(dbPath, oldPassword)) {
      return { success: false, error: 'Current password does not match' };
    }
    const ok = dbCredentials.setCredential(dbPath, newPassword);
    return { success: ok };
  });

  ipcMain.handle('hub:remove-db-password', (_event, { dbPath, password }) => {
    if (typeof dbPath !== 'string' || typeof password !== 'string') {
      return { success: false, error: 'Invalid arguments' };
    }
    if (!dbCredentials.verifyCredential(dbPath, password)) {
      return { success: false, error: 'Current password does not match' };
    }
    const removed = dbCredentials.removeCredential(dbPath);
    return { success: removed };
  });

  ipcMain.handle('hub:test-db-connection', async (_event, { dbPath, password }) => {
    if (typeof dbPath !== 'string') {
      return { success: false, error: 'Invalid path' };
    }
    // Try better-sqlite3 first, then sql.js fallback
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      if (password) {
        const hex = Buffer.from(password, 'utf-8').toString('hex');
        db.pragma(`key="x'${hex}'"`);
      }
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
      db.close();
      return { success: true, tables };
    } catch (betterErr) {
      try {
        const initSqlJs = require('sql.js');
        const SQL = await initSqlJs();
        const fileBuffer = fs.readFileSync(dbPath);
        const db = new SQL.Database(fileBuffer);
        const rows = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
        const tables = rows.length ? rows[0].values.map(r => r[0]) : [];
        db.close();
        return { success: true, tables };
      } catch {
        return { success: false, error: betterErr.message };
      }
    }
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
          getDbCredential: (dbPath) => dbCredentials.getCredential(dbPath),
        });
      } catch (err) {
        console.error(`[hub] Failed to setup module "${mod.id}":`, err.message);
      }
    }
  }

  console.log(`[hub] Loaded ${registry.getAll().length} module(s): ${registry.getAll().map((m) => m.id).join(', ') || '(none)'}`);
}

// --- Default Credentials (demo / GitHub) ---

function initDefaultCredentials() {
  const DEFAULT_PASSWORD = '0000';
  try {
    const rootDir = path.join(__dirname, '..');
    const userDataDir = app.getPath('userData');
    const dbs = dbScanner.scanForDatabases(rootDir, MODULES_DIR, userDataDir);
    for (const db of dbs) {
      if (!dbCredentials.hasCredential(db.path)) {
        dbCredentials.setCredential(db.path, DEFAULT_PASSWORD);
        console.log(`[hub] Set default credential for ${db.relativePath}`);
      }
    }
  } catch (err) {
    console.warn('[hub] Failed to init default credentials:', err.message);
  }
}

function logCredentialStatus() {
  try {
    const rootDir = path.join(__dirname, '..');
    const userDataDir = app.getPath('userData');
    const dbs = dbScanner.scanForDatabases(rootDir, MODULES_DIR, userDataDir);
    const creds = dbCredentials.listCredentials();
    const credPaths = new Set(creds.map(c => c.path));
    const withPw = dbs.filter(d => credPaths.has(d.path)).length;
    console.log(`[hub] Credential status: ${withPw}/${dbs.length} database(s) have stored passwords`);
    for (const db of dbs) {
      const status = credPaths.has(db.path) ? '\u2713 credential stored' : '\u2717 no credential';
      console.log(`[hub]   ${db.relativePath} — ${status}`);
    }
  } catch (err) {
    console.warn('[hub] Failed to log credential status:', err.message);
  }
}

// --- App Lifecycle ---

async function init() {
  await app.whenReady();

  // Set dock icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(ICON_PATH));
  }

  setupHubIPC();
  initDefaultCredentials();
  loadModules();
  logCredentialStatus();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

async function bootstrap() {
  try {
    await init();
  } catch (err) {
    console.error('[hub] Fatal error:', err);
  }
}

bootstrap(); // NOSONAR — CJS module, top-level await not available

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

  // DB Manager handlers
  ipcMain.removeHandler('hub:scan-databases');
  ipcMain.removeHandler('hub:get-db-credentials');
  ipcMain.removeHandler('hub:set-db-password');
  ipcMain.removeHandler('hub:change-db-password');
  ipcMain.removeHandler('hub:remove-db-password');
  ipcMain.removeHandler('hub:test-db-connection');
});
