const HomeTab = (() => {

  // Track loaded module prefs
  let modulePrefs = {};

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
    favBtn.setAttribute('title', 'Favorite — sort to top');
    favBtn.textContent = prefs.favorite ? '\u2665' : '\u2661';
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(mod.id, favBtn);
    });
    toggles.appendChild(favBtn);

    const autoBtn = document.createElement('button');
    autoBtn.className = 'card-toggle toggle-autostart' + (prefs.autoStart ? ' active' : '');
    autoBtn.setAttribute('aria-label', 'Toggle auto-start');
    autoBtn.setAttribute('title', 'Auto-start — open with AutomataHub');
    autoBtn.textContent = prefs.autoStart ? '\u2605' : '\u2606';
    autoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleAutoStart(mod.id, autoBtn);
    });
    toggles.appendChild(autoBtn);

    footer.appendChild(toggles);

    const openBtn = document.createElement('button');
    openBtn.className = 'btn';
    openBtn.textContent = '\u25B6 Open';
    openBtn.addEventListener('click', () => handleOpenModule(mod));
    footer.appendChild(openBtn);

    card.appendChild(footer);
    return card;
  }

  function handleOpenModule(mod) {
    // Find the module's default tab type and open it
    if (mod.tabTypes && mod.tabTypes.length > 0) {
      const defaultType = mod.tabTypes[0];
      const typeId = defaultType.id || defaultType;

      // If the module provides a custom open handler, use it
      if (window._hub && window._hub.moduleOpeners && window._hub.moduleOpeners[mod.id]) {
        window._hub.moduleOpeners[mod.id](mod);
        return;
      }

      // Check if this module already has an open tab (e.g. auto-started)
      const existing = window.tabManager.getTabsByType(typeId);
      if (existing.length > 0) {
        window.tabManager.switchTab(existing[0].id);
        return;
      }

      // Otherwise open in the module (lower) tab bar
      if (window.tabManager.hasTabType(typeId)) {
        window.tabManager.createTab(typeId, mod.name, { moduleId: mod.id }, { target: 'module' });
      }
    }
  }

  // --- Toggle Handlers ---

  async function toggleFavorite(moduleId, btn) {
    const current = modulePrefs[moduleId] || { favorite: false, autoStart: false };
    const newVal = !current.favorite;
    modulePrefs[moduleId] = { ...current, favorite: newVal };
    await window.api.setModulePrefs(moduleId, { favorite: newVal });

    btn.classList.toggle('active', newVal);
    btn.textContent = newVal ? '\u2665' : '\u2661';

    // Re-sort the grid
    sortModuleGrid();
  }

  async function toggleAutoStart(moduleId, btn) {
    const current = modulePrefs[moduleId] || { favorite: false, autoStart: false };
    const newVal = !current.autoStart;
    modulePrefs[moduleId] = { ...current, autoStart: newVal };
    await window.api.setModulePrefs(moduleId, { autoStart: newVal });

    btn.classList.toggle('active', newVal);
    btn.textContent = newVal ? '\u2605' : '\u2606';
  }

  function sortModuleGrid() {
    const grid = document.querySelector('.scripts-grid');
    if (!grid) return;

    const cards = [...grid.querySelectorAll('.script-card')];
    cards.sort((a, b) => {
      const aFav = modulePrefs[a.dataset.moduleId]?.favorite ? 1 : 0;
      const bFav = modulePrefs[b.dataset.moduleId]?.favorite ? 1 : 0;
      if (bFav !== aFav) return bFav - aFav;
      // Alphabetical by aria-label as fallback
      return a.getAttribute('aria-label').localeCompare(b.getAttribute('aria-label'));
    });

    for (const card of cards) {
      grid.appendChild(card);
    }
  }

  function sortModules(modules) {
    return [...modules].sort((a, b) => {
      const aFav = modulePrefs[a.id]?.favorite ? 1 : 0;
      const bFav = modulePrefs[b.id]?.favorite ? 1 : 0;
      if (bFav !== aFav) return bFav - aFav;
      return a.name.localeCompare(b.name);
    });
  }

  // --- Empty State ---

  function renderEmpty(container) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';

    const icon = document.createElement('div');
    icon.className = 'empty-state-icon';
    icon.textContent = '\uD83D\uDD27';
    empty.appendChild(icon);

    const msg = document.createElement('p');
    msg.textContent = 'No modules installed';
    empty.appendChild(msg);

    const hint = document.createElement('small');
    hint.textContent = 'Add modules to the modules/ directory to get started.';
    empty.appendChild(hint);

    container.appendChild(empty);
  }

  // --- Render ---

  async function render() {
    const container = document.getElementById('tab-content');
    if (!container) return;

    container.innerHTML = '';

    // Load user preferences
    try {
      const prefs = await window.api.getPrefs();
      modulePrefs = (prefs && prefs.modules) || {};
    } catch {
      modulePrefs = {};
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'home-tab';

    const header = document.createElement('div');
    header.className = 'home-header';

    const headerText = document.createElement('div');
    headerText.className = 'home-header-text';

    const h1 = document.createElement('h1');
    h1.textContent = 'AutomataHub';
    headerText.appendChild(h1);

    const subtitle = document.createElement('p');
    subtitle.className = 'subtitle';
    subtitle.textContent = 'Select a module to get started';
    headerText.appendChild(subtitle);

    header.appendChild(headerText);

    const infoBtn = document.createElement('button');
    infoBtn.className = 'header-info-btn';
    infoBtn.setAttribute('aria-label', 'About AutomataHub');

    const infoImg = document.createElement('img');
    infoImg.alt = 'Info';
    infoImg.className = 'header-info-icon';
    window.api.getResourcesPath().then(resourcesPath => {
      infoImg.src = `file://${resourcesPath}/info.png`;
    });
    infoBtn.appendChild(infoImg);

    const tooltip = document.createElement('div');
    tooltip.className = 'info-tooltip';
    
    // Build tooltip content using safe DOM construction
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
    
    infoBtn.appendChild(tooltip);

    header.appendChild(infoBtn);

    wrapper.appendChild(header);

    // Module cards (sorted: favorites first, then alphabetical)
    const modules = (window._hub && window._hub.modules) || [];
    const sorted = sortModules(modules);

    if (sorted.length === 0) {
      renderEmpty(wrapper);
    } else {
      const grid = document.createElement('div');
      grid.className = 'scripts-grid';

      for (const mod of sorted) {
        grid.appendChild(createModuleCard(mod));
      }

      wrapper.appendChild(grid);
    }

    // Add watermark logo in bottom right
    const logo = document.createElement('img');
    logo.className = 'home-logo';
    logo.alt = 'MW Logo';
    logo.style.cursor = 'pointer';
    logo.setAttribute('title', 'Visit GitHub');

    window.api.getResourcesPath().then(resourcesPath => {
      logo.src = `file://${resourcesPath}/mw.png`;
    }).catch(() => {
      logo.src = '../resources/mw.png';
    });

    let promptOpen = false;

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

    wrapper.appendChild(logo);

    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'y' || e.key === 'Y') {
        const btn = wrapper.querySelector('.header-info-btn');
        if (btn && btn.matches(':hover')) {
          showGitHubPrompt();
        }
      }
    });

    let promptKeyHandler = null;

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
      line2Cursor.textContent = '█';
      line2.appendChild(line2Cursor);
      
      body.appendChild(line2);

      box.appendChild(body);

      // Close when mouse leaves both logo and box
      box.addEventListener('mouseleave', () => {
        setTimeout(() => {
          if (!logo.matches(':hover') && !box.matches(':hover')) {
            dismissPrompt();
          }
        }, 120);
      });

      document.body.appendChild(box);
      requestAnimationFrame(() => box.classList.add('github-prompt-visible'));

      // Typewriter — fast regular rhythm with slight word-boundary pauses
      const fullText = ' wanna visit my github? ';
      let i = 0;
      function typingDelay(ch, nextCh) {
        if (ch === ' ') return 95 + Math.random() * 60;  // pause at word boundary
        if (nextCh === ' ') return 70 + Math.random() * 30; // slight slow before space
        return 68 + Math.random() * 28;                    // fast regular keystrokes
      }
      function typeNext() {
        if (i < fullText.length) {
          const ch = fullText[i];
          const nextCh = fullText[i + 1] || '';
          cmdSpan.textContent += ch;
          i++;
          setTimeout(typeNext, typingDelay(ch, nextCh));
        } else {
          // Append [y/n] as a separate span element (safe DOM construction)
          const ynSpan = document.createElement('span');
          ynSpan.className = 'github-prompt-yn';
          ynSpan.textContent = '[y/n]';
          cmdSpan.appendChild(ynSpan);
        }
      }
      setTimeout(typeNext, 820); // wait for flicker to settle

      promptKeyHandler = function(e) {
        if (e.key === 'y' || e.key === 'Y') {
          window.api.openExternalUrl('https://github.com/Rey-der');
          dismissPrompt();
        } else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') {
          dismissPrompt();
        }
      };
      document.addEventListener('keydown', promptKeyHandler);
    }

    container.appendChild(wrapper);
  }

  return { render };
})();

window.homeTab = HomeTab;
