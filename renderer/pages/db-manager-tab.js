/**
 * Database Manager Tab — hub-level UI for managing SQLite database passwords.
 * Scans the project for .db/.sqlite/.sqlite3 files, shows credentials status,
 * and provides set/change/remove password + connection test per database.
 */

const DbManagerTab = (() => {

  // Cached state
  let databases = [];
  let credentials = {};  // { absolutePath: true } — has-password map
  let testResults = {};  // { absolutePath: { success, error?, tables? } }
  let authFailures = {}; // { absolutePath: { module } } — DBs that failed credential auth at boot
  let _authFailedCleanup = null; // push-event unsubscribe function

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function sourceBadge(source) {
    const badge = document.createElement('span');
    badge.className = 'dbm-badge';
    if (source === 'hub') {
      badge.classList.add('dbm-badge-hub');
      badge.textContent = 'Hub';
    } else if (source.startsWith('module:')) {
      badge.classList.add('dbm-badge-module');
      badge.textContent = source.replace('module:', '');
    } else {
      badge.classList.add('dbm-badge-project');
      badge.textContent = 'Project';
    }
    return badge;
  }

  function hasPassword(dbPath) {
    return credentials[dbPath] === true;
  }

  function hasAuthFailure(dbPath) {
    return dbPath in authFailures;
  }

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  async function loadData() {
    const [dbs, creds] = await Promise.all([
      globalThis.api.invoke('hub:scan-databases'),
      globalThis.api.invoke('hub:get-db-credentials'),
    ]);
    databases = Array.isArray(dbs) ? dbs : [];
    credentials = {};
    if (Array.isArray(creds)) {
      for (const c of creds) {
        credentials[c.path] = c.hasPassword;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Inline password form
  // ---------------------------------------------------------------------------

  const PW_MIN = 4;
  const PW_MAX = 256;

  /** Create a password input with a show/hide toggle button. */
  function createPasswordField(placeholder, role) {
    const wrapper = document.createElement('div');
    wrapper.className = 'dbm-pw-field';

    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = placeholder;
    input.dataset.role = role;
    input.maxLength = PW_MAX;
    wrapper.appendChild(input);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'dbm-pw-toggle';
    toggle.textContent = 'Show';
    toggle.title = 'Show password';
    toggle.addEventListener('click', () => {
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      toggle.textContent = visible ? 'Show' : 'Hide';
      toggle.title = visible ? 'Show password' : 'Hide password';
    });
    wrapper.appendChild(toggle);

    return { wrapper, input };
  }

  function showSetPasswordForm(card, dbPath, isChange) {
    // Remove any existing form on this card
    const existing = card.querySelector('.dbm-pw-form');
    if (existing) existing.remove();

    const form = document.createElement('div');
    form.className = 'dbm-pw-form';

    let oldInput = null;
    if (isChange) {
      const f = createPasswordField('Current password', 'old');
      oldInput = f.input;
      form.appendChild(f.wrapper);
    }

    const { wrapper: pwWrapper, input: pwInput } = createPasswordField(
      isChange ? 'New password' : 'Password', 'new'
    );
    form.appendChild(pwWrapper);

    const { wrapper: confirmWrapper, input: confirmInput } = createPasswordField(
      'Confirm password', 'confirm'
    );
    form.appendChild(confirmWrapper);

    const errorEl = document.createElement('p');
    errorEl.className = 'dbm-pw-error';
    form.appendChild(errorEl);

    const buttons = document.createElement('div');
    buttons.className = 'dbm-pw-form-buttons';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary btn-sm';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => form.remove());
    buttons.appendChild(cancelBtn);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-sm';
    saveBtn.textContent = isChange ? 'Change' : 'Save';
    saveBtn.type = 'button';
    saveBtn.disabled = true; // disabled until valid

    /** Validate all inputs and update the save button / error message. */
    function validate() {
      const newPw = pwInput.value;
      const confirmPw = confirmInput.value;

      if (isChange && oldInput && !oldInput.value) {
        errorEl.textContent = 'Enter current password';
        saveBtn.disabled = true;
        return false;
      }
      if (newPw.length < PW_MIN) {
        errorEl.textContent = `Password must be at least ${PW_MIN} characters`;
        saveBtn.disabled = true;
        return false;
      }
      if (newPw.length > PW_MAX) {
        errorEl.textContent = `Password must be at most ${PW_MAX} characters`;
        saveBtn.disabled = true;
        return false;
      }
      if (confirmPw && newPw !== confirmPw) {
        errorEl.textContent = 'Passwords do not match';
        saveBtn.disabled = true;
        return false;
      }
      if (!confirmPw) {
        errorEl.textContent = '';
        saveBtn.disabled = true;
        return false;
      }
      errorEl.textContent = '';
      saveBtn.disabled = false;
      return true;
    }

    // Real-time validation on every keystroke
    form.addEventListener('input', validate);

    saveBtn.addEventListener('click', async () => {
      if (!validate()) return;
      const newPw = pwInput.value;
      saveBtn.disabled = true;
      try {
        let result;
        if (isChange) {
          result = await globalThis.api.invoke('hub:change-db-password', { dbPath, oldPassword: oldInput.value, newPassword: newPw });
        } else {
          result = await globalThis.api.invoke('hub:set-db-password', { dbPath, password: newPw });
        }
        if (result.success) {
          credentials[dbPath] = true;
          globalThis.ui.showNotification('Password saved', 'success');
          form.remove();
          refreshCard(card, dbPath);
        } else {
          errorEl.textContent = result.error || 'Failed to save password';
          saveBtn.disabled = false;
        }
      } catch (err) {
        errorEl.textContent = err.message || 'Unexpected error';
        saveBtn.disabled = false;
      }
    });
    buttons.appendChild(saveBtn);

    form.appendChild(buttons);

    // Insert before card actions
    const actionsEl = card.querySelector('.dbm-card-actions');
    if (actionsEl) {
      actionsEl.before(form);
    } else {
      card.appendChild(form);
    }

    // Focus first input
    const firstInput = form.querySelector('input');
    if (firstInput) firstInput.focus();
  }

  // ---------------------------------------------------------------------------
  // Inline remove-password form (requires current password)
  // ---------------------------------------------------------------------------

  function showRemovePasswordForm(card, dbPath, relativePath) {
    const existing = card.querySelector('.dbm-pw-form');
    if (existing) existing.remove();

    const form = document.createElement('div');
    form.className = 'dbm-pw-form';

    const { wrapper, input: pwInput } = createPasswordField('Current password', 'old');
    form.appendChild(wrapper);

    const errorEl = document.createElement('p');
    errorEl.className = 'dbm-pw-error';
    form.appendChild(errorEl);

    const buttons = document.createElement('div');
    buttons.className = 'dbm-pw-form-buttons';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary btn-sm';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.type = 'button';
    cancelBtn.addEventListener('click', () => form.remove());
    buttons.appendChild(cancelBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger btn-sm';
    removeBtn.textContent = 'Remove';
    removeBtn.type = 'button';
    removeBtn.disabled = true;

    pwInput.addEventListener('input', () => {
      removeBtn.disabled = pwInput.value.length < PW_MIN;
      errorEl.textContent = '';
    });

    removeBtn.addEventListener('click', async () => {
      removeBtn.disabled = true;
      try {
        const result = await globalThis.api.invoke('hub:remove-db-password', { dbPath, password: pwInput.value });
        if (result.success) {
          delete credentials[dbPath];
          globalThis.ui.showNotification('Password removed', 'info');
          form.remove();
          refreshCard(card, dbPath);
        } else {
          errorEl.textContent = result.error || 'Failed to remove password';
          removeBtn.disabled = false;
        }
      } catch (err) {
        errorEl.textContent = err.message || 'Unexpected error';
        removeBtn.disabled = false;
      }
    });
    buttons.appendChild(removeBtn);
    form.appendChild(buttons);

    const actionsEl = card.querySelector('.dbm-card-actions');
    if (actionsEl) {
      actionsEl.before(form);
    } else {
      card.appendChild(form);
    }
    pwInput.focus();
  }

  // ---------------------------------------------------------------------------
  // Card builder
  // ---------------------------------------------------------------------------

  function _buildCardMeta(db) {
    const meta = document.createElement('div');
    meta.className = 'dbm-card-meta';

    const sizeSpan = document.createElement('span');
    sizeSpan.textContent = formatSize(db.sizeBytes);
    meta.appendChild(sizeSpan);

    const status = document.createElement('span');
    status.className = 'dbm-status';
    const dot = document.createElement('span');
    dot.className = 'dbm-status-dot ' + (hasPassword(db.path) ? 'has-password' : 'no-password');
    status.appendChild(dot);
    const statusLabel = document.createElement('span');
    statusLabel.textContent = hasPassword(db.path) ? 'Password set' : 'No password';
    status.appendChild(statusLabel);
    meta.appendChild(status);

    const testResult = testResults[db.path];
    if (testResult) {
      const testStatus = document.createElement('span');
      testStatus.className = 'dbm-status';
      const testDot = document.createElement('span');
      testDot.className = 'dbm-status-dot ' + (testResult.success ? 'test-ok' : 'test-fail');
      testStatus.appendChild(testDot);
      const testLabel = document.createElement('span');
      testLabel.textContent = testResult.success ? 'Connected' : 'Failed';
      testStatus.appendChild(testLabel);
      meta.appendChild(testStatus);
    }

    if (hasAuthFailure(db.path)) {
      const warnBadge = document.createElement('span');
      warnBadge.className = 'dbm-badge dbm-badge-warn';
      warnBadge.textContent = 'Auth failed';
      meta.appendChild(warnBadge);
    }

    return meta;
  }

  function _buildTestDetail(db) {
    const testResult = testResults[db.path];
    const testDetail = document.createElement('div');
    testDetail.className = 'dbm-test-result';
    if (testResult) {
      if (testResult.success && testResult.tables) {
        testDetail.classList.add('success');
        testDetail.textContent = `${testResult.tables.length} table(s): ${testResult.tables.slice(0, 5).join(', ')}${testResult.tables.length > 5 ? '...' : ''}`;
      } else if (!testResult.success && testResult.error) {
        testDetail.classList.add('error');
        testDetail.textContent = testResult.error;
      }
    }
    return testDetail;
  }

  function buildCard(db) {
    const card = document.createElement('div');
    card.className = 'dbm-card';
    card.dataset.dbPath = db.path;

    // Header: name + badge
    const header = document.createElement('div');
    header.className = 'dbm-card-header';

    const name = document.createElement('h3');
    name.className = 'dbm-card-name';
    name.textContent = db.relativePath.split('/').pop();
    header.appendChild(name);

    header.appendChild(sourceBadge(db.source));
    card.appendChild(header);

    // Path
    const pathEl = document.createElement('p');
    pathEl.className = 'dbm-card-path';
    pathEl.textContent = db.relativePath;
    card.appendChild(pathEl);

    // Meta: size + status + test indicator + auth warning
    card.appendChild(_buildCardMeta(db));

    // Test result details
    card.appendChild(_buildTestDetail(db));

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'dbm-card-actions';

    if (hasPassword(db.path)) {
      const changeBtn = document.createElement('button');
      changeBtn.className = 'btn btn-secondary btn-sm';
      changeBtn.textContent = 'Change Password';
      changeBtn.addEventListener('click', () => showSetPasswordForm(card, db.path, true));
      actions.appendChild(changeBtn);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-danger btn-sm';
      removeBtn.textContent = 'Remove Password';
      removeBtn.addEventListener('click', () => showRemovePasswordForm(card, db.path, db.relativePath));
      actions.appendChild(removeBtn);
    } else {
      const setBtn = document.createElement('button');
      setBtn.className = 'btn btn-sm';
      setBtn.textContent = 'Set Password';
      setBtn.addEventListener('click', () => showSetPasswordForm(card, db.path, false));
      actions.appendChild(setBtn);
    }

    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn-secondary btn-sm';
    testBtn.textContent = 'Test Connection';
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'Testing...';
      try {
        const result = await globalThis.api.invoke('hub:test-db-connection', { dbPath: db.path });
        testResults[db.path] = result;
        refreshCard(card, db.path);
      } catch (err) {
        testResults[db.path] = { success: false, error: err.message };
        refreshCard(card, db.path);
      }
    });
    actions.appendChild(testBtn);

    card.appendChild(actions);
    return card;
  }

  function refreshCard(oldCard, dbPath) {
    const db = databases.find(d => d.path === dbPath);
    if (!db || !oldCard.parentNode) return;
    const newCard = buildCard(db);
    oldCard.replaceWith(newCard);
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  async function render(tab, container) {
    container.innerHTML = '';

    // Listen for auth-failure push events from main process
    if (_authFailedCleanup) _authFailedCleanup();
    _authFailedCleanup = globalThis.api.on('hub:db-auth-failed', (data) => {
      if (data?.dbPath) {
        authFailures[data.dbPath] = { module: data.module };
        globalThis.ui.showNotification(
          `Stored password failed for ${data.dbPath.split('/').pop()} (${data.module || 'unknown'})`,
          'warning', 5000
        );
        // Refresh the card if it's visible
        const card = container.querySelector(`[data-db-path="${CSS.escape(data.dbPath)}"]`);
        if (card) refreshCard(card, data.dbPath);
      }
    });

    // Load stylesheet once
    if (!document.querySelector('link[data-dbm-style]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '../renderer/pages/db-manager.css';
      link.dataset.dbmStyle = '1';
      document.head.appendChild(link);
    }

    const root = document.createElement('div');
    root.className = 'dbm-container';

    // Header
    const header = document.createElement('div');
    header.className = 'dbm-header';

    const title = document.createElement('h1');
    title.className = 'dbm-title';
    title.textContent = 'Database Manager';
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'dbm-actions';

    const scanBtn = document.createElement('button');
    scanBtn.className = 'btn dbm-scan-btn';
    scanBtn.textContent = 'Scan Now';
    scanBtn.addEventListener('click', async () => {
      scanBtn.classList.add('loading');
      scanBtn.textContent = 'Scanning...';
      try {
        testResults = {};
        await loadData();
        renderContent(root);
      } finally {
        scanBtn.classList.remove('loading');
        scanBtn.textContent = 'Scan Now';
      }
    });
    actions.appendChild(scanBtn);
    header.appendChild(actions);
    root.appendChild(header);

    container.appendChild(root);

    // Initial load
    try {
      await loadData();
      renderContent(root);
    } catch (err) {
      const errEl = document.createElement('p');
      errEl.style.color = 'var(--error)';
      errEl.textContent = 'Failed to scan databases: ' + (err.message || err);
      root.appendChild(errEl);
    }
  }

  function renderContent(root) {
    // Remove old stats + grid
    const oldStats = root.querySelector('.dbm-stats');
    if (oldStats) oldStats.remove();
    const oldGrid = root.querySelector('.dbm-grid');
    if (oldGrid) oldGrid.remove();

    // Stats bar
    const stats = document.createElement('div');
    stats.className = 'dbm-stats';

    const totalStat = createStat('Databases', databases.length);
    stats.appendChild(totalStat);

    const withPw = databases.filter(db => hasPassword(db.path)).length;
    stats.appendChild(createStat('With Password', withPw));
    stats.appendChild(createStat('Without Password', databases.length - withPw));

    root.appendChild(stats);

    // Grid
    const grid = document.createElement('div');
    grid.className = 'dbm-grid';

    if (databases.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dbm-empty';
      const emptyTitle = document.createElement('p');
      emptyTitle.className = 'dbm-empty-title';
      emptyTitle.textContent = 'No databases found';
      empty.appendChild(emptyTitle);
      const emptyHint = document.createElement('p');
      emptyHint.textContent = 'Place .db, .sqlite, or .sqlite3 files in the data/ or modules/ directories.';
      empty.appendChild(emptyHint);
      grid.appendChild(empty);
    } else {
      for (const db of databases) {
        grid.appendChild(buildCard(db));
      }
    }

    root.appendChild(grid);
  }

  function createStat(label, value) {
    const stat = document.createElement('div');
    stat.className = 'dbm-stat';
    const valSpan = document.createElement('span');
    valSpan.className = 'dbm-stat-value';
    valSpan.textContent = value;
    stat.appendChild(valSpan);
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    stat.appendChild(labelSpan);
    return stat;
  }

  // ---------------------------------------------------------------------------
  // Register tab type
  // ---------------------------------------------------------------------------

  return {
    render,
    register(tm) {
      tm.registerTabType('db-manager', {
        render,
        maxTabs: 1,
        onClose: () => {
          if (_authFailedCleanup) {
            _authFailedCleanup();
            _authFailedCleanup = null;
          }
        },
      });
    },
  };
})();

globalThis.dbManagerTab = DbManagerTab;
