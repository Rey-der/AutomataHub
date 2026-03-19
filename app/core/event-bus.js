/**
 * Event Bus — secured inter-module communication.
 *
 * Modules communicate through a controlled EventBus that enforces:
 *   1. Event allowlist — only declared events can be emitted or listened to
 *   2. Source tracking — every emission is tagged with the module that sent it
 *   3. Payload type enforcement — payloads must be plain objects (no functions/classes)
 *   4. Scoped API — each module receives a frozen handle that can only emit
 *      events with its own moduleId as source
 *
 * Hub-level code uses hubBus directly. Modules receive scoped handles via
 * createModuleBus(moduleId) during setup.
 *
 * Usage (module setup):
 *   const bus = createModuleBus('netops');
 *   bus.on('module:data-available', (data) => { ... });
 *   bus.emit('module:data-available', { key: 'value' });
 *   // data received by listeners: { source: 'netops', key: 'value' }
 */

const { EventEmitter } = require('node:events');

// --- Allowed event names (add new events here as modules need them) ---
const ALLOWED_EVENTS = new Set([
  'module:activated',
  'module:deactivated',
  'module:data-available',
  'module:error',
]);

const hubBus = new EventEmitter();
hubBus.setMaxListeners(50);

/**
 * Validates that a payload is a plain object (no functions, arrays, or primitives).
 * Prevents callback injection and prototype pollution through the bus.
 */
function isPlainObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val) && Object.getPrototypeOf(val) === Object.prototype;
}

/**
 * Register a new allowed event name at runtime (e.g. during module loading).
 * Only hub-level code should call this.
 */
function registerEvent(eventName) {
  if (typeof eventName !== 'string' || eventName.length === 0) return;
  ALLOWED_EVENTS.add(eventName);
}

/**
 * Create a scoped bus handle for a module. The handle:
 *   - Only allows emitting/listening on declared event names
 *   - Tags every emitted payload with { source: moduleId }
 *   - Validates payloads are plain objects
 *   - Is frozen to prevent mutation
 *
 * @param {string} moduleId — the module's manifest id
 * @returns {object} frozen { on, off, emit }
 */
function createModuleBus(moduleId) {
  if (typeof moduleId !== 'string' || moduleId.length === 0) {
    throw new Error('createModuleBus requires a non-empty moduleId');
  }

  function guardEvent(event, action) {
    if (typeof event !== 'string' || !ALLOWED_EVENTS.has(event)) {
      console.warn(`[event-bus] Module "${moduleId}" tried to ${action} undeclared event: ${event}`);
      return false;
    }
    return true;
  }

  return Object.freeze({
    on(event, handler) {
      if (!guardEvent(event, 'listen to')) return () => {};
      if (typeof handler !== 'function') return () => {};
      hubBus.on(event, handler);
      return () => hubBus.off(event, handler);
    },

    off(event, handler) {
      if (!guardEvent(event, 'remove listener from')) return;
      hubBus.off(event, handler);
    },

    emit(event, payload) {
      if (!guardEvent(event, 'emit')) return;
      if (payload !== undefined && !isPlainObject(payload)) {
        console.warn(`[event-bus] Module "${moduleId}" emitted non-object payload on "${event}" — blocked`);
        return;
      }
      const data = { ...payload, source: moduleId };
      hubBus.emit(event, data);
    },
  });
}

module.exports = { hubBus, createModuleBus, registerEvent, ALLOWED_EVENTS };
