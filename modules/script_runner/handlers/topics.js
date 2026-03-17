/**
 * Script Runner — Topics Handler
 * Handles topic CRUD operations.
 */

function register(ipcBridge, { store, persistence, emit }) {
  ipcBridge.handle('script-runner:get-topics', async (_e, _args) => {
    try {
      const topics = store.getAllTopics();
      return { topics };
    } catch (err) {
      console.error('[script-runner] get-topics error:', err.message);
      return { error: err.message };
    }
  });

  ipcBridge.handle('script-runner:create-topic', async (_e, args) => {
    try {
      const { name, description, color } = args || {};
      if (!name) return { success: false, error: 'Topic name is required' };

      // Check for duplicate names
      const existing = store.getAllTopics().find((t) => t.name === name);
      if (existing) return { success: false, error: `Topic "${name}" already exists` };

      const topic = {
        id: store.generateId(),
        name,
        description: description || '',
        color: color || '#4A90E2',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      store.addTopic(topic);
      if (persistence) await persistence.saveTopic(topic);

      emit('script-runner:topic-created', { topic });
      console.log('[script-runner] Created topic:', name);

      return { success: true, topic };
    } catch (err) {
      console.error('[script-runner] create-topic error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcBridge.handle('script-runner:update-topic', async (_e, args) => {
    try {
      const { topic_id, ...updates } = args || {};
      if (!topic_id) return { success: false, error: 'Topic ID is required' };

      const topic = store.updateTopic(topic_id, updates);
      if (persistence) await persistence.saveTopic(topic);

      emit('script-runner:topic-updated', { topic });
      console.log('[script-runner] Updated topic:', topic_id);

      return { success: true, topic };
    } catch (err) {
      console.error('[script-runner] update-topic error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcBridge.handle('script-runner:delete-topic', async (_e, args) => {
    try {
      const { topic_id } = args || {};
      if (!topic_id) return { success: false, error: 'Topic ID is required' };

      store.removeTopic(topic_id);
      if (persistence) await persistence.removeTopic(topic_id);

      emit('script-runner:topic-deleted', { topic_id });
      console.log('[script-runner] Deleted topic:', topic_id);

      return { success: true };
    } catch (err) {
      console.error('[script-runner] delete-topic error:', err.message);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { register };
