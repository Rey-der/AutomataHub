/**
 * Script Runner — TopicList
 * Sidebar component for topic selection and management.
 * 
 * Features:
 * - Double-click to edit topic name/description/color
 * - Right-click context menu (Edit, Delete, Duplicate)
 * - Create topic modal with validation
 * - In-place success notifications
 * - Drag-and-drop scripts over topics
 * - Better color picker UI
 */

class TopicList {
  constructor(app) {
    this.app = app;
    this.container = null;
    this.editingTopicId = null;
    this.dragOverTopicId = null;
    this.unsubscribes = [];
  }

  async init(container) {
    this.container = container;
    this.render();
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="topic-list-wrapper">
        <div class="topic-list-header">
          <h3>Topics</h3>
          <div class="topic-header-actions">
            <button class="topic-header-btn" id="btn-import-topics" title="Import topics from JSON">&#x2B06;</button>
            <button class="topic-header-btn" id="btn-export-topics" title="Export topics as JSON">&#x2B07;</button>
            <button class="btn-new-topic" id="btn-new-topic" title="Create new topic (Ctrl+N)">+</button>
          </div>
        </div>
        
        <div class="topic-list-items" id="topic-items">
          ${this._renderTopicItems()}
        </div>
      </div>

      <!-- Context Menu (hidden by default) -->
      <div class="topic-context-menu" id="topic-context-menu" style="display: none;">
        <button class="context-menu-item" id="ctx-edit">Edit</button>
        <button class="context-menu-item" id="ctx-duplicate">Duplicate</button>
        <div class="context-menu-separator"></div>
        <button class="context-menu-item context-menu-item-danger" id="ctx-delete">Delete</button>
      </div>

      <!-- Edit Dialog -->
      <div class="topic-dialog-overlay" id="edit-dialog-overlay" style="display: none;">
        <div class="topic-dialog">
          <h3>Edit Topic</h3>
          <form id="edit-topic-form">
            <div class="form-group">
              <label for="edit-topic-name">Name *</label>
              <input type="text" id="edit-topic-name" required placeholder="Topic name">
              <span class="form-error" id="edit-name-error"></span>
            </div>

            <div class="form-group">
              <label for="edit-topic-description">Description</label>
              <textarea id="edit-topic-description" placeholder="Optional description" rows="2"></textarea>
            </div>

            <div class="form-group">
              <label>Color</label>
              <div class="color-picker" id="edit-color-picker">
                ${this._renderColorPicker()}
              </div>
            </div>

            <div class="form-actions">
              <button type="button" class="btn btn-secondary" id="edit-btn-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">Save Changes</button>
            </div>
          </form>
        </div>
      </div>

      <!-- Create Dialog -->
      <div class="topic-dialog-overlay" id="create-dialog-overlay" style="display: none;">
        <div class="topic-dialog">
          <h3>Create New Topic</h3>
          <form id="create-topic-form">
            <div class="form-group">
              <label for="create-topic-name">Name *</label>
              <input type="text" id="create-topic-name" required placeholder="Topic name" autofocus>
              <span class="form-error" id="create-name-error"></span>
            </div>

            <div class="form-group">
              <label for="create-topic-description">Description</label>
              <textarea id="create-topic-description" placeholder="Optional description" rows="2"></textarea>
            </div>

            <div class="form-group">
              <label>Color</label>
              <div class="color-picker" id="create-color-picker">
                ${this._renderColorPicker()}
              </div>
            </div>

            <div class="form-actions">
              <button type="button" class="btn btn-secondary" id="create-btn-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary">Create Topic</button>
            </div>
          </form>
        </div>
      </div>
    `;

    this._attachEventListeners();
  }

  _renderColorPicker() {
    const colors = [
      { name: 'Blue', hex: '#4A90E2' },
      { name: 'Red', hex: '#E94B3C' },
      { name: 'Green', hex: '#50C878' },
      { name: 'Orange', hex: '#FFB81C' },
      { name: 'Purple', hex: '#8B5CF6' },
      { name: 'Pink', hex: '#EC4899' },
      { name: 'Teal', hex: '#14B8A6' },
      { name: 'Cyan', hex: '#06B6D4' },
    ];

    return colors
      .map(
        (c) => `
      <button type="button" class="color-option" 
              data-color="${c.hex}" 
              title="${c.name}"
              style="background-color: ${c.hex}">
      </button>
    `
      )
      .join('');
  }

  _renderTopicItems() {
    if (this.app.topics.length === 0) {
      return '<div class="topic-list-empty">No topics yet. Click + to create one.</div>';
    }

    return this.app.topics
      .map((topic) => {
        const isSelected = this.app.selectedTopicId === topic.id;
        const isDragOver = this.dragOverTopicId === topic.id;
        const scriptCount = topic.script_count || 0;
        return `
          <div class="topic-item-wrapper" data-topic-id="${topic.id}">
            <button class="topic-item ${isSelected ? 'active' : ''} ${isDragOver ? 'drag-over' : ''}" 
                    id="topic-${topic.id}"
                    data-topic-id="${topic.id}"
                    style="--topic-color: ${topic.color || '#4A90E2'}"
                    title="${topic.description || topic.name}"
                    draggable="false">
              <span class="topic-color-dot" style="background: var(--topic-color);"></span>
              <span class="topic-name">${this._escapeHtml(topic.name)}</span>
              <span class="topic-count">${scriptCount}</span>
            </button>
            <button class="topic-menu-btn" data-topic-id="${topic.id}" title="Options">⋮</button>
          </div>
        `;
      })
      .join('');
  }

  _attachEventListeners() {
    // New topic button + Ctrl+N shortcut
    const btnNew = this.container.querySelector('#btn-new-topic');
    if (btnNew) {
      btnNew.addEventListener('click', () => this._showCreateDialog());
    }

    const btnExport = this.container.querySelector('#btn-export-topics');
    if (btnExport) {
      btnExport.addEventListener('click', () => this._handleExportTopics());
    }

    const btnImport = this.container.querySelector('#btn-import-topics');
    if (btnImport) {
      btnImport.addEventListener('click', () => this._handleImportTopics());
    }

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        this._showCreateDialog();
      }
    });

    // Topic items - click to select
    this.container.querySelectorAll('.topic-item[data-topic-id]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.topic-menu-btn')) return;
        const topicId = el.dataset.topicId;
        this.app.selectTopic(topicId);
      });

      // Double-click to edit
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const topicId = el.dataset.topicId;
        const topic = this.app.topics.find((t) => t.id === topicId);
        if (topic) this._showEditDialog(topic);
      });

      // Right-click context menu
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const topicId = el.dataset.topicId;
        this._showContextMenu(topicId, e);
      });

      // Drag-over feedback for script drops
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dragOverTopicId = el.dataset.topicId;
        el.classList.add('drag-over');
      });

      el.addEventListener('dragleave', (e) => {
        e.preventDefault();
        if (e.target === el) {
          this.dragOverTopicId = null;
          el.classList.remove('drag-over');
        }
      });

      el.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dragOverTopicId = null;
        el.classList.remove('drag-over');

        const scriptId = e.dataTransfer?.getData('script-id');
        if (scriptId) {
          const topicId = el.dataset.topicId;
          await this._addScriptToTopic(scriptId, topicId);
        }
      });
    });

    // Topic menu buttons
    this.container.querySelectorAll('.topic-menu-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const topicId = btn.dataset.topicId;
        this._showContextMenu(topicId, e);
      });
    });

    // Create topic form
    const createForm = this.container.querySelector('#create-topic-form');
    if (createForm) {
      createForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this._handleCreateTopic();
      });
    }

    const createCancel = this.container.querySelector('#create-btn-cancel');
    if (createCancel) {
      createCancel.addEventListener('click', () => this._hideCreateDialog());
    }

    // Edit topic form
    const editForm = this.container.querySelector('#edit-topic-form');
    if (editForm) {
      editForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this._handleEditTopic();
      });
    }

    const editCancel = this.container.querySelector('#edit-btn-cancel');
    if (editCancel) {
      editCancel.addEventListener('click', () => this._hideEditDialog());
    }

    // Create color picker
    this.container.querySelectorAll('#create-color-picker .color-option').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.container.querySelectorAll('#create-color-picker .color-option').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    // Edit color picker
    this.container.querySelectorAll('#edit-color-picker .color-option').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.container.querySelectorAll('#edit-color-picker .color-option').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    // Context menu actions
    const ctxEdit = this.container.querySelector('#ctx-edit');
    if (ctxEdit) {
      ctxEdit.addEventListener('click', () => {
        const topic = this.app.topics.find((t) => t.id === this._contextMenuTopicId);
        if (topic) this._showEditDialog(topic);
        this._hideContextMenu();
      });
    }

    const ctxDelete = this.container.querySelector('#ctx-delete');
    if (ctxDelete) {
      ctxDelete.addEventListener('click', () => {
        const topic = this.app.topics.find((t) => t.id === this._contextMenuTopicId);
        if (topic && confirm(`Delete "${topic.name}"? Scripts will be unassigned.`)) {
          this._deleteTopic(topic.id);
        }
        this._hideContextMenu();
      });
    }

    const ctxDuplicate = this.container.querySelector('#ctx-duplicate');
    if (ctxDuplicate) {
      ctxDuplicate.addEventListener('click', () => {
        const topic = this.app.topics.find((t) => t.id === this._contextMenuTopicId);
        if (topic) this._duplicateTopic(topic);
        this._hideContextMenu();
      });
    }

    // Close modals on overlay click
    const createOverlay = this.container.querySelector('#create-dialog-overlay');
    if (createOverlay) {
      createOverlay.addEventListener('click', (e) => {
        if (e.target === createOverlay) this._hideCreateDialog();
      });
    }

    const editOverlay = this.container.querySelector('#edit-dialog-overlay');
    if (editOverlay) {
      editOverlay.addEventListener('click', (e) => {
        if (e.target === editOverlay) this._hideEditDialog();
      });
    }

    // Close context menu on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.topic-context-menu')) {
        this._hideContextMenu();
      }
    });
  }

  _showCreateDialog() {
    const overlay = this.container?.querySelector('#create-dialog-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
      const nameInput = this.container?.querySelector('#create-topic-name');
      if (nameInput) nameInput.focus();

      // Select default color
      const defaultColor = this.container?.querySelector('#create-color-picker .color-option[data-color="#4A90E2"]');
      if (defaultColor) defaultColor.classList.add('selected');
    }
  }

  _hideCreateDialog() {
    const overlay = this.container?.querySelector('#create-dialog-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  _showEditDialog(topic) {
    const overlay = this.container?.querySelector('#edit-dialog-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
      this.editingTopicId = topic.id;

      const nameInput = this.container?.querySelector('#edit-topic-name');
      if (nameInput) {
        nameInput.value = topic.name;
        nameInput.focus();
      }

      const descInput = this.container?.querySelector('#edit-topic-description');
      if (descInput) descInput.value = topic.description || '';

      // Select color
      const colorBtn = this.container?.querySelector(`#edit-color-picker .color-option[data-color="${topic.color}"]`);
      if (colorBtn) {
        this.container?.querySelectorAll('#edit-color-picker .color-option').forEach((b) => b.classList.remove('selected'));
        colorBtn.classList.add('selected');
      }
    }
  }

  _hideEditDialog() {
    const overlay = this.container?.querySelector('#edit-dialog-overlay');
    if (overlay) overlay.style.display = 'none';
    this.editingTopicId = null;
  }

  async _handleCreateTopic() {
    const nameInput = this.container?.querySelector('#create-topic-name');
    const descInput = this.container?.querySelector('#edit-topic-description');
    const colorBtn = this.container?.querySelector('#create-color-picker .color-option.selected');

    const name = nameInput?.value?.trim();
    const description = descInput?.value?.trim() || '';
    const color = colorBtn?.dataset.color || '#4A90E2';

    if (!name) {
      const errorEl = this.container?.querySelector('#create-name-error');
      if (errorEl) errorEl.textContent = 'Topic name is required';
      return;
    }

    // Check for duplicate
    if (this.app.topics.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      const errorEl = this.container?.querySelector('#create-name-error');
      if (errorEl) errorEl.textContent = 'Topic name already exists';
      return;
    }

    try {
      const result = await API.invoke('script-runner:create-topic', { name, description, color });
      if (result.success) {
        globalThis.ui?.showNotification?.(`Topic "${name}" created`, 'success');
        this._hideCreateDialog();
      } else {
        globalThis.ui?.showNotification?.(result.error || 'Failed to create topic', 'error');
      }
    } catch (err) {
      console.error('[script-topics] Create error:', err.message);
      globalThis.ui?.showNotification?.('Error creating topic', 'error');
    }
  }

  async _handleEditTopic() {
    const nameInput = this.container?.querySelector('#edit-topic-name');
    const descInput = this.container?.querySelector('#edit-topic-description');
    const colorBtn = this.container?.querySelector('#edit-color-picker .color-option.selected');

    const name = nameInput?.value?.trim();
    const description = descInput?.value?.trim() || '';
    const color = colorBtn?.dataset.color || '#4A90E2';

    if (!name) {
      const errorEl = this.container?.querySelector('#edit-name-error');
      if (errorEl) errorEl.textContent = 'Topic name is required';
      return;
    }

    try {
      const result = await API.invoke('script-runner:update-topic', {
        topic_id: this.editingTopicId,
        name,
        description,
        color,
      });

      if (result.success) {
        globalThis.ui?.showNotification?.('Topic updated', 'success');
        this._hideEditDialog();
      } else {
        globalThis.ui?.showNotification?.(result.error || 'Failed to update topic', 'error');
      }
    } catch (err) {
      console.error('[script-topics] Update error:', err.message);
      globalThis.ui?.showNotification?.('Error updating topic', 'error');
    }
  }

  async _deleteTopic(topicId) {
    try {
      const result = await API.invoke('script-runner:delete-topic', { topic_id: topicId });
      if (result.success) {
        globalThis.ui?.showNotification?.('Topic deleted', 'success');
      } else {
        globalThis.ui?.showNotification?.(result.error || 'Failed to delete topic', 'error');
      }
    } catch (err) {
      console.error('[script-topics] Delete error:', err.message);
      globalThis.ui?.showNotification?.('Error deleting topic', 'error');
    }
  }

  async _duplicateTopic(topic) {
    const newName = `${topic.name} (copy)`;

    try {
      const result = await API.invoke('script-runner:create-topic', {
        name: newName,
        description: topic.description,
        color: topic.color,
      });

      if (result.success) {
        globalThis.ui?.showNotification?.(`Topic duplicated as "${newName}"`, 'success');
      } else {
        globalThis.ui?.showNotification?.(result.error || 'Failed to duplicate topic', 'error');
      }
    } catch (err) {
      console.error('[script-topics] Duplicate error:', err.message);
      globalThis.ui?.showNotification?.('Error duplicating topic', 'error');
    }
  }

  async _addScriptToTopic(scriptId, topicId) {
    try {
      const result = await API.invoke('script-runner:add-script-to-topic', { script_id: scriptId, topic_id: topicId });
      if (result.success) {
        globalThis.ui?.showNotification?.('Script added to topic', 'success');
        // Reload topics to update counts
        await this.app.loadTopics();
        this.render();
      } else {
        globalThis.ui?.showNotification?.(result.error || 'Failed to add script', 'error');
      }
    } catch (err) {
      console.error('[script-topics] Add script error:', err.message);
      globalThis.ui?.showNotification?.('Error adding script', 'error');
    }
  }

  _showContextMenu(topicId, e) {
    this._contextMenuTopicId = topicId;
    const menu = this.container?.querySelector('#topic-context-menu');
    if (menu) {
      menu.style.display = 'block';
      menu.style.left = '0px';
      menu.style.top = '0px';
      const rect = menu.getBoundingClientRect();
      const x = Math.min(e.clientX, window.innerWidth - rect.width - 8);
      const y = Math.min(e.clientY, window.innerHeight - rect.height - 8);
      menu.style.left = Math.max(0, x) + 'px';
      menu.style.top = Math.max(0, y) + 'px';
    }
  }

  _hideContextMenu() {
    const menu = this.container?.querySelector('#topic-context-menu');
    if (menu) menu.style.display = 'none';
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  _handleExportTopics() {
    const topics = this.app.topics.map(({ id, name, description, color, created_at }) => ({
      id, name, description, color, created_at,
    }));
    const json = JSON.stringify({ version: 1, exported_at: new Date().toISOString(), topics }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `topics-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    globalThis.ui?.showNotification?.(`Exported ${topics.length} topic${topics.length === 1 ? '' : 's'}`, 'success');
  }

  _handleImportTopics() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const topics = Array.isArray(data) ? data : (data.topics || []);
        if (!topics.length) {
          globalThis.ui?.showNotification?.('No topics found in file', 'error');
          return;
        }

        let imported = 0;
        let skipped = 0;
        for (const t of topics) {
          if (!t.name) { skipped++; continue; }
          const existing = this.app.topics.find((e) => e.name === t.name);
          if (existing) { skipped++; continue; }
          const result = await API.invoke('script-runner:create-topic', {
            name: t.name,
            description: t.description || '',
            color: t.color || '#4A90E2',
          });
          if (result.success) imported++;
          else skipped++;
        }

        await this.app.loadTopics();
        this.render();
        const plural = imported === 1 ? '' : 's';
        const msg = skipped > 0
          ? `Imported ${imported}, skipped ${skipped} (duplicates or invalid)`
          : `Imported ${imported} topic${plural}`;
        globalThis.ui?.showNotification?.(msg, 'success');
      } catch (err) {
        console.error('[script-runner] Import topics error:', err.message);
        globalThis.ui?.showNotification?.('Failed to parse JSON file', 'error');
      }
    });
    input.click();
  }

  destroy() {
    for (const unsub of this.unsubscribes) {
      if (unsub) unsub();
    }
  }
}
