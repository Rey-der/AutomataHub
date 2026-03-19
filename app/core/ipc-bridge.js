/**
 * IPC Bridge — provides a safe interface for modules to register IPC handlers.
 * Tracks registered handlers so they can be cleaned up on quit.
 *
 * When an allowedChannels set is provided, only channels declared in the
 * module's manifest can be registered. This prevents modules from hijacking
 * undeclared channels.
 */

const { ipcMain } = require('electron');

class IpcBridge {
  /**
   * @param {Set<string>} [allowedChannels] — if provided, only these channels can be registered
   */
  constructor(allowedChannels) {
    this._registeredHandlers = [];
    this._allowedChannels = allowedChannels instanceof Set ? allowedChannels : null;
  }

  /**
   * Register an IPC handler. If an allowlist was provided at construction,
   * the channel must be in that list.
   *
   * @param {string} channel
   * @param {Function} handler — async (event, args) => result
   */
  handle(channel, handler) {
    if (this._allowedChannels && !this._allowedChannels.has(channel)) {
      console.warn(`[ipc-bridge] Blocked registration of undeclared channel: ${channel}`);
      return;
    }
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
