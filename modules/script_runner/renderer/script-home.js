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

    // Show all variant language badges
    const variants = script.variants || [];
    if (variants.length > 1) {
      const badges = document.createElement('div');
      badges.className = 'variant-badges';
      for (const v of variants) {
        const badge = document.createElement('span');
        badge.className = 'script-language';
        badge.textContent = v.language;
        badges.appendChild(badge);
      }
      header.appendChild(badges);
    } else {
      const lang = document.createElement('span');
      lang.className = 'script-language';
      lang.textContent = script.language;
      header.appendChild(lang);
    }

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
    removeBtn.className = 'btn btn-danger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRemoveScript(script);
    });
    footer.appendChild(removeBtn);

    card.appendChild(footer);
    return card;
  }

  // --- Variant Picker Dialog ---

  function showVariantPicker(script) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'dialog-overlay';

      const dialog = document.createElement('div');
      dialog.className = 'dialog';

      const title = document.createElement('h3');
      title.className = 'dialog-title';
      title.textContent = `Run: ${script.name}`;
      dialog.appendChild(title);

      const desc = document.createElement('p');
      desc.className = 'dialog-description';
      desc.textContent = 'Choose which variant to run:';
      dialog.appendChild(desc);

      const list = document.createElement('div');
      list.className = 'dialog-list';

      for (const variant of script.variants) {
        const item = document.createElement('button');
        item.className = 'dialog-list-item';
        item.textContent = variant.label;
        item.addEventListener('click', () => {
          overlay.remove();
          resolve(variant);
        });
        list.appendChild(item);
      }

      dialog.appendChild(list);

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        overlay.remove();
        resolve(null);
      });
      dialog.appendChild(cancelBtn);

      overlay.appendChild(dialog);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
          resolve(null);
        }
      });

      document.body.appendChild(overlay);
    });
  }

  // --- Actions ---

  async function handleRunScript(script) {
    const variants = script.variants || [];

    let chosen;
    if (variants.length > 1) {
      chosen = await showVariantPicker(script);
      if (!chosen) return; // cancelled
    } else if (variants.length === 1) {
      chosen = variants[0];
    } else {
      chosen = { scriptPath: script.scriptPath, label: script.language };
    }

    globalThis.tabManager.createTab('script-execution', `${script.name} (${chosen.label})`, {
      scriptPath: chosen.scriptPath,
      scriptName: script.name,
      scriptEnv: chosen.env || {},
    });
  }

  async function handleRemoveScript(script) {
    try {
      const result = await globalThis.api.invoke('script-runner:remove-script', { scriptId: script.folder });
      if (result.success) {
        globalThis.ui.showNotification(result.message, 'success');
        // Re-render the script-home tab to reflect removal
        const activeId = globalThis.tabManager.getActiveTabId();
        const activeTab = globalThis.tabManager.getTab(activeId);
        if (activeTab?.type === 'script-home') {
          render(activeTab, document.getElementById('tab-content'));
        }
      } else {
        globalThis.ui.showNotification(result.message || 'Failed to remove script', 'error');
      }
    } catch {
      globalThis.ui.showNotification('Failed to remove script', 'error');
    }
  }

  // --- Import Zone ---

  function createImportZoneElement() {
    const zone = document.createElement('div');
    zone.className = 'import-zone import-zone-header';
    zone.setAttribute('role', 'region');
    zone.setAttribute('aria-label', 'Import scripts');

    const label = document.createElement('p');
    label.className = 'import-label';
    label.textContent = 'Add scripts with Browse';
    zone.appendChild(label);

    const browseBtn = document.createElement('button');
    browseBtn.className = 'btn btn-secondary btn-sm';
    browseBtn.textContent = 'Browse\u2026';
    browseBtn.addEventListener('click', handleBrowse);
    zone.appendChild(browseBtn);

    // Drag & drop
    zone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add('import-zone-active');
    });
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add('import-zone-active');
    });
    zone.addEventListener('dragleave', (e) => {
      // Only remove active if leaving the zone completely
      if (e.target === zone) {
        zone.classList.remove('import-zone-active');
      }
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('import-zone-active');
      handleDrop(e);
    });

    return zone;
  }

  async function handleBrowse() {
    try {
      const result = await globalThis.api.invoke('script-runner:open-folder-picker');
      if (result.canceled) return;
      if (!result.valid) {
        globalThis.ui.showNotification(result.error || 'Invalid folder', 'error');
        return;
      }
      await doImport(result.folderPath);
    } catch {
      globalThis.ui.showNotification('Failed to open folder picker', 'error');
    }
  }

  async function handleDrop(e) {
    // When a drop is detected, use the folder picker to select it
    // (Electron security prevents accessing .path from drop events)
    try {
      const result = await globalThis.api.invoke('script-runner:open-folder-picker');
      if (result.canceled) return;
      if (!result.valid) {
        globalThis.ui.showNotification(result.error || 'Invalid folder', 'error');
        return;
      }
      await doImport(result.folderPath);
    } catch (err) {
      globalThis.ui.showNotification('Failed to import folder', 'error');
      console.error('[script-home] Drop handling error:', err);
    }
  }

  async function doImport(folderPath) {
    try {
      const result = await globalThis.api.invoke('script-runner:import-script', { folderPath });
      if (result.success) {
        globalThis.ui.showNotification(result.message, 'success');
        // Re-render
        const activeId = globalThis.tabManager.getActiveTabId();
        const activeTab = globalThis.tabManager.getTab(activeId);
        if (activeTab?.type === 'script-home') {
          render(activeTab, document.getElementById('tab-content'));
        }
      } else {
        globalThis.ui.showNotification(result.message || 'Import failed', 'error');
      }
    } catch {
      globalThis.ui.showNotification('Failed to import script folder', 'error');
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

    // Create import zone and add to header
    const importZone = createImportZoneElement();
    header.appendChild(importZone);

    wrapper.appendChild(header);

    // Load scripts
    let scripts = [];
    try {
      scripts = await globalThis.api.invoke('script-runner:get-scripts');
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

    container.appendChild(wrapper);
  }

  return { render };
})();

// NOTE: TabManager registration is handled by script-app.js (ScriptApp component).
// This file (script-home.js) is kept for backward compatibility and helper functions.
// The new architecture uses ScriptApp (with TopicList sidebar + ScriptBrowser) as the main component.
