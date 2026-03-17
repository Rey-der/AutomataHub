/**
 * Script Runner — Scripts Handler
 * Handles script discovery, import, and removal.
 */

const path = require('path');
const fs = require('fs');
const { dialog } = require('electron');

const EXECUTABLE_EXTENSIONS = ['.sh', '.bash', '.py', '.py3', '.js', '.mjs', '.rb', '.pl', '.csx', '.cs'];
const IGNORED_ENTRIES = new Set(['.DS_Store', 'Thumbs.db', '.git', 'node_modules', '__pycache__', '.idea', '.vscode']);

const EXTENSION_LANGUAGE_MAP = {
  '.sh': 'Bash',
  '.bash': 'Bash',
  '.py': 'Python',
  '.py3': 'Python',
  '.js': 'JS',
  '.mjs': 'JS',
  '.rb': 'Ruby',
  '.pl': 'Perl',
  '.csx': 'C# Script',
  '.cs': 'C#',
};

function register(ipcBridge, { store, emit, send, mainWindow, paths, resolveInside, ensureDir, readJsonConfig, ERROR_MESSAGES }) {
  // --- Script Discovery ---

  function discoverVariants(folderPath, folderName) {
    const variants = [];
    const configPath = path.join(folderPath, 'config.json');
    const meta = readJsonConfig(configPath, () => {
      console.warn(`[script-runner] Malformed config in ${folderName}`);
    });

    const parentEnv = meta.env || {};
    const files = fs.readdirSync(folderPath);
    const executables = files.filter((f) => EXECUTABLE_EXTENSIONS.includes(path.extname(f).toLowerCase()));

    if (executables.length > 0) {
      const mainScript = meta.mainScript || meta.main || executables[0];
      const mainPath = path.join(folderPath, mainScript);
      if (fs.existsSync(mainPath)) {
        const ext = path.extname(mainScript).toLowerCase();
        variants.push({
          label: EXTENSION_LANGUAGE_MAP[ext] || 'Unknown',
          language: EXTENSION_LANGUAGE_MAP[ext] || 'Unknown',
          mainScript,
          scriptPath: mainPath,
          env: parentEnv,
        });
      }
    }

    // Scan subfolders for variants
    const subEntries = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const sub of subEntries) {
      if (!sub.isDirectory()) continue;
      if (IGNORED_ENTRIES.has(sub.name)) continue;

      const subPath = path.join(folderPath, sub.name);
      const subConfig = path.join(subPath, 'config.json');
      const subMeta = readJsonConfig(subConfig, () => {});

      const subFiles = fs.readdirSync(subPath);
      const subExecs = subFiles.filter((f) => EXECUTABLE_EXTENSIONS.includes(path.extname(f).toLowerCase()));
      if (subExecs.length === 0) continue;

      const subMain = subMeta.main || subMeta.mainScript || subExecs[0];
      const subMainPath = path.join(subPath, subMain);
      if (!fs.existsSync(subMainPath)) continue;

      const ext = path.extname(subMain).toLowerCase();
      variants.push({
        label: subMeta.name || EXTENSION_LANGUAGE_MAP[ext] || sub.name,
        language: EXTENSION_LANGUAGE_MAP[ext] || 'Unknown',
        mainScript: subMain,
        scriptPath: subMainPath,
        env: { ...parentEnv, ...(subMeta.env || {}) },
      });
    }

    return { meta, variants };
  }

  function getAvailableScripts(scriptsDir) {
    ensureDir(scriptsDir);
    const entries = fs.readdirSync(scriptsDir, { withFileTypes: true });
    const scripts = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (IGNORED_ENTRIES.has(entry.name)) continue;

      const folderPath = path.join(scriptsDir, entry.name);
      const { meta, variants } = discoverVariants(folderPath, entry.name);

      if (variants.length === 0) continue;

      const primary = variants[0];
      const scriptId = entry.name; // Use folder name as script ID

      let existing = store.getScript(scriptId);
      if (!existing) {
        existing = store.addScript({
          id: scriptId,
          folder: entry.name,
          name: meta.name || entry.name,
          description: meta.description || '',
          language: primary.language,
          mainScript: primary.mainScript,
          scriptPath: primary.scriptPath,
          executables: variants.map((v) => v.mainScript),
          variants,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      scripts.push(existing);
    }

    return scripts;
  }

  // --- Folder Validation ---

  function validateFolder(folderPath) {
    if (!fs.existsSync(folderPath)) return { valid: false, error: 'Folder not found' };
    const stat = fs.statSync(folderPath);
    if (!stat.isDirectory()) return { valid: false, error: 'Not a directory' };
    if (IGNORED_ENTRIES.has(path.basename(folderPath))) return { valid: false, error: 'Ignored folder' };

    const files = fs.readdirSync(folderPath);
    const executables = files.filter((f) => EXECUTABLE_EXTENSIONS.includes(path.extname(f).toLowerCase()));
    if (executables.length === 0) return { valid: false, error: 'No executables found' };

    return { valid: true, executables, name: path.basename(folderPath) };
  }

  // --- Import/Remove ---

  function importScriptFolder(sourcePath, scriptsDir) {
    const folderName = path.basename(sourcePath);
    const destPath = path.join(scriptsDir, folderName);

    if (fs.existsSync(destPath)) {
      return { success: false, message: `Script folder "${folderName}" already exists` };
    }

    try {
      fs.cpSync(sourcePath, destPath, { recursive: true });
      return { success: true, message: `Imported "${folderName}" successfully` };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  function removeScriptFolder(scriptId, scriptsDir) {
    const folderPath = path.join(scriptsDir, scriptId);

    try {
      resolveInside(folderPath, scriptsDir);
    } catch {
      return { success: false, message: 'Cannot remove folders outside scripts directory' };
    }

    try {
      fs.rmSync(folderPath, { recursive: true, force: true });
      store.removeScript(scriptId);
      return { success: true, message: `Removed "${scriptId}" successfully` };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // --- IPC Handlers ---

  ipcBridge.handle('script-runner:get-scripts', async (_e, args) => {
    try {
      const scriptsDir = path.join(paths.root, 'modules', 'script_runner', 'automation_scripts');
      const scripts = getAvailableScripts(scriptsDir);

      // Filter by topic if requested
      if (args?.topic_id) {
        const topicScripts = store.getTopicScripts(args.topic_id);
        return { scripts: topicScripts };
      }

      return { scripts };
    } catch (err) {
      console.error('[script-runner] get-scripts error:', err.message);
      return { error: err.message };
    }
  });

  ipcBridge.handle('script-runner:open-folder-picker', async (_e, _args) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select a script folder to import',
      });

      if (result.canceled) return { canceled: true };

      const folderPath = result.filePaths[0];
      const validation = validateFolder(folderPath);

      if (!validation.valid) return { valid: false, error: validation.error };

      return {
        valid: true,
        folderPath,
        folderName: validation.name,
        executables: validation.executables,
      };
    } catch (err) {
      console.error('[script-runner] folder-picker error:', err.message);
      return { error: err.message };
    }
  });

  ipcBridge.handle('script-runner:validate-dropped-folder', async (_e, args) => {
    try {
      const { folderPath } = args || {};
      if (!folderPath) return { valid: false, error: 'No folder path provided' };

      const validation = validateFolder(folderPath);
      return validation;
    } catch (err) {
      console.error('[script-runner] validate-dropped-folder error:', err.message);
      return { valid: false, error: err.message };
    }
  });

  ipcBridge.handle('script-runner:import-script', async (_e, args) => {
    try {
      const { folderPath } = args || {};
      if (!folderPath) return { success: false, message: 'No folder path provided' };

      const scriptsDir = path.join(paths.root, 'modules', 'script_runner', 'automation_scripts');
      const result = importScriptFolder(folderPath, scriptsDir);

      if (result.success) {
        // Discover and add the newly imported script
        const folderName = path.basename(folderPath);
        const newScriptPath = path.join(scriptsDir, folderName);
        const { meta, variants } = discoverVariants(newScriptPath, folderName);
        if (variants.length > 0) {
          const scripts = getAvailableScripts(scriptsDir);
          emit('script-runner:scripts-updated', { scripts });
        }
      }

      return result;
    } catch (err) {
      console.error('[script-runner] import-script error:', err.message);
      return { success: false, message: err.message };
    }
  });

  ipcBridge.handle('script-runner:remove-script', async (_e, args) => {
    try {
      const { script_id } = args || {};
      if (!script_id) return { success: false, message: 'No script_id provided' };

      const scriptsDir = path.join(paths.root, 'modules', 'script_runner', 'automation_scripts');
      const result = removeScriptFolder(script_id, scriptsDir);

      if (result.success) {
        const scripts = getAvailableScripts(scriptsDir);
        emit('script-runner:scripts-updated', { scripts });
      }

      return result;
    } catch (err) {
      console.error('[script-runner] remove-script error:', err.message);
      return { success: false, message: err.message };
    }
  });
}

module.exports = { register };
