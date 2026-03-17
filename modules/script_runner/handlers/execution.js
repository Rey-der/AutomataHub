/**
 * Script Runner — Execution Handler
 * Handles script execution, queue status, and log saving.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

function register(ipcBridge, { executor, send, paths, ensureDir, ERROR_MESSAGES }) {
  // Temp files written for per-run script overrides; cleaned up after completion
  const pendingCleanup = new Map();

  // Forward executor events to renderer
  executor.on('output', (data) => send('script-runner:output', data));
  executor.on('error', (data) => send('script-runner:error', data));
  executor.on('complete', (data) => {
    if (pendingCleanup.has(data.tabId)) {
      try { fs.unlinkSync(pendingCleanup.get(data.tabId)); } catch { /* ignore */ }
      pendingCleanup.delete(data.tabId);
    }
    send('script-runner:complete', data);
  });
  executor.on('queue-status', (data) => send('script-runner:queue-status', data));

  ipcBridge.handle('script-runner:run-script', (_event, args) => {
    try {
      const { scriptPath, scriptName, tabId, scriptEnv: perScriptEnv, scriptContent } = args || {};
      if (!scriptPath || typeof scriptPath !== 'string') throw new Error('Missing scriptPath');
      if (!tabId || typeof tabId !== 'string') throw new Error('Missing tabId');

      let effectivePath = scriptPath;
      if (scriptContent && typeof scriptContent === 'string') {
        // Write edited content next to the original (inside scriptsDir so resolveInside passes)
        const ext = path.extname(scriptPath);
        const tmpFile = path.join(path.dirname(scriptPath), `_tmp_run_${Date.now()}${ext}`);
        fs.writeFileSync(tmpFile, scriptContent, 'utf-8');
        effectivePath = tmpFile;
        pendingCleanup.set(tabId, tmpFile);
      }

      executor.execute({ scriptPath: effectivePath, name: scriptName || path.basename(scriptPath), tabId, env: perScriptEnv });
      return { success: true };
    } catch (err) {
      console.error('[script-runner] run-script error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcBridge.handle('script-runner:stop-script', (_event, args) => {
    try {
      const { tabId } = args || {};
      if (!tabId || typeof tabId !== 'string') throw new Error('Missing tabId');
      executor.stop(tabId);
      return { success: true };
    } catch (err) {
      console.error('[script-runner] stop-script error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcBridge.handle('script-runner:clear-terminal', (_event, _args) => {
    // Terminal state is renderer-side, this is an ack
    return { success: true };
  });

  ipcBridge.handle('script-runner:read-script', (_event, args) => {
    try {
      const { scriptPath } = args || {};
      if (!scriptPath || typeof scriptPath !== 'string') throw new Error('Missing scriptPath');
      const content = fs.readFileSync(scriptPath, 'utf-8');
      return { success: true, content };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcBridge.handle('script-runner:save-logs', (_event, args) => {
    try {
      const { content, scriptName } = args || {};
      if (!content || typeof content !== 'string') throw new Error('Missing content');

      const logsDir = path.join(paths.root, 'logs');
      ensureDir(logsDir);

      const now = new Date();
      const datePart = now.toISOString().replaceAll(/T/g, '_').replaceAll(/:/g, '-').replaceAll(/\..+/g, '');
      const safeName = String(scriptName || 'log').replaceAll(/[^a-z0-9_-]/gi, '_');
      const fileName = `${safeName}_${datePart}.txt`;
      const filePath = path.join(logsDir, fileName);

      fs.writeFileSync(filePath, content, 'utf-8');
      console.log('[script-runner] Logs saved:', fileName);

      return {
        success: true,
        message: `Logs saved: ${fileName}`,
        path: filePath,
      };
    } catch (err) {
      console.error('[script-runner] save-logs error:', err.message);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { register };
