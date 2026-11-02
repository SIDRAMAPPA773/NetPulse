const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('dns').promises;
const { resolveHostname } = require('../utils/dnsProbe');

test('resolveHostname handles non-existent reverse PTR gracefully', async () => {
  // 192.0.2.1 is documentation prefix TEST-NET-1, usually has no PTR
  const result = await resolveHostname('192.0.2.1', { timeoutMs: 1500 });
  assert.equal(result.ipAddress, '192.0.2.1');
  assert.ok(['NXDOMAIN', 'TIMEOUT', 'ERROR'].includes(result.status));
  assert.ok(typeof result.errorReason === 'string');
});

test('resolveHostname parses successful reverse DNS lookup', async () => {
  const origReverse = dns.reverse;
  dns.reverse = async (ip) => {
    if (ip === '10.38.27.1') return ['gateway.campus.local', 'router.local'];
    throw new Error('Not found');
  };

  try {
    const result = await resolveHostname('10.38.27.1');
    assert.equal(result.status, 'RESOLVED');
    assert.equal(result.hostname, 'gateway.campus.local');
    assert.equal(result.hostnames.length, 2);
    assert.equal(result.errorReason, null);
    assert.ok(typeof result.responseTimeMs === 'number');
  } finally {
    dns.reverse = origReverse;
  }
});
