const test = require('node:test');
const assert = require('node:assert');
const { isValidIPv4, parseCidr, enumerateHosts } = require('../utils/ipValidation');

test('validates IPv4', () => {
  assert.strictEqual(isValidIPv4('192.168.1.1'), true);
  assert.strictEqual(isValidIPv4('999.1.1.1'), false);
  assert.strictEqual(isValidIPv4('abc'), false);
});

test('parses /24', () => {
  const info = parseCidr('192.168.1.0/24');
  assert.strictEqual(info.hostCount, 254);
  assert.strictEqual(info.network, '192.168.1.0');
  assert.strictEqual(info.firstHost, '192.168.1.1');
  assert.strictEqual(info.lastHost, '192.168.1.254');
});

test('rejects too large subnet', () => {
  const r = enumerateHosts('10.0.0.0/8', 1024);
  assert.strictEqual(r.error, 'EXCEEDS_MAX');
});

test('enumerates /24 hosts', () => {
  const r = enumerateHosts('192.168.1.0/24', 1024);
  assert.strictEqual(r.hosts.length, 254);
});