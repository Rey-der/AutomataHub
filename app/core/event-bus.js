/**
 * Event Bus — minimal inter-module communication.
 * Modules can emit/listen to hub-level events without direct coupling.
 *
 * Usage (in a module's setup):
 *   const { hubBus } = require('../../app/core/event-bus');
 *   hubBus.on('module:activated', (data) => { ... });
 *   hubBus.emit('module:data-available', { source: 'my-module', payload });
 *
 * Keep usage minimal — only add events when two modules actually need to talk.
 */

const { EventEmitter } = require('node:events');

const hubBus = new EventEmitter();

// Prevent runaway listener warnings for hub-wide events
hubBus.setMaxListeners(50);

module.exports = { hubBus };
