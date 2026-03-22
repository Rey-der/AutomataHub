/**
 * Unit tests for core/script-persistence.js
 * Run with: node --test tests/script-persistence.test.js
 */

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStore, createPersistence, createTempDir, cleanup } = require('./helpers');

describe('ScriptPersistence', () => {
  afterEach(() => {
    cleanup();
  });

  it('initialises and creates tables without error', async () => {
    const p = await createPersistence();
    assert.ok(p.db, 'db handle should exist');
    p.close();
  });

  it('saveTopic persists a topic that survives reload', async () => {
    const p = await createPersistence();
    const dbPath = p.dbPath;

    p.saveTopic({
      id: 't1',
      name: 'Dev',
      description: 'Development scripts',
      color: '#FF0000',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    });
    p.flush();
    p.close();

    // Reload from the same file
    const p2 = await createPersistence(dbPath);
    const store = createStore();
    await p2.loadIntoStore(store);

    const topic = store.getTopic('t1');
    assert.ok(topic, 'topic should be loaded back');
    assert.equal(topic.name, 'Dev');
    assert.equal(topic.description, 'Development scripts');
    assert.equal(topic.color, '#FF0000');
    p2.close();
  });

  it('removeTopic deletes the topic and its associations', async () => {
    const p = await createPersistence();
    const dbPath = p.dbPath;

    p.saveTopic({
      id: 't1', name: 'Dev', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
    });
    p.saveAssociation('s1', 't1', 0);
    p.removeTopic('t1');
    p.flush();
    p.close();

    // Reload and verify
    const p2 = await createPersistence(dbPath);
    const store = createStore();
    await p2.loadIntoStore(store);

    assert.equal(store.getTopic('t1'), null);
    assert.equal(store.getAllTopics().length, 0);
    p2.close();
  });

  it('saveAssociation round-trips through reload', async () => {
    const p = await createPersistence();
    const dbPath = p.dbPath;

    p.saveTopic({
      id: 't1', name: 'Dev', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
    });
    p.saveAssociation('s1', 't1', 0);
    p.saveAssociation('s2', 't1', 1);
    p.flush();
    p.close();

    const p2 = await createPersistence(dbPath);
    const store = createStore();
    // Add scripts so the association loading can reference them
    store.addScript({ id: 's1', name: 'A' });
    store.addScript({ id: 's2', name: 'B' });
    store.addTopic({ id: 't1', name: 'Dev', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' });
    await p2.loadIntoStore(store);

    // loadIntoStore adds topics from DB — but we already added t1 manually,
    // so check the associations map directly
    const scripts = store.getTopicScripts('t1');
    assert.equal(scripts.length, 2);
    p2.close();
  });

  it('removeAssociation deletes a specific link', async () => {
    const p = await createPersistence();
    const dbPath = p.dbPath;

    p.saveTopic({
      id: 't1', name: 'Dev', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
    });
    p.saveAssociation('s1', 't1', 0);
    p.removeAssociation('s1', 't1');
    p.flush();
    p.close();

    const p2 = await createPersistence(dbPath);
    const store = createStore();
    store.addScript({ id: 's1', name: 'A' });
    await p2.loadIntoStore(store);

    const topic = store.getTopic('t1');
    assert.ok(topic, 'topic should still exist');
    const scripts = store.getTopicScripts('t1');
    assert.equal(scripts.length, 0);
    p2.close();
  });

  it('flush writes the .sqlite file to disk', async () => {
    const p = await createPersistence();
    p.saveTopic({
      id: 't1', name: 'Flushed', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
    });
    p.flush();

    assert.ok(fs.existsSync(p.dbPath), 'sqlite file should exist on disk');
    const stat = fs.statSync(p.dbPath);
    assert.ok(stat.size > 0, 'file should have content');
    p.close();
  });

  it('close persists dirty data without explicit flush', async () => {
    const p = await createPersistence();
    const dbPath = p.dbPath;

    p.saveTopic({
      id: 't1', name: 'AutoFlushed', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
    });
    // No explicit flush — close should handle it
    p.close();

    assert.ok(fs.existsSync(dbPath), 'sqlite file should exist after close');

    const p2 = await createPersistence(dbPath);
    const store = createStore();
    await p2.loadIntoStore(store);
    assert.ok(store.getTopic('t1'), 'topic should survive close without explicit flush');
    p2.close();
  });

  it('throws when operating on an uninitialised database', async () => {
    const dbPath = path.join(createTempDir('sr-never-init'), 'never-init.sqlite');
    const p = new (require('../core/script-persistence').ScriptPersistence)(dbPath);
    assert.throws(() => p.saveTopic({ id: 't1', name: 'X' }), /not initialized/i);
  });
});
