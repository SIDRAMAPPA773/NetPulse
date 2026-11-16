const test = require('node:test');
const assert = require('node:assert/strict');
const { probeDnsQuery } = require('../utils/dnsProbe');

test('probeDnsQuery reports invalid resolver input without fabricating a result', async () => {
  const result = await probeDnsQuery('not-an-ip', 'example.com', { timeoutMs: 100 });
  assert.equal(result.status, 'INVALID');
  assert.equal(result.responseTimeMs, null);
});

test('probeDnsQuery resolves configured record types through the promises resolver', async () => {
  const result = await probeDnsQuery('8.8.8.8', 'example.com', {
    recordType: 'A',
    timeoutMs: 100,
    resolverFactory: () => ({
      setServers() {},
      resolve4: async () => ['192.0.2.10'],
    }),
  });
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.recordType, 'A');
  assert.deepEqual(result.addresses, ['192.0.2.10']);
});

test('probeDnsQuery reports unsupported record types explicitly', async () => {
  const result = await probeDnsQuery('8.8.8.8', 'example.com', { recordType: 'SOA' });
  assert.equal(result.status, 'INVALID');
});
