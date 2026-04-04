/**
 * Unit tests for NetworkScanner.parseCIDR
 * Run with: node --test modules/netops/tests/network-scanner.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { NetworkScanner } = require('../monitoring/network-scanner');

describe('NetworkScanner.parseCIDR', () => {
  it('returns single IP when no mask given', () => {
    const ips = NetworkScanner.parseCIDR('10.0.0.5');
    assert.deepEqual(ips, ['10.0.0.5']);
  });

  it('returns single IP for /32 mask', () => {
    const ips = NetworkScanner.parseCIDR('10.0.0.5/32');
    assert.deepEqual(ips, ['10.0.0.5']);
  });

  it('expands /30 to 2 usable hosts', () => {
    const ips = NetworkScanner.parseCIDR('192.168.1.0/30');
    // /30 = network .0, usable .1 .2, broadcast .3
    assert.deepEqual(ips, ['192.168.1.1', '192.168.1.2']);
  });

  it('expands /29 to 6 usable hosts', () => {
    const ips = NetworkScanner.parseCIDR('10.0.0.0/29');
    assert.equal(ips.length, 6);
    assert.equal(ips[0], '10.0.0.1');
    assert.equal(ips[5], '10.0.0.6');
  });

  it('expands /24 to 254 usable hosts', () => {
    const ips = NetworkScanner.parseCIDR('192.168.1.0/24');
    assert.equal(ips.length, 254);
    assert.equal(ips[0], '192.168.1.1');
    assert.equal(ips[253], '192.168.1.254');
  });

  it('excludes network and broadcast addresses', () => {
    const ips = NetworkScanner.parseCIDR('10.0.0.0/24');
    assert.ok(!ips.includes('10.0.0.0'), 'should exclude network address');
    assert.ok(!ips.includes('10.0.0.255'), 'should exclude broadcast address');
  });

  it('throws on invalid CIDR mask', () => {
    assert.throws(() => NetworkScanner.parseCIDR('10.0.0.0/33'), /Invalid CIDR mask/);
    assert.throws(() => NetworkScanner.parseCIDR('10.0.0.0/-1'), /Invalid CIDR mask/);
  });

  it('throws on invalid IP octets', () => {
    assert.throws(() => NetworkScanner.parseCIDR('999.0.0.0/24'), /Invalid IP address/);
  });

  it('handles /31 edge case (2 addresses, 0 usable)', () => {
    const ips = NetworkScanner.parseCIDR('10.0.0.0/31');
    // network=.0, broadcast=.1 — no usable hosts between them
    // parseCIDR returns empty → falls back to original IP
    assert.ok(ips.length >= 1);
  });
});
