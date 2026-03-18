/**
 * Script Runner — Organization Handler
 * Handles script-topic associations and reordering.
 */

function register(ipcBridge, { store, persistence, emit }) {
  ipcBridge.handle('script-runner:add-script-to-topic', async (_e, args) => {
    try {
      const { script_id, topic_id, position } = args || {};
      if (!script_id || !topic_id) {
        return { success: false, error: 'script_id and topic_id are required' };
      }

      store.addScriptToTopic(script_id, topic_id, position || 0);
      if (persistence) {
        await persistence.saveAssociation(script_id, topic_id, position || 0);
        persistence.flush();
      }

      emit('script-runner:script-added-to-topic', { script_id, topic_id });
      console.log('[script-runner] Added script to topic:', script_id, topic_id);

      return { success: true };
    } catch (err) {
      console.error('[script-runner] add-script-to-topic error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcBridge.handle('script-runner:remove-script-from-topic', async (_e, args) => {
    try {
      const { script_id, topic_id } = args || {};
      if (!script_id || !topic_id) {
        return { success: false, error: 'script_id and topic_id are required' };
      }

      store.removeScriptFromTopic(script_id, topic_id);
      if (persistence) {
        await persistence.removeAssociation(script_id, topic_id);
        persistence.flush();
      }

      emit('script-runner:script-removed-from-topic', { script_id, topic_id });
      console.log('[script-runner] Removed script from topic:', script_id, topic_id);

      return { success: true };
    } catch (err) {
      console.error('[script-runner] remove-script-from-topic error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcBridge.handle('script-runner:reorder-topic-scripts', async (_e, args) => {
    try {
      const { topic_id, script_ids } = args || {};
      if (!topic_id || !Array.isArray(script_ids)) {
        return { success: false, error: 'topic_id and script_ids array are required' };
      }

      store.reorderTopicScripts(topic_id, script_ids);
      if (persistence) {
        script_ids.forEach((scriptId, index) => {
          persistence.saveAssociation(scriptId, topic_id, index);
        });
        persistence.flush();
      }

      emit('script-runner:topic-scripts-reordered', { topic_id, script_ids });
      console.log('[script-runner] Reordered scripts in topic:', topic_id);

      return { success: true };
    } catch (err) {
      console.error('[script-runner] reorder-topic-scripts error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcBridge.handle('script-runner:get-script-topics', async (_e, args) => {
    try {
      const { script_id } = args || {};
      if (!script_id) return { error: 'script_id is required' };

      const topics = store.getScriptTopics(script_id);
      return { topics };
    } catch (err) {
      console.error('[script-runner] get-script-topics error:', err.message);
      return { error: err.message };
    }
  });

  ipcBridge.handle('script-runner:get-topic-scripts', async (_e, args) => {
    try {
      const { topic_id } = args || {};
      if (!topic_id) return { error: 'topic_id is required' };

      const scripts = store.getTopicScripts(topic_id);
      return { scripts };
    } catch (err) {
      console.error('[script-runner] get-topic-scripts error:', err.message);
      return { error: err.message };
    }
  });
}

module.exports = { register };
