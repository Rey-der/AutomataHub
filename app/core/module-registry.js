/**
 * Module Registry — stores loaded module metadata and provides lookup methods.
 */

class ModuleRegistry {
  constructor() {
    this._modules = new Map();
  }

  /**
   * Register a module from its loaded manifest + handlers.
   * @param {object} mod - { id, name, version, description, tabTypes, ipcChannels, mainEntry, rendererScripts, setup, teardown }
   */
  register(mod) {
    if (!mod || !mod.id) throw new Error('Module must have an id');
    if (this._modules.has(mod.id)) throw new Error(`Module "${mod.id}" is already registered`);
    this._modules.set(mod.id, mod);
  }

  get(id) {
    return this._modules.get(id) || null;
  }

  getAll() {
    return [...this._modules.values()];
  }

  getAllowedChannels() {
    const channels = [];
    for (const mod of this._modules.values()) {
      if (Array.isArray(mod.ipcChannels)) {
        channels.push(...mod.ipcChannels);
      }
    }
    return channels;
  }

  getTabTypes() {
    const types = [];
    for (const mod of this._modules.values()) {
      if (Array.isArray(mod.tabTypes)) {
        for (const t of mod.tabTypes) {
          types.push({ moduleId: mod.id, ...t });
        }
      }
    }
    return types;
  }

  getRendererScripts() {
    const scripts = [];
    for (const mod of this._modules.values()) {
      if (Array.isArray(mod.rendererScripts)) {
        scripts.push(...mod.rendererScripts);
      }
    }
    return scripts;
  }
}

module.exports = { ModuleRegistry };
