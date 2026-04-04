/**
 * Integration tests for modules/sql_visualizer/db-bridge.js
 * Run with: node --test modules/sql_visualizer/tests/db-bridge.test.js
 *
 * Uses sql.js in-memory fallback since better-sqlite3 is compiled against
 * Electron's Node.js version and cannot be loaded in plain Node.js.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const dbBridge = require('../db-bridge');

describe('db-bridge (sql.js fallback)', () => {

  before(async () => {
    // Initialize with the in-memory sql.js demo database
    await dbBridge.initSqlJsFallback();
  });

  after(() => {
    dbBridge.close();
  });

  // ── Connection lifecycle ──────────────────────────────────────

  it('is connected after initSqlJsFallback', () => {
    assert.equal(dbBridge.isConnected(), true);
  });

  it('close resets state', () => {
    dbBridge.close();
    assert.equal(dbBridge.isConnected(), false);
    assert.equal(dbBridge.getDbPath(), null);
  });

  // ── Schema introspection ──────────────────────────────────────

  describe('schema', () => {
    before(async () => await dbBridge.initSqlJsFallback());
    after(() => dbBridge.close());

    it('getTables returns table names from in-memory DB', () => {
      const tables = dbBridge.getTables();
      assert.ok(tables.includes('automation_logs'), `Expected automation_logs in [${tables}]`);
      assert.ok(tables.includes('execution_tracking'));
      assert.ok(tables.includes('errors'));
    });

    it('getTableInfo returns column definitions', () => {
      const info = dbBridge.getTableInfo('automation_logs');
      const names = info.map(c => c.name);
      assert.ok(names.includes('id'));
      assert.ok(names.includes('timestamp'));
      assert.ok(names.includes('script'));
      assert.ok(names.includes('status'));
    });

    it('getRowCount returns correct count', () => {
      const count = dbBridge.getRowCount('automation_logs');
      assert.equal(count, 3);
    });

    it('getTableStats returns stats for all tables', () => {
      const stats = dbBridge.getTableStats();
      assert.ok(Array.isArray(stats));
      const logStats = stats.find(s => s.table === 'automation_logs');
      assert.ok(logStats);
      assert.equal(logStats.count, 3);
    });
  });

  // ── Querying ──────────────────────────────────────────────────

  describe('queries', () => {
    before(async () => await dbBridge.initSqlJsFallback());
    after(() => dbBridge.close());

    it('queryRows returns rows with limit', () => {
      const result = dbBridge.queryRows('automation_logs', { limit: 2 });
      assert.equal(result.rows.length, 2);
      assert.equal(result.total, 3);
    });

    it('queryRows with offset returns remainder', () => {
      const result = dbBridge.queryRows('automation_logs', { limit: 2, offset: 2 });
      assert.equal(result.rows.length, 1);
    });

    it('runReadOnlyQuery executes arbitrary SELECT', () => {
      const result = dbBridge.runReadOnlyQuery("SELECT script FROM automation_logs WHERE status = 'SUCCESS'");
      assert.equal(result.rows.length, 3);
      assert.ok(result.rows.some(r => r.script === 'backup-runner'));
    });

    it('runReadOnlyQuery blocks non-SELECT statements', () => {
      assert.throws(
        () => dbBridge.runReadOnlyQuery('DELETE FROM automation_logs'),
        /Only SELECT/,
      );
    });

    it('runReadOnlyQuery blocks SQL injection via comments', () => {
      assert.throws(
        () => dbBridge.runReadOnlyQuery('SELECT 1 -- DROP TABLE users'),
        /comments are not allowed/,
      );
    });

    it('runReadOnlyQuery blocks multi-statement injection', () => {
      assert.throws(
        () => dbBridge.runReadOnlyQuery('SELECT 1; DROP TABLE users'),
        /single SQL statement/,
      );
    });
  });

  // ── CSV export ────────────────────────────────────────────────

  describe('exportCsv', () => {
    before(async () => await dbBridge.initSqlJsFallback());
    after(() => dbBridge.close());

    it('exports query results as CSV string', () => {
      const csv = dbBridge.exportCsv('SELECT script, status FROM automation_logs');
      assert.ok(csv.includes('script'));
      assert.ok(csv.includes('backup-runner'));
      // Header + 3 data rows
      const lines = csv.trim().split('\n');
      assert.equal(lines.length, 4);
    });
  });
});
