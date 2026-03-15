/**
 * Script Runner — script-home tab renderer.
 * Shows the list of discovered scripts and an import zone.
 * Registers the "script-home" tab type with TabManager.
 */

const ScriptHome = (() => {

  // --- Script Card ---

  function createScriptCard(script) {
    const card = document.createElement('div');
    card.className = 'script-card';
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'article');
    card.setAttribute('aria-label', `Script: ${script.name}`);

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleRunScript(script);
      }
    });

    const header = document.createElement('div');
    header.className = 'card-header';

    const name = document.createElement('h3');
    name.className = 'script-name';
    name.textContent = script.name;
    header.appendChild(name);

    const lang = document.createElement('span');
    lang.className = 'script-language';
    lang.textContent = script.language;
    header.appendChild(lang);

    card.appendChild(header);

    const desc = document.createElement('p');
    desc.className = 'script-description';
    desc.textContent = script.description || 'No description available';
    card.appendChild(desc);

    const footer = document.createElement('div');
    footer.className = 'card-footer';

    const runBtn = document.createElement('button');
    runBtn.className = 'btn';
    runBtn.textContent = '\u25B6 Run';
    runBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRunScript(script);
    });
    footer.appendChild(runBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger btn-sm';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRemoveScript(script);
    });
    footer.appendChild(removeBtn);

    card.appendChild(footer);
    return card;
  }

  // --- Actions ---

  function handleRunScript(script) {
    const tab = window.tabManager.createTab('script-execution', script.name, {
      scriptPath: script.scriptPath,
      scriptName: script.name,
    });
    // Tab render handles the rest
  }

  async function handleRemoveScript(script) {
    try {
      const result = await window.api.invoke('script-runner:remove-script', { scriptId: script.folder });
      if (result.success) {
        window.ui.showNotification(result.message, 'success');
        // Re-render the script-home tab to reflect removal
        const activeId = window.tabManager.getActiveTabId();
        const activeTab = window.tabManager.getTab(activeId);
        if (activeTab && activeTab.type === 'script-home') {
          render(activeTab, document.getElementById('tab-content'));
        }
      } else {
        window.ui.showNotification(result.message || 'Failed to remove script', 'error');
      }
    } catch (err) {
      window.ui.showNotification('Failed to remove script', 'error');
    }
  }

  // --- Import Zone ---

  function createImportZone(container) {
    const zone = document.createElement('div');
    zone.className = 'import-zone';
    zone.setAttribute('role', 'region');
    zone.setAttribute('aria-label', 'Import scripts');

    const label = document.createElement('p');
    label.className = 'import-label';
    label.textContent = 'Drag a script folder here or click to browse';
    zone.appendChild(label);

    const browseBtn = document.createElement('button');
    browseBtn.className = 'btn btn-secondary';
    browseBtn.textContent = 'Browse\u2026';
    browseBtn.addEventListener('click', handleBrowse);
    zone.appendChild(browseBtn);

    // Drag & drop
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('import-zone-active');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('import-zone-active');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('import-zone-active');
      handleDrop(e);
    });

    container.appendChild(zone);
  }

  async function handleBrowse() {
    try {
      const result = await window.api.invoke('script-runner:open-folder-picker');
      if (result.canceled) return;
      if (!result.valid) {
        window.ui.showNotification(result.error || 'Invalid folder', 'error');
        return;
      }
      await doImport(result.folderPath);
    } catch (err) {
      window.ui.showNotification('Failed to open folder picker', 'error');
    }
  }

  async function handleDrop(e) {
    const items = e.dataTransfer && e.dataTransfer.files;
    if (!items || items.length === 0) return;

    const folderPath = items[0].path;
    if (!folderPath) return;

    try {
      const validation = await window.api.invoke('script-runner:validate-dropped-folder', { folderPath });
      if (!validation.valid) {
        window.ui.showNotification(validation.error || 'Invalid folder', 'error');
        return;
      }
      await doImport(folderPath);
    } catch (err) {
      window.ui.showNotification('Invalid folder', 'error');
    }
  }

  async function doImport(folderPath) {
    try {
      const result = await window.api.invoke('script-runner:import-script', { folderPath });
      if (result.success) {
        window.ui.showNotification(result.message, 'success');
        // Re-render
        const activeId = window.tabManager.getActiveTabId();
        const activeTab = window.tabManager.getTab(activeId);
        if (activeTab && activeTab.type === 'script-home') {
          render(activeTab, document.getElementById('tab-content'));
        }
      } else {
        window.ui.showNotification(result.message || 'Import failed', 'error');
      }
    } catch (err) {
      window.ui.showNotification('Failed to import script folder', 'error');
    }
  }

  // --- Empty State ---

  function renderEmpty(container) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';

    const icon = document.createElement('div');
    icon.className = 'empty-state-icon';
    icon.textContent = '\uD83D\uDCDC';
    empty.appendChild(icon);

    const msg = document.createElement('p');
    msg.textContent = 'No scripts found';
    empty.appendChild(msg);

    const hint = document.createElement('small');
    hint.textContent = 'Import a script folder or drop one onto the import zone below.';
    empty.appendChild(hint);

    container.appendChild(empty);
  }

  // --- Render ---

  async function render(tab, container) {
    if (!container) return;
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'home-tab';

    const header = document.createElement('div');
    header.className = 'home-header';

    const headerText = document.createElement('div');
    headerText.className = 'home-header-text';

    const h1 = document.createElement('h1');
    h1.textContent = 'Script Runner';
    headerText.appendChild(h1);

    const subtitle = document.createElement('p');
    subtitle.className = 'subtitle';
    subtitle.textContent = 'Manage and execute local automation scripts';
    headerText.appendChild(subtitle);

    header.appendChild(headerText);
    wrapper.appendChild(header);

    // Load scripts
    let scripts = [];
    try {
      scripts = await window.api.invoke('script-runner:get-scripts');
    } catch (err) {
      console.error('[script-home] Failed to load scripts:', err);
    }

    if (scripts.length === 0) {
      renderEmpty(wrapper);
    } else {
      const grid = document.createElement('div');
      grid.className = 'scripts-grid';
      for (const script of scripts) {
        grid.appendChild(createScriptCard(script));
      }
      wrapper.appendChild(grid);
    }

    // Import zone
    createImportZone(wrapper);

    container.appendChild(wrapper);
  }

  return { render };
})();

// --- Register with TabManager and Hub ---

(function register() {
  // Wait for tabManager (set by module-bootstrap.js after scripts load)
  function doRegister() {
    if (!window.tabManager) {
      // Retry after a tick if bootstrap hasn't finished
      setTimeout(doRegister, 0);
      return;
    }

    window.tabManager.registerTabType('script-home', {
      render: ScriptHome.render,
      maxTabs: 1,
    });

    // Register a module opener so the hub home tab can open this module
    window._hub = window._hub || {};
    window._hub.moduleOpeners = window._hub.moduleOpeners || {};
    window._hub.moduleOpeners['script-runner'] = () => {
      window.tabManager.createTab('script-home', 'Scripts', {}, { reuseKey: 'script-home' });
    };
  }

  doRegister();
})();
