/**
 * Unit tests for core/script-store.js
 * Run with: node --test tests/script-store.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('./helpers');

describe('ScriptStore', () => {

  // --- Script CRUD ---

  describe('addScript / getScript / getAllScripts', () => {
    it('adds a script and retrieves it by id', () => {
      const store = createStore();
      const script = store.addScript({ id: 's1', name: 'Test Script', language: 'JS' });
      assert.equal(script.id, 's1');
      assert.deepStrictEqual(store.getScript('s1'), script);
    });

    it('getAllScripts returns all added scripts', () => {
      const store = createStore();
      store.addScript({ id: 's1', name: 'A' });
      store.addScript({ id: 's2', name: 'B' });
      const all = store.getAllScripts();
      assert.equal(all.length, 2);
      const ids = all.map(s => s.id).sort();
      assert.deepStrictEqual(ids, ['s1', 's2']);
    });

    it('getScript returns null for unknown id', () => {
      const store = createStore();
      assert.equal(store.getScript('nonexistent'), null);
    });

    it('throws when adding a script without id', () => {
      const store = createStore();
      assert.throws(() => store.addScript({ name: 'no id' }), /must have an id/i);
    });
  });

  describe('removeScript', () => {
    it('removes an existing script', () => {
      const store = createStore();
      store.addScript({ id: 's1', name: 'A' });
      store.removeScript('s1');
      assert.equal(store.getScript('s1'), null);
      assert.equal(store.getAllScripts().length, 0);
    });

    it('throws when removing a non-existent script', () => {
      const store = createStore();
      assert.throws(() => store.removeScript('nope'), /not found/i);
    });

    it('cleans up associations when a script is removed', () => {
      const store = createStore();
      store.addScript({ id: 's1', name: 'A' });
      store.addTopic({ id: 't1', name: 'Topic1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      store.addScriptToTopic('s1', 't1');
      store.removeScript('s1');
      assert.equal(store.getTopicScripts('t1').length, 0);
    });
  });

  describe('updateScript', () => {
    it('merges updates into an existing script', () => {
      const store = createStore();
      store.addScript({ id: 's1', name: 'Old' });
      store.updateScript('s1', { name: 'New' });
      assert.equal(store.getScript('s1').name, 'New');
    });

    it('sets updated_at timestamp', () => {
      const store = createStore();
      store.addScript({ id: 's1', name: 'A' });
      store.updateScript('s1', { name: 'B' });
      assert.ok(store.getScript('s1').updated_at);
    });

    it('throws for non-existent script', () => {
      const store = createStore();
      assert.throws(() => store.updateScript('nope', { name: 'X' }), /not found/i);
    });
  });

  // --- Topic CRUD ---

  describe('addTopic / getTopic / getAllTopics', () => {
    it('adds and retrieves a topic', () => {
      const store = createStore();
      const now = new Date().toISOString();
      const topic = store.addTopic({ id: 't1', name: 'Dev', created_at: now, updated_at: now });
      assert.equal(topic.id, 't1');
      assert.deepStrictEqual(store.getTopic('t1'), topic);
    });

    it('getAllTopics includes script_count', () => {
      const store = createStore();
      const now = new Date().toISOString();
      store.addTopic({ id: 't1', name: 'Dev', created_at: now, updated_at: now });
      store.addScript({ id: 's1', name: 'A' });
      store.addScriptToTopic('s1', 't1');
      const topics = store.getAllTopics();
      assert.equal(topics[0].script_count, 1);
    });

    it('getTopic returns null for unknown id', () => {
      const store = createStore();
      assert.equal(store.getTopic('nonexistent'), null);
    });

    it('throws when adding a topic without id', () => {
      const store = createStore();
      assert.throws(() => store.addTopic({ name: 'no id' }), /must have an id/i);
    });
  });

  describe('removeTopic', () => {
    it('removes an existing topic and its associations', () => {
      const store = createStore();
      const now = new Date().toISOString();
      store.addTopic({ id: 't1', name: 'Dev', created_at: now, updated_at: now });
      store.addScript({ id: 's1', name: 'A' });
      store.addScriptToTopic('s1', 't1');
      store.removeTopic('t1');
      assert.equal(store.getTopic('t1'), null);
      assert.equal(store.getScriptTopics('s1').length, 0);
    });

    it('throws for non-existent topic', () => {
      const store = createStore();
      assert.throws(() => store.removeTopic('nope'), /not found/i);
    });
  });

  // --- Associations ---

  describe('addScriptToTopic / removeScriptFromTopic', () => {
    it('creates and removes an association', () => {
      const store = createStore();
      const now = new Date().toISOString();
      store.addScript({ id: 's1', name: 'A' });
      store.addTopic({ id: 't1', name: 'Dev', created_at: now, updated_at: now });

      store.addScriptToTopic('s1', 't1');
      assert.equal(store.getTopicScripts('t1').length, 1);
      assert.equal(store.getTopicScripts('t1')[0].id, 's1');

      store.removeScriptFromTopic('s1', 't1');
      assert.equal(store.getTopicScripts('t1').length, 0);
    });

    it('throws when adding to a non-existent topic', () => {
      const store = createStore();
      store.addScript({ id: 's1', name: 'A' });
      assert.throws(() => store.addScriptToTopic('s1', 'missing'), /not found/i);
    });

    it('throws when adding a non-existent script', () => {
      const store = createStore();
      const now = new Date().toISOString();
      store.addTopic({ id: 't1', name: 'Dev', created_at: now, updated_at: now });
      assert.throws(() => store.addScriptToTopic('missing', 't1'), /not found/i);
    });
  });

  describe('getTopicScripts / getScriptTopics', () => {
    it('returns only scripts in the requested topic', () => {
      const store = createStore();
      const now = new Date().toISOString();
      store.addScript({ id: 's1', name: 'A' });
      store.addScript({ id: 's2', name: 'B' });
      store.addTopic({ id: 't1', name: 'Dev', created_at: now, updated_at: now });
      store.addTopic({ id: 't2', name: 'Ops', created_at: now, updated_at: now });

      store.addScriptToTopic('s1', 't1');
      store.addScriptToTopic('s2', 't2');

      const t1Scripts = store.getTopicScripts('t1');
      assert.equal(t1Scripts.length, 1);
      assert.equal(t1Scripts[0].id, 's1');
    });

    it('getScriptTopics returns all topics for a script', () => {
      const store = createStore();
      const now = new Date().toISOString();
      store.addScript({ id: 's1', name: 'A' });
      store.addTopic({ id: 't1', name: 'Dev', created_at: now, updated_at: now });
      store.addTopic({ id: 't2', name: 'Ops', created_at: now, updated_at: now });

      store.addScriptToTopic('s1', 't1');
      store.addScriptToTopic('s1', 't2');

      const topics = store.getScriptTopics('s1');
      assert.equal(topics.length, 2);
    });
  });

  describe('reorderTopicScripts', () => {
    it('updates positions for scripts in a topic', () => {
      const store = createStore();
      const now = new Date().toISOString();
      store.addScript({ id: 's1', name: 'A' });
      store.addScript({ id: 's2', name: 'B' });
      store.addTopic({ id: 't1', name: 'Dev', created_at: now, updated_at: now });

      store.addScriptToTopic('s1', 't1', 0);
      store.addScriptToTopic('s2', 't1', 1);

      // Reverse order
      store.reorderTopicScripts('t1', ['s2', 's1']);

      const scripts = store.getTopicScripts('t1');
      assert.equal(scripts[0].id, 's2');
      assert.equal(scripts[1].id, 's1');
    });
  });

  // --- ID Generation ---

  describe('generateId', () => {
    it('returns a UUID string', () => {
      const store = createStore();
      const id = store.generateId();
      assert.equal(typeof id, 'string');
      assert.ok(id.length > 10);
    });

    it('generates unique ids', () => {
      const store = createStore();
      const ids = new Set(Array.from({ length: 50 }, () => store.generateId()));
      assert.equal(ids.size, 50);
    });
  });
});
