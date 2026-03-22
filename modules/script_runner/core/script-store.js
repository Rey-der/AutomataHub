/**
 * Script Runner — ScriptStore
 * In-memory store for scripts and topics (similar to NetOpsStore).
 * Persistence is handled separately via ScriptPersistence.
 */

const crypto = require('node:crypto');

class ScriptStore {
  constructor() {
    this.scripts = new Map(); // scriptId -> script object
    this.topics = new Map(); // topicId -> topic object
    this.associations = new Map(); // `${scriptId}:${topicId}` -> { position }
    this.chains = new Map(); // chainId -> { id, name, script_ids: [] }
    this.schedules = new Map(); // scheduleId -> { id, target_type, target_id, cron, name, enabled, ... }
    this.persistence = null;
  }

  // --- ID Generation ---

  generateId() {
    return crypto.randomUUID();
  }

  // --- Topic Management ---

  addTopic(topic) {
    if (!topic?.id) throw new Error('Topic must have an id');
    this.topics.set(topic.id, topic);
    return topic;
  }

  updateTopic(topicId, updates) {
    const topic = this.topics.get(topicId);
    if (!topic) throw new Error(`Topic not found: ${topicId}`);
    Object.assign(topic, updates, { updated_at: new Date().toISOString() });
    if (this.persistence) this.persistence.saveTopic(topic);
    return topic;
  }

  removeTopic(topicId) {
    if (!this.topics.has(topicId)) throw new Error(`Topic not found: ${topicId}`);
    // Remove all associations with this topic
    for (const [key] of this.associations) {
      if (key.endsWith(`:${topicId}`)) {
        this.associations.delete(key);
      }
    }
    this.topics.delete(topicId);
    if (this.persistence) this.persistence.removeTopic(topicId);
  }

  getTopic(topicId) {
    return this.topics.get(topicId) || null;
  }

  getAllTopics() {
    const topics = Array.from(this.topics.values()).map((t) => ({
      ...t,
      script_count: this.getTopicScripts(t.id).length,
    }));
    return topics;
  }

  // --- Script Management ---

  addScript(script) {
    if (!script?.id) throw new Error('Script must have an id');
    this.scripts.set(script.id, script);
    return script;
  }

  updateScript(scriptId, updates) {
    const script = this.scripts.get(scriptId);
    if (!script) throw new Error(`Script not found: ${scriptId}`);
    Object.assign(script, updates, { updated_at: new Date().toISOString() });
    return script;
  }

  removeScript(scriptId) {
    if (!this.scripts.has(scriptId)) throw new Error(`Script not found: ${scriptId}`);
    // Remove all associations with this script
    for (const [key] of this.associations) {
      if (key.startsWith(`${scriptId}:`)) {
        this.associations.delete(key);
      }
    }
    this.scripts.delete(scriptId);
  }

  getScript(scriptId) {
    return this.scripts.get(scriptId) || null;
  }

  getAllScripts() {
    return Array.from(this.scripts.values());
  }

  // --- Script-Topic Associations ---

  addScriptToTopic(scriptId, topicId, position = 0) {
    if (!this.scripts.has(scriptId)) throw new Error(`Script not found: ${scriptId}`);
    if (!this.topics.has(topicId)) throw new Error(`Topic not found: ${topicId}`);
    const key = `${scriptId}:${topicId}`;
    this.associations.set(key, { position });
    if (this.persistence) this.persistence.saveAssociation(scriptId, topicId, position);
  }

  removeScriptFromTopic(scriptId, topicId) {
    const key = `${scriptId}:${topicId}`;
    this.associations.delete(key);
    if (this.persistence) this.persistence.removeAssociation(scriptId, topicId);
  }

  getScriptTopics(scriptId) {
    const result = [];
    for (const [key, assoc] of this.associations) {
      if (key.startsWith(`${scriptId}:`)) {
        const topicId = key.split(':')[1];
        const topic = this.topics.get(topicId);
        if (topic) result.push({ ...topic, position: assoc.position });
      }
    }
    return result.sort((a, b) => a.position - b.position);
  }

  getTopicScripts(topicId) {
    const result = [];
    for (const [key, assoc] of this.associations) {
      if (key.endsWith(`:${topicId}`)) {
        const scriptId = key.split(':')[0];
        const script = this.scripts.get(scriptId);
        if (script) result.push({ ...script, position: assoc.position });
      }
    }
    return result.sort((a, b) => a.position - b.position);
  }

  reorderTopicScripts(topicId, scriptIds) {
    if (!this.topics.has(topicId)) throw new Error(`Topic not found: ${topicId}`);
    scriptIds.forEach((scriptId, index) => {
      const key = `${scriptId}:${topicId}`;
      if (this.associations.has(key)) {
        this.associations.get(key).position = index;
        if (this.persistence) this.persistence.saveAssociation(scriptId, topicId, index);
      }
    });
  }

  // --- Persistence Setup ---

  setPersistence(persistence) {
    this.persistence = persistence;
  }

  // --- User Chain Management ---

  addChain(chain) {
    if (!chain?.id) throw new Error('Chain must have an id');
    this.chains.set(chain.id, { ...chain, script_ids: chain.script_ids || [] });
    return this.chains.get(chain.id);
  }

  updateChain(chainId, updates) {
    const chain = this.chains.get(chainId);
    if (!chain) throw new Error(`Chain not found: ${chainId}`);
    Object.assign(chain, updates, { updated_at: new Date().toISOString() });
    return chain;
  }

  removeChain(chainId) {
    if (!this.chains.has(chainId)) throw new Error(`Chain not found: ${chainId}`);
    this.chains.delete(chainId);
  }

  getChain(chainId) {
    return this.chains.get(chainId) || null;
  }

  getAllChains() {
    return Array.from(this.chains.values());
  }

  // --- Schedule Management ---

  addSchedule(schedule) {
    if (!schedule?.id) throw new Error('Schedule must have an id');
    this.schedules.set(schedule.id, { ...schedule });
    return this.schedules.get(schedule.id);
  }

  updateSchedule(scheduleId, updates) {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`);
    Object.assign(schedule, updates, { updated_at: new Date().toISOString() });
    return schedule;
  }

  removeSchedule(scheduleId) {
    if (!this.schedules.has(scheduleId)) throw new Error(`Schedule not found: ${scheduleId}`);
    this.schedules.delete(scheduleId);
  }

  getSchedule(scheduleId) {
    return this.schedules.get(scheduleId) || null;
  }

  getAllSchedules() {
    return Array.from(this.schedules.values());
  }
}

module.exports = { ScriptStore };
