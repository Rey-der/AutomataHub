const HomeTab = (() => {

  // Track loaded module prefs
  let modulePrefs = {};

  // Filter / sort state
  let filterText = '';
  let filterView = 'all'; // 'all' | 'favorites' | 'autostart'
  let sortMode = 'default'; // 'default' | 'az' | 'za'
  let sidebarCollapsed = false;

  // GitHub prompt state (module-scoped to reduce nesting)
  let promptOpen = false;
  let promptKeyHandler = null;
  let promptLogoRef = null;

  // Crypto-safe random for typing animation
  const randBuf = new Uint32Array(1);
  function cryptoRand() {
    crypto.getRandomValues(randBuf);
    return randBuf[0] / 0x100000000;
  }

  function typingDelay(ch, nextCh) {
    if (ch === ' ') return 95 + cryptoRand() * 60;
    if (nextCh === ' ') return 70 + cryptoRand() * 30;
    return 68 + cryptoRand() * 28;
  }

  // --- Module Card ---

  function createModuleCard(mod) {
    const prefs = modulePrefs[mod.id] || { favorite: false, autoStart: false };

    const card = document.createElement('div');
    card.className = 'script-card';
    card.dataset.moduleId = mod.id;
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'article');
    card.setAttribute('aria-label', `Module: ${mod.name}`);

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleOpenModule(mod);
      }
    });

    const header = document.createElement('div');
    header.className = 'card-header';

    const name = document.createElement('h3');
    name.className = 'script-name';
    name.textContent = mod.name;
    header.appendChild(name);

    const version = document.createElement('span');
    version.className = 'script-language';
    version.textContent = `v${mod.version || '0.0.0'}`;
    header.appendChild(version);

    card.appendChild(header);

    const desc = document.createElement('p');
    desc.className = 'script-description';
    desc.textContent = mod.description || 'No description available';
    card.appendChild(desc);

    const footer = document.createElement('div');
    footer.className = 'card-footer';

    // Preference toggles (bottom-left in footer)
    const toggles = document.createElement('div');
    toggles.className = 'card-toggles';

    const favBtn = document.createElement('button');
    favBtn.className = 'card-toggle toggle-favorite' + (prefs.favorite ? ' active' : '');
    favBtn.setAttribute('aria-label', 'Toggle favorite');
    favBtn.setAttribute('title', 'Favorite');
    favBtn.textContent = prefs.favorite ? '\u2665' : '\u2661';
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(mod.id, favBtn);
    });
    toggles.appendChild(favBtn);

    const autoBtn = document.createElement('button');
    autoBtn.className = 'card-toggle toggle-autostart' + (prefs.autoStart ? ' active' : '');
    autoBtn.setAttribute('aria-label', 'Toggle auto-start');
    autoBtn.setAttribute('title', 'Auto-start');
    autoBtn.textContent = prefs.autoStart ? '\u2605' : '\u2606';
    autoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleAutoStart(mod.id, autoBtn);
    });
    toggles.appendChild(autoBtn);

    footer.appendChild(toggles);

    const openBtn = document.createElement('button');
    openBtn.className = 'btn';
    openBtn.textContent = 'Open';
    openBtn.addEventListener('click', () => handleOpenModule(mod));
    footer.appendChild(openBtn);

    card.appendChild(footer);
    return card;
  }

  function handleOpenModule(mod) {
    if (!mod.tabTypes?.length) return;

    const defaultType = mod.tabTypes[0];
    const typeId = defaultType.id || defaultType;

    // Try module-specific opener first
    if (globalThis._hub?.moduleOpeners?.[mod.id]) {
      try {
        globalThis._hub.moduleOpeners[mod.id](mod);
        return;
      } catch (err) {
        console.error(`[home] Module opener for "${mod.id}" failed:`, err);
        // Fall through to generic tab creation
      }
    }

    // Reuse existing tab if one is already open
    const existing = globalThis.tabManager.getTabsByType(typeId);
    if (existing.length > 0) {
      globalThis.tabManager.switchTab(existing[0].id);
      return;
    }

    if (globalThis.tabManager.hasTabType(typeId)) {
      globalThis.tabManager.createTab(typeId, mod.name, { moduleId: mod.id }, { target: 'module' });
    }
  }

  // --- Toggle Handlers ---

  async function toggleFavorite(moduleId, btn) {
    const current = modulePrefs[moduleId] || { favorite: false, autoStart: false };
    const newVal = !current.favorite;
    modulePrefs[moduleId] = { ...current, favorite: newVal };
    await globalThis.api.setModulePrefs(moduleId, { favorite: newVal });

    btn.classList.toggle('active', newVal);
    btn.textContent = newVal ? '\u2665' : '\u2661';

    updateSidebarCounts();
    updateModuleGrid();
  }

  async function toggleAutoStart(moduleId, btn) {
    const current = modulePrefs[moduleId] || { favorite: false, autoStart: false };
    const newVal = !current.autoStart;
    modulePrefs[moduleId] = { ...current, autoStart: newVal };
    await globalThis.api.setModulePrefs(moduleId, { autoStart: newVal });

    btn.classList.toggle('active', newVal);
    btn.textContent = newVal ? '\u2605' : '\u2606';

    updateSidebarCounts();
    updateModuleGrid();
  }

  // --- Filtering & Sorting ---

  function getFilteredModules() {
    let modules = globalThis._hub?.modules || [];

    // View filter
    if (filterView === 'favorites') {
      modules = modules.filter(m => modulePrefs[m.id]?.favorite);
    } else if (filterView === 'autostart') {
      modules = modules.filter(m => modulePrefs[m.id]?.autoStart);
    }

    // Text filter
    if (filterText) {
      const q = filterText.toLowerCase();
      modules = modules.filter(m => {
        const name = (m.name || '').toLowerCase();
        const desc = (m.description || '').toLowerCase();
        return name.includes(q) || desc.includes(q);
      });
    }

    // Sort
    modules = [...modules].sort((a, b) => {
      // Favorites always float to top in 'default' mode
      if (sortMode === 'default') {
        const aFav = modulePrefs[a.id]?.favorite ? 1 : 0;
        const bFav = modulePrefs[b.id]?.favorite ? 1 : 0;
        if (bFav !== aFav) return bFav - aFav;
        return a.name.localeCompare(b.name);
      }
      if (sortMode === 'az') return a.name.localeCompare(b.name);
      if (sortMode === 'za') return b.name.localeCompare(a.name);
      return 0;
    });

    return modules;
  }

  function updateModuleGrid() {
    const grid = document.querySelector('.hub-modules-grid');
    if (!grid) return;

    grid.innerHTML = '';
    const modules = getFilteredModules();

    if (modules.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'hub-empty-state';
      const title = document.createElement('p');
      title.className = 'hub-empty-title';
      title.textContent = filterText || filterView !== 'all' ? 'No modules match' : 'No modules installed';
      empty.appendChild(title);
      const hint = document.createElement('p');
      hint.className = 'hub-empty-hint';
      hint.textContent = filterText || filterView !== 'all'
        ? 'Try a different filter or view.'
        : 'Add modules to the modules/ directory to get started.';
      empty.appendChild(hint);
      grid.appendChild(empty);
    } else {
      for (const mod of modules) {
        grid.appendChild(createModuleCard(mod));
      }
    }
  }

  function updateSidebarCounts() {
    const modules = globalThis._hub?.modules || [];

    const allCount = document.getElementById('hub-count-all');
    const favCount = document.getElementById('hub-count-favorites');
    const autoCount = document.getElementById('hub-count-autostart');

    if (allCount) allCount.textContent = modules.length;
    if (favCount) favCount.textContent = modules.filter(m => modulePrefs[m.id]?.favorite).length;
    if (autoCount) autoCount.textContent = modules.filter(m => modulePrefs[m.id]?.autoStart).length;
  }

  function setActiveNavItem(viewId) {
    filterView = viewId;
    document.querySelectorAll('.hub-sidebar-nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewId);
    });
    updateModuleGrid();
  }

  // --- GitHub Prompt (module-scoped) ---

  function dismissPrompt() {
    const box = document.querySelector('.github-prompt-box');
    if (!box) return;
    box.classList.remove('github-prompt-visible');
    setTimeout(() => box.remove(), 200);
    if (promptKeyHandler) {
      document.removeEventListener('keydown', promptKeyHandler);
      promptKeyHandler = null;
    }
    promptOpen = false;
  }

  function showGitHubPrompt() {
    if (promptOpen) return;
    promptOpen = true;

    const box = document.createElement('div');
    box.className = 'github-prompt-box';

    const body = document.createElement('div');
    body.className = 'github-prompt-body';

    const line1 = document.createElement('div');
    line1.className = 'github-prompt-line';

    const promptSpan = document.createElement('span');
    promptSpan.className = 'github-prompt-prompt';
    promptSpan.textContent = '~';
    line1.appendChild(promptSpan);

    const cmdSpan = document.createElement('span');
    cmdSpan.className = 'github-prompt-cmd';
    line1.appendChild(cmdSpan);
    body.appendChild(line1);

    const line2 = document.createElement('div');
    line2.className = 'github-prompt-line github-prompt-input-line';

    const line2Prompt = document.createElement('span');
    line2Prompt.className = 'github-prompt-prompt';
    line2Prompt.textContent = '~';
    line2.appendChild(line2Prompt);

    const line2Cursor = document.createElement('span');
    line2Cursor.className = 'github-prompt-cursor';
    line2Cursor.textContent = '\u2588';
    line2.appendChild(line2Cursor);

    body.appendChild(line2);
    box.appendChild(body);

    box.addEventListener('mouseleave', () => {
      setTimeout(() => {
        if (promptLogoRef && !promptLogoRef.matches(':hover') && !box.matches(':hover')) {
          dismissPrompt();
        }
      }, 120);
    });

    document.body.appendChild(box);
    requestAnimationFrame(() => box.classList.add('github-prompt-visible'));

    const fullText = ' wanna visit my github? ';
    let i = 0;
    function typeNext() {
      if (i < fullText.length) {
        const ch = fullText[i];
        const nextCh = fullText[i + 1] || '';
        cmdSpan.textContent += ch;
        i++;
        setTimeout(typeNext, typingDelay(ch, nextCh));
      } else {
        const ynSpan = document.createElement('span');
        ynSpan.className = 'github-prompt-yn';
        ynSpan.textContent = '[y/n]';
        cmdSpan.appendChild(ynSpan);
      }
    }
    setTimeout(typeNext, 820);

    promptKeyHandler = function(e) {
      if (e.key === 'y' || e.key === 'Y') {
        globalThis.api.openExternalUrl('https://github.com/Rey-der');
        dismissPrompt();
      } else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') {
        dismissPrompt();
      }
    };
    document.addEventListener('keydown', promptKeyHandler);
  }

  // --- Sidebar Builder ---

  function createSidebar(modules) {
    const sidebar = document.createElement('aside');
    sidebar.className = 'hub-sidebar' + (sidebarCollapsed ? ' collapsed' : '');

    // Header
    const sidebarHeader = document.createElement('div');
    sidebarHeader.className = 'hub-sidebar-header';

    const sidebarTitle = document.createElement('span');
    sidebarTitle.className = 'hub-sidebar-title';
    sidebarTitle.textContent = 'AutomataHub';
    sidebarHeader.appendChild(sidebarTitle);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'hub-sidebar-toggle';
    toggleBtn.setAttribute('title', 'Toggle sidebar');
    toggleBtn.textContent = '\u2630';
    toggleBtn.addEventListener('click', () => {
      sidebarCollapsed = !sidebarCollapsed;
      sidebar.classList.toggle('collapsed', sidebarCollapsed);
    });
    sidebarHeader.appendChild(toggleBtn);
    sidebar.appendChild(sidebarHeader);

    // Navigation
    const nav = document.createElement('nav');
    nav.className = 'hub-sidebar-nav';

    const navItems = [
      { id: 'all',       label: 'All Modules',  countId: 'hub-count-all',       count: modules.length },
      { id: 'favorites', label: 'Favorites',     countId: 'hub-count-favorites', count: modules.filter(m => modulePrefs[m.id]?.favorite).length },
      { id: 'autostart', label: 'Auto-start',    countId: 'hub-count-autostart', count: modules.filter(m => modulePrefs[m.id]?.autoStart).length },
    ];

    for (const item of navItems) {
      const btn = document.createElement('button');
      btn.className = 'hub-sidebar-nav-item' + (filterView === item.id ? ' active' : '');
      btn.dataset.view = item.id;
      btn.addEventListener('click', () => setActiveNavItem(item.id));

      const label = document.createElement('span');
      label.className = 'hub-nav-label';
      label.textContent = item.label;
      btn.appendChild(label);

      const count = document.createElement('span');
      count.className = 'hub-nav-count';
      count.id = item.countId;
      count.textContent = item.count;
      btn.appendChild(count);

      nav.appendChild(btn);
    }

    sidebar.appendChild(nav);
    sidebar.appendChild(createInfoButton());
    sidebar.appendChild(createDbManagerButton());
    return sidebar;
  }

  function createInfoButton() {
    const infoBtn = document.createElement('button');
    infoBtn.className = 'hub-sidebar-info-btn';
    infoBtn.setAttribute('aria-label', 'About AutomataHub');

    const infoImg = document.createElement('img');
    infoImg.alt = 'Info';
    infoImg.className = 'hub-sidebar-info-icon';
    globalThis.api.getResourcesPath().then(resourcesPath => {
      infoImg.src = `file://${resourcesPath}/info.png`;
    });
    infoBtn.appendChild(infoImg);

    const infoLabel = document.createElement('span');
    infoLabel.className = 'hub-nav-label';
    infoLabel.textContent = 'About';
    infoBtn.appendChild(infoLabel);

    infoBtn.appendChild(buildTooltipContent());
    return infoBtn;
  }

  function buildTooltipContent() {
    const tooltip = document.createElement('div');
    tooltip.className = 'info-tooltip';

    const tooltipLines = [
      { type: 'strong', text: 'AutomataHub' },
      { type: 'text', text: 'A modular desktop hub for automation tools.' },
      { type: 'strong', text: 'Adding Modules' },
      { type: 'text', text: 'Place module folders inside ' },
      { type: 'code', text: 'modules/' },
      { type: 'text', text: ' with a ' },
      { type: 'code', text: 'manifest.json' },
      { type: 'text', text: '.' },
      { type: 'strong', text: 'Installed Modules' },
      { type: 'text', text: 'Each module provides its own tab types and functionality.' },
    ];

    let currentParagraph = document.createElement('div');
    for (const line of tooltipLines) {
      if (line.type === 'strong') {
        if (currentParagraph.children.length > 0) {
          tooltip.appendChild(currentParagraph);
          currentParagraph = document.createElement('div');
        }
        const strong = document.createElement('strong');
        strong.textContent = line.text;
        currentParagraph.appendChild(strong);
      } else if (line.type === 'code') {
        const code = document.createElement('code');
        code.textContent = line.text;
        currentParagraph.appendChild(code);
      } else {
        const span = document.createElement('span');
        span.textContent = line.text;
        currentParagraph.appendChild(span);
      }
    }
    if (currentParagraph.children.length > 0) {
      tooltip.appendChild(currentParagraph);
    }
    return tooltip;
  }

  // --- DB Manager Button ---

  function createDbManagerButton() {
    const btn = document.createElement('button');
    btn.className = 'hub-sidebar-info-btn';
    btn.setAttribute('aria-label', 'Database Manager');

    const icon = document.createElement('span');
    icon.style.flexShrink = '0';
    icon.style.width = '20px';
    icon.style.display = 'flex';
    icon.style.alignItems = 'center';
    icon.style.justifyContent = 'center';
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm0-1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/><path d="M14.16 7.394l-1.28-.37a4.97 4.97 0 0 0-.39-.94l.63-1.16a.38.38 0 0 0-.06-.44l-.82-.82a.38.38 0 0 0-.44-.06l-1.16.63a4.97 4.97 0 0 0-.94-.39l-.37-1.28a.38.38 0 0 0-.37-.27h-1.16a.38.38 0 0 0-.37.27l-.37 1.28a4.97 4.97 0 0 0-.94.39L4.9 3.56a.38.38 0 0 0-.44.06l-.82.82a.38.38 0 0 0-.06.44l.63 1.16c-.17.3-.3.61-.39.94l-1.28.37a.38.38 0 0 0-.27.37v1.16c0 .17.11.32.27.37l1.28.37c.09.33.22.64.39.94l-.63 1.16a.38.38 0 0 0 .06.44l.82.82c.12.12.29.14.44.06l1.16-.63c.3.17.61.3.94.39l.37 1.28c.05.16.2.27.37.27h1.16c.17 0 .32-.11.37-.27l.37-1.28c.33-.09.64-.22.94-.39l1.16.63c.15.08.32.06.44-.06l.82-.82a.38.38 0 0 0 .06-.44l-.63-1.16c.17-.3.3-.61.39-.94l1.28-.37a.38.38 0 0 0 .27-.37V7.77a.38.38 0 0 0-.27-.37zM8 11.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>';
    btn.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'hub-nav-label';
    label.textContent = 'DB Manager';
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      if (!globalThis.tabManager.hasTabType('db-manager')) return;
      const existing = globalThis.tabManager.getTabsByType('db-manager');
      if (existing.length > 0) {
        globalThis.tabManager.switchTab(existing[0].id);
      } else {
        globalThis.tabManager.createTab('db-manager', 'DB Manager', {}, { target: 'main' });
      }
    });

    return btn;
  }

  // --- Toolbar Builder ---

  function createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'hub-toolbar';

    const filterInput = document.createElement('input');
    filterInput.type = 'text';
    filterInput.className = 'hub-filter-input';
    filterInput.placeholder = 'Search modules...';
    filterInput.value = filterText;
    filterInput.addEventListener('input', () => {
      filterText = filterInput.value;
      updateModuleGrid();
    });
    filterInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        filterText = '';
        filterInput.value = '';
        updateModuleGrid();
      }
    });
    toolbar.appendChild(filterInput);

    const sortSelect = document.createElement('select');
    sortSelect.className = 'hub-sort-select';
    sortSelect.title = 'Sort modules';
    const sortOptions = [
      { value: 'default', label: 'Default' },
      { value: 'az', label: 'A - Z' },
      { value: 'za', label: 'Z - A' },
    ];
    for (const opt of sortOptions) {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      if (opt.value === sortMode) option.selected = true;
      sortSelect.appendChild(option);
    }
    sortSelect.addEventListener('change', () => {
      sortMode = sortSelect.value;
      updateModuleGrid();
    });
    toolbar.appendChild(sortSelect);

    return toolbar;
  }

  // --- Render ---

  async function render() {
    const container = document.getElementById('tab-content');
    if (!container) return;

    container.innerHTML = '';

    // Load user preferences
    try {
      const prefs = await globalThis.api.getPrefs();
      modulePrefs = prefs?.modules || {};
    } catch {
      modulePrefs = {};
    }

    const modules = globalThis._hub?.modules || [];

    // Root layout: sidebar + main
    const layout = document.createElement('div');
    layout.className = 'hub-layout';

    layout.appendChild(createSidebar(modules));

    // Main content
    const main = document.createElement('div');
    main.className = 'hub-main';

    main.appendChild(createToolbar());

    const grid = document.createElement('div');
    grid.className = 'hub-modules-grid';
    main.appendChild(grid);

    layout.appendChild(main);
    container.appendChild(layout);

    // Populate grid
    updateModuleGrid();

    // Watermark logo
    const logo = document.createElement('img');
    logo.className = 'home-logo';
    logo.alt = 'MW Logo';
    logo.style.cursor = 'pointer';
    logo.setAttribute('title', 'Visit GitHub');
    promptLogoRef = logo;

    globalThis.api.getResourcesPath().then(resourcesPath => {
      logo.src = `file://${resourcesPath}/mw.png`;
    }).catch(() => {
      logo.src = '../resources/mw.png';
    });

    logo.addEventListener('click', () => {
      if (promptOpen) {
        dismissPrompt();
      } else {
        showGitHubPrompt();
      }
    });

    logo.addEventListener('mouseleave', () => {
      setTimeout(() => {
        const box = document.querySelector('.github-prompt-box');
        if (box && !box.matches(':hover')) {
          dismissPrompt();
        }
      }, 120);
    });

    layout.appendChild(logo);
  }

  return { render };
})();

globalThis.homeTab = HomeTab;
