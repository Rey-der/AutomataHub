/**
 * Script Runner — Execution Handler
 * Handles script execution, queue status, log saving, and workflow chaining.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { resolveExecutionOrder } = require('../core/dependency-resolver');

function register(ipcBridge, { executor, store, send, paths, ensureDir, ERROR_MESSAGES, persistence }) {
  // Temp files written for per-run script overrides; cleaned up after completion
  const pendingCleanup = new Map();

  // Active workflow chains keyed by tabId
  const activeChains = new Map();
  // Chains being cancelled — stop handler sets this so the general complete
  // listener doesn't forward a raw completion while _runChain is still running.
  const cancellingChains = new Set();

  // Forward executor events to renderer
  executor.on('output', (data) => send('script-runner:output', data));
  executor.on('error', (data) => send('script-runner:error', data));
  executor.on('retry', (data) => send('script-runner:retry', data));
  executor.on('complete', (data) => {
    if (pendingCleanup.has(data.tabId)) {
      try { fs.unlinkSync(pendingCleanup.get(data.tabId)); } catch { /* ignore */ }
      pendingCleanup.delete(data.tabId);
    }

    // If this tab has an active chain, don't forward completion to renderer —
    // the chain handler manages its own complete events.
    if (activeChains.has(data.tabId) || cancellingChains.has(data.tabId)) return;

    send('script-runner:complete', data);
  });
  executor.on('queue-status', (data) => send('script-runner:queue-status', data));

  // --- Workflow chain helpers ---

  function _executeAndWait(scriptObj, tabId) {
    return new Promise((resolve) => {
      const onComplete = (data) => {
        if (data.tabId === tabId) {
          executor.removeListener('complete', onComplete);
          resolve(data);
        }
      };
      executor.on('complete', onComplete);
      executor.execute({
        scriptPath: scriptObj.scriptPath,
        name: scriptObj.name,
        tabId,
        env: scriptObj.env || {},
        retries: scriptObj.retries || 0,
        retryDelayMs: scriptObj.retryDelayMs || 3000,
      });
    });
  }

  async function _runChain(chainScripts, tabId) {
    const chainId = crypto.randomUUID();
    const total = chainScripts.length;
    activeChains.set(tabId, chainId);
    let totalRuntime = 0;

    send('script-runner:chain-progress', {
      tabId, chainId, step: 0, total,
      status: 'started',
      scriptNames: chainScripts.map((s) => s.name),
      timestamp: new Date().toISOString(),
    });

    for (let i = 0; i < total; i++) {
      // If chain was cancelled (e.g. user stopped), bail out
      if (!activeChains.has(tabId)) {
        cancellingChains.delete(tabId);
        return;
      }

      const script = chainScripts[i];

      send('script-runner:chain-progress', {
        tabId, chainId, step: i + 1, total,
        scriptName: script.name,
        status: 'running',
        timestamp: new Date().toISOString(),
      });

      const result = await _executeAndWait(script, tabId);
      totalRuntime += result.runtime || 0;

      // Re-check after await: chain may have been cancelled during execution
      if (!activeChains.has(tabId)) {
        cancellingChains.delete(tabId);
        for (let j = i + 1; j < total; j++) {
          send('script-runner:chain-skip', {
            tabId, chainId, step: j + 1, total,
            scriptName: chainScripts[j].name,
            reason: 'chain stopped by user',
            timestamp: new Date().toISOString(),
          });
        }
        send('script-runner:complete', {
          tabId,
          exitCode: 1,
          signal: result.signal || 'SIGTERM',
          runtime: totalRuntime,
          chainFailed: true,
          chainStep: i + 1,
          chainTotal: total,
        });
        return;
      }

      if (result.exitCode !== 0) {
        send('script-runner:chain-progress', {
          tabId, chainId, step: i + 1, total,
          scriptName: script.name,
          status: 'failed',
          exitCode: result.exitCode,
          runtime: result.runtime,
          timestamp: new Date().toISOString(),
        });

        // Skip remaining downstream scripts
        for (let j = i + 1; j < total; j++) {
          send('script-runner:chain-skip', {
            tabId, chainId, step: j + 1, total,
            scriptName: chainScripts[j].name,
            reason: `dependency "${script.name}" failed`,
            timestamp: new Date().toISOString(),
          });
        }

        activeChains.delete(tabId);
        send('script-runner:complete', {
          tabId,
          exitCode: result.exitCode,
          signal: null,
          runtime: totalRuntime,
          chainFailed: true,
          chainStep: i + 1,
          chainTotal: total,
        });
        return;
      }

      send('script-runner:chain-progress', {
        tabId, chainId, step: i + 1, total,
        scriptName: script.name,
        status: 'completed',
        exitCode: 0,
        runtime: result.runtime,
        timestamp: new Date().toISOString(),
      });
    }

    activeChains.delete(tabId);
    send('script-runner:complete', {
      tabId,
      exitCode: 0,
      signal: null,
      runtime: totalRuntime,
      chainComplete: true,
      chainTotal: total,
    });
  }

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

      // Look up script config from store using folder name as script ID
      const scriptId = path.basename(path.dirname(scriptPath));
      const stored = store.getScript(scriptId);
      const retries = stored?.retries || 0;
      const retryDelayMs = stored?.retryDelayMs || 3000;
      const dependsOn = stored?.dependsOn || [];

      // Script versioning: hash the original script file and record it
      if (persistence) {
        try {
          const hashSource = scriptContent || fs.readFileSync(scriptPath, 'utf-8');
          const hash = crypto.createHash('sha256').update(hashSource).digest('hex');
          persistence.saveScriptHash(scriptId, hash);
        } catch { /* non-critical — skip if file unreadable */ }
      }

      // If the script has dependencies, resolve and run the full chain
      if (dependsOn.length > 0) {
        try {
          const orderedIds = resolveExecutionOrder(scriptId, (id) => store.getScript(id));

          // Only chain if there are actual dependencies (more than just the target)
          if (orderedIds.length > 1) {
            const chainScripts = orderedIds.map((id) => {
              const s = store.getScript(id);
              return {
                id,
                name: s.name,
                scriptPath: id === scriptId ? effectivePath : s.scriptPath,
                env: id === scriptId ? perScriptEnv : (s.variants?.[0]?.env || {}),
                retries: s.retries || 0,
                retryDelayMs: s.retryDelayMs || 3000,
              };
            });

            _runChain(chainScripts, tabId);
            return { success: true, chain: true, steps: chainScripts.length };
          }
        } catch (err) {
          console.error('[script-runner] Dependency resolution failed:', err.message);
          return { success: false, error: err.message };
        }
      }

      executor.execute({ scriptPath: effectivePath, name: scriptName || path.basename(scriptPath), tabId, env: perScriptEnv, retries, retryDelayMs });
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

      // Cancel active chain so remaining steps are not executed.
      // Add to cancellingChains so the general complete listener doesn't
      // forward a raw completion — _runChain will send its own.
      if (activeChains.has(tabId)) {
        cancellingChains.add(tabId);
        activeChains.delete(tabId);
      }

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
      const datePart = now.toISOString().replaceAll('T', '_').replaceAll(':', '-').replaceAll(/\..+/g, '');
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
