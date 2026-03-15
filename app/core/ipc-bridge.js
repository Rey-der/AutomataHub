/**
 * IPC Bridge — provides a safe interface for modules to register IPC handlers.
 * Tracks registered handlers so they can be cleaned up on quit.
 */

const { ipcMain } = require('electron');

class IpcBridge {
  constructor() {
    this._registeredHandlers = [];
  }

  /**
   * Register an IPC handler. The channel is NOT namespaced automatically;
   * modules should declare their full channel names in manifest.json.
   *
   * @param {string} channel
   * @param {Function} handler — async (event, args) => result
   */
  handle(channel, handler) {
    ipcMain.handle(channel, handler);
    this._registeredHandlers.push(channel);
  }

  /**
   * Remove all handlers registered through this bridge.
   */
  removeAll() {
    for (const channel of this._registeredHandlers) {
      try {
        ipcMain.removeHandler(channel);
      } catch {
        // Handler may have already been removed
      }
    }
    this._registeredHandlers = [];
  }

  /**
   * Get list of registered channels (for debugging).
   */
  getRegisteredChannels() {
    return [...this._registeredHandlers];
  }
}

module.exports = { IpcBridge };
