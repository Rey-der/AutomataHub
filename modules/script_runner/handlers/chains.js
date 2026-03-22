/**
 * Script Runner — Chains Handler
 * CRUD for user-defined chains (ordered sequences of scripts).
 */

function register(ipcBridge, { store, persistence, emit }) {
  ipcBridge.handle('script-runner:get-chains', async (_e, _args) => {
    try {
      return { chains: store.getAllChains() };
    } catch (err) {
      console.error('[script-runner] get-chains error:', err.message);
      return { error: err.message };
    }
  });

  ipcBridge.handle('script-runner:create-chain', async (_e, args) => {
    try {
      const { name, script_ids } = args || {};
      if (!name || !name.trim()) return { success: false, error: 'Chain name is required' };

      const existing = store.getAllChains().find((c) => c.name === name.trim());
      if (existing) return { success: false, error: `Chain "${name}" already exists` };

      const chain = {
        id: store.generateId(),
        name: name.trim(),
        script_ids: script_ids || [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      store.addChain(chain);
      if (persistence) {
        persistence.saveChain(chain);
        persistence.flush();
      }

      emit('script-runner:chain-created', { chain });
      console.log('[script-runner] Created chain:', chain.name);
      return { success: true, chain };
    } catch (err) {
      console.error('[script-runner] create-chain error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcBridge.handle('script-runner:update-chain', async (_e, args) => {
    try {
      const { chain_id, name, script_ids } = args || {};
      if (!chain_id) return { success: false, error: 'Chain ID is required' };

      const updates = {};
      if (name !== undefined) updates.name = name.trim();
      if (script_ids !== undefined) updates.script_ids = script_ids;

      const chain = store.updateChain(chain_id, updates);
      if (persistence) {
        persistence.saveChain(chain);
        persistence.flush();
      }

      emit('script-runner:chain-updated', { chain });
      return { success: true, chain };
    } catch (err) {
      console.error('[script-runner] update-chain error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcBridge.handle('script-runner:delete-chain', async (_e, args) => {
    try {
      const { chain_id } = args || {};
      if (!chain_id) return { success: false, error: 'Chain ID is required' };

      store.removeChain(chain_id);
      if (persistence) {
        persistence.removeChain(chain_id);
        persistence.flush();
      }

      emit('script-runner:chain-deleted', { chain_id });
      console.log('[script-runner] Deleted chain:', chain_id);
      return { success: true };
    } catch (err) {
      console.error('[script-runner] delete-chain error:', err.message);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { register };
