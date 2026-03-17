/**
 * Module Bootstrap — loads module renderer scripts dynamically.
 * Runs after core scripts (ui.js, tab-manager.js, home-tab.js) are loaded.
 *
 * Flow:
 * 1. Init allowed channels from main process
 * 2. Fetch module list from main process
 * 3. Load each module's renderer scripts
 * 4. Boot the tab manager (show home)
 */

function loadStyle(absolutePath) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `file://${absolutePath}`;
  link.onerror = () => {
    console.warn(`[bootstrap] Failed to load style: ${absolutePath}`);
  };
  document.head.appendChild(link);
}

function loadScript(absolutePath) {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = `file://${absolutePath}`;
    script.onload = resolve;
    script.onerror = () => {
      console.warn(`[bootstrap] Failed to load script: ${absolutePath}`);
      resolve(); // Don't block other modules
    };
    document.body.appendChild(script);
  });
}

// Wait for DOM
if (document.readyState === 'loading') {
  await new Promise((r) => document.addEventListener('DOMContentLoaded', r));
}

try {
  // 1. Initialize dynamic IPC channels
  await globalThis.api.initChannels();

  // 2. Fetch modules
  const modules = await globalThis.api.getModules();
  globalThis._hub = globalThis._hub || {};
  globalThis._hub.modules = modules;

  // 3. Load renderer styles and scripts for each module
  for (const mod of modules) {
    // Load styles first so they're available when scripts render
    if (Array.isArray(mod.rendererStyles)) {
      for (const stylePath of mod.rendererStyles) {
        loadStyle(stylePath);
      }
    }

    // Load scripts sequentially to respect order
    if (Array.isArray(mod.rendererScripts)) {
      for (const scriptPath of mod.rendererScripts) {
        await loadScript(scriptPath);
      }
    }
  }
} catch (err) {
  console.error('[bootstrap] Failed to load modules:', err);
}

// 4. Boot tab manager and show home
globalThis.tabManager = new TabManager();
globalThis.tabManager.switchTab('home');

// 5. Auto-start modules with autoStart preference
// Use setTimeout to let module renderer scripts finish registering their tab types
setTimeout(async () => {
  try {
    const prefs = await globalThis.api.getPrefs();
    const modulePrefs = prefs?.modules || {};

    for (const mod of (globalThis._hub?.modules || [])) {
      if (modulePrefs[mod.id]?.autoStart) {
        if (mod.tabTypes?.length > 0) {
          const typeId = mod.tabTypes[0].id || mod.tabTypes[0];
          if (globalThis.tabManager.hasTabType(typeId)) {
            globalThis.tabManager.createTab(typeId, mod.name, { moduleId: mod.id }, { target: 'main', reuseKey: `autostart-${mod.id}`, background: true });
          }
        }
      }
    }
  } catch (err) {
    console.error('[bootstrap] Failed to auto-start modules:', err);
  }
}, 50);
