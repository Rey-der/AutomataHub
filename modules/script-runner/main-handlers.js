/**
 * Script Runner — main-process handlers.
 * Registers IPC handlers for script discovery, execution, log saving, import/removal.
 */

const path = require('path');
const fs = require('fs');
const { dialog } = require('electron');

// Hub utilities — resolved at setup() time via paths.root
let ScriptExecutor, ERROR_MESSAGES, friendlyError, resolveInside, ensureDir, readJsonConfig;

const SCRIPTS_DIR_NAME = 'scripts';
const LOGS_DIR_NAME = 'logs';

const EXECUTABLE_EXTENSIONS = ['.sh', '.bash', '.py', '.py3', '.js', '.mjs', '.rb', '.pl', '.csx'];

const EXTENSION_LANGUAGE_MAP = {
  '.sh': 'Bash',
  '.bash': 'Bash',
  '.py': 'Python',
  '.py3': 'Python',
  '.js': 'JavaScript',
  '.mjs': 'JavaScript',
  '.rb': 'Ruby',
  '.pl': 'Perl',
  '.csx': 'C# Script',
};

const IGNORED_ENTRIES = new Set(['.DS_Store', 'Thumbs.db', '.git', 'node_modules', '__pycache__', '.idea', '.vscode']);

let executor = null;
let _send = null;

// --- Script discovery ---

function getAvailableScripts(scriptsDir) {
  ensureDir(scriptsDir);

  const entries = fs.readdirSync(scriptsDir, { withFileTypes: true });
  const scripts = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (IGNORED_ENTRIES.has(entry.name)) continue;

    const folderPath = path.join(scriptsDir, entry.name);
    const configPath = path.join(folderPath, 'config.json');

    const meta = readJsonConfig(configPath, {}, (_path, _err) => {
      console.warn(`${ERROR_MESSAGES.MALFORMED_CONFIG} (${entry.name})`);
    });

    const files = fs.readdirSync(folderPath);
    const executables = files.filter((f) => EXECUTABLE_EXTENSIONS.includes(path.extname(f).toLowerCase()));

    if (executables.length === 0) continue;

    const mainScript = meta.main || executables[0];
    const mainPath = path.join(folderPath, mainScript);

    if (!fs.existsSync(mainPath)) continue;

    const ext = path.extname(mainScript).toLowerCase();
    scripts.push({
      name: meta.name || entry.name,
      folder: entry.name,
      description: meta.description || '',
      language: EXTENSION_LANGUAGE_MAP[ext] || 'Unknown',
      mainScript,
      scriptPath: mainPath,
      executables,
    });
  }

  return scripts;
}

// --- Folder validation helpers ---

function validateFolder(folderPath) {
  if (!fs.existsSync(folderPath)) return { valid: false, error: ERROR_MESSAGES.FOLDER_NOT_FOUND };
  const stat = fs.statSync(folderPath);
  if (!stat.isDirectory()) return { valid: false, error: ERROR_MESSAGES.NOT_A_DIRECTORY };
  if (IGNORED_ENTRIES.has(path.basename(folderPath))) return { valid: false, error: ERROR_MESSAGES.IGNORED_FOLDER };

  const files = fs.readdirSync(folderPath);
  const executables = files.filter((f) => EXECUTABLE_EXTENSIONS.includes(path.extname(f).toLowerCase()));
  if (executables.length === 0) return { valid: false, error: ERROR_MESSAGES.NO_EXECUTABLES };

  return { valid: true, executables, name: path.basename(folderPath) };
}

function importScriptFolder(sourcePath, scriptsDir) {
  const folderName = path.basename(sourcePath);
  const destPath = path.join(scriptsDir, folderName);

  if (fs.existsSync(destPath)) {
    return { success: false, message: `A script folder named "${folderName}" already exists` };
  }

  fs.cpSync(sourcePath, destPath, { recursive: true });
  return { success: true, message: `Imported "${folderName}" successfully` };
}

function removeScriptFolder(scriptId, scriptsDir) {
  const folderPath = path.join(scriptsDir, scriptId);

  try {
    resolveInside(folderPath, scriptsDir);
  } catch {
    return { success: false, message: 'Cannot remove folders outside the scripts directory' };
  }

  fs.rmSync(folderPath, { recursive: true, force: true });
  return { success: true, message: `Removed "${scriptId}" successfully` };
}

// --- Log saving ---

function saveLogs(content, scriptName, _timestamp, logsDir) {
  if (!content) return { success: false, message: ERROR_MESSAGES.NO_CONTENT };

  ensureDir(logsDir);

  const now = new Date();
  const datePart = now.toISOString().replace(/T/, '_').replace(/:/g, '-').replace(/\..+/, '');
  const safeName = String(scriptName || 'log').replace(/[^a-z0-9_-]/gi, '_');
  const fileName = `${safeName}_${datePart}.txt`;
  const filePath = path.join(logsDir, fileName);

  fs.writeFileSync(filePath, content, 'utf-8');
  return { success: true, message: `Logs saved: ${fileName}`, path: filePath };
}

// --- Module setup/teardown ---

function setup(ctx) {
  const { ipcBridge, mainWindow, paths, send } = ctx;
  _send = send;

  // Resolve hub utilities from the host project
  const hubApp = path.join(paths.root, 'app');
  // Load ScriptExecutor from module's own directory (self-contained)
  ({ ScriptExecutor } = require(path.join(__dirname, 'script-executor')));
  ({ ERROR_MESSAGES, friendlyError } = require(path.join(hubApp, 'core', 'errors')));
  ({ resolveInside, ensureDir } = require(path.join(hubApp, 'core', 'path-utils')));
  ({ readJsonConfig } = require(path.join(hubApp, 'core', 'config-utils')));

  const scriptsDir = path.join(paths.root, SCRIPTS_DIR_NAME);
  const logsDir = path.join(paths.root, LOGS_DIR_NAME);

  executor = new ScriptExecutor(scriptsDir);

  // Forward executor events to renderer
  executor.on('output', (data) => send('script-runner:output', data));
  executor.on('error', (data) => send('script-runner:error', data));
  executor.on('complete', (data) => send('script-runner:complete', data));
  executor.on('queue-status', (data) => send('script-runner:queue-status', data));

  // --- IPC Handlers ---

  ipcBridge.handle('script-runner:get-scripts', () => {
    try {
      return getAvailableScripts(scriptsDir);
    } catch (err) {
      console.error('[script-runner] get-scripts error:', err);
      return [];
    }
  });

  ipcBridge.handle('script-runner:run-script', (_event, args) => {
    const { scriptPath, scriptName, tabId } = args || {};
    if (!scriptPath || typeof scriptPath !== 'string') throw new Error(ERROR_MESSAGES.MISSING_SCRIPT_PATH);
    if (!tabId || typeof tabId !== 'string') throw new Error(ERROR_MESSAGES.MISSING_TAB_ID);

    executor.execute({ scriptPath, name: scriptName || path.basename(scriptPath), tabId });
    return { success: true };
  });

  ipcBridge.handle('script-runner:stop-script', (_event, args) => {
    const { tabId } = args || {};
    if (!tabId || typeof tabId !== 'string') throw new Error(ERROR_MESSAGES.MISSING_TAB_ID);
    executor.stop(tabId);
    return { success: true };
  });

  ipcBridge.handle('script-runner:clear-terminal', (_event, args) => {
    // Terminal state is renderer-side; this is a no-op ack
    return { success: true };
  });

  ipcBridge.handle('script-runner:save-logs', (_event, args) => {
    const { content, scriptName, timestamp, tabId } = args || {};
    if (!content || typeof content !== 'string') throw new Error(ERROR_MESSAGES.NO_CONTENT);
    return saveLogs(content, scriptName, timestamp, logsDir);
  });

  ipcBridge.handle('script-runner:open-folder-picker', async () => {
    const win = mainWindow();
    if (!win) return { canceled: true };

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Script Folder',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const folderPath = result.filePaths[0];
    const validation = validateFolder(folderPath);
    if (!validation.valid) {
      return { canceled: false, valid: false, error: validation.error };
    }
    return { canceled: false, valid: true, ...validation, folderPath };
  });

  ipcBridge.handle('script-runner:validate-dropped-folder', (_event, args) => {
    const { folderPath } = args || {};
    if (!folderPath || typeof folderPath !== 'string') throw new Error(ERROR_MESSAGES.MISSING_FOLDER_PATH);
    return validateFolder(folderPath);
  });

  ipcBridge.handle('script-runner:import-script', (_event, args) => {
    const { folderPath, mainScript } = args || {};
    if (!folderPath || typeof folderPath !== 'string') throw new Error(ERROR_MESSAGES.MISSING_FOLDER_PATH);
    return importScriptFolder(folderPath, scriptsDir);
  });

  ipcBridge.handle('script-runner:remove-script', (_event, args) => {
    const { scriptId } = args || {};
    if (!scriptId || typeof scriptId !== 'string') throw new Error(ERROR_MESSAGES.MISSING_SCRIPT_ID);
    return removeScriptFolder(scriptId, scriptsDir);
  });
}

function teardown() {
  if (executor) {
    executor.killAll();
    executor = null;
  }
  _send = null;
}

module.exports = { setup, teardown };
